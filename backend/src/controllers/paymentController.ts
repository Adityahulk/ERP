import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

// ── POST /api/payments ────────────────────────────────────────
export async function createPayment(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;

    const result = await withTransaction(async (client) => {
      // Auto-generate payment number
      const prefix = d.payment_type === 'payment_out' ? 'PYOT-' : 'PYIN-';
      const numRes = await client.query(
        `SELECT COUNT(*) + 1 as num FROM payments WHERE company_id = $1`, [companyId]
      );
      const paymentNumber = `${prefix}${String(numRes.rows[0].num).padStart(5, '0')}`;

      // Create payment
      const payRes = await client.query(
        `INSERT INTO payments (
          company_id, payment_number, payment_type, party_id, invoice_id,
          payment_date, amount, payment_mode, reference_number,
          bank_name, status, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          companyId, paymentNumber, d.payment_type || 'payment_in',
          d.party_id, d.invoice_id,
          d.payment_date || new Date().toISOString().split('T')[0],
          d.amount, d.payment_mode || 'cash',
          d.reference_number, d.bank_name,
          'completed', d.notes, req.user!.id,
        ]
      );

      const payment = payRes.rows[0];

      // Update invoice if linked
      if (d.invoice_id) {
        await client.query(
          `UPDATE invoices SET 
            amount_paid = amount_paid + $1,
            balance_due = balance_due - $1,
            status = CASE 
              WHEN balance_due - $1 <= 0 THEN 'paid'
              WHEN amount_paid + $1 > 0 THEN 'partial'
              ELSE status END
          WHERE id = $2`,
          [d.amount, d.invoice_id]
        );
      }

      // Update party balance
      if (d.party_id) {
        const balanceChange = d.payment_type === 'payment_out' ? d.amount : -d.amount;
        await client.query(
          'UPDATE parties SET balance = balance + $1 WHERE id = $2', [balanceChange, d.party_id]
        );

        // Party ledger entry
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'payment', $5, $6, $7)`,
          [
            companyId, d.party_id,
            d.payment_type === 'payment_out' ? 'debit' : 'credit',
            d.amount, payment.id,
            `${paymentNumber} - ${d.payment_mode || 'cash'}${d.reference_number ? ` (${d.reference_number})` : ''}`,
            req.user!.id,
          ]
        );
      }

      return payment;
    });

    await logAction(req.user!.id, companyId, 'create', 'payment', result.id, null, { amount: d.amount }, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/payments ─────────────────────────────────────────
export async function listPayments(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, payment_type, payment_mode, party_id, from_date, to_date } = req.query;

    let where = 'py.company_id = $1 AND py.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) { where += ` AND (py.payment_number ILIKE $${idx} OR p.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (payment_type) { where += ` AND py.payment_type = $${idx}`; params.push(payment_type); idx++; }
    if (payment_mode) { where += ` AND py.payment_mode = $${idx}`; params.push(payment_mode); idx++; }
    if (party_id) { where += ` AND py.party_id = $${idx}`; params.push(party_id); idx++; }
    if (from_date) { where += ` AND py.payment_date >= $${idx}`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND py.payment_date <= $${idx}`; params.push(to_date); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM payments py LEFT JOIN parties p ON py.party_id = p.id WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT py.*, p.name as party_name, i.invoice_number,
              u.name as created_by_name
       FROM payments py
       LEFT JOIN parties p ON py.party_id = p.id
       LEFT JOIN invoices i ON py.invoice_id = i.id
       LEFT JOIN users u ON py.created_by = u.id
       WHERE ${where}
       ORDER BY py.payment_date DESC, py.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Summary
    const statsRes = await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE payment_type = 'payment_in'), 0) as total_received,
         COALESCE(SUM(amount) FILTER (WHERE payment_type = 'payment_out'), 0) as total_sent,
         COUNT(*) FILTER (WHERE payment_mode = 'cash') as cash_count,
         COUNT(*) FILTER (WHERE payment_mode = 'upi') as upi_count,
         COUNT(*) FILTER (WHERE payment_mode = 'bank_transfer') as bank_count
       FROM payments WHERE company_id = $1 AND is_deleted = false`,
      [companyId]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit), statsRes.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/payments/:id ─────────────────────────────────────
export async function getPayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const result = await query(
      `SELECT py.*, p.name as party_name, p.phone as party_phone,
              i.invoice_number, i.total_amount as invoice_total,
              u.name as created_by_name
       FROM payments py
       LEFT JOIN parties p ON py.party_id = p.id
       LEFT JOIN invoices i ON py.invoice_id = i.id
       LEFT JOIN users u ON py.created_by = u.id
       WHERE py.id = $1 AND py.company_id = $2 AND py.is_deleted = false`,
      [id, companyId]
    );
    if (!result.rows.length) return res.status(404).json(error('Payment not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/payments/:id ──────────────────────────────────
export async function deletePayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const payRes = await query('SELECT * FROM payments WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]);
    if (!payRes.rows.length) return res.status(404).json(error('Payment not found'));
    const payment = payRes.rows[0];

    await withTransaction(async (client) => {
      // Reverse invoice update
      if (payment.invoice_id) {
        await client.query(
          `UPDATE invoices SET 
            amount_paid = GREATEST(0, amount_paid - $1),
            balance_due = balance_due + $1,
            status = CASE 
              WHEN amount_paid - $1 <= 0 THEN 'unpaid'
              ELSE 'partial' END
          WHERE id = $2`,
          [payment.amount, payment.invoice_id]
        );
      }

      // Reverse party balance
      if (payment.party_id) {
        const reverseChange = payment.payment_type === 'payment_out' ? -payment.amount : payment.amount;
        await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2', [reverseChange, payment.party_id]);

        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'payment', $5, $6, $7)`,
          [
            companyId, payment.party_id,
            payment.payment_type === 'payment_out' ? 'credit' : 'debit',
            payment.amount, id,
            `Reversed: ${payment.payment_number}`,
            req.user!.id,
          ]
        );
      }

      await client.query('UPDATE payments SET is_deleted = true WHERE id = $1', [id]);
    });

    await logAction(req.user!.id, companyId, 'delete', 'payment', id);
    res.json(success({ message: 'Payment deleted and reversed' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
