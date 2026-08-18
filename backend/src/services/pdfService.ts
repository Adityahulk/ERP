import fs from 'fs';
import path from 'path';
import puppeteer, { Page } from 'puppeteer';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { env } from '../config/env';
import { amountToWordsINR } from '../lib/amountToWords';
import {
  PRINT_THEME_TO_PALETTE,
  PRINT_THEME_TO_TEMPLATE_KIND,
  normalizeInvoicePrintTheme,
  type InvoicePrintTheme,
} from '../lib/printThemes';
import { getConvertedPrice } from './gstService';

function templatesRoot(): string {
  const dist = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(dist)) {
    const nested = path.join(dist, 'templates');
    if (fs.existsSync(nested)) return nested;
    return dist;
  }
  const dev = path.join(process.cwd(), 'src', 'templates');
  if (fs.existsSync(dev)) return dev;
  return dist;
}

function readTpl(rel: string): string {
  return fs.readFileSync(path.join(templatesRoot(), rel), 'utf-8');
}

function fmtPaise(paise: number): string {
  return (Math.round(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeCurrencyCode(value: unknown): 'INR' | 'USD' {
  return String(value || 'INR').trim().toUpperCase() === 'USD' ? 'USD' : 'INR';
}

function currencySymbol(value: unknown): string {
  return normalizeCurrencyCode(value) === 'USD' ? '$' : '₹';
}

function fmtMoney(paise: number, currency: unknown): string {
  const code = normalizeCurrencyCode(currency);
  const locale = code === 'USD' ? 'en-US' : 'en-IN';
  const symbol = currencySymbol(code);
  return `${symbol}${(Math.round(Number(paise || 0)) / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function replaceAll(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function resolveAssetUrl(src?: string): string {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http') || raw.startsWith('data:') || raw.startsWith('file://')) return raw;
  if (raw.startsWith('/uploads')) return `${env.FRONTEND_URL}${raw}`;
  return `${env.FRONTEND_URL}/${raw.replace(/^\/+/, '')}`;
}

/**
 * Read a /uploads/* asset from disk and inline as a base64 data URI so Puppeteer can render it
 * without depending on the frontend HTTP server being reachable from the headless browser.
 * Returns '' when the source is missing, unreadable, or unsupported.
 */
function inlineAssetAsDataUri(src?: string): string {
  const raw = String(src || '').trim();
  if (!raw) return '';
  // Already inlinable / external — return as-is.
  if (raw.startsWith('data:') || raw.startsWith('file://')) return raw;
  // Network URLs we can't synchronously inline — fall through to network fetch.
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;

  try {
    let absPath: string;
    if (raw.startsWith('/uploads/')) {
      const rel = raw.replace(/^\/uploads\/?/, '');
      absPath = path.resolve(env.UPLOAD_DIR, rel);
    } else if (path.isAbsolute(raw)) {
      absPath = raw;
    } else {
      absPath = path.resolve(env.UPLOAD_DIR, raw.replace(/^\/+/, ''));
    }
    if (!fs.existsSync(absPath)) return '';
    const ext = path.extname(absPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const buf = fs.readFileSync(absPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

function themeStyle(theme: string): string {
  if (theme === 'modern') return `<style>body{font-family:Inter,Segoe UI,Arial,sans-serif}.inv-card,.panel,.box{border-radius:12px}table th{background:#eef2ff}</style>`;
  if (theme === 'compact') return `<style>body{font-size:12px}table th,table td{padding:4px 6px}.section,.inv-card,.panel{margin-bottom:6px}</style>`;
  if (theme === 'executive') return `<style>body{font-family:Georgia,"Times New Roman",serif}.hdr{border-bottom:4px solid {{PRIMARY_COLOR}}!important;background:#fff!important;color:#111!important}.box{border-color:#d4d4d8}table.items th{background:#18181b!important}.foot{font-style:italic}</style>`;
  if (theme === 'sunrise') return `<style>body{font-family:Segoe UI,Arial,sans-serif;background:#fffdf8}.hdr{background:linear-gradient(135deg,{{PRIMARY_COLOR}},#f97316)!important}.box{background:#fff7ed}table.items th{background:#fb923c!important}</style>`;
  if (theme === 'forest') return `<style>body{font-family:Segoe UI,Arial,sans-serif;background:#fbfefb}.hdr{background:linear-gradient(135deg,{{PRIMARY_COLOR}},#15803d)!important}.box{background:#f0fdf4;border-color:#bbf7d0}table.items th{background:#166534!important}</style>`;
  if (theme === 'midnight') return `<style>body{font-family:Segoe UI,Arial,sans-serif;background:#f8fafc}.hdr{background:linear-gradient(135deg,#0f172a,{{PRIMARY_COLOR}})!important}.box{border-color:#cbd5e1}table.items th{background:#1e293b!important}</style>`;
  if (theme === 'royal') return `<style>body{font-family:"Trebuchet MS",Verdana,sans-serif}.hdr{background:linear-gradient(135deg,{{PRIMARY_COLOR}},#7c3aed)!important}.box{background:#faf5ff;border-color:#ddd6fe}table.items th{background:#6d28d9!important}</style>`;
  if (theme === 'slate') return `<style>body{font-family:Segoe UI,Arial,sans-serif}.hdr{background:#334155!important}.box{background:#f8fafc;border-color:#cbd5e1}table.items th{background:#475569!important}</style>`;
  if (theme === 'retail') return `<style>body{font-family:Arial,Helvetica,sans-serif}.hdr{background:#111827!important}.box{border-width:2px}table.items th{background:#2563eb!important}.tot table{width:320px}.foot{text-transform:uppercase;letter-spacing:.04em}</style>`;
  if (theme === 'minimal') return `<style>body{font-family:Arial,Helvetica,sans-serif;padding:10px}.hdr{background:#fff!important;color:#111!important;border:1px solid #e5e7eb;border-radius:0!important}table.items th{background:#f3f4f6!important;color:#111!important}.box,.einv{border-radius:0}.sign{text-align:left}</style>`;
  return '';
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
}

async function withBrowserPage<T>(render: (page: Page) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    return await render(page);
  } finally {
    await browser.close().catch((err: unknown) => {
      console.error('Failed to close PDF browser:', err instanceof Error ? err.message : err);
    });
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function multilineHtml(value: unknown): string {
  return escapeHtml(String(value ?? '')).replace(/\r?\n/g, '<br/>');
}

function stateCodeFromGstin(value: unknown): string {
  const gstin = String(value || '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(gstin) ? gstin.slice(0, 2) : '';
}

const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

function companyAddress(company: any): string {
  const line1 = company.registered_address || company.gstin_address || company.address || '';
  const line2 = [company.city, company.state, company.pincode].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(', ');
}

function companyLegalDisplayName(company: any): string {
  if (company?.__hide_company_name === true) return '';
  return String(
    company?.legal_name ||
    company?.gstin_legal_name ||
    company?.name ||
    company?.gstin_trade_name ||
    'Company',
  ).trim();
}

/** Build the buyer address from a party — prefers `billing_*` fields but falls back to legacy `city/state/pincode`. */
function buyerAddress(party: any): string {
  if (!party) return '';
  const city = party.billing_city || party.city || '';
  const state = party.billing_state || party.state || '';
  const pincode = party.billing_pincode || party.pincode || '';
  return [party.billing_address, city, state, pincode].filter(Boolean).join(', ');
}

function normalizeStateCode(value: unknown): string {
  const raw = String(value || '').trim();
  const match = raw.match(/\b(\d{2})\b/);
  return match ? match[1] : raw.slice(0, 2);
}

function stateLabel(stateCode: unknown, stateName?: unknown): string {
  const code = normalizeStateCode(stateCode);
  const explicitName = String(stateName || '').trim().replace(/^\d{2}\s*[-:]\s*/, '');
  if (!code && !explicitName) return '';
  const name = GST_STATE_NAMES[code] || explicitName;
  return code && name ? `${code}-${name}` : (code || name);
}

function companyStateLabel(company: any): string {
  const code = stateCodeFromGstin(company?.gstin) || normalizeStateCode(company?.state_code);
  return stateLabel(code, company?.state);
}

function partyStateLabel(party: any, gstin?: unknown, fallbackCode?: unknown, fallbackName?: unknown): string {
  const code = stateCodeFromGstin(gstin) || normalizeStateCode(party?.billing_state_code || party?.state_code || fallbackCode);
  return stateLabel(code, party?.billing_state || party?.state || fallbackName);
}

function businessContactBlock(args: {
  name: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  gstin?: unknown;
  pan?: unknown;
  state?: unknown;
  title?: string;
  className?: string;
  compact?: boolean;
}): string {
  const rows = [
    fieldLine('Phone no.', args.phone),
    fieldLine('Email', args.email),
    fieldLine('GSTIN', args.gstin, 'mono'),
    fieldLine('PAN', args.pan, 'mono'),
    fieldLine('State', args.state),
  ].join('');
  return `<div class="business-block ${args.className || ''}">
    ${args.title ? `<div class="block-title">${escapeHtml(args.title)}</div>` : ''}
    <div class="business-name">${escapeHtml(String(args.name || '—'))}</div>
    <div class="business-address">${addressHtml(args.address)}</div>
    <div class="business-lines">${rows}</div>
  </div>`;
}

function companyContactBlock(company: any, options?: { title?: string; className?: string }): string {
  const name = companyLegalDisplayName(company);
  const state = companyStateLabel(company);
  return businessContactBlock({
    title: options?.title,
    className: options?.className,
    name,
    address: companyAddress(company),
    phone: company?.phone,
    email: company?.email,
    gstin: company?.gstin,
    pan: company?.pan,
    state,
  });
}

function partyContactBlock(args: {
  title: string;
  name: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  gstin?: unknown;
  pan?: unknown;
  state?: unknown;
  className?: string;
}): string {
  return businessContactBlock({ ...args, className: args.className, title: args.title });
}

function bankBlock(company: any): string {
  const rows = [
    ['Bank', company.bank_name],
    ['A/C No.', company.bank_account_number],
    ['IFSC', company.bank_ifsc],
    ['Branch', company.bank_branch],
    ['UPI', company.upi_id],
  ].filter(([, v]) => v);
  if (!rows.length) return '<span class="muted">Bank details not configured</span>';
  return rows.map(([label, value]) => `<div><b>${escapeHtml(String(label))}:</b> ${escapeHtml(String(value))}</div>`).join('');
}

function formatDocDate(value: unknown): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value).slice(0, 10));
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function fmtQty(value: unknown): string {
  const n = Number(value || 0);
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);
}

function addressHtml(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '<span class="muted">—</span>';
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join('<br/>');
}

function fieldLine(label: string, value: unknown, cls = ''): string {
  const v = String(value || '').trim();
  if (!v) return '';
  return `<div class="${cls}"><span>${escapeHtml(label)}:</span> ${escapeHtml(v)}</div>`;
}

function themePalette(theme: string, fallback: string) {
  const palettes: Record<string, { primary: string; accent: string; soft: string; ink: string }> = {
    classic: { primary: fallback || '#b45309', accent: '#92400e', soft: '#fff7ed', ink: '#111827' },
    modern: { primary: fallback || '#1d4ed8', accent: '#172554', soft: '#eef2ff', ink: '#0f172a' },
    compact: { primary: fallback || '#475569', accent: '#334155', soft: '#f8fafc', ink: '#111827' },
    executive: { primary: fallback || '#111827', accent: '#000000', soft: '#f4f4f5', ink: '#0a0a0a' },
    sunrise: { primary: fallback || '#c2410c', accent: '#9a3412', soft: '#fff7ed', ink: '#111827' },
    forest: { primary: fallback || '#15803d', accent: '#14532d', soft: '#ecfdf5', ink: '#052e16' },
    midnight: { primary: fallback || '#1e3a8a', accent: '#0f172a', soft: '#e0e7ff', ink: '#0f172a' },
    royal: { primary: fallback || '#6d28d9', accent: '#4c1d95', soft: '#f5f3ff', ink: '#1f2937' },
    slate: { primary: fallback || '#334155', accent: '#1e293b', soft: '#f1f5f9', ink: '#0f172a' },
    retail: { primary: fallback || '#0f766e', accent: '#115e59', soft: '#ccfbf1', ink: '#111827' },
    minimal: { primary: fallback || '#111827', accent: '#111827', soft: '#f8fafc', ink: '#111827' },
  };
  return palettes[theme] || palettes.classic;
}

const PRINT_LAYOUT_THEME: Record<string, string> = {
  'business-theme-1': PRINT_THEME_TO_PALETTE['business-theme-1'],
  'business-theme-2': PRINT_THEME_TO_PALETTE['business-theme-2'],
  'business-theme-3': PRINT_THEME_TO_PALETTE['business-theme-3'],
  'business-theme-4': PRINT_THEME_TO_PALETTE['business-theme-4'],
  'tally-theme-1': 'minimal',
  'landscape-theme-1': 'modern',
  'landscape-theme-2': 'retail',
  'gst-theme-1': 'royal',
  'gst-theme-2': 'modern',
  'gst-theme-3': 'executive',
  'gst-theme-4': 'slate',
  'gst-theme-5': 'forest',
  'reference-tax-eway-theme': 'minimal',
  micro_theme_1: 'classic',
  micro_theme_2: 'modern',
  micro_theme_3: 'executive',
  micro_theme_4: 'minimal',
  micro_theme_5: 'retail',
  landscape_theme_1: 'modern',
  landscape_theme_2: 'retail',
  gst_theme_1: 'royal',
  gst_theme_2: 'modern',
  gst_theme_3: 'executive',
  gst_theme_4: 'slate',
  gst_theme_5: 'forest',
  gst_theme_6: 'sunrise',
  gst_theme_7: 'midnight',
  gst_theme_8: 'sunrise',
  gst_theme_9: 'midnight',
  gst_theme_10: 'minimal',
  delivery_theme: 'minimal',
  double_divine: 'minimal',
};

const PRINT_LAYOUT_KIND: Record<string, string> = {
  'business-theme-1': PRINT_THEME_TO_TEMPLATE_KIND['business-theme-1'],
  'business-theme-2': PRINT_THEME_TO_TEMPLATE_KIND['business-theme-2'],
  'business-theme-3': PRINT_THEME_TO_TEMPLATE_KIND['business-theme-3'],
  'business-theme-4': PRINT_THEME_TO_TEMPLATE_KIND['business-theme-4'],
  'tally-theme-1': 'monochrome',
  'landscape-theme-1': 'standard',
  'landscape-theme-2': 'standard',
  'gst-theme-1': 'standard',
  'gst-theme-2': 'standard',
  'gst-theme-3': 'performa',
  'gst-theme-4': 'monochrome',
  'gst-theme-5': 'standard',
  'reference-tax-eway-theme': 'reference',
  micro_theme_1: 'standard',
  micro_theme_2: 'simple',
  micro_theme_3: 'performa',
  micro_theme_4: 'monochrome',
  micro_theme_5: 'standard',
  landscape_theme_1: 'standard',
  landscape_theme_2: 'standard',
  gst_theme_1: 'standard',
  gst_theme_2: 'standard',
  gst_theme_3: 'performa',
  gst_theme_4: 'monochrome',
  gst_theme_5: 'standard',
  gst_theme_6: 'standard',
  gst_theme_7: 'simple',
  gst_theme_8: 'standard',
  gst_theme_9: 'simple',
  gst_theme_10: 'monochrome',
  delivery_theme: 'monochrome',
  double_divine: 'monochrome',
};

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
  layout_colors: {} as Record<string, string>,
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
  transaction_names: {
    sale: 'Tax Invoice',
    purchase: 'Bill',
    payment_in: 'Payment Receipt',
    payment_out: 'Payment Out',
    expense: 'Expense',
    other_income: 'Other Income',
    sale_order: 'Sale Order',
    purchase_order: 'Purchase Order',
    estimate: 'Estimate',
    proforma_invoice: 'Proforma Invoice',
    delivery_challan: 'Delivery Challan',
    credit_note: 'Credit Note',
    debit_note: 'Debit Note',
    non_tax_bill: false,
  },
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
    show_seller_name: true,
    seller_name: '',
    show_seller_phone: true,
    seller_phone: '',
    show_seller_address: true,
    seller_address: '',
    show_date_time: true,
    show_bill_no: true,
    show_logo: true,
    show_tax_columns: false,
    show_payment_details: true,
    card_auth_code_override: '',
    card_last_four_override: '',
    barcode_or_qr: 'barcode',
    return_policy: 'Items can be returned within 7 days in original condition.',
    show_footer_thank_you: true,
    enable_refund_layout: true,
    enable_deposit_layout: false,
    deposit_account_details: '',
  },
};

type PrintSettings = typeof DEFAULT_PRINT_SETTINGS;

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

function invoiceSettingsDetailsBlock(invoice: any): string {
  const customFields = parseObject(invoice?.custom_fields);
  const sections = [
    {
      title: 'Additional Details',
      values: parseObject(customFields.transaction_settings),
      transportation: false,
    },
    {
      title: 'Transportation Details',
      values: parseObject(customFields.transportation_details),
      transportation: true,
    },
  ];

  const rendered = sections.flatMap(({ title, values, transportation }) => {
    const configuredFields = Array.isArray(values.__fields)
      ? values.__fields.filter((field: any) => field && typeof field === 'object')
      : [];
    const fields = configuredFields.length > 0
      ? configuredFields
      : Object.keys(values)
          .filter((key) => !key.startsWith('__'))
          .map((key) => ({
            key,
            label: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' '),
            showInPrint: true,
          }));
    const rows = fields
      .filter((field: any) => !transportation || field.showInPrint !== false)
      .map((field: any) => {
        const value = values[String(field.key || '')];
        if (value === undefined || value === null || String(value).trim() === '') return '';
        const displayValue = field.type === 'date' ? formatDocDate(value) : String(value);
        return `<div class="custom-detail-row"><span>${escapeHtml(String(field.label || field.key || 'Field'))}</span><b>${escapeHtml(displayValue)}</b></div>`;
      })
      .filter(Boolean);
    if (rows.length === 0) return [];
    return [`<div class="info-card custom-details"><h3>${title}</h3>${rows.join('')}</div>`];
  });

  return rendered.join('');
}

function resolvePrintSettings(company: any): PrintSettings {
  const raw = parseObject(company?.print_settings);
  const regularRaw = parseObject(raw.regular);
  const layout = normalizeInvoicePrintTheme(raw.invoiceTheme || raw.invoice_theme || regularRaw.layout || company?.invoice_pdf_template || company?.document_theme);
  return {
    regular: { ...DEFAULT_PRINT_SETTINGS.regular, ...regularRaw, layout },
    header: { ...DEFAULT_PRINT_SETTINGS.header, ...parseObject(raw.header) },
    item_table: {
      ...DEFAULT_PRINT_SETTINGS.item_table,
      ...parseObject(raw.item_table),
      columns: Array.isArray(raw?.item_table?.columns) && raw.item_table.columns.length
        ? raw.item_table.columns.map((col: unknown) => String(col)).filter(Boolean)
        : DEFAULT_PRINT_SETTINGS.item_table.columns,
    },
    layout_colors: parseObject(raw.layout_colors) as Record<string, string>,
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
      ...DEFAULT_PRINT_SETTINGS.thermal,
      ...parseObject(raw.thermal),
    },
  };
}

function printAwareCompany(company: any, settings: PrintSettings) {
  return {
    ...company,
    __hide_company_name: settings.header.company_name === false,
    name: settings.header.company_name ? company?.name : '',
    legal_name: settings.header.company_name ? company?.legal_name : '',
    gstin_legal_name: settings.header.company_name ? company?.gstin_legal_name : '',
    registered_address: settings.header.address ? company?.registered_address : '',
    gstin_address: settings.header.address ? company?.gstin_address : '',
    address: settings.header.address ? company?.address : '',
    city: settings.header.address ? company?.city : '',
    state: settings.header.address ? company?.state : '',
    pincode: settings.header.address ? company?.pincode : '',
    phone: settings.header.phone ? company?.phone : '',
    email: settings.header.email ? company?.email : '',
    gstin: settings.header.gstin ? company?.gstin : '',
  };
}

function printMoney(paise: number, currencyCode: string, settings: PrintSettings): string {
  const code = normalizeCurrencyCode(currencyCode);
  const symbol = currencySymbol(code);
  const locale = code === 'USD' ? 'en-US' : 'en-IN';
  const withDecimals = settings.totals.amount_with_decimal !== false;
  const amount = withDecimals ? Math.round(Number(paise || 0)) / 100 : Math.round(Number(paise || 0) / 100);
  return `${symbol}${amount.toLocaleString(locale, {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
    useGrouping: settings.totals.print_amount_with_grouping !== false,
  })}`;
}

const PRINT_COLUMN_LABELS: Record<string, string> = {
  serial_no: '#',
  item_name: 'Item name',
  item_code: 'Item Code',
  hsn_code: 'HSN/SAC',
  quantity: 'Quantity',
  unit: 'Unit',
  unit_price: 'Price/Unit',
  discount_amount: 'Discount',
  discount_percent: 'Disc. %',
  taxable_amount: 'Taxable',
  gst_rate: 'GST %',
  tax_amount: 'Tax Amount',
  amount: 'Amount',
  description: 'Description',
  batch_no: 'Batch No.',
  exp_date: 'Exp. Date',
  mfg_date: 'Mfg. Date',
  mrp: 'MRP',
  size: 'Size',
  model_no: 'Model No.',
  brand: 'Brand',
  material: 'Material',
};

const RIGHT_PRINT_COLUMNS = new Set(['quantity', 'unit_price', 'discount_amount', 'discount_percent', 'taxable_amount', 'gst_rate', 'tax_amount', 'amount', 'mrp']);

function itemTaxAmount(it: any): number {
  return Number(it.cgst_amount || 0) + Number(it.sgst_amount || 0) + Number(it.igst_amount || 0) + Number(it.cess_amount || 0);
}

function itemColumnValue(it: any, index: number, column: string, currencyCode: string, settings: PrintSettings): string {
  if (column === 'serial_no') return String(index + 1);
  if (column === 'item_name') {
    const name = escapeHtml(it.item_name || it.name || 'Item');
    const desc = multilineHtml(it.item_description || it.description || '');
    return `<div class="item-name">${name}</div>${desc && settings.item_table.columns.includes('description') === false ? `<div class="item-desc">${desc}</div>` : ''}`;
  }
  if (column === 'description') return multilineHtml(it.item_description || it.description || '');
  if (column === 'hsn_code') return escapeHtml(it.hsn_code || '');
  if (column === 'item_code') return escapeHtml(it.item_code || it.sku || '');
  if (column === 'quantity') return `<b>${fmtQty(it.quantity)}</b>`;
  if (column === 'unit') return escapeHtml(it.unit || 'PCS');
  if (column === 'unit_price') return printMoney(Number(it.unit_price || 0), it.currency_code || currencyCode, settings);
  if (column === 'discount_amount') return printMoney(Number(it.discount_amount || 0), it.currency_code || currencyCode, settings);
  if (column === 'discount_percent') return Number(it.discount_percent || it.discount_rate || 0) ? `${Number(it.discount_percent || it.discount_rate || 0).toFixed(2)}%` : '';
  if (column === 'taxable_amount') return printMoney(Number(it.taxable_amount || 0), it.currency_code || currencyCode, settings);
  if (column === 'gst_rate') return Number(it.gst_rate || 0) ? `${Number(it.gst_rate || 0).toFixed(2)}%` : '';
  if (column === 'tax_amount') return printMoney(itemTaxAmount(it), it.currency_code || currencyCode, settings);
  if (column === 'amount') return printMoney(Number(it.total_amount || 0), it.currency_code || currencyCode, settings);
  if (column === 'mrp') return it.mrp ? printMoney(Number(it.mrp || 0), it.currency_code || currencyCode, settings) : '';
  if (column === 'size') return escapeHtml(it.size || it.item_size || '');
  if (column === 'model_no') return escapeHtml(it.model_no || '');
  if (column === 'brand') return escapeHtml(it.brand || '');
  if (column === 'material') return escapeHtml(it.material || '');
  if (column === 'batch_no') return escapeHtml(it.batch_no || '');
  if (column === 'exp_date') return it.exp_date ? formatDocDate(it.exp_date) : '';
  if (column === 'mfg_date') return it.mfg_date ? formatDocDate(it.mfg_date) : '';
  return '';
}

function invoiceItemTable(items: any[], currencyCode: string, settings: PrintSettings, pricingMode?: string): string {
  const columns = settings.item_table.columns.length ? settings.item_table.columns : DEFAULT_PRINT_SETTINGS.item_table.columns;
  const headers = columns.map((col) => {
    let label = PRINT_COLUMN_LABELS[col] || col;
    if (col === 'unit_price') {
      if (pricingMode === 'inclusive') {
        label = 'Rate (Incl. GST)';
      } else if (pricingMode === 'exclusive') {
        label = 'Rate (Excl. GST)';
      }
    }
    return `<th class="${RIGHT_PRINT_COLUMNS.has(col) ? 'right' : ''}">${escapeHtml(label)}</th>`;
  }).join('');
  const rows = items.map((it, i) => `<tr>${columns.map((col) => `<td class="${col === 'serial_no' ? 'idx' : ''} ${RIGHT_PRINT_COLUMNS.has(col) ? 'right' : ''} ${col === 'amount' ? 'amount' : ''}">${itemColumnValue(it, i, col, currencyCode, settings)}</td>`).join('')}</tr>`).join('');
  const blankRows = Math.max(0, Number(settings.regular.min_item_rows || 0) - items.length);
  const blanks = Array.from({ length: blankRows }, () => `<tr class="blank-row">${columns.map(() => '<td>&nbsp;</td>').join('')}</tr>`).join('');
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const quantityFooter = settings.totals.total_item_quantity === false
    ? ''
    : `<tfoot><tr class="items-total">${columns.map((column, index) => {
        if (column === 'quantity') return `<td class="right"><b>${fmtQty(totalQuantity)}</b></td>`;
        if (column === 'item_name' || (index === 0 && !columns.includes('item_name'))) return '<td><b>Total quantity</b></td>';
        return '<td></td>';
      }).join('')}</tr></tfoot>`;
  return `<table class="items"><thead><tr>${headers}</tr></thead><tbody>${rows}${blanks}</tbody>${quantityFooter}</table>`;
}

function totalsRows(invoice: any, currencyCode: string, settings: PrintSettings): string {
  const rows: Array<[string, number, string?]> = [
    ['Sub Total', Number(invoice.subtotal || 0)],
    ['Discount', Number(invoice.discount_amount || 0)],
    ['Taxable Amount', Number(invoice.taxable_amount || 0)],
  ];
  if (settings.totals.tax_details !== false && Number(invoice.cgst_amount || 0)) rows.push(['CGST', Number(invoice.cgst_amount || 0)]);
  if (settings.totals.tax_details !== false && Number(invoice.sgst_amount || 0)) rows.push(['SGST', Number(invoice.sgst_amount || 0)]);
  if (settings.totals.tax_details !== false && Number(invoice.igst_amount || 0)) rows.push(['IGST', Number(invoice.igst_amount || 0)]);
  if (Number(invoice.round_off || 0)) rows.push(['Round Off', Number(invoice.round_off || 0)]);
  return rows
    .filter(([, amount], idx) => idx < 3 || amount !== 0)
    .map(([label, amount]) => `<div class="total-row"><span>${escapeHtml(label)}</span><b>${printMoney(amount, currencyCode, settings)}</b></div>`)
    .join('');
}

function formatReferenceDate(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' });
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yr}`;
}

function referenceInvoiceCustomDefs(company: any): Array<{ id: string; label: string }> {
  const sales = Array.isArray(company?.sales_invoice_custom_fields) ? company.sales_invoice_custom_fields : [];
  const item = Array.isArray(company?.item_custom_fields) ? company.item_custom_fields : [];
  const seen = new Set<string>();
  return [...sales, ...item]
    .map((field: any) => ({
      id: String(field?.id || field?.key || '').trim(),
      label: String(field?.label || field?.id || field?.key || '').trim(),
      enabled: field?.enabled !== false,
      show: field?.show_in_print !== false,
    }))
    .filter((field) => {
      if (!field.id || !field.label || !field.enabled || !field.show || seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });
}

function referenceItemDescription(it: any, company: any, settings: PrintSettings): string {
  const description = multilineHtml(it.item_description || it.description || '');
  const custom = parseObject(it.custom_fields);
  const customLines = settings.reference_invoice.show_item_custom_fields === false
    ? ''
    : referenceInvoiceCustomDefs(company)
        .map((field) => {
          const value = String(custom[field.id] ?? '').trim();
          return value ? `<div class="ref-custom-line"><span>${escapeHtml(field.label)}:</span> ${escapeHtml(value)}</div>` : '';
        })
        .join('');
  return `<b>${escapeHtml(it.item_name || it.name || 'Item')}</b>${description ? `<div class="ref-desc">${description}</div>` : ''}${customLines}`;
}

function referenceMoney(paise: unknown): string {
  return fmtPaise(Number(paise || 0));
}

function referenceWordsFromPaise(paise: unknown): string {
  const rupees = Math.round(Number(paise || 0) / 100);
  return amountToWordsINR(rupees)
    .replace(/^Rupees\s+/i, '')
    .replace(/\s+Only$/i, ' Only')
    .trim();
}

function referenceFieldEnabled(settings: PrintSettings, key: string): boolean {
  return parseObject(settings.reference_invoice?.fields)[key] !== false;
}

function referenceFieldValue(settings: PrintSettings, values: Record<string, any>, key: string, fallback: unknown = ''): string {
  if (!referenceFieldEnabled(settings, key)) return '';
  return String(values[key] ?? fallback ?? '').trim();
}

function referenceTaxSummary(items: any[], invoice: any): string {
  const grouped = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number; cess: number; cgstRate: number; sgstRate: number; igstRate: number }>();
  for (const it of items) {
    const hsn = String(it.hsn_code || '').trim() || '—';
    const existing = grouped.get(hsn) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, cgstRate: 0, sgstRate: 0, igstRate: 0 };
    existing.taxable += Number(it.taxable_amount || 0);
    existing.cgst += Number(it.cgst_amount || 0);
    existing.sgst += Number(it.sgst_amount || 0);
    existing.igst += Number(it.igst_amount || 0);
    existing.cess += Number(it.cess_amount || 0);
    existing.cgstRate = Number(it.cgst_rate || existing.cgstRate || 0);
    existing.sgstRate = Number(it.sgst_rate || existing.sgstRate || 0);
    existing.igstRate = Number(it.igst_rate || existing.igstRate || 0);
    grouped.set(hsn, existing);
  }
  const rows = Array.from(grouped.entries());
  const body = rows.map(([hsn, row]) => {
    const totalTax = row.cgst + row.sgst + row.igst + row.cess;
    return `<tr>
      <td>${escapeHtml(hsn)}</td>
      <td class="num">${referenceMoney(row.taxable)}</td>
      <td class="num">${row.igst ? '' : `${row.cgstRate.toFixed(2)}%`}</td>
      <td class="num">${referenceMoney(row.cgst)}</td>
      <td class="num">${row.igst ? `${row.igstRate.toFixed(2)}%` : `${row.sgstRate.toFixed(2)}%`}</td>
      <td class="num">${referenceMoney(row.sgst + row.igst)}</td>
      <td class="num">${referenceMoney(totalTax)}</td>
    </tr>`;
  }).join('');
  const totalTaxable = rows.reduce((sum, [, row]) => sum + row.taxable, 0) || Number(invoice.taxable_amount || 0);
  const totalCgst = rows.reduce((sum, [, row]) => sum + row.cgst, 0) || Number(invoice.cgst_amount || 0);
  const totalSgstIgst = rows.reduce((sum, [, row]) => sum + row.sgst + row.igst, 0) || Number(invoice.sgst_amount || 0) + Number(invoice.igst_amount || 0);
  const totalTax = totalCgst + totalSgstIgst + rows.reduce((sum, [, row]) => sum + row.cess, 0);
  return `<table class="ref-tax-summary">
    <thead>
      <tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br/>Value</th><th colspan="2">CGST</th><th colspan="2">SGST/UTGST</th><th>Total<br/>Tax Amount</th></tr>
      <tr><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th><th></th></tr>
    </thead>
    <tbody>${body}
      <tr class="ref-total-row"><td>Total</td><td class="num">${referenceMoney(totalTaxable)}</td><td></td><td class="num">${referenceMoney(totalCgst)}</td><td></td><td class="num">${referenceMoney(totalSgstIgst)}</td><td class="num">${referenceMoney(totalTax)}</td></tr>
    </tbody>
  </table>`;
}

function buildReferenceTaxInvoiceHtml(args: {
  invoice: any;
  company: any;
  party: any | null;
  items: any[];
  printSettings: PrintSettings;
}) {
  const { invoice, company, party, items, printSettings } = args;
  const refValues = parseObject(parseObject(invoice.custom_fields).reference_invoice);
  const ewayDetails = { ...parseObject(invoice.eway_bill_details), ...parseObject(refValues.eway_details) };
  const ewayNo = referenceFieldValue(printSettings, refValues, 'eway_bill_no', invoice.eway_bill_no || ewayDetails.ewb_no);
  const sellerName = companyLegalDisplayName(company);
  const sellerGstin = String(company.gstin || '').trim();
  const sellerStateCode = stateCodeFromGstin(sellerGstin) || String(company.state_code || '').slice(0, 2);
  const sellerStateName = GST_STATE_NAMES[sellerStateCode] || company.state || '';
  const buyerName = invoice.party_name_snapshot || party?.name || 'Customer';
  const buyerGstin = invoice.party_gstin_snapshot || party?.gstin || '';
  const buyerStateCode = stateCodeFromGstin(buyerGstin) || String(invoice.place_of_supply || party?.billing_state_code || party?.state_code || '').slice(0, 2);
  const buyerStateName = GST_STATE_NAMES[buyerStateCode] || party?.billing_state || party?.state || '';
  const billingAddress = invoice.billing_address_snapshot || buyerAddress(party) || '';
  const shippingAddress = invoice.shipping_address_snapshot || party?.shipping_address || billingAddress;
  const amountWords = referenceWordsFromPaise(invoice.total_amount);
  const taxWords = referenceWordsFromPaise(Number(invoice.cgst_amount || 0) + Number(invoice.sgst_amount || 0) + Number(invoice.igst_amount || 0) + Number(invoice.cess_amount || 0));
  const currency = currencySymbol(invoice.currency_code || 'INR');
  const totalQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  const firstUnit = items.find((it) => it.unit)?.unit || '';
  const refItemHeight = Math.max(18, Math.min(70, 70 / Math.max(items.length, 1)));
  const itemRows = items.map((it, index) => {
    const taxLabelBlock = index === 0
      ? `<div class="ref-tax-lines"><b>CGST</b><b>SGST</b>${Number(invoice.round_off || 0) ? '<b>Round Off</b>' : ''}</div>`
      : '';
    const taxAmountBlock = index === 0
      ? `<div class="ref-tax-amounts"><b>${referenceMoney(invoice.cgst_amount)}</b><b>${referenceMoney(invoice.sgst_amount || invoice.igst_amount)}</b>${Number(invoice.round_off || 0) ? `<b>${referenceMoney(invoice.round_off)}</b>` : ''}</div>`
      : '';
    return `<tr class="ref-item-row" style="height:${refItemHeight}mm">
      <td class="center">${index + 1}</td>
      <td>${referenceItemDescription(it, company, printSettings)}${taxLabelBlock}</td>
      <td class="center">${escapeHtml(it.hsn_code || '')}</td>
      <td class="num"><b>${fmtQty(it.quantity)} ${escapeHtml(it.unit || '')}</b></td>
      <td class="num">${referenceMoney(it.unit_price)}</td>
      <td class="center">${escapeHtml(it.unit || '')}</td>
      <td class="num"><b>${referenceMoney(it.taxable_amount || it.total_amount)}</b>${taxAmountBlock}</td>
    </tr>`;
  }).join('');
  const declaration = String(refValues.declaration || printSettings.reference_invoice.declaration || '').trim();
  const terms = String(refValues.terms || printSettings.reference_invoice.terms || invoice.terms_and_conditions || company.terms_and_conditions || '').trim();
  const ewayAppendix = printSettings.reference_invoice.include_eway_appendix !== false && ewayNo
    ? `<main class="ref-eway-page">
        <h2>e-Way Bill</h2>
        <div class="ref-eway-head">
          <div><p><span>Doc No.</span> : <b>Tax Invoice - ${escapeHtml(invoice.invoice_number || '')}</b></p><p><span>Date</span> : <b>${formatReferenceDate(invoice.invoice_date)}</b></p></div>
          <div class="ref-eway-qr"><b>e-Way Bill</b>${invoice.__eway_qr_src ? `<img src="${invoice.__eway_qr_src}" />` : ''}</div>
        </div>
        <div class="ref-eway-rule"></div>
        <section class="ref-eway-section">
          <h3>1. e-Way Bill Details</h3>
          <div class="ref-eway-detail-grid">
            <p><span>e-Way Bill No.</span> : <b>${escapeHtml(ewayNo)}</b></p>
            <p><span>Mode</span> : <b>${escapeHtml(String(ewayDetails.mode || ewayDetails.transport_mode || refValues.transport_mode || ''))}</b></p>
            <p><span>Generated Date</span> : <b>${escapeHtml(formatReferenceDate(ewayDetails.generated_date || invoice.eway_bill_date))}</b></p>
            <p><span>Generated By</span> : <b>${escapeHtml(String(ewayDetails.generated_by || sellerGstin))}</b></p>
            <p><span>Approx Distance</span> : <b>${escapeHtml(String(ewayDetails.distance_km || ewayDetails.distance || refValues.distance_km || ''))}${ewayDetails.distance_km || refValues.distance_km ? ' KM' : ''}</b></p>
            <p><span>Valid Upto</span> : <b>${escapeHtml(formatReferenceDate(ewayDetails.valid_upto || invoice.eway_bill_valid_upto))}</b></p>
            <p><span>Supply Type</span> : <b>${escapeHtml(String(ewayDetails.supply_type || 'Outward-Supply'))}</b></p>
            <p><span>Transaction Type</span> : <b>${escapeHtml(String(ewayDetails.transaction_type || 'Regular'))}</b></p>
          </div>
        </section>
        <div class="ref-eway-rule"></div>
        <section class="ref-eway-section">
          <h3>2. Address Details</h3>
          <div class="ref-eway-address-grid">
            <div><b>From</b><br/>${escapeHtml(sellerName)}<br/>${addressHtml(companyAddress(company))}</div>
            <div><b>To</b><br/>${escapeHtml(buyerName)}<br/>${addressHtml(shippingAddress || billingAddress)}</div>
          </div>
        </section>
      </main>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:8.35px;line-height:1.04}.ref-page{width:100%;min-height:281mm;padding:15mm 15mm 5mm}.ref-title{text-align:center;font-size:12px;font-weight:700;margin:0 0 -1px}.ref-grid,.ref-grid td,.ref-grid th,.ref-tax-summary,.ref-tax-summary td,.ref-tax-summary th{border:.75px solid #000;border-collapse:collapse}.ref-grid{width:100%;table-layout:fixed}.ref-grid td,.ref-grid th{padding:2px 4px;vertical-align:top}.ref-top-grid{height:88mm}.ref-firm{font-size:10.25px;font-weight:700;letter-spacing:.01em}.ref-left-block{padding:2px 4px;overflow:hidden}.ref-seller{height:21mm}.ref-consignee{height:31mm;border-top:.75px solid #000}.ref-buyer{height:36mm;border-top:.75px solid #000}.ref-party-title{font-size:8.4px;margin:0 0 2px}.ref-party-name{font-weight:700;font-size:9.3px}.ref-meta{width:100%;height:88mm;border-collapse:collapse;table-layout:fixed}.ref-meta td{border:.75px solid #000;padding:2px 4px;height:8mm;overflow:hidden}.ref-meta tr:first-child td{height:9mm}.ref-meta tr:nth-child(9) td{height:23mm}.ref-label{display:block;color:#000;font-size:8px}.ref-value{font-weight:700}.ref-items{width:100%;border-collapse:collapse;border-left:.75px solid #000;border-right:.75px solid #000;table-layout:fixed}.ref-items th,.ref-items td{border:.75px solid #000;padding:3px 4px;vertical-align:top}.ref-items th{text-align:center;font-weight:400;height:8mm}.center{text-align:center}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.ref-desc,.ref-custom-line{font-size:7.9px;margin-top:1px}.ref-custom-line span{font-weight:700}.ref-tax-lines{margin-top:23mm;text-align:right;padding-right:10px;display:grid;gap:3px;font-style:italic;font-size:9px}.ref-tax-amounts{margin-top:23mm;display:grid;gap:3px}.ref-total-line td{height:6mm}.ref-total-row{font-weight:700}.ref-total-row td{font-weight:700}.ref-words{border-left:.75px solid #000;border-right:.75px solid #000;border-bottom:.75px solid #000;padding:2px 4px;min-height:6mm}.ref-tax-summary{width:100%;text-align:center;table-layout:fixed}.ref-tax-summary th,.ref-tax-summary td{padding:1.5px 4px;height:4.5mm}.ref-bottom{display:grid;grid-template-columns:1fr 1fr;border-left:.75px solid #000;border-right:.75px solid #000;border-bottom:.75px solid #000}.ref-bottom>div{min-height:19mm;padding:2px 4px}.ref-sign{border-left:.75px solid #000;text-align:right;display:flex;flex-direction:column;justify-content:space-between;padding-top:5px!important}.ref-computer{text-align:center;margin-top:4px;font-size:8.4px}.ref-eway-page{page-break-before:always;padding:25mm 12mm 8mm;font-size:9.5px;line-height:1.16}.ref-eway-page h2{text-align:center;text-decoration:underline;font-size:13px;margin:0 0 26px}.ref-eway-head{display:grid;grid-template-columns:1fr 170px;align-items:start;margin:0 0 18px;min-height:42mm}.ref-eway-head span{display:inline-block;width:58px}.ref-eway-qr{text-align:center;font-size:9px}.ref-eway-qr img{display:block;width:130px;height:130px;margin:9px auto}.ref-eway-rule{border-top:.75px solid #000;margin:8px 0}.ref-eway-section h3{font-size:9.5px;margin:0 0 8px}.ref-eway-detail-grid{display:grid;grid-template-columns:1fr 1fr 1.15fr;column-gap:18px;row-gap:4px}.ref-eway-detail-grid p{margin:0}.ref-eway-detail-grid span{display:inline-block;width:72px}.ref-eway-address-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;min-height:34mm}
    ${printSettings.regular.print_original_duplicate ? 'body::before{content:"ORIGINAL FOR RECIPIENT";position:fixed;right:15mm;top:5mm;border:.75px solid #000;padding:2px 5px;font-size:7px;font-weight:700;z-index:10;background:#fff}' : ''}
  </style></head><body>
    <main class="ref-page">
      <h1 class="ref-title">Tax Invoice</h1>
      <table class="ref-grid ref-top-grid"><tr>
        <td style="width:50%;padding:0">
          <div class="ref-left-block ref-seller"><div class="ref-firm">${escapeHtml(sellerName)}</div>${addressHtml(companyAddress(company))}<br/>GSTIN/UIN: ${escapeHtml(sellerGstin)}<br/>State Name : ${escapeHtml(sellerStateName)}, Code : ${escapeHtml(sellerStateCode)}</div>
          <div class="ref-left-block ref-consignee"><div class="ref-party-title">Consignee (Ship to)</div><div class="ref-party-name">${escapeHtml(buyerName)}</div>${addressHtml(shippingAddress)}<br/>GSTIN/UIN : ${escapeHtml(buyerGstin)}<br/>State Name : ${escapeHtml(buyerStateName)}, Code : ${escapeHtml(buyerStateCode)}</div>
          <div class="ref-left-block ref-buyer"><div class="ref-party-title">Buyer (Bill to)</div><div class="ref-party-name">${escapeHtml(buyerName)}</div>${addressHtml(billingAddress)}<br/>GSTIN/UIN : ${escapeHtml(buyerGstin)}<br/>State Name : ${escapeHtml(buyerStateName)}, Code : ${escapeHtml(buyerStateCode)}<br/>Place of Supply : ${escapeHtml(buyerStateName || String(invoice.place_of_supply || ''))}</div>
        </td>
        <td style="width:50%;padding:0">
          <table class="ref-meta">
            <tr><td><span class="ref-label">Invoice No.</span><span class="ref-value">${escapeHtml(invoice.invoice_number || '')}</span></td><td><span class="ref-label">e-Way Bill No.</span><span class="ref-value">${escapeHtml(ewayNo)}</span></td><td><span class="ref-label">Dated</span><span class="ref-value">${formatReferenceDate(invoice.invoice_date)}</span></td></tr>
            <tr><td><span class="ref-label">Delivery Note</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'delivery_note'))}</td><td colspan="2"><span class="ref-label">Mode/Terms of Payment</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'mode_terms_payment'))}</td></tr>
            <tr><td colspan="2"><span class="ref-label">Reference No. & Date.</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'reference_no_date'))}</td><td><span class="ref-label">Other References</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'other_references'))}</td></tr>
            <tr><td colspan="2"><span class="ref-label">Buyer's Order No.</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'buyer_order_no'))}</td><td><span class="ref-label">Dated</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'buyer_order_date'))}</td></tr>
            <tr><td colspan="2"><span class="ref-label">Dispatch Doc No.</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'dispatch_doc_no'))}</td><td><span class="ref-label">Delivery Note Date</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'delivery_note_date'))}</td></tr>
            <tr><td colspan="2"><span class="ref-label">Dispatched through</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'dispatched_through'))}</td><td><span class="ref-label">Destination</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'destination'))}</td></tr>
            <tr><td colspan="2"><span class="ref-label">Vessel/Flight No.</span><span class="ref-value">${escapeHtml(referenceFieldValue(printSettings, refValues, 'vessel_flight_no'))}</span></td><td><span class="ref-label">Place of receipt by shipper:</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'receipt_by_shipper'))}</td></tr>
            <tr><td colspan="2"><span class="ref-label">City/Port of Loading</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'port_loading'))}</td><td><span class="ref-label">City/Port of Discharge</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'port_discharge'))}</td></tr>
            <tr><td colspan="3" style="height:35mm"><span class="ref-label">Terms of Delivery</span>${escapeHtml(referenceFieldValue(printSettings, refValues, 'terms_delivery'))}</td></tr>
          </table>
        </td>
      </tr></table>
      <table class="ref-items"><thead><tr><th style="width:5mm">Sl<br/>No</th><th>Description of Goods</th><th style="width:20mm">HSN/SAC</th><th style="width:24mm">Quantity</th><th style="width:20mm">Rate</th><th style="width:9mm">per</th><th style="width:30mm">Amount</th></tr></thead><tbody>${itemRows}<tr class="ref-total-line"><td></td><td class="num">Total</td><td></td><td class="num"><b>${fmtQty(totalQty)} ${escapeHtml(firstUnit)}</b></td><td></td><td></td><td class="num"><b>${currency} ${referenceMoney(invoice.total_amount)}</b></td></tr></tbody></table>
      <div class="ref-words"><span>Amount Chargeable (in words)</span><span style="float:right"><i>E. & O.E</i></span><br/><b>INR ${escapeHtml(amountWords)}</b></div>
      ${referenceTaxSummary(items, invoice)}
      <div class="ref-words">Tax Amount (in words) : <b>INR ${escapeHtml(taxWords)}</b></div>
      <div class="ref-bottom"><div><b>Declaration</b><br/>${multilineHtml(declaration)}<br/><b>Terms & Condition :</b><br/>${multilineHtml(terms)}</div><div class="ref-sign"><b>for ${escapeHtml(sellerName)}</b><span>Authorised Signatory</span></div></div>
      <div class="ref-computer">This is a Computer Generated Invoice</div>
    </main>
    ${ewayAppendix}
  </body></html>`;
}

function buildInvoiceHtml(args: {
  invoice: any;
  company: any;
  party: any | null;
  items: any[];
  kind: string;
  theme: string;
  printSettings: PrintSettings;
  logoSrc: string;
  signatureSrc: string;
  upiQr: string;
  einvBlock: string;
  isThermal?: boolean;
  thermalWidth?: string;
}) {
  const { invoice, party, items, kind, theme, printSettings, signatureSrc, upiQr, einvBlock, isThermal, thermalWidth } = args;
  const company = printAwareCompany(args.company, printSettings);
  const logoSrc = printSettings.header.company_logo === false ? '' : args.logoSrc;
  const currencyCode = normalizeCurrencyCode(invoice.currency_code || company.default_currency || company.currency || 'INR');
  const configuredLayout = String(printSettings.regular.layout || '');
  const layoutColor = printSettings.layout_colors?.[configuredLayout];
  const palette = themePalette(theme, String(layoutColor || company.document_primary_color || ''));
  const isPurchase = Boolean(invoice.bill_number || invoice.purchase_invoice_id);
  const title = kind === 'performa'
    ? String(printSettings.transaction_names.proforma_invoice || 'PROFORMA INVOICE')
    : isPurchase
      ? String(printSettings.transaction_names.purchase || 'PURCHASE BILL')
      : String(printSettings.transaction_names.non_tax_bill ? 'Bill of Supply' : printSettings.transaction_names.sale || 'Tax Invoice');
  const legalCompanyName = companyLegalDisplayName(company);
  const sellerName = isPurchase ? (party?.name || invoice.party_name_snapshot || 'Supplier') : legalCompanyName;
  const buyerName = isPurchase ? legalCompanyName : (party?.name || invoice.party_name_snapshot || 'Walk-in Customer');
  const sellerGstin = isPurchase ? (party?.gstin || invoice.party_gstin_snapshot || '') : (company.gstin || '');
  const buyerGstin = isPurchase ? (company.gstin || '') : (party?.gstin || invoice.party_gstin_snapshot || '');
  const sellerStateCode = stateCodeFromGstin(sellerGstin) || String(company.state_code || '').slice(0, 2);
  const buyerStateCode = stateCodeFromGstin(buyerGstin) || String(party?.billing_state_code || invoice.place_of_supply || '').slice(0, 2);
  const hasExplicitPlaceOfSupply = Boolean(String(invoice.place_of_supply || '').trim());
  const hasExplicitShipTo = Boolean(String(invoice.shipping_address_snapshot || '').trim());
  const supplyStateCode = String(invoice.place_of_supply || buyerStateCode || sellerStateCode || '—').slice(0, 5);
  const primaryPartyPan = String(isPurchase ? (party?.pan || invoice.party_pan || '') : (party?.pan || invoice.party_pan || '')).trim().toUpperCase();
  const primaryPartyPhone = invoice.party_phone_snapshot || invoice.party_phone || party?.phone || '';
  const primaryPartyEmail = invoice.party_email_snapshot || invoice.party_email || party?.email || '';
  const sellerAddr = isPurchase ? (party ? buyerAddress(party) : invoice.billing_address_snapshot || '') : companyAddress(company);
  const buyerAddr = isPurchase ? companyAddress(company) : (party ? buyerAddress(party) : invoice.billing_address_snapshot || '');
  const shipAddr = invoice.shipping_address_snapshot || party?.shipping_address || buyerAddr;
  const primaryPartyName = isPurchase ? sellerName : buyerName;
  const primaryPartyGstin = isPurchase ? sellerGstin : buyerGstin;
  const primaryPartyAddr = isPurchase ? sellerAddr : buyerAddr;
  const sellerBlock = isPurchase
    ? partyContactBlock({
      title: '',
      name: sellerName,
      address: sellerAddr,
      phone: primaryPartyPhone,
      email: primaryPartyEmail,
      gstin: sellerGstin,
      pan: primaryPartyPan,
      state: partyStateLabel(party, sellerGstin, sellerStateCode),
    })
    : companyContactBlock(company);
  const primaryPartyBlock = partyContactBlock({
    title: isPurchase ? 'Bill From' : 'Bill To',
    name: primaryPartyName,
    address: primaryPartyAddr,
    phone: primaryPartyPhone,
    email: primaryPartyEmail,
    gstin: primaryPartyGstin || (isPurchase ? '' : 'URP'),
    pan: primaryPartyPan,
    state: isPurchase ? partyStateLabel(party, sellerGstin, sellerStateCode) : partyStateLabel(party, buyerGstin, buyerStateCode),
  });
  const shipToBlock = isPurchase
    ? companyContactBlock(company, { title: 'Bill To' })
    : partyContactBlock({
      title: hasExplicitPlaceOfSupply ? 'Ship To / Place of Supply' : 'Ship To',
      name: invoice.ship_to_name || invoice.party_name_snapshot || party?.name || 'Customer',
      address: shipAddr,
      phone: primaryPartyPhone,
      email: primaryPartyEmail,
      gstin: buyerGstin || 'URP',
      pan: primaryPartyPan,
      state: stateLabel(supplyStateCode || buyerStateCode, party?.shipping_state || party?.billing_state || party?.state),
    });
  const shouldShowShipToBlock = isPurchase || hasExplicitShipTo || hasExplicitPlaceOfSupply;
  const amountWords = currencyCode === 'INR'
    ? escapeHtml(amountToWordsINR(Math.round(Number(invoice.total_amount || 0) / 100)))
    : escapeHtml(`${fmtMoney(Number(invoice.total_amount || 0), currencyCode)} only`);
  const balanceDue = Number(invoice.balance_due ?? Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0)));
  const terms = String(invoice.terms_and_conditions || company.terms_and_conditions || 'Thank you for your business.').trim();
  const notes = String(invoice.notes || company.invoice_notes || 'Thanks for your business.').trim();
  const logo = printSettings.header.company_logo === false
    ? ''
    : logoSrc
      ? `<img src="${logoSrc}" alt="${escapeHtml(legalCompanyName || 'Logo')}"/>`
      : `<div class="logo-fallback">${escapeHtml((legalCompanyName || 'M').slice(0, 1))}</div>`;
  const signature = signatureSrc
    ? `<img src="${signatureSrc}" alt="Signature" />`
    : '<div class="signature-line"></div>';
  const qrBlock = upiQr ? `<div class="qr-card"><img src="${upiQr}" alt="UPI QR"/><span>Scan to pay</span></div>` : '';
  const invoiceMeta = `
    <div class="meta-grid">
      <div><span>Invoice#</span><b>${escapeHtml(invoice.invoice_number || invoice.bill_number || '—')}</b></div>
      <div><span>Invoice Date</span><b>${formatDocDate(invoice.invoice_date || invoice.bill_date)}</b></div>
      <div><span>Due Date</span><b>${formatDocDate(invoice.due_date)}</b></div>
      <div><span>Supply State Code</span><b>${escapeHtml(supplyStateCode)}</b></div>
    </div>`;
  const gstSummary = `
    <div class="tax-summary">
      <div>${fieldLine('Seller GSTIN', sellerGstin, 'mono-line')}</div>
      <div>${fieldLine('Buyer GSTIN', buyerGstin, 'mono-line')}</div>
      <div>${fieldLine('Seller State Code', sellerStateCode || '—', 'mono-line')}</div>
      <div>${fieldLine('Buyer State Code', buyerStateCode || '—', 'mono-line')}</div>
      <div>${fieldLine('Company Phone', company.phone)}</div>
      <div>${fieldLine('Company Email', company.email)}</div>
    </div>`;
  const shipToSection = shouldShowShipToBlock
    ? `<section class="bill-grid" style="margin-top:0"><div class="bill-card">${shipToBlock}</div><div>${gstSummary}</div></section>`
    : `<section style="margin-top:0">${gstSummary}</section>`;
  const bank = `<div class="info-card bank-card"><h3>Bank Details</h3>${bankBlock(company)}</div>`;
  const visibleSignBlock = printSettings.footer.signature_enabled === false
    ? ''
    : `<div class="signature-card"><p>For <b>${escapeHtml(legalCompanyName)}</b></p>${signature}<p>${escapeHtml(printSettings.footer.signature_text || 'Authorized Signatory')}</p></div>`;
  const itemTable = invoiceItemTable(items, currencyCode, printSettings, invoice.pricing_mode);
  const paidAmount = Number(invoice.paid_amount || 0);
  const partyBalance = Number(party?.balance || 0);
  const currentBalanceRow = printSettings.totals.current_balance_of_party
    ? `<div class="total-row"><span>Current Party Balance</span><b>${printMoney(partyBalance, currencyCode, printSettings)}</b></div>`
    : '';
  const youSavedRow = printSettings.totals.you_saved === false || Number(invoice.discount_amount || 0) === 0
    ? ''
    : `<div class="total-row"><span>You Saved</span><b>${printMoney(Number(invoice.discount_amount || 0), currencyCode, printSettings)}</b></div>`;
  const totals = `<div class="totals">${totalsRows(invoice, currencyCode, printSettings)}<div class="grand total-row"><span>Total</span><b>${printMoney(Number(invoice.total_amount || 0), currencyCode, printSettings)}</b></div>${printSettings.totals.received_amount === false ? '' : `<div class="total-row"><span>Received</span><b>${printMoney(paidAmount, currencyCode, printSettings)}</b></div>`}${currentBalanceRow}${youSavedRow}${printSettings.totals.balance_amount === false ? '' : `<div class="due total-row"><span>Balance Due</span><b>${printMoney(balanceDue, currencyCode, printSettings)}</b></div>`}</div>`;
  const notesBlock = printSettings.footer.print_description === false ? '' : `<div class="note-block"><h3>Notes</h3>${escapeHtml(notes)}</div>`;
  const termsBlock = printSettings.footer.print_terms === false ? '' : `<div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div>`;
  const settingsDetailsBlock = invoiceSettingsDetailsBlock(invoice);
  const receivedByBlock = printSettings.footer.print_received_by === false ? '' : `<div class="info-card"><h3>Received By</h3><div>Name:</div><div>Comment:</div><div>Date:</div></div>`;
  const deliveredByBlock = printSettings.footer.print_delivered_by === false ? '' : `<div class="info-card"><h3>Delivered By</h3><div>Name:</div><div>Comment:</div><div>Date:</div></div>`;
  const paymentModeBlock = printSettings.footer.payment_mode ? `<div class="info-card"><h3>Payment Mode</h3>${escapeHtml(invoice.payment_mode || invoice.payment_type || '—')}</div>` : '';
  const acknowledgementBlock = printSettings.footer.acknowledgement ? '<div class="info-card"><h3>Acknowledgement</h3><div>Goods/services received in good condition.</div><div class="signature-line"></div><div>Receiver signature</div></div>' : '';
  const extraBottomLines = Math.max(0, Math.min(20, Number(printSettings.regular.extra_bottom_lines || 0)));
  const extraBottomBlock = extraBottomLines ? `<div class="extra-bottom-lines">${Array.from({ length: extraBottomLines }, () => '<div></div>').join('')}</div>` : '';
  const topSpace = Math.max(0, Math.min(80, Number(printSettings.regular.extra_top_space || 0)));
  const companyNameSize = printSettings.regular.company_name_text_size === 'small' ? '13px' : printSettings.regular.company_name_text_size === 'medium' ? '16px' : '19px';
  const invoiceTitleSize = printSettings.regular.invoice_text_size === 'small' ? '24px' : printSettings.regular.invoice_text_size === 'large' ? '42px' : '32px';

  const baseCss = `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    ${isThermal ? `@page{size:${thermalWidth || '80mm'} auto;margin:0}\n    html,body{width:${thermalWidth || '80mm'};min-width:${thermalWidth || '80mm'}}\n    .page{padding:5px!important}` : `@page{size:${['A1','A2','A3','A4','A5','Letter','Legal'].includes(printSettings.regular.paper_size as string) ? printSettings.regular.paper_size : 'A4'};margin:8mm}`}
    *{box-sizing:border-box}
    body{margin:0;color:${palette.ink};font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.34;background:#fff}${printSettings.regular.print_original_duplicate ? '\n    body::before{content:"ORIGINAL FOR RECIPIENT";position:fixed;right:9mm;top:3mm;border:1px solid #52525b;padding:2px 6px;font-size:8px;font-weight:800;letter-spacing:.05em;z-index:10;background:#fff}' : ''}
    .page{padding:${8 + topSpace}px 14px 8px;position:relative}
    .muted,.item-desc,.item-meta{color:#71717a}.mono,.mono-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .logo img{max-width:150px;max-height:88px;object-fit:contain;display:block}.logo-fallback{width:68px;height:68px;border-radius:50%;background:${palette.primary};color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:900}
    .doc-title{font-size:${invoiceTitleSize};letter-spacing:.08em;font-weight:300;color:${palette.primary};margin:0}.doc-subtitle{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}
    .company-name,.party-name,.business-name{font-size:15px;font-weight:800;color:${palette.accent}}.business-block:first-child .business-name{font-size:${companyNameSize}}.address,.business-address{color:#52525b}.gst{font-size:10px;margin-top:3px}
    .business-block{line-height:1.45}.business-lines{font-size:10px;margin-top:4px;color:#374151}.business-lines .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.block-title{font-size:11px;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em;color:${palette.primary};font-weight:800}
    .bill-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.bill-card h3,.info-card h3{font-size:11px;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em;color:${palette.primary}}
    .bill-card{border:1px solid #e5e7eb;padding:10px;min-height:88px}.meta-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e5e7eb}.meta-grid div{padding:7px 9px;border-bottom:1px solid #e5e7eb}.meta-grid div:nth-child(odd){border-right:1px solid #e5e7eb}.meta-grid div:nth-last-child(-n+2){border-bottom:0}.meta-grid span{display:block;color:#71717a;font-size:10px}.meta-grid b{display:block;margin-top:1px}
    table.items{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}table.items thead{display:${printSettings.regular.repeat_header === false ? 'table-row-group' : 'table-header-group'}}table.items th{background:${palette.primary};color:#fff;padding:8px 9px;text-align:left;font-weight:650}table.items td{padding:9px 9px;border-bottom:1px solid #e5e7eb;vertical-align:top}table.items tr:nth-child(even) td{background:#fafafa}table.items tfoot td{border-top:1px solid #d4d4d8;background:#fff!important}.right{text-align:right}.idx{width:34px}.mono{white-space:nowrap}.item-name{font-weight:700;font-size:12px}.item-desc{white-space:pre-line;margin-top:2px}.item-meta{font-size:9.5px;margin-top:2px}.amount{font-weight:800}
    .lower{display:grid;grid-template-columns:1fr 330px;gap:18px;margin-top:10px}.totals{background:${palette.soft};padding:9px 12px}.total-row{display:flex;justify-content:space-between;gap:14px;padding:4px 0}.grand{font-size:14px;border-top:2px solid #d4d4d8;margin-top:3px;padding-top:8px}.due{margin:8px -12px -9px;padding:9px 12px;background:${palette.primary};color:#fff;font-size:14px;font-weight:900}
    .info-card{border:1px solid #e5e7eb;padding:10px;margin-bottom:8px}.bank-card{line-height:1.55}.tax-summary{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:10px;margin-top:6px;color:#52525b}.tax-summary span{color:#71717a}
    .custom-details{break-inside:avoid}.custom-detail-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px solid #f1f5f9}.custom-detail-row:last-child{border-bottom:0}.custom-detail-row span{color:#71717a}.custom-detail-row b{text-align:right;white-space:pre-wrap;overflow-wrap:anywhere}
    .note-block{margin-top:10px;color:#52525b}.note-block h3{font-size:13px;color:#111827;margin:0 0 3px}.signature-card{text-align:right;margin-top:10px;break-inside:avoid}.signature-card img{max-height:48px;max-width:160px;object-fit:contain}.signature-line{height:34px;border-bottom:1px solid #9ca3af;margin-left:auto;width:160px}.qr-card{display:inline-flex;gap:8px;align-items:center;border:1px solid #e5e7eb;padding:6px;margin-top:6px}.qr-card img{width:70px;height:70px}.einv{font-size:9px;border:1px dashed ${palette.primary};padding:6px;margin-top:6px;word-break:break-all}.einv img{width:76px;height:76px}
    .lower{break-inside:avoid}.footer-line{margin-top:10px;border-top:1px solid #e5e7eb;padding-top:5px;color:#71717a;font-size:9px}.extra-bottom-lines div{height:12px;border-bottom:1px solid #e5e7eb}
  </style>`;

  const standard = `${baseCss}</head><body><main class="page standard">
    <section style="display:grid;grid-template-columns:1fr 1.05fr;gap:26px;align-items:start">
      <div><div class="logo">${logo}</div><div style="margin-top:12px">${sellerBlock}</div></div>
      <div style="text-align:right"><h1 class="doc-title">${title}</h1><div class="doc-subtitle"># ${escapeHtml(invoice.invoice_number || invoice.bill_number || '—')}</div></div>
    </section>
    <section class="bill-grid"><div class="bill-card">${primaryPartyBlock}</div><div>${invoiceMeta}</div></section>
    ${shipToSection}
    ${itemTable}<section class="lower"><div>${settingsDetailsBlock}${bank}${qrBlock}${einvBlock}<div class="note-block"><h3>Amount in Words</h3>${amountWords}</div>${notesBlock}${termsBlock}${receivedByBlock}${deliveredByBlock}${paymentModeBlock}${acknowledgementBlock}</div><div>${totals}${visibleSignBlock}</div></section>${extraBottomBlock}
    <div class="footer-line">${escapeHtml(legalCompanyName)}${company.gstin ? ` · GSTIN ${escapeHtml(company.gstin)}` : ''}${company.phone ? ` · ${escapeHtml(company.phone)}` : ''}</div>
  </main></body></html>`;

  const simple = `${baseCss}<style>@page{margin:0}.page{padding:0}.hero{background:${palette.accent};color:#fff;padding:24px 34px;display:grid;grid-template-columns:1fr 1fr;align-items:start}.hero .doc-title{color:#fff;font-size:40px}.hero .address,.hero .muted,.hero .business-address,.hero .business-lines,.hero .business-name,.hero .block-title{color:#fff!important}.simple-body{padding:24px 34px}.simple .bill-grid{grid-template-columns:1fr 330px}.simple table.items th{background:#fff;color:#85858b;border-bottom:1px solid #d4d4d8}.simple table.items td{border-bottom:1px solid #e4e4e7}.simple .totals{background:${palette.soft}}.simple .due{background:#dbeafe;color:#111827}</style></head><body><main class="page simple">
    <section class="hero"><div><h1 class="doc-title">${title}</h1></div><div style="text-align:right"><div class="logo" style="display:flex;justify-content:flex-end;margin-bottom:8px">${logo}</div>${sellerBlock}</div></section>
    <section style="background:${palette.soft};padding:10px 34px;text-align:right;font-size:18px">BALANCE DUE <b>${fmtMoney(balanceDue, currencyCode)}</b></section>
    <section class="simple-body"><div class="bill-grid"><div>${primaryPartyBlock}${shouldShowShipToBlock ? `<div style="margin-top:24px">${shipToBlock}</div>` : ''}</div>${invoiceMeta}</div>
    ${itemTable}<section class="lower"><div>${settingsDetailsBlock}<div class="note-block"><h3>Amount in Words</h3>${amountWords}</div>${notesBlock}${termsBlock}${bank}${qrBlock}${einvBlock}${receivedByBlock}${deliveredByBlock}${paymentModeBlock}${acknowledgementBlock}</div><div>${totals}${visibleSignBlock}</div></section>${extraBottomBlock}</section>
  </main></body></html>`;

  const performa = `${baseCss}<style>.performa{font-size:10.5px}.center{text-align:center}.performa .doc-title{font-size:40px;font-weight:800;color:${palette.primary};line-height:1.02;margin-top:6px}.performa .logo img{margin:0 auto;max-width:150px;max-height:82px}.performa .logo-fallback{margin:0 auto;width:64px;height:64px;font-size:30px}.performa .rule{height:2px;background:${palette.primary};margin:8px 0}.performa .bill-card{border:0;text-align:center;min-height:0;padding:4px}.performa .meta-grid div{padding:5px 8px}.performa table.items{margin-top:9px}.performa table.items th{background:#fff;color:${palette.primary};border-bottom:2px solid #e5e7eb;padding:6px 7px}.performa table.items td{border-bottom:1px solid #e5e7eb;padding:6px 7px}.performa .lower{grid-template-columns:1fr 310px;gap:14px;margin-top:8px}.performa .totals{background:#fff;padding:6px 10px}.performa .due{background:#fff;color:${palette.primary};border-top:2px solid ${palette.primary};border-bottom:2px solid ${palette.primary};margin-top:5px}.performa .note-block{margin-top:6px}.performa .signature-card{margin-top:6px}</style></head><body><main class="page performa">
    <section class="center"><div class="logo">${logo}</div><div style="margin-top:10px">${sellerBlock}</div><h1 class="doc-title">${title}</h1></section>
    <div class="rule"></div><section class="bill-card">${primaryPartyBlock}${shouldShowShipToBlock ? `<div style="margin-top:10px">${shipToBlock}</div>` : ''}</section><div class="rule"></div>
    ${invoiceMeta}${itemTable}<section class="lower"><div>${settingsDetailsBlock}<div class="note-block"><h3>Amount in Words</h3>${amountWords}</div>${notesBlock}${termsBlock}${bank}${qrBlock}${einvBlock}${receivedByBlock}${deliveredByBlock}${paymentModeBlock}${acknowledgementBlock}</div><div>${totals}${visibleSignBlock}</div></section>${extraBottomBlock}
  </main></body></html>`;

  const monochrome = `${baseCss}<style>
    @page{margin:10mm}.page{padding:0;color:#111;font-family:Arial,Helvetica,sans-serif}.monochrome *{color:#111!important}
    .monochrome .doc-title{font-size:26px;letter-spacing:.06em;font-weight:800;color:#111;margin:0;text-align:center}
    .mono-table{width:100%;border-collapse:collapse}.mono-table td,.mono-table th{border:1px solid #111;padding:5px 7px;vertical-align:top}.mono-table th{background:#fff;color:#111;font-weight:700}
    .monochrome .company-name{font-size:16px;color:#111;text-align:center}.monochrome .address{text-align:center;color:#111}.monochrome .gst{text-align:center}
    .monochrome table.items th{background:#fff!important;color:#111!important;border:1px solid #111;padding:5px 6px}.monochrome table.items td{border:1px solid #111;padding:6px}.monochrome table.items tr:nth-child(even) td{background:#fff}
    .monochrome .lower{grid-template-columns:1fr 300px;gap:10px}.monochrome .totals{background:#fff;border:1px solid #111}.monochrome .due{background:#fff;color:#111;border-top:1px solid #111;margin:6px -12px -9px}
    .monochrome .info-card,.monochrome .bill-card{border:1px solid #111}.monochrome .signature-line{border-bottom:1px solid #111}.monochrome .footer-line{border-top:1px solid #111}
  </style></head><body><main class="page monochrome">
    <table class="mono-table">
      <tr>
        <td style="width:22%;text-align:center">${logoSrc ? `<img src="${logoSrc}" style="max-width:128px;max-height:78px;object-fit:contain" />` : ''}</td>
        <td style="width:52%">
          ${sellerBlock}
        </td>
        <td style="width:26%;text-align:center"><h1 class="doc-title">${title}</h1></td>
      </tr>
    </table>
    <table class="mono-table" style="margin-top:8px">
      <tr>
        <td style="width:${shouldShowShipToBlock ? '50%' : '100%'}">${primaryPartyBlock}</td>
        ${shouldShowShipToBlock ? `<td style="width:50%">${shipToBlock}</td>` : ''}
      </tr>
    </table>
    <table class="mono-table" style="margin-top:8px">
      <tr><td><b>Invoice No.</b><br/>${escapeHtml(invoice.invoice_number || invoice.bill_number || '—')}</td><td><b>Date</b><br/>${formatDocDate(invoice.invoice_date || invoice.bill_date)}</td><td><b>Due Date</b><br/>${formatDocDate(invoice.due_date)}</td><td><b>Supply State Code</b><br/>${escapeHtml(supplyStateCode)}</td></tr>
    </table>
    ${itemTable}
    <section class="lower"><div>${settingsDetailsBlock}${einvBlock}<div class="info-card"><h3>Amount in Words</h3>${amountWords}</div>${bank}${termsBlock}${notesBlock}${receivedByBlock}${deliveredByBlock}${paymentModeBlock}${acknowledgementBlock}</div><div>${totals}${visibleSignBlock}</div></section>${extraBottomBlock}
    <div class="footer-line">${escapeHtml(notes || 'Thank you for your business.')}</div>
  </main></body></html>`;

  return kind === 'simple' ? simple : kind === 'performa' ? performa : kind === 'monochrome' ? monochrome : standard;
}

export async function generateInvoicePDF(
  invoice: any,
  company: any,
  party: any | null,
  items: any[],
  opts?: { templateOverride?: string; themeOverride?: string },
): Promise<Buffer> {
  const pricingMode = invoice.pricing_mode === 'inclusive' ? 'inclusive' : 'exclusive';
  const convertedItems = items.map((it) => {
    const originalPrice = Number(it.unit_price) || 0;
    const itemIncludesTax = it.price_includes_tax === true;
    const gstRate = Number(it.gst_rate) || 0;
    const cessRate = Number(it.cess_rate) || 0;
    const convertedPrice = getConvertedPrice(originalPrice, itemIncludesTax, pricingMode, gstRate, cessRate);
    return {
      ...it,
      unit_price: convertedPrice,
    };
  });

  const rawPrintSettings = parseObject(company?.print_settings);
  const printSettings = resolvePrintSettings(company);
  const explicitTheme = opts?.themeOverride || opts?.templateOverride;
  const savedTheme = rawPrintSettings.invoiceTheme || rawPrintSettings.invoice_theme || rawPrintSettings.regular?.layout || company.invoice_pdf_template || company.document_theme;
  const invoiceTheme = invoice.pdf_template || invoice.document_theme;
  const resolvedTheme = normalizeInvoicePrintTheme(explicitTheme || invoiceTheme || savedTheme || 'business-theme-1') as InvoicePrintTheme;
  const invoiceCustomFields = parseObject(invoice?.custom_fields);
  const invoiceLayoutColor = String(invoiceCustomFields.__print_layout_color || '').trim();
  const effectivePrintSettings = {
    ...printSettings,
    regular: { ...printSettings.regular, layout: resolvedTheme },
    layout_colors: {
      ...printSettings.layout_colors,
      ...(invoiceLayoutColor ? { [resolvedTheme]: invoiceLayoutColor } : {}),
    },
  };
  const kind = PRINT_LAYOUT_KIND[resolvedTheme] || 'standard';
  const docTheme = PRINT_LAYOUT_THEME[resolvedTheme] || 'classic';

  const upi = company.upi_id || invoice.upi_id_snapshot || '';
  let upiQr = '';
  if (upi) {
    const upiPayload = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(companyLegalDisplayName(company))}&am=${(invoice.total_amount / 100).toFixed(2)}&cu=INR`;
    upiQr = await QRCode.toDataURL(upiPayload, { width: 160, margin: 1 });
  }

  let einvBlock = '';
  if (kind !== 'performa' && invoice.irn && invoice.einvoice_status === 'generated') {
    let qrSrc = '';
    if (invoice.qr_code_url) {
      if (invoice.qr_code_url.startsWith('/uploads')) {
        const rel = invoice.qr_code_url.replace(/^\/uploads\/?/, '');
        const abs = path.resolve(env.UPLOAD_DIR, rel);
        if (fs.existsSync(abs)) qrSrc = `file://${abs}`;
      } else if (invoice.qr_code_url.startsWith('http') || invoice.qr_code_url.startsWith('data:')) {
        qrSrc = invoice.qr_code_url;
      }
    }
    einvBlock = `<div class="einv"><p><b>IRN:</b> ${escapeHtml(invoice.irn)}</p><p><b>ACK:</b> ${escapeHtml(invoice.ack_number || '')}</p>${qrSrc ? `<img src="${qrSrc}" alt="QR" style="width:120px;height:120px"/>` : ''}</div>`;
  }

  const logoSrc = inlineAssetAsDataUri(company.logo_url) || resolveAssetUrl(company.logo_url);
  const signatureSrc = inlineAssetAsDataUri(company.signature_url) || resolveAssetUrl(company.signature_url);
  if (kind === 'reference') {
    const ewayNo = String(invoice.eway_bill_no || parseObject(invoice.eway_bill_details).ewb_no || parseObject(parseObject(invoice.custom_fields).reference_invoice).eway_bill_no || '').trim();
    if (ewayNo) {
      invoice.__eway_qr_src = await QRCode.toDataURL(JSON.stringify({
        ewbNo: ewayNo,
        docNo: invoice.invoice_number,
        date: invoice.invoice_date,
        total: Number(invoice.total_amount || 0) / 100,
      }), { width: 180, margin: 1 });
    }
    const html = buildReferenceTaxInvoiceHtml({ invoice, company, party, items: convertedItems, printSettings: effectivePrintSettings });
    return withBrowserPage(async (page) => {
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const copyCount = Math.max(1, Math.min(10, Number(effectivePrintSettings.regular.number_of_copies || 1)));
      if (copyCount > 1) {
        await page.evaluate((copies) => {
          const doc = (globalThis as any).document;
          const originals = (Array.from(doc.body.children || []) as any[]).map((node) => node.cloneNode(true));
          for (let copy = 1; copy < copies; copy += 1) {
            originals.forEach((original, index) => {
              const clone = original.cloneNode(true);
              if (index === 0) clone.style.pageBreakBefore = 'always';
              doc.body.appendChild(clone);
            });
          }
        }, copyCount);
      }
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      return Buffer.from(pdf);
    });
  }

  const tpl = buildInvoiceHtml({ invoice, company, party, items: convertedItems, kind, theme: docTheme, printSettings: effectivePrintSettings, logoSrc, signatureSrc, upiQr, einvBlock });
  return withBrowserPage(async (page) => {
    await page.setContent(tpl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const copyCount = Math.max(1, Math.min(10, Number(effectivePrintSettings.regular.number_of_copies || 1)));
    if (copyCount > 1) {
      await page.evaluate((copies) => {
        const doc = (globalThis as any).document;
        const original = doc.body.firstElementChild?.cloneNode(true);
        if (!original) return;
        for (let copy = 1; copy < copies; copy += 1) {
          const clone = original.cloneNode(true);
          clone.style.pageBreakBefore = 'always';
          doc.body.appendChild(clone);
        }
      }, copyCount);
    }
    const requestedPaperSize = ['A1', 'A2', 'A3', 'A4', 'A5', 'Letter', 'Legal'].includes(String(effectivePrintSettings.regular.paper_size))
      ? effectivePrintSettings.regular.paper_size
      : 'A4';
    const pdf = await page.pdf({
      format: requestedPaperSize as any,
      landscape: effectivePrintSettings.regular.orientation === 'landscape' || resolvedTheme.startsWith('landscape-'),
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  });
}

export const BULK_SALES_INVOICE_DEFAULT_COLUMNS = [
  'serial_no',
  'item_name',
  'billing_date',
  'quantity',
  'unit',
  'unit_price',
  'gst_rate',
  'amount',
] as const;

export const BULK_SALES_INVOICE_ALLOWED_COLUMNS = [
  'serial_no',
  'invoice_number',
  'billing_date',
  'item_name',
  'item_description',
  'hsn_code',
  'quantity',
  'unit',
  'unit_price',
  'discount_amount',
  'taxable_amount',
  'gst_rate',
  'cgst_amount',
  'sgst_amount',
  'igst_amount',
  'cess_amount',
  'amount',
  'payment_status',
] as const;

const BULK_COLUMN_LABELS: Record<string, string> = {
  serial_no: '#',
  invoice_number: 'Invoice No.',
  billing_date: 'Billing Date',
  item_name: 'Item name',
  item_description: 'Description',
  hsn_code: 'HSN/SAC',
  quantity: 'Qty',
  unit: 'Unit',
  unit_price: 'Rate',
  discount_amount: 'Discount',
  taxable_amount: 'Taxable',
  gst_rate: 'GST %',
  cgst_amount: 'CGST',
  sgst_amount: 'SGST',
  igst_amount: 'IGST',
  cess_amount: 'Cess',
  amount: 'Amount',
  payment_status: 'Status',
};

const BULK_MONEY_COLUMNS = new Set([
  'unit_price',
  'discount_amount',
  'taxable_amount',
  'cgst_amount',
  'sgst_amount',
  'igst_amount',
  'cess_amount',
  'amount',
]);

const BULK_TAX_COLUMNS = new Set([
  'gst_rate',
  'cgst_amount',
  'sgst_amount',
  'igst_amount',
  'cess_amount',
]);

const BULK_NUMERIC_COLUMNS = new Set([
  'serial_no',
  'quantity',
  'unit_price',
  'discount_amount',
  'taxable_amount',
  'gst_rate',
  'cgst_amount',
  'sgst_amount',
  'igst_amount',
  'cess_amount',
  'amount',
]);

function normalizeBulkSalesColumns(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const picked = raw
    .map((c) => String(c || '').trim())
    .filter((c) => BULK_COLUMN_LABELS[c] || c.startsWith('custom:invoice:') || c.startsWith('custom:item:'));
  const uniq = Array.from(new Set(picked));
  return uniq.length ? uniq : [...BULK_SALES_INVOICE_DEFAULT_COLUMNS];
}

function normalizeBulkSalesColumnsForBill(input: unknown, isGstBill: boolean): string[] {
  const columns = normalizeBulkSalesColumns(input);
  if (isGstBill) return columns;
  const filtered = columns.filter((column) => !BULK_TAX_COLUMNS.has(column));
  return filtered.length ? filtered : ['serial_no', 'item_name', 'billing_date', 'quantity', 'unit', 'unit_price', 'amount'];
}

function salesCustomFieldDefinitions(company: any): Array<{ id: string; label: string; scope: string; enabled?: boolean }> {
  const raw = company?.sales_invoice_custom_fields;
  const defs = Array.isArray(raw) ? raw : [];
  return defs
    .map((d: any) => ({
      id: String(d?.id || '').trim(),
      label: String(d?.label || d?.id || '').trim(),
      scope: 'item',
      enabled: d?.enabled !== false,
    }))
    .filter((d) => d.id && d.label && d.enabled);
}

function bulkColumnLabel(company: any, column: string): string {
  if (BULK_COLUMN_LABELS[column]) return BULK_COLUMN_LABELS[column];
  const def = salesCustomFieldDefinitions(company).find((d) => column === `custom:${d.scope}:${d.id}`);
  return def?.label || column.replace(/^custom:(invoice|item):/, '');
}

function bulkCellValue(row: any, column: string, serial: number): string {
  if (column === 'serial_no') return String(serial);
  if (column.startsWith('custom:invoice:')) {
    const key = column.replace('custom:invoice:', '');
    return String(row.invoice_custom_fields?.[key] ?? '');
  }
  if (column.startsWith('custom:item:')) {
    const key = column.replace('custom:item:', '');
    return String(row.item_custom_fields?.[key] ?? '');
  }
  if (column === 'billing_date') return formatDocDate(row.invoice_date);
  if (column === 'amount') return fmtPaise(Number(row.total_amount || 0));
  if (column === 'unit_price') return fmtPaise(Number(row.unit_price || 0));
  if (BULK_MONEY_COLUMNS.has(column)) return fmtPaise(Number(row[column] || 0));
  if (column === 'quantity') return fmtQty(row.quantity);
  if (column === 'gst_rate') return `${Number(row.gst_rate || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
  if (column === 'payment_status') return String(row.payment_status || '').replace(/_/g, ' ');
  return String(row[column] ?? '');
}

export async function generateBulkSalesInvoicePDF(args: {
  company: any;
  party: any;
  rows: any[];
  columns: unknown;
  fromDate: string;
  toDate: string;
  isGstBill?: boolean;
  bulkInvoiceNumber?: string;
  paymentStatus?: string;
}): Promise<Buffer> {
  const { company, party, rows, fromDate, toDate } = args;
  const isGstBill = args.isGstBill !== false;
  const columns = normalizeBulkSalesColumnsForBill(args.columns, isGstBill);
  const logoSrc = inlineAssetAsDataUri(company.logo_url) || resolveAssetUrl(company.logo_url);
  const signatureSrc = inlineAssetAsDataUri(company.signature_url) || resolveAssetUrl(company.signature_url);
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const totalTaxable = rows.reduce((sum, r) => sum + Number(r.taxable_amount || 0), 0);
  const totalCgst = rows.reduce((sum, r) => sum + Number(r.cgst_amount || 0), 0);
  const totalSgst = rows.reduce((sum, r) => sum + Number(r.sgst_amount || 0), 0);
  const totalIgst = rows.reduce((sum, r) => sum + Number(r.igst_amount || 0), 0);
  const totalDiscount = rows.reduce((sum, r) => sum + Number(r.discount_amount || 0), 0);
  const totalQty = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  let upiQr = '';
  if (company.upi_id) {
    const upiPayload = `upi://pay?pa=${encodeURIComponent(company.upi_id)}&pn=${encodeURIComponent(companyLegalDisplayName(company))}&am=${(totalAmount / 100).toFixed(2)}&cu=INR`;
    upiQr = await QRCode.toDataURL(upiPayload, { width: 160, margin: 1 });
  }

  const tableHead = columns
    .map((col) => `<th class="${BULK_NUMERIC_COLUMNS.has(col) ? 'num' : ''}">${escapeHtml(bulkColumnLabel(company, col))}</th>`)
    .join('');
  const tableRows = rows
    .map((row, idx) => {
      const cells = columns
        .map((col) => {
          const value = bulkCellValue(row, col, idx + 1);
          const cls = BULK_NUMERIC_COLUMNS.has(col) ? 'num' : '';
          const content = col === 'item_name'
            ? `<b>${escapeHtml(value)}</b>`
            : col === 'item_description'
              ? multilineHtml(value)
              : escapeHtml(value);
          return `<td class="${cls}">${content}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const qtyTotalCell = columns.includes('quantity') ? `<div><span>Total Qty</span><b>${fmtQty(totalQty)}</b></div>` : '';
  const discountCell = totalDiscount > 0 ? `<div><span>Discount</span><b>${fmtPaise(totalDiscount)}</b></div>` : '';
  const taxCells = isGstBill
    ? [
        `<div><span>Taxable</span><b>${fmtPaise(totalTaxable)}</b></div>`,
        totalCgst > 0 ? `<div><span>CGST</span><b>${fmtPaise(totalCgst)}</b></div>` : '',
        totalSgst > 0 ? `<div><span>SGST</span><b>${fmtPaise(totalSgst)}</b></div>` : '',
        totalIgst > 0 ? `<div><span>IGST</span><b>${fmtPaise(totalIgst)}</b></div>` : '',
      ].join('')
    : '';
  const paymentStatus = String(args.paymentStatus || '').trim();

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;font-size:11px}
    .header{display:grid;grid-template-columns:1fr 82px;gap:18px;align-items:start;border-bottom:2px solid #111;padding-bottom:8px}
    .company-name{font-size:23px;font-weight:900;letter-spacing:.01em}.company-lines{margin-top:4px;line-height:1.45}.company-lines div span{font-weight:700}
    .logo{width:72px;height:72px;object-fit:contain;margin-left:auto}.title{text-align:center;color:#6b2a0d;font-size:18px;font-weight:900;margin:14px 0 18px}
    .meta{display:grid;grid-template-columns:1fr 240px;gap:20px;margin-bottom:14px}.block-title{font-weight:800;margin-bottom:8px}.party-name{font-weight:900;font-size:13px;margin-bottom:7px}.muted{color:#4b5563;line-height:1.45}
    .details{text-align:right;line-height:1.8}.details b{display:block;margin-bottom:2px}.range{font-weight:700}
    table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tfoot{display:table-footer-group}tr{page-break-inside:avoid;page-break-after:auto}
    th{background:#6b2a0d;color:#fff;text-align:left;padding:7px 6px;font-size:10px;vertical-align:bottom}td{border-bottom:1px solid #9ca3af;padding:5px 6px;vertical-align:top;line-height:1.25}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.wrap{white-space:normal}.footer{display:grid;grid-template-columns:1fr 310px;gap:24px;margin-top:14px;page-break-inside:avoid}
    .totals{font-size:11px}.totals div{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #9ca3af;padding:5px 0}.totals .grand{font-weight:900;font-size:12px;border-bottom:2px solid #111}
    .words{font-size:10.5px;line-height:1.5}.terms{margin-top:10px;font-size:10.5px;line-height:1.45}.bank-sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px;page-break-inside:avoid}
    .qr{width:88px;height:88px;object-fit:contain}.bank h3{font-size:11px;margin:0 0 6px}.sign{text-align:center}.sign img{max-width:120px;max-height:54px;object-fit:contain}.sign-line{font-weight:800;margin-top:8px}
  </style></head><body>
    <section class="header">
      <div>
        <div class="company-name">${escapeHtml(companyLegalDisplayName(company))}</div>
        <div class="company-lines">
          <div>${escapeHtml(companyAddress(company))}</div>
          ${fieldLine('Phone no.', company.phone)}
          ${fieldLine('Email', company.email)}
          ${fieldLine('GSTIN', company.gstin, 'mono')}
          ${fieldLine('State', companyStateLabel(company))}
        </div>
      </div>
      <div>${logoSrc ? `<img class="logo" src="${logoSrc}" alt="Logo"/>` : ''}</div>
    </section>
    <h1 class="title">${isGstBill ? 'Tax Invoice' : 'Invoice'}</h1>
    <section class="meta">
      <div>
        <div class="block-title">Bill To</div>
        <div class="party-name">${escapeHtml(party?.name || 'Customer')}</div>
        <div class="muted">
          ${addressHtml(buyerAddress(party))}
          ${fieldLine('Contact No.', party?.phone)}
          ${fieldLine('Email', party?.email)}
          ${fieldLine('GSTIN', party?.gstin)}
          ${fieldLine('PAN', party?.pan)}
          ${fieldLine('State', partyStateLabel(party, party?.gstin))}
        </div>
      </div>
      <div class="details">
        <b>Invoice Details</b>
        <div class="range">Period: ${escapeHtml(formatDocDate(fromDate))} to ${escapeHtml(formatDocDate(toDate))}</div>
        ${args.bulkInvoiceNumber ? `<div>Bulk Invoice No.: ${escapeHtml(args.bulkInvoiceNumber)}</div>` : ''}
        <div>Generated: ${escapeHtml(formatDocDate(new Date().toISOString()))}</div>
        <div>Total lines: ${rows.length}${paymentStatus ? ` · ${escapeHtml(paymentStatus.replace(/_/g, ' '))}` : ''}</div>
      </div>
    </section>
    <table>
      <thead><tr>${tableHead}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <section class="footer">
      <div>
        <div class="words"><b>Invoice Amount in Words:</b> ${escapeHtml(amountToWordsINR(totalAmount / 100))}</div>
        <div class="terms"><b>Terms and Conditions</b><br/>${multilineHtml(company.terms_and_conditions || 'Thank you for your business.')}</div>
      </div>
      <div class="totals">
        ${qtyTotalCell}
        ${discountCell}
        ${taxCells}
        <div class="grand"><span>Total</span><b>₹ ${fmtPaise(totalAmount)}</b></div>
      </div>
    </section>
    <section class="bank-sign">
      <div class="bank">
        <h3>Bank Details</h3>
        ${upiQr ? `<img class="qr" src="${upiQr}" alt="UPI QR"/>` : ''}
        <div class="muted">${bankBlock(company)}</div>
      </div>
      <div class="sign">
        <div>For : ${escapeHtml(companyLegalDisplayName(company))}</div>
        <div style="height:42px;margin-top:18px">${signatureSrc ? `<img src="${signatureSrc}" alt="Signature"/>` : ''}</div>
        <div class="sign-line">Authorized Signatory</div>
      </div>
    </section>
  </body></html>`;

  return withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    return Buffer.from(pdf);
  });
}

export async function generateThermalReceipt(
  invoice: any,
  company: any,
  items: any[],
  width: 58 | 80 | 100 = 80,
  logoSrc?: string,
  signatureSrc?: string,
  upiQr?: string,
): Promise<Buffer> {
  const partyRes = invoice.party_id
    ? await import('../config/db').then(m => m.query('SELECT * FROM parties WHERE id = $1', [invoice.party_id]))
    : null;
  const party = partyRes?.rows[0] || null;

  const thermalWidth = width === 58 ? '58mm' : width === 100 ? '100mm' : '80mm';
  const rawPrintSettings = parseObject(company?.print_settings);
  const thermal = parseObject(rawPrintSettings.thermal);
  const customFields = parseObject(invoice?.custom_fields);
  const posFields = parseObject(customFields.pos);
  const currency = invoice.currency_code || 'INR';
  const paid = Number(invoice.paid_amount || 0);
  const tendered = Number(posFields.tendered_amount ?? paid);
  const change = Number(posFields.change_amount ?? Math.max(0, tendered - Number(invoice.total_amount || 0)));
  const sellerName = thermal.show_seller_name === false
    ? ''
    : String(thermal.seller_name || companyLegalDisplayName(company));
  const sellerPhone = thermal.show_seller_phone === false
    ? ''
    : String(thermal.seller_phone || company.phone || '');
  const sellerAddress = thermal.show_seller_address === false
    ? ''
    : String(thermal.seller_address || company.registered_address || company.address || '');
  const showTaxColumns = thermal.show_tax_columns === true;
  const showPaymentDetails = thermal.show_payment_details !== false;
  const returnPolicy = String(thermal.return_policy ?? company.receipt_footer_message ?? 'Items can be returned within 7 days in original condition.');
  const showThankYou = thermal.show_footer_thank_you !== false;
  const barcodeMode = String(thermal.barcode_or_qr || 'barcode');
  const effectiveLogoSrc = logoSrc
    || inlineAssetAsDataUri(company.logo_url)
    || resolveAssetUrl(company.logo_url);
  let lookupCode = '';
  if (barcodeMode === 'barcode' && invoice.invoice_number) {
    try {
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: String(invoice.invoice_number),
        scale: 2,
        height: 9,
        includetext: false,
      });
      lookupCode = `data:image/png;base64,${barcodeBuffer.toString('base64')}`;
    } catch {
      lookupCode = '';
    }
  } else if (barcodeMode === 'qr' && invoice.invoice_number) {
    lookupCode = await QRCode.toDataURL(String(invoice.invoice_number), { width: 180, margin: 1 });
  }
  const invoiceDate = formatDocDate(invoice.invoice_date || invoice.created_at);
  const invoiceTime = invoice.created_at
    ? new Date(invoice.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '';
  const partyName = String(invoice.party_name_snapshot || party?.name || 'Walk-in Customer');
  const rows = items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const total = Number(item.total_amount ?? item.line_total ?? (Number(item.unit_price || 0) * quantity));
    const meta = showTaxColumns
      ? [item.hsn_code ? `HSN: ${escapeHtml(String(item.hsn_code))}` : '', item.gst_rate != null ? `GST: ${Number(item.gst_rate)}%` : ''].filter(Boolean).join(' | ')
      : '';
    return `<div class="item-row">
      <div class="item-main"><span>${escapeHtml(String(item.item_name || item.name || 'Item'))}</span><span>${quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</span><span>${fmtMoney(total, currency)}</span></div>
      ${meta ? `<div class="item-meta">${meta}</div>` : ''}
    </div>`;
  }).join('');
  const taxRows = [
    ['CGST', Number(invoice.cgst_amount || 0)],
    ['SGST', Number(invoice.sgst_amount || 0)],
    ['IGST', Number(invoice.igst_amount || 0)],
    ['Cess', Number(invoice.cess_amount || 0)],
    ['Round Off', Number(invoice.round_off_amount || 0)],
  ].filter(([, amount]) => Number(amount) !== 0)
    .map(([label, amount]) => `<div class="money-row"><span>${label}</span><span>${fmtMoney(Number(amount), currency)}</span></div>`)
    .join('');
  const paymentMode = String(invoice.payment_mode || invoice.payment_type || 'cash');
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <style>
      @page{size:${thermalWidth} auto;margin:0}
      *{box-sizing:border-box}
      html,body{margin:0;width:${thermalWidth};min-width:${thermalWidth};background:#fff;color:#000}
      body{font-family:"Courier New",ui-monospace,monospace;font-size:${width === 58 ? '9px' : '11px'};line-height:1.28}
      main{width:100%;padding:${width === 58 ? '2mm' : '3mm'}}
      .center{text-align:center}.strong{font-weight:700}.seller{font-size:${width === 58 ? '12px' : '14px'};font-weight:800;text-transform:uppercase}
      .small{font-size:.88em}.rule{border-top:1px dashed #000;margin:6px 0}
      .kv,.money-row{display:flex;justify-content:space-between;gap:8px}.kv span:last-child,.money-row span:last-child{text-align:right}
      .item-head,.item-main{display:grid;grid-template-columns:minmax(0,1fr) 20% 31%;gap:3px}
      .item-head{font-weight:700}.item-head span:nth-child(2),.item-main span:nth-child(2){text-align:center}
      .item-head span:last-child,.item-main span:last-child{text-align:right}.item-row{margin:4px 0}
      .item-main span:first-child{overflow-wrap:anywhere}.item-meta{font-size:.8em;padding-left:3px}
      .total{font-size:1.2em;font-weight:800;padding:2px 0}.footer{font-size:.85em;text-align:center}
      .logo{display:block;max-width:${width === 58 ? '34mm' : '44mm'};max-height:15mm;margin:0 auto 4px;object-fit:contain;filter:grayscale(1) contrast(1.5)}
      .lookup{display:block;max-width:90%;max-height:${barcodeMode === 'qr' ? '24mm' : '13mm'};margin:7px auto 2px;object-fit:contain}
    </style></head><body><main>
      ${thermal.show_logo !== false && effectiveLogoSrc ? `<img class="logo" src="${effectiveLogoSrc}" alt="Logo"/>` : ''}
      <div class="center">${sellerName ? `<div class="seller">${escapeHtml(sellerName)}</div>` : ''}${sellerAddress ? `<div class="small">${escapeHtml(sellerAddress)}</div>` : ''}${company.gstin ? `<div class="small">GSTIN: ${escapeHtml(String(company.gstin))}</div>` : ''}${sellerPhone ? `<div class="small">Ph: ${escapeHtml(sellerPhone)}</div>` : ''}</div>
      <div class="rule"></div>
      ${thermal.show_bill_no === false ? '' : `<div class="kv"><span>INVOICE:</span><span class="strong">${escapeHtml(String(invoice.invoice_number || ''))}</span></div>`}
      ${thermal.show_date_time === false ? '' : `<div class="kv"><span>Date:</span><span>${escapeHtml(invoiceDate)}</span></div><div class="kv"><span>Time:</span><span>${escapeHtml(invoiceTime)}</span></div>`}
      <div class="kv"><span>Party:</span><span>${escapeHtml(partyName)}</span></div>
      <div class="rule"></div>
      <div class="item-head"><span>Item</span><span>Qty</span><span>Price</span></div>
      <div class="rule"></div>${rows || '<div class="center">No items</div>'}<div class="rule"></div>
      <div class="money-row"><span>Subtotal</span><span>${fmtMoney(Number(invoice.subtotal || 0), currency)}</span></div>
      ${Number(invoice.discount_amount || 0) ? `<div class="money-row"><span>Discount</span><span>-${fmtMoney(Number(invoice.discount_amount), currency)}</span></div>` : ''}
      ${taxRows}<div class="rule"></div>
      <div class="money-row total"><span>TOTAL</span><span>${fmtMoney(Number(invoice.total_amount || 0), currency)}</span></div>
      ${showPaymentDetails ? `<div class="rule"></div><div class="money-row"><span>Payment</span><span>${escapeHtml(paymentMode)}</span></div><div class="money-row"><span>Paid</span><span>${fmtMoney(paid, currency)}</span></div>${paymentMode.toLowerCase() === 'cash' ? `<div class="money-row"><span>Tendered</span><span>${fmtMoney(tendered, currency)}</span></div><div class="money-row"><span>Change</span><span>${fmtMoney(change, currency)}</span></div>` : ''}` : ''}
      ${returnPolicy ? `<div class="rule"></div><div class="footer">${escapeHtml(returnPolicy)}</div>` : ''}
      ${showThankYou ? '<div class="center strong" style="margin-top:6px">Thank you for your business!</div>' : ''}
      ${lookupCode ? `<img class="lookup" src="${lookupCode}" alt="Invoice lookup code"/><div class="center small">${escapeHtml(String(invoice.invoice_number || ''))}</div>` : ''}
    </main></body></html>`;

  return withBrowserPage(async (page) => {
    const viewportWidth = Math.ceil((width / 25.4) * 96);
    await page.setViewport({ width: viewportWidth, height: 100, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(() => (globalThis as any).document.fonts?.ready);
    const contentHeight = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const receipt = doc.querySelector('main');
      return receipt ? Math.ceil(receipt.getBoundingClientRect().height) : doc.body.scrollHeight;
    });
    const pdf = await page.pdf({
      printBackground: true,
      width: thermalWidth,
      height: `${Math.max(80, Math.ceil(contentHeight + 2))}px`,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  });
}

export async function generateEinvoicePdf(
  invoice: any,
  company: any,
  party: any | null,
  items: any[],
): Promise<Buffer> {
  const qr = inlineAssetAsDataUri(invoice.qr_code_url)
    || (invoice.qr_code_url && (invoice.qr_code_url.startsWith('http') || invoice.qr_code_url.startsWith('data:')) ? invoice.qr_code_url : '')
    || await QRCode.toDataURL(invoice.irn || JSON.stringify({ irn: invoice.irn, no: invoice.invoice_number }), { width: 220, margin: 1 });
  const logoSrc = inlineAssetAsDataUri(company.logo_url) || resolveAssetUrl(company.logo_url);
  const buyerAddressText = invoice.billing_address_snapshot || buyerAddress(party);
  const primary = String(company.document_primary_color || '#174EA6');
  const buyerGstin = invoice.party_gstin_snapshot || party?.gstin || 'URP';
  const buyerBlock = partyContactBlock({
    title: 'Bill To',
    name: invoice.party_name_snapshot || party?.name || 'Customer',
    address: buyerAddressText,
    phone: invoice.party_phone_snapshot || invoice.party_phone || party?.phone || '',
    email: invoice.party_email_snapshot || invoice.party_email || party?.email || '',
    gstin: buyerGstin,
    pan: invoice.party_pan || party?.pan || '',
    state: partyStateLabel(party, buyerGstin, invoice.place_of_supply),
  });
  const rows = items.map((it, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td><b>${escapeHtml(it.item_name || '')}</b>${it.item_description ? `<div class="muted small">${multilineHtml(it.item_description)}</div>` : ''}</td>
    <td class="mono center">${escapeHtml(it.hsn_code || '—')}</td>
    <td class="right">${Number(it.quantity) || 0}</td>
    <td class="center mono">${escapeHtml(it.unit || 'PCS')}</td>
    <td class="right">${fmtPaise(Number(it.unit_price) || 0)}</td>
    <td class="right">${Number(it.gst_rate || 0).toFixed(2)}%</td>
    <td class="right">${fmtPaise(Number(it.taxable_amount) || 0)}</td>
    <td class="right"><b>${fmtPaise(Number(it.total_amount) || 0)}</b></td>
  </tr>`).join('');
  const ackDate = invoice.ack_date ? new Date(invoice.ack_date) : null;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box} body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827;margin:0;background:#fff;font-size:12px}
    .top{display:grid;grid-template-columns:1.3fr .7fr;gap:18px;border-bottom:4px solid ${escapeHtml(primary)};padding-bottom:14px}
    .brand{display:flex;gap:12px;align-items:flex-start}.logo{max-width:82px;max-height:64px;object-fit:contain}.title{text-align:right}
    h1{margin:0;color:${escapeHtml(primary)};font-size:34px;letter-spacing:1px}.muted{color:#667085}.small{font-size:11px}.mono{font-family:"SFMono-Regular",Consolas,monospace}
    .company,.business-name{font-size:18px;font-weight:800}.business-address{color:#667085}.business-lines{font-size:11px;line-height:1.5}.block-title{font-size:12px;text-transform:uppercase;color:${escapeHtml(primary)};font-weight:800;margin-bottom:6px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.box{border:1px solid #d9e2ec;border-radius:8px;padding:12px;min-height:96px}
    .box h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:${escapeHtml(primary)};letter-spacing:.04em}.kv{display:grid;grid-template-columns:92px 1fr;gap:6px}.irn{word-break:break-all;line-height:1.45}
    .qrbox{display:flex;gap:12px;align-items:center;border:1px solid #d9e2ec;border-radius:8px;padding:10px;margin-top:12px}.qrbox img{width:132px;height:132px;object-fit:contain}
    table{width:100%;border-collapse:collapse;margin-top:14px}th{background:${escapeHtml(primary)};color:#fff;padding:8px;text-align:left;font-size:11px}td{border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top}
    .right{text-align:right}.center{text-align:center}.totals{display:grid;grid-template-columns:1fr 310px;gap:18px;margin-top:12px}.totals table{margin-top:0}.totals td{padding:7px;border-bottom:1px solid #e5e7eb}.grand td{font-size:15px;font-weight:800;color:#111827}
    .seal{margin-top:12px;padding:10px;border-radius:8px;background:#eef6ff;color:#174a7c}.footer{margin-top:16px;border-top:1px solid #e5e7eb;padding-top:10px;color:#667085}
  </style></head><body>
    <section class="top">
      <div class="brand">${logoSrc ? `<img class="logo" src="${logoSrc}" />` : ''}<div>${companyContactBlock(company)}</div></div>
      <div class="title"><h1>e-INVOICE</h1><div class="muted">Government registered tax invoice</div></div>
    </section>
    <section class="grid">
      <div class="box">${buyerBlock}</div>
      <div class="box"><h3>Invoice Details</h3><div class="kv"><span>Invoice No</span><b>${escapeHtml(invoice.invoice_number || '')}</b><span>Date</span><b>${formatDocDate(invoice.invoice_date)}</b><span>Ack No</span><b>${escapeHtml(invoice.ack_number || '—')}</b><span>Ack Date</span><b>${escapeHtml(ackDate && !Number.isNaN(ackDate.getTime()) ? ackDate.toLocaleString('en-IN') : String(invoice.ack_date || '—'))}</b></div></div>
    </section>
    <section class="qrbox"><img src="${qr}" alt="Signed QR Code" /><div><h3 style="margin:0 0 6px;color:${escapeHtml(primary)}">IRN</h3><div class="mono irn">${escapeHtml(invoice.irn || '')}</div><div class="seal small">Scan the QR code to verify the signed e-invoice details from IRP.</div></div></section>
    <table><thead><tr><th class="center">#</th><th>Item</th><th class="center">HSN/SAC</th><th class="right">Qty</th><th>Unit</th><th class="right">Rate</th><th class="right">GST</th><th class="right">Taxable</th><th class="right">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <section class="totals"><div><b>Amount in words</b><div class="muted">${escapeHtml(amountToWordsINR(Math.round((Number(invoice.total_amount) || 0) / 100)))}</div></div><table>
      <tr><td>Taxable Value</td><td class="right">${fmtPaise(Number(invoice.taxable_amount) || 0)}</td></tr>
      <tr><td>CGST</td><td class="right">${fmtPaise(Number(invoice.cgst_amount) || 0)}</td></tr>
      <tr><td>SGST</td><td class="right">${fmtPaise(Number(invoice.sgst_amount) || 0)}</td></tr>
      <tr><td>IGST</td><td class="right">${fmtPaise(Number(invoice.igst_amount) || 0)}</td></tr>
      <tr><td>Round Off</td><td class="right">${fmtPaise(Number(invoice.round_off) || 0)}</td></tr>
      <tr class="grand"><td>Grand Total</td><td class="right">₹${fmtPaise(Number(invoice.total_amount) || 0)}</td></tr>
    </table></section>
    <div class="footer">This document is generated from IRN details stored in Microtechnique Accounts.</div>
  </body></html>`;

  return withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  });
}

export async function generateQuotationPDF(
  quotation: any,
  company: any,
  party: any | null,
  items: any[],
): Promise<Buffer> {
  const buyerAddr = buyerAddress(party);
  const rows = items
    .map(
      (it: any, i: number) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.item_name || '')}</td>
      <td class="mono">${escapeHtml(it.hsn_code || '—')}</td>
      <td class="right">${Number(it.quantity) || 0}</td>
      <td class="right">${fmtPaise(Number(it.unit_price) || 0)}</td>
      <td class="right">${fmtPaise(Number(it.discount_amount) || 0)}</td>
      <td class="right">${Number(it.gst_rate) || 0}%</td>
      <td class="right"><b>${fmtPaise(Number(it.total_amount) || 0)}</b></td>
    </tr>`
    )
    .join('');

  const primaryColor = String(company.document_primary_color || '#4F46E5');
  const quotationTheme = normalizeInvoicePrintTheme(quotation.document_theme || quotation.pdf_template || company.document_theme || company.invoice_pdf_template);
  const theme = PRINT_LAYOUT_THEME[quotationTheme] || 'classic';
  const logoSrc = inlineAssetAsDataUri(company.logo_url) || resolveAssetUrl(company.logo_url);
  const signatureSrc = inlineAssetAsDataUri(company.signature_url) || resolveAssetUrl(company.signature_url);
  const legalCompanyName = companyLegalDisplayName(company);
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" style="max-height:72px;display:block;margin-bottom:8px" alt="${escapeHtml(legalCompanyName || 'Logo')}" />`
    : '';
  const signatureBlock = signatureSrc
    ? `<div style="text-align:right;margin-top:26px"><p style="margin:0 0 6px">For <b>${escapeHtml(legalCompanyName)}</b></p><img src="${signatureSrc}" style="max-height:52px"/><p style="margin:6px 0 0">Authorised Signatory</p></div>`
    : `<div style="text-align:right;margin-top:26px"><p>For <b>${escapeHtml(legalCompanyName)}</b></p><p>Authorised Signatory</p></div>`;
  const sellerBlock = companyContactBlock(company, { title: 'Seller' });
  const buyerBlock = partyContactBlock({
    title: 'Buyer',
    name: quotation.party_name_override || party?.name || 'Customer',
    address: buyerAddr,
    phone: quotation.party_phone_override || party?.phone || '',
    email: quotation.party_email_override || party?.email || '',
    gstin: party?.gstin || 'URP',
    pan: party?.pan || '',
    state: partyStateLabel(party, party?.gstin),
  });

  let html = `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body{font-family:Arial,sans-serif;color:#111;padding:16px}
    .row{display:flex;justify-content:space-between;align-items:flex-start}
    .muted{color:#666;font-size:12px}
    .business-name{font-size:16px;font-weight:800}.business-address{color:#555;font-size:12px;line-height:1.45}.business-lines{font-size:12px;color:#444;line-height:1.5}.block-title{font-size:11px;text-transform:uppercase;color:${escapeHtml(primaryColor)};font-weight:800;margin-bottom:5px}
    h1{font-size:20px;margin:0}
    .header{background:${escapeHtml(primaryColor)};color:#fff;padding:16px 18px;border-radius:8px}
    .header .muted,.header .business-name,.header .business-address,.header .business-lines,.header .block-title{color:#fff!important}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
    .box{border:1px solid #ddd;padding:10px;border-radius:8px}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
    th,td{border:1px solid #ddd;padding:6px}
    th{background:${escapeHtml(primaryColor)};color:#fff}.right{text-align:right}.mono{font-family:monospace}
    .totals{margin-top:12px;display:flex;justify-content:flex-end}
    .totals table{width:320px}
  </style></head><body>
    <div class="row header">
      <div>
        ${logoBlock}
        <h1>Quotation</h1>
        <div class="muted">${companyContactBlock(company)}</div>
      </div>
      <div style="text-align:right">
        <p><b>Quote No:</b> ${escapeHtml(quotation.quotation_number || '')}</p>
        <p><b>Date:</b> ${escapeHtml(String(quotation.quotation_date || ''))}</p>
        <p><b>Valid Until:</b> ${escapeHtml(String(quotation.valid_until || '—'))}</p>
      </div>
    </div>
    <div class="grid2">
      <div class="box">
        ${sellerBlock}
      </div>
      <div class="box">
        ${buyerBlock}
      </div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Disc</th><th>GST</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td class="right">${fmtPaise(Number(quotation.subtotal) || 0)}</td></tr>
        <tr><td>Discount</td><td class="right">${fmtPaise(Number(quotation.discount_amount) || 0)}</td></tr>
        <tr><td>Taxable</td><td class="right">${fmtPaise(Number(quotation.taxable_amount) || 0)}</td></tr>
        <tr><td>CGST</td><td class="right">${fmtPaise(Number(quotation.cgst_amount) || 0)}</td></tr>
        <tr><td>SGST</td><td class="right">${fmtPaise(Number(quotation.sgst_amount) || 0)}</td></tr>
        <tr><td>IGST</td><td class="right">${fmtPaise(Number(quotation.igst_amount) || 0)}</td></tr>
        <tr><td><b>Grand Total</b></td><td class="right"><b>${fmtPaise(Number(quotation.total_amount) || 0)}</b></td></tr>
      </table>
    </div>
    <p><b>Customer notes:</b> ${escapeHtml(quotation.customer_notes || '—')}</p>
    <p><b>Terms:</b> ${escapeHtml(quotation.terms_and_conditions || company.terms_and_conditions || '—')}</p>
    ${signatureBlock}
  </body></html>`;

  const extraThemeStyle = themeStyle(theme);
  if (extraThemeStyle) {
    html = html.replace('</head>', `${replaceAll(extraThemeStyle, { PRIMARY_COLOR: primaryColor })}</head>`);
  }

  return withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    return Buffer.from(pdf);
  });
}

export async function generateDeliveryChallanPDF(
  challan: any,
  company: any,
  items: any[],
): Promise<Buffer> {
  const logoSrc = inlineAssetAsDataUri(company.logo_url) || resolveAssetUrl(company.logo_url);
  const signatureSrc = inlineAssetAsDataUri(company.signature_url) || resolveAssetUrl(company.signature_url);
  const legalCompanyName = companyLegalDisplayName(company);
  const signature = signatureSrc
    ? `<img src="${signatureSrc}" style="max-height:42px;max-width:150px;object-fit:contain;margin-top:10px" alt="Signature" />`
    : '<br/><br/>';
  const showPricing = company.delivery_challan_show_pricing === true;
  const totalQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  const totals = items.reduce(
    (acc, it) => {
      const qty = Number(it.quantity) || 0;
      const unitPrice = Number(it.unit_price) || 0;
      const discount = Number(it.discount_amount) || 0;
      const amount = Math.max(0, Math.round(qty * unitPrice) - discount);
      acc.total += amount;
      return acc;
    },
    { total: 0 },
  );
  const deliveredToBlock = partyContactBlock({
    title: 'Delivered To',
    name: challan.party_name_snapshot || challan.party_name || 'Customer',
    address: challan.party_address_snapshot || challan.party_address || '',
    phone: challan.party_phone_snapshot || challan.party_phone || '',
    email: challan.party_email_snapshot || challan.party_email || '',
    gstin: challan.party_gstin_snapshot || challan.party_gstin || 'URP',
    pan: challan.party_pan || '',
    state: partyStateLabel(
      {
        billing_state: challan.party_state,
        billing_state_code: challan.party_state_code,
      },
      challan.party_gstin_snapshot || challan.party_gstin,
    ),
  });
  const rows = items.map((it, idx) => `<tr>
    <td class="center">${idx + 1}</td>
    <td><b>${escapeHtml(it.item_name || it.name || 'Item')}</b>${it.item_description ? `<div class="muted">${multilineHtml(it.item_description)}</div>` : ''}</td>
    <td class="mono center">${escapeHtml(it.hsn_code || '—')}</td>
    <td class="right">${fmtQty(Number(it.quantity) || 0)}</td>
    <td class="center">${escapeHtml(it.unit || 'PCS')}</td>
    ${showPricing ? `<td class="right">${fmtPaise(Number(it.unit_price) || 0)}</td><td class="right">${fmtPaise(Number(it.discount_amount) || 0)}</td><td class="right">${fmtPaise(Math.max(0, Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)) - (Number(it.discount_amount) || 0)))}</td>` : ''}
  </tr>`).join('');
  const pricingHead = showPricing
    ? '<th class="right" style="width:90px">Rate</th><th class="right" style="width:88px">Discount</th><th class="right" style="width:105px">Amount</th>'
    : '';
  const totalColspan = showPricing ? 7 : 3;
  const totalsFooter = showPricing
    ? `<tr><td colspan="${totalColspan}" class="right"><b>Total Value</b></td><td class="right"><b>${fmtPaise(totals.total)}</b></td></tr>`
    : `<tr><td colspan="3" class="right"><b>Total Quantity</b></td><td class="right"><b>${fmtQty(totalQty)}</b></td><td></td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page{size:A4;margin:10mm}
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:12px;line-height:1.35}
    .mono{font-family:Consolas,Menlo,monospace}.muted{color:#555}.center{text-align:center}.right{text-align:right}
    .business-name{font-size:15px;font-weight:800}.business-address{color:#333;line-height:1.45}.business-lines{font-size:11px;line-height:1.45}.block-title{font-size:10px;text-transform:uppercase;color:#555;font-weight:800;margin-bottom:3px}
    .head{display:grid;grid-template-columns:90px 1fr 170px;border:1px solid #111}
    .head>div{padding:8px;border-right:1px solid #111}.head>div:last-child{border-right:0}
    .logo{max-width:74px;max-height:58px;object-fit:contain}.company{text-align:center;font-size:17px;font-weight:800}
    h1{margin:0;text-align:center;font-size:22px;letter-spacing:.08em}.boxgrid{display:grid;grid-template-columns:1fr 1fr;border-left:1px solid #111;border-right:1px solid #111}
    .box{padding:8px;border-bottom:1px solid #111}.box:first-child{border-right:1px solid #111}.label{font-size:10px;text-transform:uppercase;color:#555;margin-bottom:3px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px;vertical-align:top}th{font-weight:700;background:#fff}
    .meta{display:grid;grid-template-columns:repeat(4,1fr);border-left:1px solid #111}.meta div{padding:7px;border-right:1px solid #111;border-bottom:1px solid #111}
    .footer{display:grid;grid-template-columns:1fr 220px 220px;gap:10px;margin-top:10px}.sign{border:1px solid #111;min-height:86px;padding:8px;text-align:center}.note{border:1px solid #111;padding:8px;min-height:86px}
    .declaration{margin-top:10px;border:1px solid #111;padding:8px;font-size:11px;line-height:1.45}
  </style></head><body>
    <section class="head">
      <div class="center">${logoSrc ? `<img class="logo" src="${logoSrc}" />` : ''}</div>
      <div>${companyContactBlock(company)}</div>
      <div><h1>DELIVERY CHALLAN</h1></div>
    </section>
    <section class="meta">
      <div><span class="label">Challan No.</span><br/><b>${escapeHtml(challan.challan_number || '')}</b></div>
      <div><span class="label">Date</span><br/><b>${formatDocDate(challan.challan_date)}</b></div>
      <div><span class="label">Due Date</span><br/><b>${formatDocDate(challan.due_date)}</b></div>
      <div><span class="label">Status</span><br/><b>${escapeHtml(challan.status || 'open')}</b></div>
    </section>
    <section class="boxgrid">
      <div class="box">${deliveredToBlock}</div>
      <div class="box"><div class="label">Transport</div><div>Transport: ${escapeHtml(challan.transport_name || '—')}</div><div>Vehicle No.: ${escapeHtml(challan.vehicle_number || '—')}</div><div>LR/Docket No.: ${escapeHtml(challan.lr_number || '—')}</div></div>
    </section>
    <table><thead><tr><th class="center" style="width:44px">#</th><th>Description of Goods</th><th class="center" style="width:110px">HSN/SAC</th><th class="right" style="width:92px">Qty</th><th class="center" style="width:90px">Unit</th>${pricingHead}</tr></thead><tbody>${rows}</tbody>
      <tfoot>${totalsFooter}</tfoot>
    </table>
    <section class="declaration">${showPricing ? 'This delivery challan is issued for movement/delivery of goods only. Pricing is shown only as reference value and this document is not a tax invoice.' : 'This delivery challan is issued for movement/delivery of goods only. It is not a tax invoice and does not contain pricing or taxable value.'}</section>
    <section class="footer"><div class="note"><b>Notes</b><br/>${escapeHtml(challan.notes || 'Goods received in good condition.')}</div><div class="sign">Received By<br/><br/><br/>Name / Signature</div><div class="sign">For <b>${escapeHtml(legalCompanyName)}</b><br/>${signature}<br/>Authorised Signatory</div></section>
  </body></html>`;
  return withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  });
}
