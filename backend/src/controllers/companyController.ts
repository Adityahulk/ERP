import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';
import { getUploadUrl } from '../services/fileUpload';

// ── GET /api/company ──────────────────────────────────────────
export async function getCompany(req: Request, res: Response) {
  try {
    const result = await query('SELECT * FROM companies WHERE id = $1 AND is_deleted = false', [req.user!.company_id]);
    if (!result.rows.length) return res.status(404).json(error('Company not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/company ────────────────────────────────────────
export async function updateCompany(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const oldResult = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    const old = oldResult.rows[0];

    const fields = [
      'name', 'legal_name', 'business_type', 'gstin', 'pan',
      'registered_address', 'city', 'state', 'pincode', 'state_code',
      'phone', 'email', 'website',
      'financial_year_start', 'invoice_prefix', 'po_prefix', 'quotation_prefix',
      'default_due_days', 'currency', 'timezone',
      'item_terminology', 'item_terminology_plural', 'default_gst_rate', 'default_hsn',
      'bank_name', 'bank_account_number', 'bank_ifsc', 'bank_branch', 'upi_id',
      'terms_and_conditions', 'invoice_notes', 'onboarding_completed',
    ];

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }

    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(companyId);
    const result = await query(
      `UPDATE companies SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    await logAction(req.user!.id, companyId, 'update', 'company', companyId, old, result.rows[0], req.ip);
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/company/logo ────────────────────────────────────
export async function uploadLogoHandler(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json(error('No file uploaded'));
    const url = getUploadUrl(req.file.path);
    await query('UPDATE companies SET logo_url = $1 WHERE id = $2', [url, req.user!.company_id]);
    res.json(success({ logo_url: url }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/company/signature ───────────────────────────────
export async function uploadSignatureHandler(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json(error('No file uploaded'));
    const url = getUploadUrl(req.file.path);
    await query('UPDATE companies SET signature_url = $1 WHERE id = $2', [url, req.user!.company_id]);
    res.json(success({ signature_url: url }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
