import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { logAction } from '../lib/auditLog';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';

// ── GET /api/payments ─────────────────────────────────────────
export async function listPayments(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const result = await query(
      `SELECT p.*, pt.name as party_name 
       FROM payments p LEFT JOIN parties pt ON p.party_id = pt.id
       WHERE p.company_id = $1 AND p.is_deleted = false
       ORDER BY p.payment_date DESC LIMIT $2 OFFSET $3`, [req.user!.company_id, limit, offset]
    );
    const countRes = await query('SELECT COUNT(*) FROM payments WHERE company_id = $1 AND is_deleted = false', [req.user!.company_id]);
    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/payments/:id ─────────────────────────────────────
export async function getPayment(req: Request, res: Response) {
  try {
    const pRes = await query('SELECT * FROM payments WHERE id = $1 AND company_id = $2', [req.params.id, req.user!.company_id]);
    if (!pRes.rows.length) return res.status(404).json(error('Not found'));
    
    const allocations = await query('SELECT * FROM payment_allocations WHERE payment_id = $1', [req.params.id]);
    res.json(success({ ...pRes.rows[0], allocations: allocations.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/payments ────────────────────────────────────────
export async function createPayment(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body; 
    // d: { payment_type, party_id, amount, payment_mode, payment_date, reference_number, allocations: [{invoice_id, amount}] }

    const result = await withTransaction(async (client) => {
      // 1. Create Payment
      const pRes = await client.query(
        `INSERT INTO payments (company_id, payment_type, payment_number, payment_date, party_id, amount, payment_mode, reference_number, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
           companyId, d.payment_type || 'incoming', `PAY-${Math.floor(Math.random() * 10000)}`,
           d.payment_date || new Date().toISOString().split('T')[0], d.party_id, d.amount,
           d.payment_mode || 'cash', d.reference_number, d.notes, req.user!.id
        ]
      );
      const payment = pRes.rows[0];

      // 2. Validate & Process Allocations
      if (d.allocations && d.allocations.length > 0) {
        let totalAllocated = 0;
        for (const alloc of d.allocations) {
           totalAllocated += alloc.amount;
        }
        if (totalAllocated > d.amount) throw new Error('Allocations exceed total payment amount');

        for (const alloc of d.allocations) {
           await client.query('INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES ($1,$2,$3)', [payment.id, alloc.invoice_id, alloc.amount]);
           
           if (d.payment_type === 'incoming') {
             await client.query(
               `UPDATE invoices
                SET paid_amount = paid_amount + $1,
                    payment_status = CASE
                      WHEN paid_amount + $1 >= total_amount THEN 'paid'
                      WHEN paid_amount + $1 > 0 THEN 'partial'
                      ELSE 'unpaid'
                    END
                WHERE id = $2`,
               [alloc.amount, alloc.invoice_id]
             );
           } else {
             await client.query(
               `UPDATE purchase_invoices
                SET paid_amount = paid_amount + $1,
                    payment_status = CASE
                      WHEN paid_amount + $1 >= total_amount THEN 'paid'
                      WHEN paid_amount + $1 > 0 THEN 'partial'
                      ELSE 'unpaid'
                    END
                WHERE id = $2`,
               [alloc.amount, alloc.invoice_id]
             );
           }
        }
      }

      // 3. Update Party Ledger (Payment received decreases customer balance, given payment decreases supplier balance)
      if (d.party_id) {
         const isIncoming = d.payment_type === 'incoming';
         // Incoming reduces customer balance. Outgoing applies identically if negative/positive flip. Actually let's assume raw subtraction for both depending on schema.
         // Usually, incoming (customer) -> credit ledger. Outgoing (supplier) -> debit ledger.
         await client.query(
           `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
            VALUES ($1, $2, $3, $4, (SELECT balance - $4 FROM parties WHERE id = $2), 'payment', $5, $6, $7)`,
            [companyId, d.party_id, isIncoming ? 'credit' : 'debit', d.amount, payment.id, `Payment ${payment.payment_number}`, req.user!.id]
         );
         await client.query('UPDATE parties SET balance = balance - $1 WHERE id = $2', [isIncoming ? d.amount : -d.amount, d.party_id]);
      }

      return payment;
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/payments/:id/allocate ───────────────────────────
export async function allocatePayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const { allocations } = req.body as { allocations?: { invoice_id: string; amount: number }[] };

    if (!allocations?.length) {
      return res.status(400).json(error('allocations array is required'));
    }

    const result = await withTransaction(async (client) => {
      const pRes = await client.query(
        `SELECT * FROM payments WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!pRes.rows.length) throw new Error('Payment not found');
      const payment = pRes.rows[0];

      const sumRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::int AS s FROM payment_allocations WHERE payment_id = $1`,
        [id],
      );
      const alreadyAllocated = Number(sumRes.rows[0]?.s || 0);
      let add = 0;
      for (const a of allocations) {
        add += Number(a.amount) || 0;
      }
      if (add <= 0) throw new Error('Allocation amounts must be positive');
      if (alreadyAllocated + add > Number(payment.amount)) {
        throw new Error('Total allocations exceed payment amount');
      }

      const incoming =
        payment.payment_type === 'incoming' ||
        payment.payment_type === 'payment_in' ||
        payment.payment_type === 'receipt';

      for (const alloc of allocations) {
        const amt = Number(alloc.amount) || 0;
        if (amt <= 0) continue;

        const sale = await client.query(
          `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [alloc.invoice_id, companyId],
        );
        const purchase = await client.query(
          `SELECT id FROM purchase_invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [alloc.invoice_id, companyId],
        );

        if (incoming && sale.rows.length) {
          await client.query(
            `INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES ($1,$2,$3)`,
            [id, alloc.invoice_id, amt],
          );
          await client.query(
            `UPDATE invoices SET
               paid_amount = paid_amount + $1,
               payment_status = CASE
                 WHEN paid_amount + $1 >= total_amount THEN 'paid'
                 WHEN paid_amount + $1 > 0 THEN 'partial'
                 ELSE 'unpaid'
               END
             WHERE id = $2 AND company_id = $3`,
            [amt, alloc.invoice_id, companyId],
          );
        } else if (!incoming && purchase.rows.length) {
          // payment_allocations.invoice_id FK targets sales `invoices` only — purchase lines update PI balances here without a link row.
          await client.query(
            `UPDATE purchase_invoices SET
               paid_amount = paid_amount + $1,
               payment_status = CASE
                 WHEN paid_amount + $1 >= total_amount THEN 'paid'
                 WHEN paid_amount + $1 > 0 THEN 'partial'
                 ELSE 'unpaid'
               END
             WHERE id = $2 AND company_id = $3`,
            [amt, alloc.invoice_id, companyId],
          );
        } else {
          throw new Error(
            incoming
              ? 'Sales allocation requires a valid sales invoice id (payment_allocations references invoices only).'
              : 'Purchase allocation requires a valid purchase_invoice id for this company.',
          );
        }
      }

      return { payment_id: id, allocated_paise: add, total_allocated_paise: alreadyAllocated + add };
    });

    await logAction(req.user!.id, companyId, 'update', 'payment', id, undefined, result, req.ip);
    res.json(success(result));
  } catch (err: any) {
    res.status(400).json(error(err.message));
  }
}
