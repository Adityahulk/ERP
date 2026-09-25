import { Request, Response } from 'express';
import { query } from '../config/db';
import { error } from '../lib/response';
import { generateQuotationPDF, generateThermalReceipt } from '../services/pdfService';

/** GET /api/print/receipt/:invoiceId?width=40..100 */
export async function getReceiptPdf(req: Request, res: Response) {
  try {
    const { invoiceId } = req.params;
    const requestedWidth = Number(req.query.width);

    const invRes = await query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [invoiceId, req.user!.company_id]
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));

    const companyRes = await query(`SELECT * FROM companies WHERE id = $1`, [req.user!.company_id]);
    const rawSettings = companyRes.rows[0]?.print_settings;
    let printSettings: Record<string, any> = {};
    if (typeof rawSettings === 'string') {
      try {
        printSettings = JSON.parse(rawSettings || '{}');
      } catch {
        printSettings = {};
      }
    } else if (rawSettings && typeof rawSettings === 'object') {
      printSettings = rawSettings;
    }
    const thermal = printSettings.thermal || {};
    const savedWidth = thermal.page_size === '2_inch'
      ? 58
      : thermal.page_size === '4_inch'
        ? 100
        : thermal.page_size === 'custom'
          ? Number(thermal.custom_page_size || 48)
          : 80;
    const w = Number.isFinite(requestedWidth)
      ? Math.max(40, Math.min(100, requestedWidth))
      : Math.max(40, Math.min(100, savedWidth));
    const itemsRes = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order, id`,
      [invoiceId, req.user!.company_id]
    );

    const pdfBuffer = await generateThermalReceipt(invRes.rows[0], companyRes.rows[0], itemsRes.rows, w);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=receipt-${invRes.rows[0].invoice_number}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

/** GET /api/print/quotation/:quotationId */
export async function getQuotationPdf(req: Request, res: Response) {
  try {
    const { quotationId } = req.params;
    const qRes = await query(
      `SELECT q.*,
              COALESCE(q.salesperson_name_snapshot, u.name) AS salesperson_name,
              COALESCE(q.salesperson_phone_snapshot, u.phone) AS salesperson_phone,
              COALESCE(q.salesperson_email_snapshot, u.email) AS salesperson_email
       FROM quotations q
       LEFT JOIN users u ON u.id = q.created_by AND u.company_id = q.company_id AND u.is_deleted = false
       WHERE q.id = $1 AND q.company_id = $2 AND q.is_deleted = false`,
      [quotationId, req.user!.company_id]
    );
    if (!qRes.rows.length) return res.status(404).json(error('Quotation not found'));
    const quotation = qRes.rows[0];

    const companyRes = await query(`SELECT * FROM companies WHERE id = $1`, [req.user!.company_id]);
    const partyRes = quotation.party_id
      ? await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [quotation.party_id, req.user!.company_id])
      : { rows: [] as any[] };
    const itemsRes = await query(
      `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order, id`,
      [quotationId]
    );
    const pdf = await generateQuotationPDF(quotation, companyRes.rows[0], partyRes.rows[0] || null, itemsRes.rows);
    res.setHeader('Content-Type', 'application/pdf');
    const filenamePrefix = quotation.document_type === 'proforma' ? 'proforma-invoice' : 'quotation';
    res.setHeader('Content-Disposition', `inline; filename=${filenamePrefix}-${quotation.quotation_number}.pdf`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
