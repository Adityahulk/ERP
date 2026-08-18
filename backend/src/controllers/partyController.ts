import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blankToNull(v: unknown): unknown {
  return typeof v === 'string' && v.trim() === '' ? null : v;
}

function moneyInt(v: unknown, fallback = 0): number {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function dayInt(v: unknown, fallback = 30): number {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

// ── GET /api/parties ──────────────────────────────────────────
export async function listParties(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, party_type, is_active, has_balance } = req.query;

    let where = 'p.company_id = $1 AND p.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) {
      where += ` AND (p.name ILIKE $${idx} OR p.phone ILIKE $${idx} OR p.gstin ILIKE $${idx} OR p.email ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }
    if (party_type) { where += ` AND p.party_type = $${idx}`; params.push(party_type); idx++; }
    if (is_active !== undefined) { where += ` AND p.is_active = $${idx}`; params.push(is_active === 'true'); idx++; }
    if (has_balance === 'true') { where += ` AND p.balance != 0`; }

    const countRes = await query(`SELECT COUNT(*) FROM parties p WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM invoices i WHERE i.party_id = p.id AND i.is_deleted = false) as invoice_count,
              (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i WHERE i.party_id = p.id AND i.is_deleted = false AND i.status != 'cancelled') as total_business
       FROM parties p
       WHERE ${where}
       ORDER BY p.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Summary stats
    const statsRes = await query(
      `SELECT 
         COUNT(*)::int as total_parties,
         COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) as total_receivable,
         COALESCE(SUM(ABS(balance)) FILTER (WHERE balance < 0), 0) as total_payable
       FROM parties WHERE company_id = $1 AND is_deleted = false`,
      [companyId]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit), statsRes.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/parties/:id ──────────────────────────────────────
export async function getParty(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    if (!UUID_RE.test(id)) return res.status(400).json(error('Invalid party id'));

    const partyRes = await query(
      'SELECT * FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]
    );
    if (!partyRes.rows.length) return res.status(404).json(error('Party not found'));

    // Recent invoices
    const invoiceRes = await query(
      `SELECT id, invoice_number, invoice_date, total_amount, balance_due, status, invoice_type
       FROM invoices WHERE party_id = $1 AND company_id = $2 AND is_deleted = false
       ORDER BY invoice_date DESC LIMIT 10`,
      [id, companyId]
    );

    // Recent payments
    const paymentRes = await query(
      `SELECT id, payment_number, payment_date, amount, payment_mode, 'posted'::varchar as status
       FROM payments WHERE party_id = $1 AND company_id = $2 AND is_deleted = false
       ORDER BY payment_date DESC LIMIT 10`,
      [id, companyId]
    );

    // Ledger summary
    const ledgerRes = await query(
      `SELECT 
         COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as total_debit,
         COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as total_credit
       FROM party_ledger WHERE party_id = $1 AND company_id = $2`,
      [id, companyId]
    );

    res.json(success({
      ...partyRes.rows[0],
      invoices: invoiceRes.rows,
      payments: paymentRes.rows,
      ledger_summary: ledgerRes.rows[0],
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/parties ─────────────────────────────────────────
export async function createParty(req: Request, res: Response) {
  const companyId = req.user!.company_id;
  try {
    const d = req.body;
    const gstin =
      d.gstin && String(d.gstin).trim().length === 15 ? String(d.gstin).trim().toUpperCase() : null;
    const opening = moneyInt(d.opening_balance, 0);
    const party = await withTransaction(async (client) => {
      if (gstin) {
        const dupGst = await client.query(
          'SELECT id FROM parties WHERE company_id = $1 AND gstin = $2 AND is_deleted = false',
          [companyId, gstin],
        );
        if (dupGst.rows.length) throw new Error('A party with this GSTIN already exists');
      }
      if (d.phone) {
        const dupPhone = await client.query(
          'SELECT id FROM parties WHERE company_id = $1 AND phone = $2 AND is_deleted = false',
          [companyId, String(d.phone).trim()],
        );
        if (dupPhone.rows.length) throw new Error('A party with this phone number already exists');
      }

      const result = await client.query(
        `INSERT INTO parties (
          company_id, name, party_type, phone, email, gstin, pan,
          billing_address, shipping_address,
          billing_city, billing_state, billing_pincode, billing_state_code,
          city, state, pincode, state_code,
          credit_limit, credit_days, payment_terms,
          opening_balance, balance,
          contact_person, notes, custom_fields
        ) VALUES (
          $1, $2, 'party', $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12,
          $9, $10, $11, $12,
          $13, $14, $14,
          $15, $15,
          $16, $17, $18
        ) RETURNING *`,
        [
          companyId,
          String(d.name).trim(),
          blankToNull(typeof d.phone === 'string' ? d.phone.trim() : d.phone),
          blankToNull(typeof d.email === 'string' ? d.email.trim().toLowerCase() : d.email),
          gstin,
          blankToNull(typeof d.pan === 'string' ? d.pan.trim().toUpperCase() : d.pan),
          blankToNull(d.billing_address),
          blankToNull(d.shipping_address),
          blankToNull(d.city || d.billing_city),
          blankToNull(d.state || d.billing_state),
          blankToNull(d.pincode || d.billing_pincode),
          blankToNull(d.state_code || d.billing_state_code),
          moneyInt(d.credit_limit, 0),
          dayInt(d.payment_terms ?? d.credit_days, 30),
          opening,
          blankToNull(d.contact_person),
          blankToNull(d.notes),
          d.custom_fields ? JSON.stringify(d.custom_fields) : '{}',
        ],
      );

      if (opening !== 0) {
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, narration, created_by)
           VALUES ($1, $2, $3, $4, $5, 'Opening Balance', $6)`,
          [
            companyId,
            result.rows[0].id,
            opening > 0 ? 'debit' : 'credit',
            Math.abs(opening),
            opening,
            req.user!.id,
          ],
        );
      }
      return result.rows[0];
    });

    await logAction(req.user!.id, companyId, 'create', 'party', party.id, null, { name: d.name, gstin: gstin ?? undefined }, req.ip);
    res.status(201).json(success(party));
  } catch (err: any) {
    const message = err?.code === '23505'
      ? 'A party with the same GSTIN or phone number already exists'
      : err?.message || 'Failed to create party';
    console.error('createParty error:', {
      companyId,
      code: err?.code,
      constraint: err?.constraint,
      message: err?.message,
    });
    res.status(/already exists/i.test(message) ? 409 : 500).json(error(message));
  }
}

// ── PATCH /api/parties/:id ────────────────────────────────────
export async function updateParty(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const existing = await query('SELECT * FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]);
    if (!existing.rows.length) return res.status(404).json(error('Party not found'));

    if (req.body.gstin !== undefined) {
      const raw = String(req.body.gstin ?? '').trim().toUpperCase();
      if (raw.length > 0 && raw.length !== 15) {
        return res.status(400).json(error('GSTIN must be exactly 15 characters or left empty'));
      }
      req.body.gstin = raw.length === 0 ? null : raw;
    }

    // GSTIN uniqueness (skip when cleared / null)
    if (req.body.gstin && req.body.gstin !== existing.rows[0].gstin) {
      const dup = await query('SELECT id FROM parties WHERE company_id = $1 AND gstin = $2 AND is_deleted = false AND id != $3', [companyId, req.body.gstin, id]);
      if (dup.rows.length) return res.status(400).json(error('A party with this GSTIN already exists'));
    }

    const fields = [
      'name','phone','email','gstin','pan',
      'billing_address','shipping_address',
      'credit_limit','contact_person','notes','is_active','custom_fields',
    ];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    const numericFields = new Set(['credit_limit']);
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        values.push(
          f === 'custom_fields'
            ? JSON.stringify(req.body[f])
            : numericFields.has(f)
              ? moneyInt(req.body[f], 0)
              : blankToNull(req.body[f]),
        );
      }
    }

    // Sync city/state/pincode to both billing_* and legacy columns
    const cityVal = req.body.city ?? req.body.billing_city;
    if (cityVal !== undefined) {
      updates.push(`billing_city = $${idx}`, `city = $${idx++}`);
      values.push(blankToNull(cityVal));
    }
    const stateVal = req.body.state ?? req.body.billing_state;
    if (stateVal !== undefined) {
      updates.push(`billing_state = $${idx}`, `state = $${idx++}`);
      values.push(blankToNull(stateVal));
    }
    const pincodeVal = req.body.pincode ?? req.body.billing_pincode;
    if (pincodeVal !== undefined) {
      updates.push(`billing_pincode = $${idx}`, `pincode = $${idx++}`);
      values.push(blankToNull(pincodeVal));
    }
    const stateCodeVal = req.body.state_code ?? req.body.billing_state_code;
    if (stateCodeVal !== undefined) {
      updates.push(`billing_state_code = $${idx}`, `state_code = $${idx++}`);
      values.push(blankToNull(stateCodeVal));
    }
    const termsVal = req.body.payment_terms ?? req.body.credit_days;
    if (termsVal !== undefined) {
      updates.push(`credit_days = $${idx}`, `payment_terms = $${idx++}`);
      values.push(dayInt(termsVal, existing.rows[0].credit_days || 30));
    }
    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(id, companyId);
    const result = await query(
      `UPDATE parties SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, values
    );

    await logAction(req.user!.id, companyId, 'update', 'party', id, existing.rows[0], result.rows[0], req.ip);
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/parties/:id ───────────────────────────────────
export async function deleteParty(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    // Check for open invoices
    const invCheck = await query(
      `SELECT COUNT(*) as cnt FROM invoices WHERE party_id = $1 AND status NOT IN ('paid','cancelled') AND is_deleted = false`, [id]
    );
    if (parseInt(invCheck.rows[0].cnt) > 0) {
      return res.status(400).json(error('Cannot delete party with open invoices'));
    }

    // Check for non-zero balance
    const balCheck = await query('SELECT balance FROM parties WHERE id = $1', [id]);
    if (balCheck.rows[0]?.balance !== 0) {
      return res.status(400).json(error('Cannot delete party with outstanding balance'));
    }

    const result = await query(
      'UPDATE parties SET is_deleted = true WHERE id = $1 AND company_id = $2 RETURNING id', [id, companyId]
    );
    if (!result.rows.length) return res.status(404).json(error('Party not found'));

    await logAction(req.user!.id, companyId, 'delete', 'party', id);
    res.json(success({ message: 'Party deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/parties/:id/ledger ───────────────────────────────
export async function getPartyLedger(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { from_date, to_date } = req.query;

    let where = 'l.party_id = $1 AND l.company_id = $2';
    const params: any[] = [id, companyId];
    let idx = 3;

    if (from_date) { where += ` AND l.created_at >= $${idx}::date`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND l.created_at < $${idx}::date + interval '1 day'`; params.push(to_date); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM party_ledger l WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT l.*, u.name as created_by_name
       FROM party_ledger l
       LEFT JOIN users u ON l.created_by = u.id
       WHERE ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/parties/search ───────────────────────────────────
export async function searchParties(req: Request, res: Response) {
  try {
    const { q } = req.query;
    const companyId = req.user!.company_id;

    let where = 'company_id = $1 AND is_deleted = false AND is_active = true';
    const params: any[] = [companyId];
    let idx = 2;

    if (q) { where += ` AND (name ILIKE $${idx} OR phone ILIKE $${idx} OR gstin ILIKE $${idx})`; params.push(`%${q}%`); idx++; }

    const result = await query(
      `SELECT id, name, phone, gstin, city, state, state_code, billing_state_code,
              billing_address, shipping_address, billing_city, billing_state, billing_pincode,
              party_type, balance
       FROM parties WHERE ${where} ORDER BY name LIMIT 20`, params
    );

    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/parties/:id/statement ────────────────────────────
export async function getPartyStatement(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const { from_date, to_date } = req.query;

    const ledgerCte = `
      WITH ledger_effective AS (
        SELECT
          l.*,
          COALESCE(pay.payment_date, inv.invoice_date, pi.bill_date, sr.return_date, l.created_at::date) AS transaction_date
        FROM party_ledger l
        LEFT JOIN payments pay
          ON pay.id = l.reference_id AND pay.company_id = l.company_id AND l.reference_type = 'payment'
        LEFT JOIN invoices inv
          ON inv.id = l.reference_id AND inv.company_id = l.company_id AND l.reference_type = 'invoice'
        LEFT JOIN purchase_invoices pi
          ON pi.id = l.reference_id AND pi.company_id = l.company_id AND l.reference_type = 'purchase_invoice'
        LEFT JOIN sale_returns sr
          ON sr.id = l.reference_id AND sr.company_id = l.company_id AND l.reference_type = 'credit_note'
      )
    `;

    let where = 'le.party_id = $1 AND le.company_id = $2';
    const params: any[] = [id, companyId];
    let idx = 3;

    if (from_date) { where += ` AND le.transaction_date >= $${idx}::date`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND le.transaction_date <= $${idx}::date`; params.push(to_date); idx++; }

    const openingParams: any[] = [id, companyId];
    let openingFilter = '';
    if (from_date) {
      openingFilter = 'AND le.transaction_date < $3::date';
      openingParams.push(from_date);
    }
    const obRes = await query(
      `${ledgerCte}
       SELECT COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE -amount END), 0)::bigint AS opening_balance
       FROM ledger_effective le
       WHERE le.party_id = $1 AND le.company_id = $2 ${openingFilter}`,
      openingParams,
    );
    let openingBalance = Number(obRes.rows[0]?.opening_balance || 0);

    const result = await query(
      `${ledgerCte}
       SELECT le.* FROM ledger_effective le WHERE ${where} ORDER BY le.transaction_date ASC, le.created_at ASC, le.id ASC`,
      params
    );

    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    const statementRows = result.rows.map(r => {
       const amount = Number(r.amount || 0);
       if (r.type === 'debit') totalDebit += amount;
       if (r.type === 'credit') totalCredit += amount;
       runningBalance += (r.type === 'debit' ? amount : -amount);
       return { ...r, running_balance: runningBalance };
    });

    res.json(success({
       opening_balance: openingBalance,
       total_debit: totalDebit,
       total_credit: totalCredit,
       transactions: statementRows,
       closing_balance: runningBalance
    }));
  } catch(err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/parties/:id/aging ────────────────────────────────
export async function getPartyAging(req: Request, res: Response) {
  try {
     const { id } = req.params;
     const companyId = req.user!.company_id;

     // Calculate buckets dynamically from open invoices (sales & purchases combined conceptually, but split structurally)
     const agingRes = await query(
       `SELECT 
          SUM(balance_due) FILTER (WHERE due_date >= CURRENT_DATE OR due_date IS NULL) as current,
          SUM(balance_due) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 1 AND 30) as days_0_30,
          SUM(balance_due) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 60) as days_31_60,
          SUM(balance_due) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 61 AND 90) as days_61_90,
          SUM(balance_due) FILTER (WHERE CURRENT_DATE - due_date > 90) as days_90_plus
        FROM invoices WHERE party_id = $1 AND company_id = $2 AND status NOT IN ('paid', 'cancelled') AND is_deleted = false`,
       [id, companyId]
     );

     res.json(success({
       current: agingRes.rows[0].current || 0,
       days_0_30: agingRes.rows[0].days_0_30 || 0,
       days_31_60: agingRes.rows[0].days_31_60 || 0,
       days_61_90: agingRes.rows[0].days_61_90 || 0,
       days_90_plus: agingRes.rows[0].days_90_plus || 0,
     }));
  } catch (err:any) { res.status(500).json(error(err.message)); }
}
