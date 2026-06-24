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
import { INVOICE_PRINT_THEMES, normalizeInvoicePrintTheme } from '../lib/printThemes';

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
  item_custom_fields: [],
  item_settings: {},
  print_settings: {},
  tax_settings: {},
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
        const scope = 'item';
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

  if (field === 'item_custom_fields') {
    const fields = asArrayPayload(value)
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const label = String(record.label || record.key || '').trim().slice(0, 80);
        if (!label) return null;
        const key = normalizeFieldKey(record.key || record.id || label, `item_custom_${index + 1}`);
        const type = ['text', 'number', 'date'].includes(String(record.type || '').toLowerCase())
          ? String(record.type).toLowerCase()
          : 'text';
        return {
          id: String(record.id || key || `item_custom_${index + 1}`).slice(0, 64),
          key,
          label,
          type,
          enabled: record.enabled === true,
          show_in_print: record.show_in_print === true,
        };
      })
      .filter(Boolean);
    return JSON.stringify(fields);
  }

  if (field === 'item_settings') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify({});
    const record = value as Record<string, unknown>;
    const normalized = {
      enable_item: record.enable_item !== false,
      sell_type: ['product', 'service', 'both'].includes(String(record.sell_type || 'both')) ? record.sell_type : 'both',
      barcode_scan: record.barcode_scan === true,
      stock_maintenance: record.stock_maintenance !== false,
      manufacturing: record.manufacturing === true,
      show_low_stock_dialog: record.show_low_stock_dialog !== false,
      items_unit: record.items_unit !== false,
      default_unit: record.default_unit === true,
      item_category: record.item_category !== false,
      party_wise_item_rate: record.party_wise_item_rate === true,
      description: record.description === true,
      item_wise_tax: record.item_wise_tax !== false,
      item_wise_discount: record.item_wise_discount !== false,
      update_sale_price_from_transaction: record.update_sale_price_from_transaction === true,
      quantity_decimal_places: Math.max(0, Math.min(4, Number(record.quantity_decimal_places ?? 2) || 0)),
      wholesale_price: record.wholesale_price === true,
      mrp: record.mrp === true,
      calculate_tax_based_on_mrp: record.calculate_tax_based_on_mrp === true,
      serial_tracking: record.serial_tracking === true,
      batch_tracking: record.batch_tracking === true,
      exp_date: record.exp_date === true,
      mfg_date: record.mfg_date === true,
      model_no: record.model_no === true,
      size: record.size === true,
    };
    return JSON.stringify(normalized);
  }

  if (field === 'print_settings') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify({});
    const record = value as Record<string, unknown>;
    const regular = record.regular && typeof record.regular === 'object' && !Array.isArray(record.regular)
      ? record.regular as Record<string, unknown>
      : {};
    const transactionNames = record.transaction_names && typeof record.transaction_names === 'object' && !Array.isArray(record.transaction_names)
      ? record.transaction_names as Record<string, unknown>
      : {};
    const itemTable = record.item_table && typeof record.item_table === 'object' && !Array.isArray(record.item_table)
      ? record.item_table as Record<string, unknown>
      : {};
    const totals = record.totals && typeof record.totals === 'object' && !Array.isArray(record.totals)
      ? record.totals as Record<string, unknown>
      : {};
    const footer = record.footer && typeof record.footer === 'object' && !Array.isArray(record.footer)
      ? record.footer as Record<string, unknown>
      : {};
    const header = record.header && typeof record.header === 'object' && !Array.isArray(record.header)
      ? record.header as Record<string, unknown>
      : {};
    const thermal = record.thermal && typeof record.thermal === 'object' && !Array.isArray(record.thermal)
      ? record.thermal as Record<string, unknown>
      : {};
    const layoutColors = record.layout_colors && typeof record.layout_colors === 'object' && !Array.isArray(record.layout_colors)
      ? record.layout_colors as Record<string, unknown>
      : {};
    const allowedLayouts = new Set<string>(INVOICE_PRINT_THEMES);
    const normalizedLayoutId = normalizeInvoicePrintTheme(regular.layout || record.invoiceTheme || record.invoice_theme);
    const allowedColumns = new Set([
      'serial_no', 'item_name', 'item_code', 'hsn_code', 'quantity', 'unit', 'unit_price',
      'discount_amount', 'discount_percent', 'taxable_amount', 'gst_rate', 'tax_amount',
      'amount', 'description', 'batch_no', 'exp_date', 'mfg_date', 'mrp', 'size',
      'model_no', 'brand', 'material',
    ]);
    const columns = Array.from(new Set(asArrayPayload(itemTable.columns)
      .map((entry) => String(entry || '').trim())
      .filter((entry) => allowedColumns.has(entry))));
    const normalized = {
      regular: {
        default: regular.default !== false,
        layout: normalizedLayoutId,
        paper_size: String(regular.paper_size || 'A4') === 'Letter' ? 'Letter' : 'A4',
        orientation: String(regular.orientation || '').toLowerCase() === 'landscape' ? 'landscape' : 'portrait',
        company_name_text_size: ['small', 'medium', 'large'].includes(String(regular.company_name_text_size || '')) ? regular.company_name_text_size : 'large',
        invoice_text_size: ['small', 'medium', 'large'].includes(String(regular.invoice_text_size || '')) ? regular.invoice_text_size : 'medium',
        repeat_header: regular.repeat_header !== false,
        print_original_duplicate: regular.print_original_duplicate === true,
        extra_top_space: Math.max(0, Math.min(80, Number(regular.extra_top_space ?? 0) || 0)),
        min_item_rows: Math.max(0, Math.min(30, Number(regular.min_item_rows ?? 0) || 0)),
      },
      header: {
        company_name: header.company_name !== false,
        company_logo: header.company_logo !== false,
        address: header.address !== false,
        email: header.email !== false,
        phone: header.phone !== false,
        gstin: header.gstin !== false,
      },
      item_table: {
        columns: columns.length ? columns : ['serial_no', 'item_name', 'hsn_code', 'quantity', 'unit', 'unit_price', 'tax_amount', 'amount'],
      },
      layout_colors: Object.fromEntries(
        Array.from(allowedLayouts).map((layoutId) => {
          const color = String(layoutColors[layoutId] || '').trim();
          return [layoutId, /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : undefined];
        }).filter(([, color]) => Boolean(color)),
      ),
      totals: {
        total_item_quantity: totals.total_item_quantity !== false,
        amount_with_decimal: totals.amount_with_decimal !== false,
        received_amount: totals.received_amount !== false,
        balance_amount: totals.balance_amount !== false,
        current_balance_of_party: totals.current_balance_of_party === true,
        tax_details: totals.tax_details !== false,
        you_saved: totals.you_saved !== false,
        print_amount_with_grouping: totals.print_amount_with_grouping !== false,
        amount_in_words: String(totals.amount_in_words || '').toLowerCase() === 'international' ? 'international' : 'indian',
      },
      footer: {
        print_description: footer.print_description !== false,
        print_terms: footer.print_terms !== false,
        print_received_by: footer.print_received_by !== false,
        print_delivered_by: footer.print_delivered_by !== false,
        signature_enabled: footer.signature_enabled !== false,
        signature_text: String(footer.signature_text || 'Authorized Signatory').trim().slice(0, 80) || 'Authorized Signatory',
        payment_mode: footer.payment_mode === true,
        acknowledgement: footer.acknowledgement === true,
      },
      transaction_names: {
        sale: String(transactionNames.sale || 'Tax Invoice').trim().slice(0, 80) || 'Tax Invoice',
        purchase: String(transactionNames.purchase || 'Bill').trim().slice(0, 80) || 'Bill',
        payment_in: String(transactionNames.payment_in || 'Payment Receipt').trim().slice(0, 80) || 'Payment Receipt',
        payment_out: String(transactionNames.payment_out || 'Payment Out').trim().slice(0, 80) || 'Payment Out',
        expense: String(transactionNames.expense || 'Expense').trim().slice(0, 80) || 'Expense',
        other_income: String(transactionNames.other_income || 'Other Income').trim().slice(0, 80) || 'Other Income',
        sale_order: String(transactionNames.sale_order || 'Sale Order').trim().slice(0, 80) || 'Sale Order',
        purchase_order: String(transactionNames.purchase_order || 'Purchase Order').trim().slice(0, 80) || 'Purchase Order',
        estimate: String(transactionNames.estimate || 'Estimate').trim().slice(0, 80) || 'Estimate',
        proforma_invoice: String(transactionNames.proforma_invoice || 'Proforma Invoice').trim().slice(0, 80) || 'Proforma Invoice',
        delivery_challan: String(transactionNames.delivery_challan || 'Delivery Challan').trim().slice(0, 80) || 'Delivery Challan',
        credit_note: String(transactionNames.credit_note || 'Credit Note').trim().slice(0, 80) || 'Credit Note',
        debit_note: String(transactionNames.debit_note || 'Debit Note').trim().slice(0, 80) || 'Debit Note',
        non_tax_bill: transactionNames.non_tax_bill === true,
      },
      thermal: {
        show_seller_name: thermal.show_seller_name !== false,
        seller_name: String(thermal.seller_name ?? '').trim().slice(0, 100),
        show_seller_phone: thermal.show_seller_phone !== false,
        seller_phone: String(thermal.seller_phone ?? '').trim().slice(0, 30),
        show_seller_address: thermal.show_seller_address !== false,
        seller_address: String(thermal.seller_address ?? '').trim().slice(0, 500),
        show_date_time: thermal.show_date_time !== false,
        show_bill_no: thermal.show_bill_no !== false,
        show_logo: thermal.show_logo !== false,
        show_tax_columns: thermal.show_tax_columns === true,
        show_payment_details: thermal.show_payment_details !== false,
        card_auth_code_override: String(thermal.card_auth_code_override ?? '').trim().slice(0, 20),
        card_last_four_override: String(thermal.card_last_four_override ?? '').trim().slice(0, 4),
        barcode_or_qr: ['none', 'barcode', 'qr'].includes(String(thermal.barcode_or_qr)) ? String(thermal.barcode_or_qr) : 'barcode',
        return_policy: String(thermal.return_policy ?? '').trim().slice(0, 1000),
        show_footer_thank_you: thermal.show_footer_thank_you !== false,
        enable_refund_layout: thermal.enable_refund_layout !== false,
        enable_deposit_layout: thermal.enable_deposit_layout === true,
        deposit_account_details: String(thermal.deposit_account_details ?? '').trim().slice(0, 500),
      },
    };
    return JSON.stringify(normalized);
  }

  if (field === 'tax_settings') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify({});
    const record = value as Record<string, unknown>;
    const standardSlabs = new Set([0, 0.1, 0.25, 0.5, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28, 40].map((rate) => String(rate)));
    const enabledSlabs = Array.from(new Set(asArrayPayload(record.enabledSlabs ?? record.enabled_slabs)
      .map((entry) => Number(entry))
      .filter((rate) => Number.isFinite(rate) && standardSlabs.has(String(rate)))))
      .sort((a, b) => a - b);
    const customRates = asArrayPayload(record.customRates ?? record.custom_rates)
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const row = entry as Record<string, unknown>;
        const name = String(row.name || row.label || '').trim().slice(0, 50);
        const rate = Math.max(0.01, Math.min(100, Number(row.rate ?? 0) || 0));
        if (!name) return null;
        return {
          id: String(row.id || `custom_tax_${index + 1}`).trim().slice(0, 80) || `custom_tax_${index + 1}`,
          name,
          rate,
          isActive: row.isActive !== false && row.active !== false,
        };
      })
      .filter(Boolean);
    const rawRates = asArrayPayload(record.rates);
    const rates = rawRates
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const row = entry as Record<string, unknown>;
        const type = ['IGST', 'CGST', 'SGST', 'CESS'].includes(String(row.type || '').toUpperCase())
          ? String(row.type).toUpperCase()
          : 'IGST';
        const rate = Math.max(0, Math.min(100, Number(row.rate ?? 0) || 0));
        const label = String(row.label || `${type}@${rate}%`).trim().slice(0, 80);
        return {
          id: String(row.id || `tax_rate_${index + 1}`).trim().slice(0, 80) || `tax_rate_${index + 1}`,
          label,
          type,
          rate,
          active: row.active !== false,
        };
      })
      .filter(Boolean);
    const rawGroups = asArrayPayload(record.groups);
    const groups = rawGroups
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const row = entry as Record<string, unknown>;
        const totalRate = Math.max(0, Math.min(100, Number(row.rate ?? row.total_rate ?? 0) || 0));
        const label = String(row.label || `GST@${totalRate}%`).trim().slice(0, 80);
        const components = asArrayPayload(row.components)
          .map((component) => {
            if (!component || typeof component !== 'object') return null;
            const part = component as Record<string, unknown>;
            const type = ['CGST', 'SGST', 'IGST', 'CESS'].includes(String(part.type || '').toUpperCase())
              ? String(part.type).toUpperCase()
              : '';
            if (!type) return null;
            return {
              type,
              rate: Math.max(0, Math.min(100, Number(part.rate ?? 0) || 0)),
            };
          })
          .filter(Boolean);
        return {
          id: String(row.id || `tax_group_${index + 1}`).trim().slice(0, 80) || `tax_group_${index + 1}`,
          label,
          rate: totalRate,
          components,
          active: row.active !== false,
        };
      })
      .filter(Boolean);
    const normalized = {
      enable_gst: record.enable_gst !== false,
      enable_hsn_sac: record.enable_hsn_sac !== false,
      additional_cess_on_item: record.additional_cess_on_item === true,
      reverse_charge: record.reverse_charge === true,
      enable_place_of_supply: record.enable_place_of_supply !== false,
      composite_scheme: record.composite_scheme === true,
      enable_tcs: record.enable_tcs === true,
      enable_tds: record.enable_tds === true,
      enabledSlabs: enabledSlabs.length ? enabledSlabs : undefined,
      enabled_slabs: enabledSlabs.length ? enabledSlabs : undefined,
      customRates,
      custom_rates: customRates,
      rates,
      groups,
    };
    return JSON.stringify(normalized);
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
      'item_settings', 'item_custom_fields', 'print_settings', 'tax_settings',
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
             upi_id = $6, is_primary = $7, is_active = $8, account_type = $9, opening_balance = $10,
             opening_date = $11, notes = $12, print_on_invoice = $13, print_upi_qr = $14,
             accept_online_payments = $15
           WHERE id = $16 AND company_id = $17 AND is_deleted = false
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
            d.account_type || 'current',
            Math.round(Number(d.opening_balance) || 0),
            d.opening_date || null,
            d.notes || null,
            !!d.print_on_invoice,
            !!d.print_upi_qr,
            !!d.accept_online_payments,
            id,
            companyId,
          ],
        );
        if (!r.rows.length) throw new Error('Bank account not found');
        return r.rows[0];
      }

      const r = await client.query(
        `INSERT INTO company_bank_accounts (
           company_id, account_label, bank_name, account_number, ifsc, branch, upi_id, is_primary, is_active,
           account_type, opening_balance, opening_date, notes, print_on_invoice, print_upi_qr, accept_online_payments
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
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
          d.account_type || 'current',
          Math.round(Number(d.opening_balance) || 0),
          d.opening_date || null,
          d.notes || null,
          !!d.print_on_invoice,
          !!d.print_upi_qr,
          !!d.accept_online_payments,
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
