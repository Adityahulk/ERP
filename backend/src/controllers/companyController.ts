import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';
import { getUploadUrl } from '../services/fileUpload';
import { encryptSecret } from '../lib/credentialsCrypto';
import { removeRefreshToken } from '../middleware/auth';
import { lookupGstinDetails } from '../services/gstService';
import {
  ensurePrimaryGodown,
  applyOnboardingSeeds,
  resolveStateName,
} from '../services/onboardingService';

function sanitizeCompany(row: Record<string, unknown>) {
  const { einvoice_gsp_password_enc: _enc, ...rest } = row;
  return {
    ...rest,
    has_einvoice_gsp_password: Boolean(_enc),
  };
}

const JSONB_COMPANY_FIELD_DEFAULTS: Record<string, unknown> = {
  enabled_currencies: ['INR'],
  bulk_sales_invoice_columns: [],
  sales_invoice_custom_fields: [],
  gstin_lookup_payload: null,
};

function parseJsonMaybe(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asArrayPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const parsed = parseJsonMaybe(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function normalizeFieldKey(value: unknown, fallback: string) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return key || fallback;
}

function normalizeJsonbField(field: string, value: unknown): string | null {
  if (field === 'enabled_currencies') {
    const raw = asArrayPayload(value);
    const allowed = new Set(['INR', 'USD']);
    const currencies = Array.from(new Set(raw
      .map((entry) => String(entry || '').trim().toUpperCase())
      .filter((entry) => allowed.has(entry))));
    return JSON.stringify(currencies.length ? currencies : ['INR']);
  }

  if (field === 'bulk_sales_invoice_columns') {
    const columns = Array.from(new Set(asArrayPayload(value)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)));
    return JSON.stringify(columns);
  }

  if (field === 'sales_invoice_custom_fields') {
    const fields = asArrayPayload(value)
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const label = String(record.label || record.key || '').trim().slice(0, 80);
        if (!label) return null;
        const key = normalizeFieldKey(record.key || label, `custom_${index + 1}`);
        const scope = ['sales', 'purchase', 'all'].includes(String(record.scope || '').toLowerCase())
          ? String(record.scope).toLowerCase()
          : 'sales';
        const type = ['text', 'number', 'date'].includes(String(record.type || '').toLowerCase())
          ? String(record.type).toLowerCase()
          : 'text';
        return {
          id: String(record.id || key || `custom_${index + 1}`).slice(0, 64),
          key,
          label,
          type,
          scope,
          enabled: record.enabled !== false,
          include_in_bulk_invoice: record.include_in_bulk_invoice !== false,
        };
      })
      .filter(Boolean);
    return JSON.stringify(fields);
  }

  if (field === 'gstin_lookup_payload') {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = parseJsonMaybe(trimmed);
      return parsed && typeof parsed === 'object' ? JSON.stringify(parsed) : null;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  const fallback = JSONB_COMPANY_FIELD_DEFAULTS[field] ?? null;
  return JSON.stringify(fallback);
}

// ── GET /api/company ──────────────────────────────────────────
export async function getCompany(req: Request, res: Response) {
  try {
    const result = await query('SELECT * FROM companies WHERE id = $1 AND is_deleted = false', [req.user!.company_id]);
    if (!result.rows.length) return res.status(404).json(error('Company not found'));
    res.json(success(sanitizeCompany(result.rows[0] as any)));
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
      'default_due_days', 'currency', 'default_currency', 'enabled_currencies', 'timezone',
      'item_terminology', 'item_terminology_plural', 'default_gst_rate', 'default_hsn',
      'bank_name', 'bank_account_number', 'bank_ifsc', 'bank_branch', 'upi_id',
      'business_category',
      'gstin_legal_name', 'gstin_trade_name', 'gstin_status', 'gstin_taxpayer_type',
      'gstin_address', 'gstin_last_fetched_at', 'gstin_lookup_payload',
      'terms_and_conditions', 'invoice_notes', 'onboarding_completed',
      'einvoice_enabled', 'einvoice_turnover_above_5cr', 'einvoice_sandbox',
      'einvoice_gsp_username', 'eway_bill_only_above_50k',
      'document_primary_color', 'document_theme', 'receipt_footer_message', 'invoice_pdf_template',
      'delivery_challan_show_pricing', 'bulk_sales_invoice_columns', 'sales_invoice_custom_fields',
    ];

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const jsonbFields = new Set(Object.keys(JSONB_COMPANY_FIELD_DEFAULTS));

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (jsonbFields.has(field)) {
          updates.push(`${field} = $${idx++}::jsonb`);
          values.push(normalizeJsonbField(field, req.body[field]));
        } else {
          updates.push(`${field} = $${idx++}`);
          values.push(req.body[field]);
        }
      }
    }

    if (typeof req.body.einvoice_gsp_password === 'string') {
      const p = req.body.einvoice_gsp_password.trim();
      if (p.length > 0) {
        updates.push(`einvoice_gsp_password_enc = $${idx++}`);
        values.push(encryptSecret(p));
      } else {
        updates.push('einvoice_gsp_password_enc = NULL');
      }
    }

    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(companyId);
    const result = await query(
      `UPDATE companies SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    await logAction(req.user!.id, companyId, 'update', 'company', companyId, old, result.rows[0], req.ip);
    res.json(success(sanitizeCompany(result.rows[0] as any)));
  } catch (err: any) {
    const msg = err?.message || 'Failed to update company';
    const isJsonSyntaxError = err?.code === '22P02' || /invalid input syntax for type json/i.test(msg);
    res
      .status(isJsonSyntaxError || /Invalid JSON/i.test(msg) ? 400 : 500)
      .json(error(isJsonSyntaxError ? 'Invalid settings payload. Please refresh the page and save again.' : msg));
  }
}

export async function lookupGstin(req: Request, res: Response) {
  try {
    const details = await lookupGstinDetails(String(req.params.gstin || req.query.gstin || ''));
    res.json(success(details));
  } catch (err: any) {
    res.status(400).json(error(err.message));
  }
}

export async function listBankAccounts(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT *
       FROM company_bank_accounts
       WHERE company_id = $1 AND is_deleted = false
       ORDER BY is_primary DESC, created_at ASC`,
      [req.user!.company_id],
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function upsertBankAccount(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body || {};
    const id = d.id || req.params.id || null;
    const label = String(d.account_label || '').trim();
    const bankNameIn = String(d.bank_name || '').trim();
    const bankName = bankNameIn || label || (id ? '' : 'Bank account');
    if (!id && !label && !bankNameIn) {
      return res.status(400).json(error('Account label or bank name is required'));
    }
    if (id && !bankName) {
      return res.status(400).json(error('Bank name or account label is required'));
    }
    const accountNumRaw = d.account_number != null ? String(d.account_number).trim() : '';
    const accountNumber = accountNumRaw.length > 0 ? accountNumRaw : null;

    const row = await withTransaction(async (client) => {
      if (d.is_primary) {
        await client.query(
          `UPDATE company_bank_accounts SET is_primary = false WHERE company_id = $1 AND is_deleted = false`,
          [companyId],
        );
      }

      if (id) {
        const r = await client.query(
          `UPDATE company_bank_accounts SET
             account_label = $1, bank_name = $2, account_number = $3, ifsc = $4, branch = $5,
             upi_id = $6, is_primary = $7, is_active = $8
           WHERE id = $9 AND company_id = $10 AND is_deleted = false
           RETURNING *`,
          [
            label || null,
            bankName,
            accountNumber,
            d.ifsc ? String(d.ifsc).trim().toUpperCase() : null,
            d.branch || null,
            d.upi_id || null,
            !!d.is_primary,
            d.is_active !== false,
            id,
            companyId,
          ],
        );
        if (!r.rows.length) throw new Error('Bank account not found');
        return r.rows[0];
      }

      const r = await client.query(
        `INSERT INTO company_bank_accounts (
           company_id, account_label, bank_name, account_number, ifsc, branch, upi_id, is_primary, is_active
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          companyId,
          label || null,
          bankName,
          accountNumber,
          d.ifsc ? String(d.ifsc).trim().toUpperCase() : null,
          d.branch || null,
          d.upi_id || null,
          !!d.is_primary,
          d.is_active !== false,
        ],
      );
      return r.rows[0];
    });

    res.json(success(row));
  } catch (err: any) {
    res.status(/not found|required/i.test(err.message) ? 400 : 500).json(error(err.message));
  }
}

export async function deleteBankAccount(req: Request, res: Response) {
  try {
    const r = await query(
      `UPDATE company_bank_accounts SET is_deleted = true, is_active = false
       WHERE id = $1 AND company_id = $2 AND is_deleted = false RETURNING id`,
      [req.params.id, req.user!.company_id],
    );
    if (!r.rows.length) return res.status(404).json(error('Bank account not found'));
    res.json(success({ message: 'Bank account removed' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
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

// ── PATCH /api/company/onboarding ─────────────────────────────
export async function completeOnboarding(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { company, location, seed } = req.body as {
      company: { name: string; business_type?: string | null; gstin?: string | null; state_code: string };
      location: { name: string; city?: string | null; pincode?: string | null };
      seed?: { items?: boolean; coa?: boolean; leaves?: boolean };
    };

    const gstin = company.gstin ? String(company.gstin).replace(/\s+/g, '').toUpperCase() : null;
    const stateName = resolveStateName(company.state_code);

    await query(
      `UPDATE companies SET
         name = $1,
         legal_name = COALESCE(NULLIF(TRIM(legal_name), ''), $1),
         gstin = $2,
         state_code = $3,
         state = COALESCE($4, state),
         city = COALESCE($5, city),
         pincode = COALESCE($6, pincode),
         business_type = COALESCE($7, business_type),
         onboarding_completed = true,
         updated_at = NOW()
       WHERE id = $8`,
      [
        company.name.trim(),
        gstin,
        company.state_code,
        stateName,
        location.city?.trim() || null,
        location.pincode?.trim() || null,
        company.business_type?.trim() || null,
        companyId,
      ],
    );

    const godownId = await ensurePrimaryGodown(companyId, {
      name: location.name.trim(),
      city: location.city?.trim() || undefined,
      pincode: location.pincode?.trim() || undefined,
      state_code: company.state_code,
    });

    const seedFlags = {
      items: !!seed?.items,
      coa: !!seed?.coa,
      leaves: !!seed?.leaves,
    };
    const seeded = await applyOnboardingSeeds(companyId, godownId, seedFlags);

    await logAction(
      req.user!.id,
      companyId,
      'complete',
      'company_onboarding',
      companyId,
      null,
      { seeded, godown_id: godownId },
      req.ip,
      req.get('User-Agent'),
    );

    const result = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    res.json(success({ company: sanitizeCompany(result.rows[0] as any), seeded }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/company/delete-workspace ────────────────────────
export async function softDeleteCompany(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const old = await query(`SELECT id, name FROM companies WHERE id = $1 AND is_deleted = false`, [companyId]);
    if (!old.rows.length) return res.status(404).json(error('Company not found'));

    await withTransaction(async (client) => {
      const snapshot: Record<string, unknown> = {};
      for (const table of [
        'companies', 'users', 'godowns', 'parties', 'items', 'invoices', 'invoice_items',
        'purchase_orders', 'purchase_invoices', 'quotations', 'payments', 'employee_profiles',
      ]) {
        try {
          const rows = await client.query(`SELECT * FROM ${table} WHERE company_id = $1`, [companyId]);
          snapshot[table] = rows.rows;
        } catch {
          snapshot[table] = [];
        }
      }
      await client.query(
        `INSERT INTO owner_backup_snapshots (company_id, entity_type, entity_id, action, snapshot, created_by)
         VALUES ($1, 'company', $1, 'delete_workspace', $2, $3)`,
        [companyId, snapshot, req.user!.id],
      );
      await client.query(
        `UPDATE companies SET is_deleted = true, is_active = false, updated_at = NOW() WHERE id = $1`,
        [companyId],
      );
    });

    const users = await query(`SELECT id FROM users WHERE company_id = $1 AND is_deleted = false`, [companyId]);
    for (const row of users.rows) {
      try {
        await removeRefreshToken(row.id as string);
      } catch {
        /* Redis optional */
      }
    }

    await logAction(
      req.user!.id,
      companyId,
      'delete',
      'company',
      companyId,
      { name: old.rows[0].name },
      { workspace_closed: true },
      req.ip,
      req.get('User-Agent'),
    );

    res.json(success({ message: 'Workspace closed. This company can no longer sign in.' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
