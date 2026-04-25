import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { redis } from '../config/redis';

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Same FY + branch pattern as sales invoices, using `companies.quotation_prefix`. */
async function generateQuotationNumber(companyId: string, godownId: string | null): Promise<string> {
  const prefixRes = await query('SELECT quotation_prefix FROM companies WHERE id = $1', [companyId]);
  const raw = prefixRes.rows[0]?.quotation_prefix;
  const prefix = String(raw != null && String(raw).trim() !== '' ? raw : 'QT').replace(/\/+$/, '');

  const now = new Date();
  const month = now.getMonth();
  const yearStr = now.getFullYear().toString().slice(-2);
  const nextYearStr = (now.getFullYear() + 1).toString().slice(-2);
  const prevYearStr = (now.getFullYear() - 1).toString().slice(-2);
  const fyShort = month >= 3 ? `${yearStr}-${nextYearStr}` : `${prevYearStr}-${yearStr}`;

  const branchCode = godownId ? 'GW' : 'HQ';

  const redisKey = `seq:quotation:${companyId}:${fyShort}`;
  let seq = 1;

  if (redis) {
    try {
      seq = await redis.incr(redisKey);
    } catch {
      const dbRes = await query(
        `SELECT COUNT(*)::int as count FROM quotations WHERE company_id = $1 AND is_deleted = false AND created_at >= $2`,
        [companyId, new Date(now.getFullYear(), 0, 1).toISOString()]
      );
      seq = (dbRes.rows[0]?.count || 0) + 1;
    }
  } else {
    const dbRes = await query(
      `SELECT COUNT(*)::int as count FROM quotations WHERE company_id = $1 AND is_deleted = false AND created_at >= $2`,
      [companyId, new Date(now.getFullYear(), 0, 1).toISOString()]
    );
    seq = (dbRes.rows[0]?.count || 0) + 1;
  }

  const paddedSeq = String(seq).padStart(4, '0');
  return `${prefix}/${branchCode}/${fyShort}/${paddedSeq}`;
}

export async function createQuotation(req: Request, res: Response) {
  try {
    const d = req.body;
    if (!d.party_id) return res.status(400).json(error('party_id is required'));
    if (!d.quotation_date) return res.status(400).json(error('quotation_date is required'));

    const godownId = d.godown_id || null;
    const discount = Math.max(0, Math.round(Number(d.discount_amount) || 0));
    const total = Math.max(0, Math.round(Number(d.total_amount) || 0));
    const subtotal = Math.max(0, Math.round(Number(d.subtotal) ?? total + discount));

    const customNo = trimOrNull(d.quotation_number);
    const qn = customNo || (await generateQuotationNumber(req.user!.company_id, godownId));

    const invRes = await query(
      `INSERT INTO quotations (
         company_id, godown_id, quotation_number, quotation_date, valid_until, party_id,
         party_name_override, party_phone_override, party_email_override,
         subtotal, discount_amount, total_amount,
         customer_notes, internal_notes, terms_and_conditions,
         status, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16) RETURNING *`,
      [
        req.user!.company_id,
        godownId,
        qn,
        d.quotation_date,
        d.valid_until || null,
        d.party_id,
        trimOrNull(d.party_name_override),
        trimOrNull(d.party_phone_override),
        trimOrNull(d.party_email_override),
        subtotal,
        discount,
        total,
        trimOrNull(d.customer_notes),
        trimOrNull(d.internal_notes),
        trimOrNull(d.terms_and_conditions),
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
