import { Request, Response } from 'express';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { query } from '../config/db';
import { success, error } from '../lib/response';

function signedBankSql(alias = 'p') {
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

async function loadSession(companyId: string, sessionId: string) {
  const res = await query(
    `SELECT s.*, ba.account_name, ba.bank_name
     FROM bank_reconciliation_sessions s
     JOIN company_bank_accounts ba ON ba.id = s.company_bank_account_id
     WHERE s.id = $1 AND s.company_id = $2 AND s.is_deleted = false`,
    [sessionId, companyId],
  );
  return res.rows[0] || null;
}

function normalizeHeader(h: string): string {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function parseAmount(raw: unknown): number {
  const s = String(raw ?? '').replace(/,/g, '').trim();
  if (!s) return 0;
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function parseCsvDate(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yy = dmy[3];
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export async function createSession(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { company_bank_account_id, statement_from, statement_to } = req.body || {};
    if (!company_bank_account_id || !statement_from || !statement_to) {
      return res.status(400).json(error('company_bank_account_id, statement_from and statement_to are required'));
    }

    const bank = await query(
      `SELECT id FROM company_bank_accounts WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [company_bank_account_id, companyId],
    );
    if (!bank.rows.length) return res.status(404).json(error('Bank account not found'));

    const bal = await query(
      `SELECT COALESCE(SUM(${signedBankSql('p')}), 0)::bigint AS balance
       FROM payments p
       WHERE p.company_id = $1 AND p.company_bank_account_id = $2
         AND p.is_deleted = false AND COALESCE(p.status, 'posted') = 'posted'
         AND p.payment_date <= $3::date`,
      [companyId, company_bank_account_id, statement_to],
    );

    const created = await query(
      `INSERT INTO bank_reconciliation_sessions (
         company_id, company_bank_account_id, statement_from, statement_to,
         book_balance_paise, statement_balance_paise
       ) VALUES ($1,$2,$3,$4,$5,0)
       RETURNING *`,
      [companyId, company_bank_account_id, statement_from, statement_to, Number(bal.rows[0]?.balance || 0)],
    );
    res.status(201).json(success(created.rows[0]));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function uploadStatement(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json(error('No CSV file uploaded'));
    const companyId = req.user!.company_id;
    const { sessionId } = req.params;
    const session = await loadSession(companyId, sessionId);
    if (!session) return res.status(404).json(error('Reconciliation session not found'));

    const content = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
    if (!records.length) return res.status(400).json(error('CSV has no data rows'));

    const headerMap: Record<string, string> = {};
    for (const key of Object.keys(records[0])) {
      const n = normalizeHeader(key);
      if (['date', 'txn_date', 'transaction_date'].includes(n)) headerMap.date = key;
      else if (['description', 'narration', 'particulars', 'details'].includes(n)) headerMap.description = key;
      else if (['debit', 'withdrawal', 'dr'].includes(n)) headerMap.debit = key;
      else if (['credit', 'deposit', 'cr'].includes(n)) headerMap.credit = key;
      else if (['reference', 'ref', 'cheque_no', 'utr', 'reference_no'].includes(n)) headerMap.reference = key;
    }
    if (!headerMap.date) return res.status(400).json(error('CSV must include a Date column'));

    let inserted = 0;
    let statementNet = 0;
    for (const row of records) {
      const txnDate = parseCsvDate(row[headerMap.date]);
      if (!txnDate) continue;
      const debit = headerMap.debit ? parseAmount(row[headerMap.debit]) : 0;
      const credit = headerMap.credit ? parseAmount(row[headerMap.credit]) : 0;
      if (!debit && !credit) continue;
      const description = headerMap.description ? String(row[headerMap.description] || '').trim() : '';
      const reference = headerMap.reference ? String(row[headerMap.reference] || '').trim() : '';
      await query(
        `INSERT INTO bank_statement_lines (session_id, txn_date, description, debit_paise, credit_paise, reference)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sessionId, txnDate, description || null, debit, credit, reference || null],
      );
      statementNet += credit - debit;
      inserted++;
    }

    await query(
      `UPDATE bank_reconciliation_sessions
       SET statement_balance_paise = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [Number(session.statement_balance_paise || 0) + statementNet, sessionId, companyId],
    );

    try { fs.unlinkSync(req.file.path); } catch {}
    res.json(success({ inserted, statement_net_paise: statementNet }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getSession(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { sessionId } = req.params;
    const session = await loadSession(companyId, sessionId);
    if (!session) return res.status(404).json(error('Reconciliation session not found'));

    const lines = await query(
      `SELECT * FROM bank_statement_lines
       WHERE session_id = $1 AND is_deleted = false
       ORDER BY txn_date, created_at`,
      [sessionId],
    );

    const matchedPaymentIds = lines.rows
      .filter((l: any) => l.matched_payment_id)
      .map((l: any) => l.matched_payment_id);

    const book = await query(
      `SELECT p.id, p.payment_date, p.payment_type, p.payment_mode, p.amount,
              p.reference_number, p.notes, p.party_name_snapshot,
              (${signedBankSql('p')})::bigint AS signed_amount_paise
       FROM payments p
       WHERE p.company_id = $1 AND p.company_bank_account_id = $2
         AND p.is_deleted = false AND COALESCE(p.status, 'posted') = 'posted'
         AND p.payment_date >= $3::date AND p.payment_date <= $4::date
       ORDER BY p.payment_date, p.created_at`,
      [companyId, session.company_bank_account_id, session.statement_from, session.statement_to],
    );

    const bookRows = book.rows.map((p: any) => ({
      ...p,
      match_status: matchedPaymentIds.includes(p.id) ? 'matched' : 'unmatched',
    }));

    res.json(
      success({
        session,
        statement_lines: lines.rows,
        book_entries: bookRows,
        summary: {
          statement_matched: lines.rows.filter((l: any) => l.match_status === 'matched').length,
          statement_unmatched: lines.rows.filter((l: any) => l.match_status === 'unmatched').length,
          book_matched: bookRows.filter((b: any) => b.match_status === 'matched').length,
          book_unmatched: bookRows.filter((b: any) => b.match_status === 'unmatched').length,
        },
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function autoMatch(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { sessionId } = req.params;
    const session = await loadSession(companyId, sessionId);
    if (!session) return res.status(404).json(error('Reconciliation session not found'));

    const unmatchedLines = await query(
      `SELECT * FROM bank_statement_lines
       WHERE session_id = $1 AND is_deleted = false AND match_status = 'unmatched'`,
      [sessionId],
    );

    const payments = await query(
      `SELECT p.id, p.payment_date, p.amount, p.reference_number, p.notes,
              (${signedBankSql('p')})::bigint AS signed_amount_paise
       FROM payments p
       WHERE p.company_id = $1 AND p.company_bank_account_id = $2
         AND p.is_deleted = false AND COALESCE(p.status, 'posted') = 'posted'
         AND p.payment_date >= $3::date AND p.payment_date <= $4::date
         AND NOT EXISTS (
           SELECT 1 FROM bank_statement_lines bsl
           WHERE bsl.matched_payment_id = p.id AND bsl.is_deleted = false
         )`,
      [companyId, session.company_bank_account_id, session.statement_from, session.statement_to],
    );

    let matched = 0;
    for (const line of unmatchedLines.rows) {
      const lineAmount = Number(line.credit_paise || 0) - Number(line.debit_paise || 0);
      const absAmount = Math.abs(lineAmount);
      if (!absAmount) continue;

      const candidate = payments.rows.find((p: any) => {
        const payAmount = Math.abs(Number(p.signed_amount_paise || 0));
        if (payAmount !== absAmount) return false;
        const lineDate = new Date(line.txn_date);
        const payDate = new Date(p.payment_date);
        const diffDays = Math.abs((lineDate.getTime() - payDate.getTime()) / 86400000);
        if (diffDays > 3) return false;
        const ref = String(line.reference || '').toLowerCase();
        if (ref) {
          const payRef = `${p.reference_number || ''} ${p.notes || ''}`.toLowerCase();
          if (!payRef.includes(ref) && !ref.includes(String(p.reference_number || '').toLowerCase())) {
            return false;
          }
        }
        return true;
      });

      if (!candidate) continue;
      await query(
        `UPDATE bank_statement_lines
         SET match_status = 'matched', matched_payment_id = $1
         WHERE id = $2 AND session_id = $3`,
        [candidate.id, line.id, sessionId],
      );
      matched++;
      payments.rows = payments.rows.filter((p: any) => p.id !== candidate.id);
    }

    res.json(success({ matched }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function manualMatch(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { sessionId } = req.params;
    const { statement_line_id, payment_id } = req.body || {};
    if (!statement_line_id || !payment_id) {
      return res.status(400).json(error('statement_line_id and payment_id are required'));
    }

    const session = await loadSession(companyId, sessionId);
    if (!session) return res.status(404).json(error('Reconciliation session not found'));

    const line = await query(
      `SELECT * FROM bank_statement_lines WHERE id = $1 AND session_id = $2 AND is_deleted = false`,
      [statement_line_id, sessionId],
    );
    if (!line.rows.length) return res.status(404).json(error('Statement line not found'));

    const payment = await query(
      `SELECT id FROM payments
       WHERE id = $1 AND company_id = $2 AND company_bank_account_id = $3
         AND is_deleted = false AND COALESCE(status, 'posted') = 'posted'`,
      [payment_id, companyId, session.company_bank_account_id],
    );
    if (!payment.rows.length) return res.status(404).json(error('Payment not found for this bank account'));

    await query(
      `UPDATE bank_statement_lines
       SET match_status = 'matched', matched_payment_id = $1
       WHERE id = $2 AND session_id = $3`,
      [payment_id, statement_line_id, sessionId],
    );
    res.json(success({ matched: true }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function unmatch(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { sessionId } = req.params;
    const { statement_line_id } = req.body || {};
    if (!statement_line_id) return res.status(400).json(error('statement_line_id is required'));

    const session = await loadSession(companyId, sessionId);
    if (!session) return res.status(404).json(error('Reconciliation session not found'));

    await query(
      `UPDATE bank_statement_lines
       SET match_status = 'unmatched', matched_payment_id = NULL
       WHERE id = $1 AND session_id = $2`,
      [statement_line_id, sessionId],
    );
    res.json(success({ unmatched: true }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function completeSession(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { sessionId } = req.params;
    const session = await loadSession(companyId, sessionId);
    if (!session) return res.status(404).json(error('Reconciliation session not found'));

    const updated = await query(
      `UPDATE bank_reconciliation_sessions
       SET status = 'reconciled', updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [sessionId, companyId],
    );
    res.json(success(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function listSessions(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const bankAccountId = req.query.company_bank_account_id;
    const params: unknown[] = [companyId];
    let sql = `SELECT s.*, ba.account_name, ba.bank_name
               FROM bank_reconciliation_sessions s
               JOIN company_bank_accounts ba ON ba.id = s.company_bank_account_id
               WHERE s.company_id = $1 AND s.is_deleted = false`;
    if (bankAccountId) {
      params.push(bankAccountId);
      sql += ` AND s.company_bank_account_id = $${params.length}`;
    }
    sql += ' ORDER BY s.created_at DESC LIMIT 50';
    const result = await query(sql, params);
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
