import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';

/** Default report window for GL-style statements (matches reports module). */
function parseRange(req: Request): { from: string; to: string } {
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  const to = String(req.query.to_date || req.query.to || d.toISOString().split('T')[0]);
  const from = String(req.query.from_date || req.query.from || monthStart);
  return { from, to };
}

function accountTypeLower(t: unknown): string {
  return String(t || '').toLowerCase();
}

// ── Chart of Accounts ─────────────────────────────────────────

export async function getAccounts(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT * FROM accounts WHERE company_id = $1 AND is_deleted = false ORDER BY code ASC`,
      [req.user!.company_id]
    );

    // Build hierarchy (nesting)
    const map = new Map();
    const roots: any[] = [];
    result.rows.forEach(r => {
      r.children = [];
      map.set(r.id, r);
    });

    result.rows.forEach(r => {
      if (r.parent_id && map.has(r.parent_id)) {
        map.get(r.parent_id).children.push(r);
      } else {
        roots.push(r);
      }
    });

    res.json(success(roots));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createAccount(req: Request, res: Response) {
  try {
    const d = req.body;
    const result = await query(
      `INSERT INTO accounts (company_id, name, code, account_type, account_subtype, parent_id, opening_balance, is_system, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
       [req.user!.company_id, d.name, d.code, d.account_type, d.account_subtype, d.parent_id, d.opening_balance || 0, false, d.description]
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function updateAccount(req: Request, res: Response) {
   // simplified update payload
   try {
     const { id } = req.params;
     const result = await query(
       `UPDATE accounts SET name = $1, account_type = $2, code = $3 WHERE id = $4 AND company_id = $5 AND is_system = false RETURNING *`,
       [req.body.name, req.body.account_type, req.body.code, id, req.user!.company_id]
     );
     res.json(success(result.rows[0]));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function deleteAccount(req: Request, res: Response) {
  try {
     const check = await query('SELECT COUNT(*) FROM journal_entry_lines WHERE account_id = $1', [req.params.id]);
     if (parseInt(check.rows[0].count) > 0) return res.status(400).json(error("Cannot delete account with existing transactions"));

     await query('UPDATE accounts SET is_deleted = true WHERE id = $1 AND company_id = $2 AND is_system = false', [req.params.id, req.user!.company_id]);
     res.json(success({ message: 'Deleted' }));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

// ── Journal Entries ───────────────────────────────────────────

export async function createJournalEntry(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { entry_date, description, lines } = req.body; // lines: [{account_id, debit, credit, description, party_id}]

    let totalDebit = 0, totalCredit = 0;
    lines.forEach((l: any) => {
      totalDebit += (l.debit || 0);
      totalCredit += (l.credit || 0);
    });

    if (totalDebit !== totalCredit) return res.status(400).json(error('Debits and Credits must be equal'));
    if (totalDebit === 0) return res.status(400).json(error('Journal entry cannot be empty'));

    const result = await withTransaction(async (client) => {
      // Auto-sequence
      const seqRes = await client.query(`SELECT COUNT(*) FROM journal_entries WHERE company_id = $1`, [companyId]);
      const entryNum = `JV/${new Date().getFullYear().toString().slice(-2)}/${String(parseInt(seqRes.rows[0].count)+1).padStart(4,'0')}`;
      
      const jeRes = await client.query(
        `INSERT INTO journal_entries (company_id, entry_number, entry_date, description, total_debit, total_credit, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'posted',$7) RETURNING *`,
         [companyId, entryNum, entry_date || new Date().toISOString().split('T')[0], description, totalDebit, totalCredit, req.user!.id]
      );
      
      const jeId = jeRes.rows[0].id;

      let sort_order = 0;
      for (const line of lines) {
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, company_id, account_id, debit, credit, description, party_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [jeId, companyId, line.account_id, line.debit || 0, line.credit || 0, line.description, line.party_id, sort_order++]
        );
      }

      return jeRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function listJournalEntries(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const result = await query(
      `SELECT * FROM journal_entries WHERE company_id = $1 AND is_deleted = false ORDER BY entry_date DESC LIMIT $2 OFFSET $3`,
      [req.user!.company_id, limit, offset]
    );
    const countRes = await query('SELECT COUNT(*) FROM journal_entries WHERE company_id = $1 AND is_deleted = false', [req.user!.company_id]);
    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getJournalEntry(req: Request, res: Response) {
   try {
     const je = await query('SELECT * FROM journal_entries WHERE id = $1', [req.params.id]);
     const lines = await query(`SELECT l.*, a.name as account_name FROM journal_entry_lines l LEFT JOIN accounts a ON l.account_id = a.id WHERE l.entry_id = $1`, [req.params.id]);
     res.json(success({...je.rows[0], lines: lines.rows}));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function reverseJournalEntry(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const je = await query('SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (!je.rows.length) return res.status(404).json(error('Not found'));
    if (je.rows[0].status === 'reversed') return res.status(400).json(error('Already reversed'));

    const lines = await query('SELECT * FROM journal_entry_lines WHERE entry_id = $1', [id]);
    
    // We construct a new payload and call the same logic as Create but swapping debit/credit
    const reversedLines = lines.rows.map(r => ({
       account_id: r.account_id,
       debit: r.credit,        // swap
       credit: r.debit,        // swap
       description: `Reversal of ${je.rows[0].entry_number}`,
       party_id: r.party_id
    }));

    // In a real execution environment, we'd directly run the transaction internally without the request body spoofing, but to save token limits we'll directly insert:
    const result = await withTransaction(async (client) => {
       const seqRes = await client.query(`SELECT COUNT(*) FROM journal_entries WHERE company_id = $1`, [companyId]);
       const entryNum = `JV-REV/${new Date().getFullYear().toString().slice(-2)}/${String(parseInt(seqRes.rows[0].count)+1).padStart(4,'0')}`;
      
       const newJe = await client.query(
        `INSERT INTO journal_entries (company_id, entry_number, entry_date, description, total_debit, total_credit, status, reversed_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'posted',$7,$8) RETURNING *`,
         [companyId, entryNum, new Date().toISOString().split('T')[0], `Reversing ${je.rows[0].entry_number}`, je.rows[0].total_credit, je.rows[0].total_debit, je.rows[0].id, req.user!.id]
       );

       for (let i = 0; i < reversedLines.length; i++) {
         const line = reversedLines[i];
         await client.query(
          `INSERT INTO journal_entry_lines (entry_id, company_id, account_id, debit, credit, description, party_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [newJe.rows[0].id, companyId, line.account_id, line.debit, line.credit, line.description, line.party_id, i]
        );
       }
       await client.query("UPDATE journal_entries SET status = 'reversed' WHERE id = $1", [id]);
       return newJe.rows[0];
    });

    res.json(success(result));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

// ── Financial Statements ──────────────────────────────────────

export async function getLedger(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const accRes = await query(
      `SELECT * FROM accounts WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, companyId],
    );
    if (!accRes.rows.length) return res.status(404).json(error('Account not found'));
    const account = accRes.rows[0];
    const at = accountTypeLower(account.account_type);

    let priorMovement = 0;
    if (from) {
      const priorRes = await query(
        `SELECT COALESCE(SUM(
            CASE WHEN LOWER(a.account_type) IN ('asset', 'expense') THEN jel.debit - jel.credit
            ELSE jel.credit - jel.debit END
          ), 0)::bigint AS prior
         FROM accounts a
         JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
         JOIN journal_entries j ON j.id = jel.entry_id AND j.company_id = a.company_id
         WHERE a.id = $1 AND a.company_id = $2
           AND j.status = 'posted' AND j.is_deleted = false
           AND j.entry_date < $3::date`,
        [id, companyId, from],
      );
      priorMovement = Number(priorRes.rows[0]?.prior || 0);
    }
    const openingBalancePaise = Number(account.opening_balance || 0) + priorMovement;

    const lineParams: unknown[] = [id, companyId];
    let lineIdx = 3;
    let dateFilter = '';
    if (from) {
      dateFilter += ` AND j.entry_date >= $${lineIdx}::date`;
      lineParams.push(from);
      lineIdx++;
    }
    if (to) {
      dateFilter += ` AND j.entry_date <= $${lineIdx}::date`;
      lineParams.push(to);
      lineIdx++;
    }

    const linesRes = await query(
      `SELECT l.*, j.entry_date, j.entry_number, j.description AS entry_description
       FROM journal_entry_lines l
       JOIN journal_entries j ON l.entry_id = j.id
       WHERE l.account_id = $1 AND j.company_id = $2
         AND j.status = 'posted' AND j.is_deleted = false
         ${dateFilter}
       ORDER BY j.entry_date ASC, l.sort_order ASC, l.id ASC`,
      lineParams,
    );

    let running = openingBalancePaise;
    const lines = linesRes.rows.map((row: Record<string, unknown>) => {
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      const signed = ['asset', 'expense'].includes(at) ? debit - credit : credit - debit;
      running += signed;
      return { ...row, signed_amount_paise: signed, balance_after_paise: running };
    });

    res.json(
      success({
        account: {
          id: account.id,
          name: account.name,
          code: account.code,
          account_type: account.account_type,
        },
        period: { from, to },
        opening_balance_paise: openingBalancePaise,
        closing_balance_paise: running,
        lines,
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getTrialBalance(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT a.id, a.code, a.name, a.account_type,
              COALESCE(a.opening_balance, 0)::bigint AS opening_balance_paise,
              COALESCE(SUM(
                CASE
                  WHEN je.id IS NULL THEN 0
                  WHEN LOWER(a.account_type) IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0)::bigint AS period_net_paise,
              (COALESCE(a.opening_balance, 0) + COALESCE(SUM(
                CASE
                  WHEN je.id IS NULL THEN 0
                  WHEN LOWER(a.account_type) IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0))::bigint AS closing_balance_paise
        FROM accounts a
        LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
        LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = a.company_id
          AND je.is_deleted = false AND COALESCE(je.status, 'posted') = 'posted'
          AND je.entry_date >= $2::date AND je.entry_date <= $3::date
        WHERE a.company_id = $1 AND a.is_deleted = false AND a.is_active = true
        GROUP BY a.id, a.code, a.name, a.account_type, a.opening_balance
        HAVING (COALESCE(a.opening_balance, 0) + COALESCE(SUM(
                CASE
                  WHEN je.id IS NULL THEN 0
                  WHEN LOWER(a.account_type) IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0)) != 0
        ORDER BY a.account_type, a.code NULLS LAST, a.name`,
      [companyId, from, to],
    );

    res.json(success({ period: { from, to }, rows: result.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getProfitLoss(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const byAccount = await query(
      `SELECT a.id, a.code, a.name, a.account_type,
              COALESCE(SUM(
                CASE
                  WHEN LOWER(a.account_type) = 'expense' THEN jel.debit - jel.credit
                  WHEN LOWER(a.account_type) = 'income' THEN jel.credit - jel.debit
                  ELSE 0
                END
              ), 0)::bigint AS period_net_paise
       FROM accounts a
       JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
       JOIN journal_entries j ON j.id = jel.entry_id AND j.company_id = a.company_id
       WHERE a.company_id = $1 AND a.is_deleted = false
         AND LOWER(a.account_type) IN ('income', 'expense')
         AND j.status = 'posted' AND j.is_deleted = false
         AND j.entry_date >= $2::date AND j.entry_date <= $3::date
       GROUP BY a.id, a.code, a.name, a.account_type
       ORDER BY LOWER(a.account_type), a.code NULLS LAST`,
      [companyId, from, to],
    );

    const summary = await query(
      `SELECT LOWER(a.account_type) AS bucket,
              COALESCE(SUM(
                CASE
                  WHEN LOWER(a.account_type) = 'expense' THEN jel.debit - jel.credit
                  WHEN LOWER(a.account_type) = 'income' THEN jel.credit - jel.debit
                  ELSE 0
                END
              ), 0)::bigint AS net_paise
       FROM accounts a
       JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
       JOIN journal_entries j ON j.id = jel.entry_id AND j.company_id = a.company_id
       WHERE a.company_id = $1 AND a.is_deleted = false
         AND LOWER(a.account_type) IN ('income', 'expense')
         AND j.status = 'posted' AND j.is_deleted = false
         AND j.entry_date >= $2::date AND j.entry_date <= $3::date
       GROUP BY LOWER(a.account_type)`,
      [companyId, from, to],
    );

    res.json(
      success({
        period: { from, to },
        summary: summary.rows,
        accounts: byAccount.rows,
        note: 'Journal-based P&L from posted entries only. Operational P&L from sales/expenses lives under /api/reports/profit-loss.',
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getBalanceSheet(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT LOWER(a.account_type) AS account_type,
              COALESCE(SUM(
                CASE
                  WHEN LOWER(a.account_type) IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0)::bigint AS period_net_paise
       FROM accounts a
       JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
       JOIN journal_entries j ON j.id = jel.entry_id AND j.company_id = a.company_id
       WHERE a.company_id = $1 AND a.is_deleted = false
         AND LOWER(a.account_type) IN ('asset', 'liability', 'equity')
         AND j.status = 'posted' AND j.is_deleted = false
         AND j.entry_date >= $2::date AND j.entry_date <= $3::date
       GROUP BY LOWER(a.account_type)`,
      [companyId, from, to],
    );
    res.json(
      success({
        period: { from, to },
        components: result.rows,
        note: 'Period movement by bucket from journals. Full balance sheet with opening balances: GET /api/reports/balance-sheet.',
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getCashFlow(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    res.json(
      success({
        implemented: false,
        period: { from, to },
        message:
          'Cash flow is not computed from journals in this build. Review bank/cash ledgers (asset accounts) and the trial balance for liquidity.',
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
