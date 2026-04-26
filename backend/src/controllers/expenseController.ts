import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import {
  calculateExpenseGstBreakdown,
  determineGSTType,
  stateCodeFromGstin,
} from '../services/gstService';

async function resolveExpenseGstType(companyId: string, vendorGstin: string | undefined) {
  const comp = await query(`SELECT gstin, state_code FROM companies WHERE id = $1`, [companyId]);
  const row = comp.rows[0] || {};
  const buyerCode = String(row.state_code || '').trim() || stateCodeFromGstin(row.gstin) || '';
  const supplierCode = stateCodeFromGstin(vendorGstin) || buyerCode || '';
  const b = buyerCode || supplierCode;
  const s = supplierCode || b;
  return determineGSTType(s, b);
}

// ── POST /api/expenses ────────────────────────────────────────
export async function createExpense(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    const gstType = await resolveExpenseGstType(companyId, d.vendor_gstin);
    const rate = d.gst_rate ?? 0;
    const includesGst = !!d.amount_includes_gst;
    const tax = calculateExpenseGstBreakdown(Number(d.amount), rate, gstType, includesGst);

    const numRes = await query(
      `SELECT COUNT(*) + 1 as num FROM expenses WHERE company_id = $1`, [companyId]
    );
    const expenseNumber = `EXP-${String(numRes.rows[0].num).padStart(5, '0')}`;

    const result = await query(
      `INSERT INTO expenses (
        company_id, expense_number, expense_date, category, amount,
        gst_rate, tax_amount, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
        amount_includes_gst,
        payment_mode, reference_number, vendor_name, vendor_gstin,
        description, notes, is_reimbursable, status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [
        companyId, expenseNumber,
        d.expense_date || new Date().toISOString().split('T')[0],
        d.category, tax.taxable_amount,
        rate,
        tax.gst_amount,
        tax.gst_amount,
        tax.cgst_amount,
        tax.sgst_amount,
        tax.igst_amount,
        tax.total_amount,
        includesGst,
        d.payment_mode || 'cash', d.reference_number,
        d.vendor_name, d.vendor_gstin,
        d.description, d.notes,
        d.is_reimbursable || false,
        'approved', req.user!.id,
      ]
    );

    await logAction(req.user!.id, companyId, 'create', 'expense', result.rows[0].id);
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/expenses ─────────────────────────────────────────
export async function listExpenses(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, category, payment_mode, from_date, to_date } = req.query;

    let where = 'e.company_id = $1 AND e.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) { where += ` AND (e.expense_number ILIKE $${idx} OR e.description ILIKE $${idx} OR e.vendor_name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (category) { where += ` AND e.category = $${idx}`; params.push(category); idx++; }
    if (payment_mode) { where += ` AND e.payment_mode = $${idx}`; params.push(payment_mode); idx++; }
    if (from_date) { where += ` AND e.expense_date >= $${idx}`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND e.expense_date <= $${idx}`; params.push(to_date); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM expenses e WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT e.*, u.name as created_by_name
       FROM expenses e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Category-wise summary
    const statsRes = await query(
      `SELECT category, COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total
       FROM expenses WHERE company_id = $1 AND is_deleted = false
       GROUP BY category ORDER BY total DESC`,
      [companyId]
    );

    const totalExpenses = statsRes.rows.reduce((s: number, r: any) => s + parseInt(r.total), 0);

    res.json(success(
      buildPaginatedResponse(result.rows, total, page, limit),
      { total_expenses: totalExpenses, by_category: statsRes.rows }
    ));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/expenses/:id ─────────────────────────────────────
export async function getExpense(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT e.*, u.name as created_by_name
       FROM expenses e LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = $1 AND e.company_id = $2 AND e.is_deleted = false`,
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(404).json(error('Expense not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/expenses/:id ───────────────────────────────────
export async function updateExpense(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const cur = await query(
      `SELECT amount, gst_rate, vendor_gstin, amount_includes_gst FROM expenses WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, companyId]
    );
    if (!cur.rows.length) return res.status(404).json(error('Expense not found'));

    const fields = [
      'expense_date',
      'category',
      'payment_mode',
      'reference_number',
      'vendor_name',
      'vendor_gstin',
      'description',
      'notes',
      'is_reimbursable',
    ];
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        values.push(req.body[f]);
      }
    }

    const needRecalc =
      req.body.amount !== undefined ||
      req.body.gst_rate !== undefined ||
      req.body.amount_includes_gst !== undefined ||
      req.body.vendor_gstin !== undefined;

    if (needRecalc) {
      const row = cur.rows[0];
      const vendorGst =
        req.body.vendor_gstin !== undefined ? req.body.vendor_gstin : row.vendor_gstin;
      const gstType = await resolveExpenseGstType(companyId, vendorGst);
      const rate = req.body.gst_rate !== undefined ? req.body.gst_rate : row.gst_rate;
      // Stored `amount` is always taxable (base). Inclusive flag applies only when the client sends a new `amount`.
      let inputAmt: number;
      let includesGst: boolean;
      if (req.body.amount !== undefined) {
        inputAmt = Number(req.body.amount);
        includesGst =
          req.body.amount_includes_gst !== undefined
            ? !!req.body.amount_includes_gst
            : !!row.amount_includes_gst;
      } else {
        inputAmt = Number(row.amount);
        includesGst = false;
      }

      const tax = calculateExpenseGstBreakdown(inputAmt, rate, gstType, includesGst);
      updates.push(`amount = $${idx++}`);
      values.push(tax.taxable_amount);
      updates.push(`gst_rate = $${idx++}`);
      values.push(rate);
      updates.push(`tax_amount = $${idx++}`);
      values.push(tax.gst_amount);
      updates.push(`gst_amount = $${idx++}`);
      values.push(tax.gst_amount);
      updates.push(`cgst_amount = $${idx++}`);
      values.push(tax.cgst_amount);
      updates.push(`sgst_amount = $${idx++}`);
      values.push(tax.sgst_amount);
      updates.push(`igst_amount = $${idx++}`);
      values.push(tax.igst_amount);
      updates.push(`total_amount = $${idx++}`);
      values.push(tax.total_amount);
      if (req.body.amount_includes_gst !== undefined || req.body.amount !== undefined) {
        updates.push(`amount_includes_gst = $${idx++}`);
        values.push(includesGst);
      }
    }

    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(id, companyId);
    const result = await query(
      `UPDATE expenses SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} AND is_deleted = false RETURNING *`, values
    );
    if (!result.rows.length) return res.status(404).json(error('Expense not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/expenses/:id ──────────────────────────────────
export async function deleteExpense(req: Request, res: Response) {
  try {
    const result = await query(
      'UPDATE expenses SET is_deleted = true WHERE id = $1 AND company_id = $2 RETURNING id',
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(404).json(error('Expense not found'));
    await logAction(req.user!.id, req.user!.company_id, 'delete', 'expense', req.params.id);
    res.json(success({ message: 'Expense deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── Approvals ─────────────────────────────────────────────────
export async function approveExpense(req: Request, res: Response) {
  try {
    const result = await query(
      "UPDATE expenses SET status = 'approved', approved_by = $1 WHERE id = $2 AND company_id = $3 RETURNING *",
      [req.user!.id, req.params.id, req.user!.company_id]
    );
    res.json(success(result.rows[0]));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function rejectExpense(req: Request, res: Response) {
  try {
    const result = await query(
      "UPDATE expenses SET status = 'rejected', notes = COALESCE(notes, '') || '\nRejection Reason: ' || $1 WHERE id = $2 AND company_id = $3 RETURNING *",
      [req.body.reason || 'Rejected', req.params.id, req.user!.company_id]
    );
    res.json(success(result.rows[0]));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

// ── Misc ──────────────────────────────────────────────────────
export async function getExpenseCategories(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT category, COUNT(*) as usage_count FROM expenses 
       WHERE company_id = $1 AND is_deleted = false 
       GROUP BY category ORDER BY usage_count DESC`,
      [req.user!.company_id]
    );
    res.json(success(result.rows.map(r => r.category)));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function bulkImportExpenses(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { expenses } = req.body as { expenses?: Record<string, unknown>[] };
    if (!expenses || !Array.isArray(expenses)) {
      return res.status(400).json(error('Expected an array of expenses'));
    }

    const inserted: Record<string, unknown>[] = [];
    const errors: { index: number; message: string }[] = [];

    await withTransaction(async (client) => {
      const numRes = await client.query(`SELECT COUNT(*)::int AS n FROM expenses WHERE company_id = $1`, [companyId]);
      let seq = parseInt(String(numRes.rows[0]?.n || '0'), 10) + 1;

      for (let i = 0; i < expenses.length; i++) {
        const raw = expenses[i];
        try {
          const expense_date = (raw.expense_date as string) || new Date().toISOString().split('T')[0];
          const category = String(raw.category || '').trim();
          if (!category) throw new Error('category is required');
          const amountInput = Number(raw.amount);
          if (!Number.isFinite(amountInput) || amountInput <= 0) {
            throw new Error('amount must be a positive number (paise)');
          }

          const gstType = await resolveExpenseGstType(companyId, raw.vendor_gstin as string | undefined);
          const rate = Number(raw.gst_rate ?? 0);
          const includesGst = !!raw.amount_includes_gst;
          const tax = calculateExpenseGstBreakdown(Math.round(amountInput), rate, gstType, includesGst);

          const expenseNumber = `EXP-${String(seq).padStart(5, '0')}`;
          seq += 1;

          const ins = await client.query(
            `INSERT INTO expenses (
              company_id, expense_number, expense_date, category, amount,
              gst_rate, tax_amount, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
              amount_includes_gst,
              payment_mode, reference_number, vendor_name, vendor_gstin,
              description, notes, is_reimbursable, status, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
            [
              companyId,
              expenseNumber,
              expense_date,
              category,
              tax.taxable_amount,
              rate,
              tax.gst_amount,
              tax.gst_amount,
              tax.cgst_amount,
              tax.sgst_amount,
              tax.igst_amount,
              tax.total_amount,
              includesGst,
              (raw.payment_mode as string) || 'cash',
              (raw.reference_number as string) || null,
              (raw.vendor_name as string) || null,
              (raw.vendor_gstin as string) || null,
              (raw.description as string) || null,
              (raw.notes as string) || null,
              !!raw.is_reimbursable,
              'approved',
              req.user!.id,
            ],
          );
          inserted.push(ins.rows[0]);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'row failed';
          errors.push({ index: i, message: msg });
        }
      }
    });

    res.json(success({ inserted: inserted.length, records: inserted, errors }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
