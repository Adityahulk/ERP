import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { logAction } from '../lib/auditLog';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { postPaymentAccounting, reverseAccountingForReference } from '../services/accountingService';

function isIncomingPaymentType(value: unknown) {
  return ['incoming', 'payment_in', 'receipt'].includes(String(value || 'incoming').toLowerCase());
}

function positivePaise(value: unknown, label = 'Amount') {
  const amount = Math.round(Number(value) || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be greater than zero`);
  return amount;
}

function statusForPaid(total: number, paid: number) {
  if (paid <= 0) return 'unpaid';
  return paid >= total ? 'paid' : 'partial';
}

async function applyAllocation(
  client: any,
  companyId: string,
  payment: any,
  allocation: { invoice_id?: string; purchase_invoice_id?: string; amount?: number },
) {
  const amount = positivePaise(allocation.amount, 'Allocation amount');
  const incoming = isIncomingPaymentType(payment.payment_type);

  if (incoming) {
    const invoiceId = String(allocation.invoice_id || '').trim();
    if (!invoiceId) throw new Error('Sales invoice id is required for an incoming payment allocation');
    const invoiceRes = await client.query(
      `SELECT id, party_id, total_amount, paid_amount
       FROM invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = false
       FOR UPDATE`,
      [invoiceId, companyId],
    );
    if (!invoiceRes.rows.length) throw new Error('Sales invoice not found for this company');
    const invoice = invoiceRes.rows[0];
    if (payment.party_id && invoice.party_id && String(payment.party_id) !== String(invoice.party_id)) {
      throw new Error('The selected sales invoice belongs to a different party');
    }
    const nextPaid = Number(invoice.paid_amount || 0) + amount;
    if (nextPaid > Number(invoice.total_amount || 0)) throw new Error('Allocation exceeds the sales invoice balance');

    await client.query(
      `INSERT INTO payment_allocations (payment_id, invoice_id, purchase_invoice_id, amount)
       VALUES ($1, $2, NULL, $3)`,
      [payment.id, invoiceId, amount],
    );
    await client.query(
      `UPDATE invoices
       SET paid_amount = $1,
           payment_status = $2,
           updated_at = NOW()
       WHERE id = $3 AND company_id = $4`,
      [nextPaid, statusForPaid(Number(invoice.total_amount || 0), nextPaid), invoiceId, companyId],
    );
    return;
  }

  const purchaseInvoiceId = String(allocation.purchase_invoice_id || allocation.invoice_id || '').trim();
  if (!purchaseInvoiceId) throw new Error('Purchase invoice id is required for an outgoing payment allocation');
  const purchaseRes = await client.query(
    `SELECT id, party_id, total_amount, paid_amount
     FROM purchase_invoices
     WHERE id = $1 AND company_id = $2 AND is_deleted = false
     FOR UPDATE`,
    [purchaseInvoiceId, companyId],
  );
  if (!purchaseRes.rows.length) throw new Error('Purchase invoice not found for this company');
  const purchase = purchaseRes.rows[0];
  if (payment.party_id && purchase.party_id && String(payment.party_id) !== String(purchase.party_id)) {
    throw new Error('The selected purchase invoice belongs to a different party');
  }
  const nextPaid = Number(purchase.paid_amount || 0) + amount;
  if (nextPaid > Number(purchase.total_amount || 0)) throw new Error('Allocation exceeds the purchase invoice balance');

  await client.query(
    `INSERT INTO payment_allocations (payment_id, invoice_id, purchase_invoice_id, amount)
     VALUES ($1, NULL, $2, $3)`,
    [payment.id, purchaseInvoiceId, amount],
  );
  await client.query(
    `UPDATE purchase_invoices
     SET paid_amount = $1,
         payment_status = $2,
         updated_at = NOW()
     WHERE id = $3 AND company_id = $4`,
    [nextPaid, statusForPaid(Number(purchase.total_amount || 0), nextPaid), purchaseInvoiceId, companyId],
  );
}

// ── GET /api/payments ─────────────────────────────────────────
export async function listPayments(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where: string[] = ['p.company_id = $1', 'p.is_deleted = false'];
    const params: any[] = [req.user!.company_id];
    let idx = 2;
    if (req.query.payment_type) {
      where.push(`p.payment_type = $${idx++}`);
      params.push(String(req.query.payment_type));
    }
    if (req.query.party_id) {
      where.push(`p.party_id = $${idx++}`);
      params.push(String(req.query.party_id));
    }
    if (req.query.payment_mode) {
      where.push(`p.payment_mode = $${idx++}`);
      params.push(String(req.query.payment_mode));
    }
    if (req.query.from_date) {
      where.push(`p.payment_date >= $${idx++}::date`);
      params.push(String(req.query.from_date));
    }
    if (req.query.to_date) {
      where.push(`p.payment_date <= $${idx++}::date`);
      params.push(String(req.query.to_date));
    }
    const result = await query(
      `SELECT p.*, pt.name as party_name, ba.account_label as bank_label, ba.bank_name, ba.account_number,
              COALESCE(pa.allocated_amount, 0)::bigint AS allocated_amount,
              (p.amount - COALESCE(pa.allocated_amount, 0))::bigint AS unallocated_amount,
              COALESCE(pa.linked_documents, '[]'::json) AS linked_documents
       FROM payments p LEFT JOIN parties pt ON p.party_id = pt.id
       LEFT JOIN company_bank_accounts ba ON ba.id = p.company_bank_account_id AND ba.company_id = p.company_id
       LEFT JOIN LATERAL (
         SELECT SUM(a.amount) AS allocated_amount,
                json_agg(json_build_object(
                  'invoice_id', a.invoice_id,
                  'purchase_invoice_id', a.purchase_invoice_id,
                  'amount', a.amount,
                  'number', COALESCE(i.invoice_number, pi.bill_number)
                ) ORDER BY a.created_at) AS linked_documents
         FROM payment_allocations a
         LEFT JOIN invoices i ON i.id = a.invoice_id AND i.company_id = p.company_id
         LEFT JOIN purchase_invoices pi ON pi.id = a.purchase_invoice_id AND pi.company_id = p.company_id
         WHERE a.payment_id = p.id
       ) pa ON true
       WHERE ${where.join(' AND ')}
       ORDER BY p.payment_date DESC, p.created_at DESC LIMIT $${idx++} OFFSET $${idx}`, [...params, limit, offset]
    );
    const countRes = await query(`SELECT COUNT(*) FROM payments p WHERE ${where.join(' AND ')}`, params);
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
    const amount = positivePaise(d.amount);
    const paymentType = isIncomingPaymentType(d.payment_type) ? 'incoming' : 'outgoing';
    // d: { payment_type, party_id, amount, payment_mode, payment_date, reference_number, allocations: [{invoice_id, amount}] }

    const result = await withTransaction(async (client) => {
      if (d.party_id) {
        const party = await client.query(
          `SELECT id FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
          [d.party_id, companyId],
        );
        if (!party.rows.length) throw new Error('Party not found for this company');
      }

      // 1. Create Payment
      const pRes = await client.query(
        `INSERT INTO payments (
           company_id, payment_type, payment_number, payment_date, party_id, amount,
           payment_mode, reference_number, company_bank_account_id, cheque_number, instrument_date, notes, created_by
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
           companyId, paymentType, `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
           d.payment_date || d.pay_date || new Date().toISOString().split('T')[0], d.party_id || null, amount,
           d.payment_mode || 'cash',
           d.reference_number,
           d.company_bank_account_id || null,
           d.cheque_number || (d.payment_mode === 'cheque' ? d.reference_number || null : null),
           d.instrument_date || null,
           d.notes,
           req.user!.id
        ]
      );
      const payment = pRes.rows[0];

      if (!payment.party_id) {
        throw new Error('Select a party before allocating this payment');
      }

      // 2. Validate & Process Allocations
      if (d.allocations && d.allocations.length > 0) {
        let totalAllocated = 0;
        for (const alloc of d.allocations) {
           totalAllocated += positivePaise(alloc.amount, 'Allocation amount');
        }
        if (totalAllocated > amount) throw new Error('Allocations exceed total payment amount');

        for (const alloc of d.allocations) {
          await applyAllocation(client, companyId, payment, alloc);
        }
      }

      // 3. Update Party Ledger (Payment received decreases customer balance, given payment decreases supplier balance)
      if (d.party_id) {
         const isIncoming = isIncomingPaymentType(payment.payment_type);
         await client.query(
           `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
            VALUES ($1, $2, $3, $4, (SELECT balance + $8 FROM parties WHERE id = $2 AND company_id = $1), 'payment', $5, $6, $7)`,
            [companyId, d.party_id, isIncoming ? 'credit' : 'debit', amount, payment.id, `Payment ${payment.payment_number}`, req.user!.id, isIncoming ? -amount : amount]
         );
         await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3', [isIncoming ? -amount : amount, d.party_id, companyId]);
      }

      await postPaymentAccounting(client, companyId, payment, req.user!.id);
      return payment;
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Failed to record payment';
    res.status(/must|exceed|not found|required/i.test(msg) ? 400 : 500).json(error(msg));
  }
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
        add += positivePaise(a.amount, 'Allocation amount');
      }
      if (add <= 0) throw new Error('Allocation amounts must be positive');
      if (alreadyAllocated + add > Number(payment.amount)) {
        throw new Error('Total allocations exceed payment amount');
      }

      for (const alloc of allocations) {
        await applyAllocation(client, companyId, payment, alloc);
      }

      return { payment_id: id, allocated_paise: add, total_allocated_paise: alreadyAllocated + add };
    });

    await logAction(req.user!.id, companyId, 'update', 'payment', id, undefined, result, req.ip);
    res.json(success(result));
  } catch (err: any) {
    res.status(400).json(error(err.message));
  }
}

// ── DELETE /api/payments/:id ──────────────────────────────────
export async function deletePayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const result = await withTransaction(async (client) => {
      const pRes = await client.query(
        `SELECT * FROM payments WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!pRes.rows.length) throw new Error('Payment not found');
      const payment = pRes.rows[0];
      const amount = Number(payment.amount || 0);
      const isIncoming = isIncomingPaymentType(payment.payment_type);

      const allocations = await client.query(
        `SELECT pa.*,
                i.invoice_number, i.total_amount AS sale_total_amount, i.paid_amount AS sale_paid_amount,
                pi.bill_number, pi.total_amount AS purchase_total_amount, pi.paid_amount AS purchase_paid_amount
         FROM payment_allocations pa
         LEFT JOIN invoices i ON i.id = pa.invoice_id AND i.company_id = $2
         LEFT JOIN purchase_invoices pi ON pi.id = pa.purchase_invoice_id AND pi.company_id = $2
         WHERE pa.payment_id = $1
         ORDER BY pa.created_at ASC`,
        [id, companyId],
      );

      for (const alloc of allocations.rows) {
        const allocAmount = Number(alloc.amount || 0);
        if (alloc.invoice_id) {
          await client.query(
            `UPDATE invoices
             SET paid_amount = GREATEST(paid_amount - $1, 0),
                 payment_status = CASE
                   WHEN GREATEST(paid_amount - $1, 0) >= total_amount THEN 'paid'
                   WHEN GREATEST(paid_amount - $1, 0) > 0 THEN 'partial'
                   ELSE 'unpaid'
                 END,
                 updated_at = NOW()
             WHERE id = $2 AND company_id = $3`,
            [allocAmount, alloc.invoice_id, companyId],
          );
        } else if (alloc.purchase_invoice_id) {
          await client.query(
            `UPDATE purchase_invoices
             SET paid_amount = GREATEST(paid_amount - $1, 0),
                 payment_status = CASE
                   WHEN GREATEST(paid_amount - $1, 0) >= total_amount THEN 'paid'
                   WHEN GREATEST(paid_amount - $1, 0) > 0 THEN 'partial'
                   ELSE 'unpaid'
                 END,
                 updated_at = NOW()
             WHERE id = $2 AND company_id = $3`,
            [allocAmount, alloc.purchase_invoice_id, companyId],
          );
        }
      }

      await client.query(`DELETE FROM payment_allocations WHERE payment_id = $1`, [id]);
      await client.query(`UPDATE payments SET is_deleted = true, updated_at = NOW() WHERE id = $1 AND company_id = $2`, [id, companyId]);

      if (payment.party_id && amount > 0) {
        const delta = isIncoming ? amount : -amount;
        await client.query(
          `UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3`,
          [delta, payment.party_id, companyId],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2 AND company_id = $1), 'payment_reversal', $5, $6, $7)`,
          [
            companyId,
            payment.party_id,
            isIncoming ? 'debit' : 'credit',
            amount,
            id,
            `Reversal of ${payment.payment_number || 'payment'}`,
            req.user!.id,
          ],
        );
      }

      await reverseAccountingForReference(client, companyId, 'payment', id, req.user!.id);
      return { payment_id: id, reversed_allocations: allocations.rows.length };
    });

    await logAction(req.user!.id, companyId, 'delete', 'payment', id, undefined, result, req.ip);
    res.json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Failed to delete payment';
    res.status(/not found/i.test(msg) ? 404 : 400).json(error(msg));
  }
}
