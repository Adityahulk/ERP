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

function signedPaymentSql(alias = 'p') {
  return `CASE
    WHEN ${alias}.payment_type = 'bank_deposit' THEN ${alias}.amount
    WHEN ${alias}.payment_type = 'bank_withdrawal' THEN -${alias}.amount
    WHEN ${alias}.payment_mode IN ('bank_transfer', 'neft', 'rtgs', 'upi', 'online', 'card', 'cheque')
      AND ${alias}.payment_type IN ('incoming', 'receipt', 'payment_in') THEN ${alias}.amount
    WHEN ${alias}.payment_mode IN ('bank_transfer', 'neft', 'rtgs', 'upi', 'online', 'card', 'cheque')
      AND ${alias}.payment_type IN ('outgoing', 'payment_out') THEN -${alias}.amount
    ELSE 0
  END`;
}

function signedCashSql(alias = 'p') {
  return `CASE
    WHEN ${alias}.payment_type = 'bank_deposit' THEN -${alias}.amount
    WHEN ${alias}.payment_type = 'bank_withdrawal' THEN ${alias}.amount
    WHEN ${alias}.payment_mode = 'cash' AND ${alias}.payment_type IN ('incoming', 'receipt', 'payment_in') THEN ${alias}.amount
    WHEN ${alias}.payment_mode = 'cash' AND ${alias}.payment_type IN ('outgoing', 'payment_out') THEN -${alias}.amount
    ELSE 0
  END`;
}

export async function getCashBankSummary(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;

    const cashRes = await query(
      `SELECT COALESCE(SUM(${signedCashSql('p')}), 0)::bigint AS balance
       FROM payments p
       WHERE p.company_id = $1 AND p.is_deleted = false AND COALESCE(p.status, 'posted') != 'cancelled'`,
      [companyId],
    );

    const banksRes = await query(
      `SELECT ba.id, ba.account_label, ba.bank_name, ba.account_number, ba.ifsc, ba.upi_id, ba.is_primary,
              COALESCE(SUM(${signedPaymentSql('p')}), 0)::bigint AS balance
       FROM company_bank_accounts ba
       LEFT JOIN payments p ON p.company_bank_account_id = ba.id
         AND p.company_id = ba.company_id
         AND p.is_deleted = false
         AND COALESCE(p.status, 'posted') != 'cancelled'
       WHERE ba.company_id = $1 AND ba.is_deleted = false AND ba.is_active = true
       GROUP BY ba.id
       ORDER BY ba.is_primary DESC, ba.bank_name ASC, ba.account_label ASC`,
      [companyId],
    );

    const unassignedBankRes = await query(
      `SELECT COALESCE(SUM(${signedPaymentSql('p')}), 0)::bigint AS balance
       FROM payments p
       WHERE p.company_id = $1 AND p.is_deleted = false AND COALESCE(p.status, 'posted') != 'cancelled'
         AND p.company_bank_account_id IS NULL
         AND p.payment_mode IN ('bank_transfer', 'neft', 'rtgs', 'upi', 'online', 'card', 'cheque')`,
      [companyId],
    );

    const chequesRes = await query(
      `SELECT p.*, pt.name AS party_name, ba.account_label, ba.bank_name
       FROM payments p
       LEFT JOIN parties pt ON pt.id = p.party_id
       LEFT JOIN company_bank_accounts ba ON ba.id = p.company_bank_account_id
       WHERE p.company_id = $1 AND p.is_deleted = false
         AND p.payment_mode = 'cheque'
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT 50`,
      [companyId],
    );

    const recentRes = await query(
      `SELECT p.*, pt.name AS party_name, ba.account_label, ba.bank_name,
              ${signedPaymentSql('p')}::bigint AS signed_bank_amount,
              ${signedCashSql('p')}::bigint AS signed_cash_amount
       FROM payments p
       LEFT JOIN parties pt ON pt.id = p.party_id
       LEFT JOIN company_bank_accounts ba ON ba.id = p.company_bank_account_id
       WHERE p.company_id = $1 AND p.is_deleted = false AND COALESCE(p.status, 'posted') != 'cancelled'
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT 80`,
      [companyId],
    );

    res.json(success({
      cash_in_hand: Number(cashRes.rows[0]?.balance || 0),
      bank_accounts: banksRes.rows,
      unassigned_bank_balance: Number(unassignedBankRes.rows[0]?.balance || 0),
      cheques: chequesRes.rows,
      recent_transactions: recentRes.rows,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getCashBankTransactions(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const companyId = req.user!.company_id;
    const where: string[] = ['p.company_id = $1', 'p.is_deleted = false'];
    const params: any[] = [companyId];
    let idx = 2;
    if (req.query.account_id) {
      where.push(`p.company_bank_account_id = $${idx++}`);
      params.push(String(req.query.account_id));
    }
    if (req.query.mode) {
      where.push(`p.payment_mode = $${idx++}`);
      params.push(String(req.query.mode));
    }
    if (req.query.from_date) {
      where.push(`p.payment_date >= $${idx++}::date`);
      params.push(String(req.query.from_date));
    }
    if (req.query.to_date) {
      where.push(`p.payment_date <= $${idx++}::date`);
      params.push(String(req.query.to_date));
    }

    const rows = await query(
      `SELECT p.*, pt.name AS party_name, ba.account_label, ba.bank_name,
              ${signedPaymentSql('p')}::bigint AS signed_bank_amount,
              ${signedCashSql('p')}::bigint AS signed_cash_amount
       FROM payments p
       LEFT JOIN parties pt ON pt.id = p.party_id
       LEFT JOIN company_bank_accounts ba ON ba.id = p.company_bank_account_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
    );
    const countRes = await query(`SELECT COUNT(*) FROM payments p WHERE ${where.join(' AND ')}`, params);
    res.json(success(buildPaginatedResponse(rows.rows, Number(countRes.rows[0]?.count || 0), page, limit)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function createCashBankAdjustment(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body || {};
    const type = String(d.type || '').trim();
    if (!['bank_deposit', 'bank_withdrawal'].includes(type)) {
      return res.status(400).json(error('type must be bank_deposit or bank_withdrawal'));
    }
    const amount = Math.round(Number(d.amount) || 0);
    if (amount <= 0) return res.status(400).json(error('Enter a valid amount'));
    if (!d.company_bank_account_id) return res.status(400).json(error('Select a bank account'));

    const result = await withTransaction(async (client) => {
      const bank = await client.query(
        `SELECT id FROM company_bank_accounts
         WHERE id = $1 AND company_id = $2 AND is_deleted = false AND is_active = true`,
        [d.company_bank_account_id, companyId],
      );
      if (!bank.rows.length) throw new Error('Bank account not found');
      const pay = await client.query(
        `INSERT INTO payments (
           company_id, payment_type, payment_number, payment_date, amount,
           payment_mode, reference_number, company_bank_account_id, notes, created_by
         )
         VALUES ($1,$2,$3,$4,$5,'cash_bank_transfer',$6,$7,$8,$9)
         RETURNING *`,
        [
          companyId,
          type,
          `${type === 'bank_deposit' ? 'DEP' : 'WDL'}-${Date.now()}`,
          d.payment_date || new Date().toISOString().split('T')[0],
          amount,
          d.reference_number || null,
          d.company_bank_account_id,
          d.notes || (type === 'bank_deposit' ? 'Cash deposited to bank' : 'Cash withdrawn from bank'),
          req.user!.id,
        ],
      );
      return pay.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    res.status(400).json(error(err.message));
  }
}

export async function listLoanAccounts(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const loans = await query(
      `SELECT la.*,
              COALESCE((
                SELECT json_agg(t ORDER BY t.transaction_date DESC, t.created_at DESC)
                FROM (
                  SELECT *
                  FROM loan_transactions lt
                  WHERE lt.loan_account_id = la.id AND lt.company_id = la.company_id
                  ORDER BY lt.transaction_date DESC, lt.created_at DESC
                  LIMIT 20
                ) t
              ), '[]'::json) AS transactions
       FROM loan_accounts la
       WHERE la.company_id = $1 AND la.is_deleted = false
       ORDER BY la.is_active DESC, la.created_at DESC`,
      [companyId],
    );
    res.json(success(loans.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message || 'Failed to load loan accounts'));
  }
}

export async function createLoanAccount(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body || {};
    const accountName = String(d.account_name || '').trim();
    if (!accountName) return res.status(400).json(error('Loan account name is required'));
    const principal = Math.round(Number(d.principal_amount) || 0);
    if (principal < 0) return res.status(400).json(error('Opening loan amount cannot be negative'));

    const result = await withTransaction(async (client) => {
      const loan = await client.query(
        `INSERT INTO loan_accounts (
           company_id, account_name, lender_name, principal_amount, current_balance,
           interest_rate, notes, created_by
         ) VALUES ($1,$2,$3,$4,$4,$5,$6,$7)
         RETURNING *`,
        [
          companyId,
          accountName,
          String(d.lender_name || '').trim() || null,
          principal,
          Number(d.interest_rate) || 0,
          String(d.notes || '').trim() || null,
          req.user!.id,
        ],
      );
      if (principal > 0) {
        await client.query(
          `INSERT INTO loan_transactions (
             company_id, loan_account_id, transaction_type, amount,
             transaction_date, reference_number, notes, created_by
           ) VALUES ($1,$2,'disbursement',$3,$4,$5,$6,$7)`,
          [
            companyId,
            loan.rows[0].id,
            principal,
            d.transaction_date || new Date().toISOString().split('T')[0],
            String(d.reference_number || '').trim() || null,
            'Opening loan balance',
            req.user!.id,
          ],
        );
      }
      return loan.rows[0];
    });
    res.status(201).json(success(result));
  } catch (err: any) {
    res.status(400).json(error(err.message || 'Failed to create loan account'));
  }
}

export async function recordLoanTransaction(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const d = req.body || {};
    const type = String(d.transaction_type || '').trim();
    if (!['disbursement', 'repayment', 'interest', 'adjustment'].includes(type)) {
      return res.status(400).json(error('Invalid loan transaction type'));
    }
    const amount = Math.round(Number(d.amount) || 0);
    if (amount <= 0) return res.status(400).json(error('Enter a valid amount'));

    const result = await withTransaction(async (client) => {
      const loan = await client.query(
        `SELECT * FROM loan_accounts
         WHERE id = $1 AND company_id = $2 AND is_deleted = false
         FOR UPDATE`,
        [id, companyId],
      );
      if (!loan.rows.length) throw new Error('Loan account not found');
      const delta = ['disbursement', 'interest'].includes(type) ? amount : -amount;
      const nextBalance = Math.max(0, Number(loan.rows[0].current_balance || 0) + delta);
      const tx = await client.query(
        `INSERT INTO loan_transactions (
           company_id, loan_account_id, transaction_type, amount,
           transaction_date, reference_number, notes, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          companyId,
          id,
          type,
          amount,
          d.transaction_date || new Date().toISOString().split('T')[0],
          String(d.reference_number || '').trim() || null,
          String(d.notes || '').trim() || null,
          req.user!.id,
        ],
      );
      await client.query(
        `UPDATE loan_accounts
         SET current_balance = $1, is_active = $2, updated_at = NOW()
         WHERE id = $3 AND company_id = $4`,
        [nextBalance, nextBalance > 0, id, companyId],
      );
      return tx.rows[0];
    });
    res.status(201).json(success(result));
  } catch (err: any) {
    res.status(400).json(error(err.message || 'Failed to record loan transaction'));
  }
}
