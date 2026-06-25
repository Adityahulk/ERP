import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { reverseAccountingForReference } from '../services/accountingService';
import { logAction } from '../lib/auditLog';

// ── GET /api/pos/invoices/lookup?q= ─────────────────────────────────
export async function lookupInvoice(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json(error('Enter or scan an invoice number'));
    const result = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.status, i.payment_status,
              COALESCE(p.name, i.party_name_snapshot, 'Walk-in') AS party_name, i.party_id
       FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
       WHERE i.company_id = $1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted = false
         AND i.invoice_number ILIKE $2
       ORDER BY i.invoice_date DESC LIMIT 10`,
      [companyId, `%${q}%`],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/pos/invoices/:id/full ──────────────────────────────────
export async function getInvoiceFull(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const inv = await query(
      `SELECT i.*, COALESCE(p.name, i.party_name_snapshot, 'Walk-in') AS party_name
       FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [req.params.id, companyId],
    );
    if (!inv.rows.length) return res.status(404).json(error('Invoice not found'));
    const items = await query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`, [req.params.id]);

    const alreadyReturned = await query(
      `SELECT sri.item_id, COALESCE(SUM(sri.quantity), 0) AS qty
       FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id
       WHERE sr.invoice_id = $1 AND sr.company_id = $2 GROUP BY sri.item_id`,
      [req.params.id, companyId],
    );
    const returnedMap: Record<string, number> = {};
    for (const r of alreadyReturned.rows) returnedMap[r.item_id] = Number(r.qty);

    res.json(success({
      ...inv.rows[0],
      items: items.rows.map((it: any) => ({ ...it, already_returned_qty: returnedMap[it.item_id] || 0 })),
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/pos/invoices/:id/void ─────────────────────────────────
export async function voidBill(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json(error('A reason is required to void a bill'));

    const result = await withTransaction(async (client) => {
      const invRes = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [req.params.id, companyId],
      );
      if (!invRes.rows.length) throw new Error('Invoice not found');
      const inv = invRes.rows[0];
      if (inv.status === 'cancelled') throw new Error('This bill has already been voided');

      const itemsRes = await client.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
      for (const it of itemsRes.rows) {
        if (!it.item_id) continue;
        await client.query(
          `UPDATE item_stock SET quantity = quantity + $1, updated_at = now()
           WHERE company_id = $2 AND item_id = $3 AND godown_id = $4`,
          [it.quantity, companyId, it.item_id, inv.godown_id],
        );
        await client.query(
          `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, notes, created_by)
           VALUES ($1,$2,$3,'void_restore','invoice_void',$4,$5,$6,$7)`,
          [companyId, it.item_id, inv.godown_id, inv.id, it.quantity, `Voided: ${reason}`, req.user!.id],
        );
      }

      await reverseAccountingForReference(client, companyId, 'invoice', inv.id, req.user!.id);

      await client.query(
        `UPDATE invoices SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || $1 WHERE id = $2`,
        [`Voided by ${req.user!.id} on ${new Date().toISOString().split('T')[0]}: ${reason}`, inv.id],
      );

      return inv;
    });

    await logAction(req.user!.id, companyId, 'void_bill', 'invoice', result.id, { status: result.status }, { status: 'cancelled', reason }, req.ip);
    res.json(success({ voided: true, invoiceNumber: result.invoice_number }));
  } catch (err: any) {
    res.status(/not found|already been voided/i.test(err.message) ? 400 : 500).json(error(err.message));
  }
}

// ── POST /api/pos/invoices/:id/exchange ─────────────────────────────
export async function exchangeBill(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { returnItems, newItems, payment_mode } = req.body;
    if (!Array.isArray(returnItems) || !returnItems.length) return res.status(400).json(error('Select at least one item to return'));
    if (!Array.isArray(newItems) || !newItems.length) return res.status(400).json(error('Select at least one new item for the exchange'));

    const origRes = await query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [req.params.id, companyId]);
    if (!origRes.rows.length) return res.status(404).json(error('Original invoice not found'));
    const orig = origRes.rows[0];

    const returnValue = returnItems.reduce((s: number, it: any) => s + Math.round(it.quantity * it.unit_price), 0);
    const newValue = newItems.reduce((s: number, it: any) => s + Math.round(it.quantity * it.unit_price * (1 + (it.gst_rate || 0) / 100)), 0);
    const difference = newValue - returnValue;

    const { createSaleReturn } = await import('./saleReturnController');
    const { createInvoice } = await import('./invoiceController');

    const fakeReturnReq: any = {
      user: req.user,
      body: { invoice_id: orig.id, party_id: orig.party_id, party_name: orig.party_name_snapshot, reason: 'Exchange', items: returnItems },
    };
    let returnResult: any = null;
    const returnRes: any = { status: () => returnRes, json: (b: any) => { returnResult = b; } };
    await createSaleReturn(fakeReturnReq, returnRes);
    if (!returnResult?.data) return res.status(400).json(error(returnResult?.error || 'Could not process the return leg of this exchange'));

    const fakeInvoiceReq: any = {
      user: req.user,
      body: {
        invoice_type: 'tax_invoice', is_interstate: false, items: newItems,
        party_id: orig.party_id, party_name: orig.party_name_snapshot,
        payments: difference > 0 ? [{ amount: difference, payment_mode: payment_mode || 'cash' }] : [],
        notes: `Exchange against ${orig.invoice_number}`,
      },
    };
    let newInvoiceResult: any = null;
    const invoiceRes: any = { status: () => invoiceRes, json: (b: any) => { newInvoiceResult = b; } };
    await createInvoice(fakeInvoiceReq, invoiceRes);
    if (!newInvoiceResult?.data) {
      // The return leg above already committed in its own transaction —
      // these two legs are not atomic with each other (they're two
      // independent, already-existing controllers, not refactored to
      // share one transaction). Say so plainly rather than implying
      // nothing happened.
      return res.status(400).json(error(
        `The return (credit note ${returnResult.data.credit_note_number || returnResult.data.id}) was recorded, but the new items could not be billed: ${newInvoiceResult?.error || 'unknown error'}. Please complete the new sale manually or contact support before re-trying.`,
      ));
    }

    res.status(201).json(success({
      returnId: returnResult.data.id,
      newInvoiceId: newInvoiceResult.data.id,
      newInvoiceNumber: newInvoiceResult.data.invoice_number,
      returnValuePaise: returnValue,
      newValuePaise: newValue,
      differencePaise: difference,
      settlement: difference > 0 ? 'customer_pays' : difference < 0 ? 'refund_due' : 'even',
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/pos/invoices/:id/duplicate-draft ───────────────────────
export async function getDuplicateBillDraft(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const inv = await query(
      `SELECT i.party_id, COALESCE(p.name, i.party_name_snapshot) AS party_name, i.party_phone_snapshot
       FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [req.params.id, companyId],
    );
    if (!inv.rows.length) return res.status(404).json(error('Invoice not found'));
    const items = await query(
      `SELECT item_id, item_name, hsn_code, unit, quantity, unit_price, discount_amount, gst_rate
       FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [req.params.id],
    );
    res.json(success({ party: inv.rows[0], items: items.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
