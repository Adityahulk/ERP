import { Request, Response } from 'express';
import { query } from '../config/db';
import { error, success } from '../lib/response';
import { INVOICE_PRINT_THEMES, isInvoicePrintTheme, isRemovedDocumentTheme, normalizeInvoicePrintTheme } from '../lib/printThemes';

const DEFAULT_PRINT_SETTINGS = {
  regular: {
    default: true,
    layout: 'business-theme-1',
    paper_size: 'A4',
    orientation: 'portrait',
    company_name_text_size: 'large',
    invoice_text_size: 'medium',
    repeat_header: true,
    print_original_duplicate: false,
    extra_top_space: 0,
    min_item_rows: 0,
  },
  header: {
    company_name: true,
    company_logo: true,
    address: true,
    email: true,
    phone: true,
    gstin: true,
  },
  item_table: {
    columns: ['serial_no', 'item_name', 'hsn_code', 'quantity', 'unit', 'unit_price', 'tax_amount', 'amount'],
  },
  layout_colors: {},
  totals: {
    total_item_quantity: true,
    amount_with_decimal: true,
    received_amount: true,
    balance_amount: true,
    current_balance_of_party: false,
    tax_details: true,
    you_saved: true,
    print_amount_with_grouping: true,
    amount_in_words: 'indian',
  },
  footer: {
    print_description: true,
    print_terms: true,
    print_received_by: true,
    print_delivered_by: true,
    signature_enabled: true,
    signature_text: 'Authorized Signatory',
    payment_mode: false,
    acknowledgement: false,
  },
  transaction_names: {},
};

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizeSettings(rawValue: unknown) {
  const raw = parseObject(rawValue);
  const regular = { ...DEFAULT_PRINT_SETTINGS.regular, ...parseObject(raw.regular) };
  const invoiceTheme = normalizeInvoicePrintTheme(raw.invoiceTheme || raw.invoice_theme || regular.layout);
  return {
    ...DEFAULT_PRINT_SETTINGS,
    ...raw,
    regular: {
      ...regular,
      layout: invoiceTheme,
    },
    header: { ...DEFAULT_PRINT_SETTINGS.header, ...parseObject(raw.header) },
    item_table: { ...DEFAULT_PRINT_SETTINGS.item_table, ...parseObject(raw.item_table) },
    layout_colors: parseObject(raw.layout_colors),
    totals: { ...DEFAULT_PRINT_SETTINGS.totals, ...parseObject(raw.totals) },
    footer: { ...DEFAULT_PRINT_SETTINGS.footer, ...parseObject(raw.footer) },
    transaction_names: { ...DEFAULT_PRINT_SETTINGS.transaction_names, ...parseObject(raw.transaction_names) },
    invoiceTheme,
  };
}

async function readPrintSettings(companyId: string) {
  const result = await query(
    `SELECT print_settings, invoice_pdf_template, document_theme FROM companies WHERE id = $1 AND is_deleted = false`,
    [companyId],
  );
  if (!result.rows.length) throw new Error('Company not found');
  const row = result.rows[0];
  const base = normalizeSettings(row.print_settings);
  const persistedTheme = normalizeInvoicePrintTheme(base.invoiceTheme || row.invoice_pdf_template || row.document_theme);
  return {
    ...base,
    regular: { ...base.regular, layout: persistedTheme },
    invoiceTheme: persistedTheme,
  };
}

export async function getPrintSettings(req: Request, res: Response) {
  try {
    res.json(success(await readPrintSettings(req.user!.company_id)));
  } catch (err: any) {
    res.status(err.message === 'Company not found' ? 404 : 500).json(error(err.message || 'Could not load print settings'));
  }
}

export async function updatePrintSettings(req: Request, res: Response) {
  try {
    const bodyTheme = req.body?.invoiceTheme ?? req.body?.invoice_theme ?? req.body?.regular?.layout;
    if (bodyTheme !== undefined && !isInvoicePrintTheme(bodyTheme)) {
      const message = isRemovedDocumentTheme(bodyTheme)
        ? 'Old document themes are no longer supported. Choose a Business, GST, Landscape, or Tally theme.'
        : 'Invalid invoice theme.';
      return res.status(400).json(error(message));
    }
    const existing = await readPrintSettings(req.user!.company_id);
    const incoming = parseObject(req.body);
    const regular = { ...existing.regular, ...parseObject(incoming.regular) };
    const invoiceTheme = bodyTheme === undefined ? existing.invoiceTheme : String(bodyTheme);
    const next = {
      ...existing,
      ...incoming,
      regular: { ...regular, layout: invoiceTheme },
      header: { ...existing.header, ...parseObject(incoming.header) },
      item_table: { ...existing.item_table, ...parseObject(incoming.item_table) },
      layout_colors: { ...parseObject(existing.layout_colors), ...parseObject(incoming.layout_colors) },
      totals: { ...existing.totals, ...parseObject(incoming.totals) },
      footer: { ...existing.footer, ...parseObject(incoming.footer) },
      transaction_names: { ...existing.transaction_names, ...parseObject(incoming.transaction_names) },
      invoiceTheme,
    };
    await query(
      `UPDATE companies
         SET print_settings = $1::jsonb,
             invoice_pdf_template = $2,
             document_theme = $2,
             updated_at = NOW()
       WHERE id = $3 AND is_deleted = false`,
      [JSON.stringify(next), invoiceTheme, req.user!.company_id],
    );
    res.json(success(next));
  } catch (err: any) {
    res.status(err.message === 'Company not found' ? 404 : 500).json(error(err.message || 'Could not save print settings'));
  }
}

export { INVOICE_PRINT_THEMES };
