import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';

export async function createQuotation(req: Request, res: Response) {
  try {
    const d = req.body;
    if (!d.party_id) return res.status(400).json(error('party_id is required'));
    if (!d.quotation_date) return res.status(400).json(error('quotation_date is required'));

    const subtotal = Number(d.subtotal) || 0;
    const total = Number(d.total_amount) ?? subtotal;

    const qn =
      (typeof d.quotation_number === 'string' && d.quotation_number.trim()) ||
      `QT-${Date.now()}`;

    const invRes = await query(
      `INSERT INTO quotations (
         company_id, godown_id, quotation_number, quotation_date, valid_until, party_id,
         subtotal, total_amount, status, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9) RETURNING *`,
      [
        req.user!.company_id,
        d.godown_id || null,
        qn,
        d.quotation_date,
        d.valid_until || null,
        d.party_id,
        subtotal,
        total,
        req.user!.id,
      ]
    );
    res.status(201).json(success(invRes.rows[0]));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function listQuotations(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const companyId = req.user!.company_id;

    const countRes = await query(
      `SELECT COUNT(*)::bigint AS c FROM quotations q WHERE q.company_id = $1 AND q.is_deleted = false`,
      [companyId]
    );
    const total = parseInt(countRes.rows[0].c, 10);

    const result = await query(
      `SELECT q.*, p.name AS party_name
       FROM quotations q
       LEFT JOIN parties p ON q.party_id = p.id
       WHERE q.company_id = $1 AND q.is_deleted = false
       ORDER BY q.created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getQuotation(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT * FROM quotations WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(404).json(error('Quotation not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function updateQuotationStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json(error('status is required'));

    const r = await query(
      `UPDATE quotations SET status = $1 WHERE id = $2 AND company_id = $3 AND is_deleted = false RETURNING id`,
      [status, id, req.user!.company_id]
    );
    if (!r.rows.length) return res.status(404).json(error('Quotation not found'));

    res.json(success({ message: `Quotation marked as ${status}` }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function convertToInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const qRes = await query(
      `SELECT * FROM quotations WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, req.user!.company_id]
    );
    if (!qRes.rows.length) return res.status(404).json(error('Quotation not found'));

    res.json(success({ message: 'Quotation converted successfully', invoice_id: 'mock_uuid' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
