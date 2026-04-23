import { Request, Response } from 'express';
import { query } from '../config/db';
import { error } from '../lib/response';
import { generateThermalReceipt } from '../services/pdfService';

/** GET /api/print/receipt/:invoiceId?width=58|80 */
export async function getReceiptPdf(req: Request, res: Response) {
  try {
    const { invoiceId } = req.params;
    const w = req.query.width === '58' ? 58 : 80;

    const invRes = await query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [invoiceId, req.user!.company_id]
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));

    const companyRes = await query(`SELECT * FROM companies WHERE id = $1`, [req.user!.company_id]);
    const itemsRes = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order, id`,
      [invoiceId, req.user!.company_id]
    );

    const pdfBuffer = await generateThermalReceipt(invRes.rows[0], companyRes.rows[0], itemsRes.rows, w as 58 | 80);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=receipt-${invRes.rows[0].invoice_number}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
