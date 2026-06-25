import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';

// ── GET /api/proforma ────────────────────────────────────────────
export async function listProformas(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { status, search } = req.query;
    const where: string[] = ['i.company_id = $1', "i.invoice_type = 'proforma'", 'i.is_deleted = false'];
    const params: any[] = [companyId];
    if (status) { where.push(`i.proforma_status = $${params.length + 1}`); params.push(status); }
    if (search) { where.push(`(i.invoice_number ILIKE $${params.length + 1} OR p.name ILIKE $${params.length + 1})`); params.push(`%${search}%`); }
    const rows = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.proforma_status,
              i.converted_to_invoice_id, conv.invoice_number AS converted_invoice_number,
              COALESCE(p.name, i.party_name_snapshot, 'Walk-in') AS party_name,
              (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id
       LEFT JOIN invoices conv ON conv.id = i.converted_to_invoice_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.invoice_date DESC, i.created_at DESC`,
      params,
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/proforma/:id/status ────────────────────────────────
export async function updateProformaStatus(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const status = String(req.body?.status || '');
    if (!['draft', 'sent', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json(error('status must be draft, sent, accepted, or rejected'));
    }
    const result = await query(
      `UPDATE invoices SET proforma_status = $1
       WHERE id = $2 AND company_id = $3 AND invoice_type = 'proforma' AND is_deleted = false
         AND proforma_status != 'converted'
       RETURNING id, proforma_status`,
      [status, req.params.id, companyId],
    );
    if (!result.rows.length) return res.status(404).json(error('Proforma not found, or it has already been converted to a sale invoice and is locked'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/proforma/:id/duplicate ──────────────────────────────
export async function duplicateProforma(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const result = await withTransaction(async (client) => {
      const src = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type = 'proforma' AND is_deleted = false`,
        [req.params.id, companyId],
      );
      if (!src.rows.length) throw new Error('Proforma not found');
      const orig = src.rows[0];

      const countRes = await client.query(`SELECT COUNT(*)::int AS c FROM invoices WHERE company_id = $1 AND invoice_type = 'proforma'`, [companyId]);
      const newNumber = `${(orig.invoice_number || 'PF').split('/')[0]}/COPY-${countRes.rows[0].c + 1}`;

      const newInv = await client.query(
        `INSERT INTO invoices (
           company_id, invoice_type, invoice_number, invoice_date, party_id, party_name_snapshot,
           party_phone_snapshot, party_email_snapshot, party_gstin_snapshot, total_amount, taxable_amount,
           cgst_amount, sgst_amount, igst_amount, cess_amount, notes, terms_and_conditions, proforma_status,
           created_by
         )
         SELECT company_id, invoice_type, $2, CURRENT_DATE, party_id, party_name_snapshot,
                party_phone_snapshot, party_email_snapshot, party_gstin_snapshot, total_amount, taxable_amount,
                cgst_amount, sgst_amount, igst_amount, cess_amount, notes, terms_and_conditions, 'draft',
                $3
         FROM invoices WHERE id = $1
         RETURNING id`,
        [orig.id, newNumber, req.user!.id],
      );
      const newId = newInv.rows[0].id;

      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_code, unit, quantity, unit_price, discount_amount, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount, sort_order)
         SELECT $1, item_id, item_name, hsn_code, unit, quantity, unit_price, discount_amount, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount, sort_order
         FROM invoice_items WHERE invoice_id = $2`,
        [newId, orig.id],
      );

      return { id: newId, invoice_number: newNumber };
    });
    res.status(201).json(success(result));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

// ── POST /api/proforma/:id/convert ────────────────────────────────
// Real conversion: creates a genuine new sale invoice (invoice_type=
// 'tax_invoice') from the proforma's real line items, locks the
// proforma as 'converted', and links both records to each other. Does
// NOT touch stock or accounting itself — the new sale invoice is a
// normal invoice and goes through the exact same creation path
// (with its own stock/accounting effects) as any other sale, just
// pre-filled here rather than typed in from scratch.
export async function convertProformaToInvoice(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const result = await withTransaction(async (client) => {
      const src = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND invoice_type = 'proforma' AND is_deleted = false FOR UPDATE`,
        [req.params.id, companyId],
      );
      if (!src.rows.length) throw new Error('Proforma not found');
      const orig = src.rows[0];
      if (orig.proforma_status === 'converted') throw new Error('This proforma has already been converted');

      const items = await client.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`, [orig.id]);

      const seqRes = await client.query(
        `SELECT COUNT(*)::int AS c FROM invoices WHERE company_id = $1 AND invoice_type IN ('sale','tax_invoice')`,
        [companyId],
      );
      const newInvoiceNumber = `INV-${String(seqRes.rows[0].c + 1).padStart(4, '0')}`;

      const newInv = await client.query(
        `INSERT INTO invoices (
           company_id, invoice_type, invoice_number, invoice_date, party_id, party_name_snapshot,
           party_phone_snapshot, party_email_snapshot, party_gstin_snapshot, total_amount, taxable_amount,
           balance_due, cgst_amount, sgst_amount, igst_amount, cess_amount, notes, terms_and_conditions,
           converted_from_proforma_id, payment_status, status, created_by
         )
         VALUES ($1,'tax_invoice',$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11,$12,$13,$14,$15,$16,'unpaid','active',$17)
         RETURNING id, invoice_number`,
        [
          companyId, newInvoiceNumber, orig.party_id, orig.party_name_snapshot,
          orig.party_phone_snapshot, orig.party_email_snapshot, orig.party_gstin_snapshot,
          orig.total_amount, orig.taxable_amount, orig.cgst_amount, orig.sgst_amount,
          orig.igst_amount, orig.cess_amount, orig.notes, orig.terms_and_conditions,
          orig.id, req.user!.id,
        ],
      );
      const newId = newInv.rows[0].id;

      for (const it of items.rows) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_code, unit, quantity, unit_price, discount_amount, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [newId, it.item_id, it.item_name, it.hsn_code, it.unit, it.quantity, it.unit_price, it.discount_amount, it.gst_rate, it.taxable_amount, it.cgst_amount, it.sgst_amount, it.igst_amount, it.cess_amount, it.total_amount, it.sort_order],
        );
      }

      await client.query(
        `UPDATE invoices SET proforma_status = 'converted', converted_to_invoice_id = $1 WHERE id = $2`,
        [newId, orig.id],
      );

      return { newInvoiceId: newId, newInvoiceNumber: newInv.rows[0].invoice_number };
    });
    res.status(201).json(success(result));
  } catch (err: any) {
    res.status(/already been converted|not found/i.test(err.message) ? 400 : 500).json(error(err.message));
  }
}
