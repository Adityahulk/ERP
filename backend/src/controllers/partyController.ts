import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  try {
    const companyId = req.user!.company_id;
    const d = req.body;

    const gstin =
      d.gstin && String(d.gstin).trim().length === 15 ? String(d.gstin).trim().toUpperCase() : null;
    if (gstin) {
      const dupGst = await query(
        'SELECT id FROM parties WHERE company_id = $1 AND gstin = $2 AND is_deleted = false',
        [companyId, gstin],
      );
      if (dupGst.rows.length) return res.status(400).json(error('A party with this GSTIN already exists'));
    }

    // Phone uniqueness check
    if (d.phone) {
      const dup = await query(
        'SELECT id FROM parties WHERE company_id = $1 AND phone = $2 AND is_deleted = false', [companyId, d.phone]
      );
      if (dup.rows.length) return res.status(400).json(error('A party with this phone number already exists'));
    }

    const opening = d.opening_balance || 0;
    const result = await query(
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
        d.name,
        d.phone || null,
        d.email || null,
        gstin,
        d.pan || null,
        d.billing_address || null,
        d.shipping_address || null,
        d.city || d.billing_city || null,
        d.state || d.billing_state || null,
        d.pincode || d.billing_pincode || null,
        d.state_code || d.billing_state_code || null,
        d.credit_limit || 0,
        d.payment_terms || d.credit_days || 30,
        opening,
        d.contact_person || null,
        d.notes || null,
        d.custom_fields ? JSON.stringify(d.custom_fields) : '{}',
      ]
    );

    // If opening balance, create ledger entry
    if (d.opening_balance && d.opening_balance !== 0) {
      const type = d.opening_balance > 0 ? 'debit' : 'credit';
      await query(
        `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, narration, created_by)
         VALUES ($1, $2, $3, $4, $4, 'Opening Balance', $5)`,
        [companyId, result.rows[0].id, type, Math.abs(d.opening_balance), req.user!.id]
      );
    }

    await logAction(req.user!.id, companyId, 'create', 'party', result.rows[0].id, null, { name: d.name, gstin: gstin ?? undefined }, req.ip);
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
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
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        values.push(f === 'custom_fields' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }

    // Sync city/state/pincode to both billing_* and legacy columns
    const cityVal = req.body.city ?? req.body.billing_city;
    if (cityVal !== undefined) {
      updates.push(`billing_city = $${idx}`, `city = $${idx++}`);
      values.push(cityVal);
    }
    const stateVal = req.body.state ?? req.body.billing_state;
    if (stateVal !== undefined) {
      updates.push(`billing_state = $${idx}`, `state = $${idx++}`);
      values.push(stateVal);
    }
    const pincodeVal = req.body.pincode ?? req.body.billing_pincode;
    if (pincodeVal !== undefined) {
      updates.push(`billing_pincode = $${idx}`, `pincode = $${idx++}`);
      values.push(pincodeVal);
    }
    const stateCodeVal = req.body.state_code ?? req.body.billing_state_code;
    if (stateCodeVal !== undefined) {
      updates.push(`billing_state_code = $${idx}`, `state_code = $${idx++}`);
      values.push(stateCodeVal);
    }
    const termsVal = req.body.payment_terms ?? req.body.credit_days;
    if (termsVal !== undefined) {
      updates.push(`credit_days = $${idx}`, `payment_terms = $${idx++}`);
      values.push(termsVal);
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
    if (to_date) { where += ` AND l.created_at <= $${idx}::date + interval '1 day'`; params.push(to_date); idx++; }

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
      `SELECT id, name, phone, gstin, city, state, state_code, billing_state_code, party_type, balance
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

    let where = 'l.party_id = $1 AND l.company_id = $2';
    const params: any[] = [id, companyId];
    let idx = 3;

    if (from_date) { where += ` AND l.created_at >= $${idx}::date`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND l.created_at <= $${idx}::date + interval '1 day'`; params.push(to_date); idx++; }

    // Fetch opening balance specifically before the from_date if from_date exists
    let openingBalance = 0;
    if (from_date) {
        const obRes = await query(
          `SELECT 
             COALESCE(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END), 0) as ob
           FROM party_ledger l WHERE l.party_id = $1 AND l.company_id = $2 AND l.created_at < $3::date`,
          [id, companyId, from_date]
        );
        openingBalance = parseInt(obRes.rows[0].ob);
    }
    
    // Fallback: If no from_date, opening_balance = initial parties opening balance + 0
    if (!from_date) {
        const pObRes = await query('SELECT opening_balance, opening_balance_type FROM parties WHERE id = $1', [id]);
        openingBalance = (pObRes.rows[0]?.opening_balance_type === 'debit' ? 1 : -1) * (pObRes.rows[0]?.opening_balance || 0);
    }

    const result = await query(
      `SELECT l.* FROM party_ledger l WHERE ${where} ORDER BY l.created_at ASC, l.id ASC`, params
    );

    let runningBalance = openingBalance;
    const statementRows = result.rows.map(r => {
       runningBalance += (r.type === 'debit' ? r.amount : -r.amount);
       return { ...r, running_balance: runningBalance };
    });

    res.json(success({
       opening_balance: openingBalance,
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
