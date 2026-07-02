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
    extra_bottom_lines: 0,
    number_of_copies: 1,
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
  reference_invoice: {
    fields: {
      eway_bill_no: true,
      delivery_note: true,
      mode_terms_payment: true,
      reference_no_date: true,
      other_references: true,
      buyer_order_no: true,
      buyer_order_date: true,
      dispatch_doc_no: true,
      delivery_note_date: true,
      dispatched_through: true,
      destination: true,
      vessel_flight_no: true,
      receipt_by_shipper: true,
      port_loading: true,
      port_discharge: true,
      terms_delivery: true,
    },
    show_item_custom_fields: true,
    include_eway_appendix: true,
    declaration: '',
    terms: '1. Goods Once Sold Will Not Be Accepted.\n2. Subject to Ahemdabad jurisdiction. E. & O.E.\n3. Payment within 30 Days.\n4. Interest @ 18% will be charged from Due Date.',
  },
  thermal: {
    make_default: false,
    page_size: '3_inch',
    custom_page_size: 48,
    printing_type: 'text',
    text_styling_bold: true,
    auto_cut_paper: false,
    open_cash_drawer: false,
    extra_bottom_lines: 0,
    number_of_copies: 1,
  },
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
  const thermal = { ...DEFAULT_PRINT_SETTINGS.thermal, ...parseObject(raw.thermal) };
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
    reference_invoice: {
      ...DEFAULT_PRINT_SETTINGS.reference_invoice,
      ...parseObject(raw.reference_invoice),
      fields: {
        ...DEFAULT_PRINT_SETTINGS.reference_invoice.fields,
        ...parseObject(parseObject(raw.reference_invoice).fields),
      },
    },
    thermal: {
      show_seller_name: (thermal as any).show_seller_name !== false,
      seller_name: String((thermal as any).seller_name ?? '').trim().slice(0, 100),
      show_seller_phone: (thermal as any).show_seller_phone !== false,
      seller_phone: String((thermal as any).seller_phone ?? '').trim().slice(0, 50),
      show_seller_address: (thermal as any).show_seller_address !== false,
      seller_address: String((thermal as any).seller_address ?? '').trim().slice(0, 500),
      show_date_time: (thermal as any).show_date_time !== false,
      show_bill_no: (thermal as any).show_bill_no !== false,
      show_logo: (thermal as any).show_logo !== false,
      show_tax_columns: (thermal as any).show_tax_columns === true,
      show_payment_details: (thermal as any).show_payment_details !== false,
      card_auth_code_override: String((thermal as any).card_auth_code_override ?? '').trim().slice(0, 20),
      card_last_four_override: String((thermal as any).card_last_four_override ?? '').trim().slice(0, 4),
      barcode_or_qr: ['none', 'barcode', 'qr'].includes(String((thermal as any).barcode_or_qr)) ? ((thermal as any).barcode_or_qr as any) : 'barcode',
      return_policy: String((thermal as any).return_policy ?? '').trim().slice(0, 1000),
      show_footer_thank_you: (thermal as any).show_footer_thank_you !== false,
      enable_refund_layout: (thermal as any).enable_refund_layout !== false,
      enable_deposit_layout: (thermal as any).enable_deposit_layout === true,
      deposit_account_details: String((thermal as any).deposit_account_details ?? '').trim().slice(0, 500),
    },
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
      reference_invoice: {
        ...existing.reference_invoice,
        ...parseObject(incoming.reference_invoice),
        fields: {
          ...parseObject(existing.reference_invoice?.fields),
          ...parseObject(parseObject(incoming.reference_invoice).fields),
        },
      },
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
