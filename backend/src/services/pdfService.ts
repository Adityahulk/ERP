import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { env } from '../config/env';
import { amountToWordsINR } from '../lib/amountToWords';

function templatesRoot(): string {
  const dist = path.join(__dirname, '..', 'templates');
  if (fs.existsSync(dist)) return dist;
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

function invoiceItemRows(items: any[], kind: string): string {
  const showTax = kind !== 'simple';
  return items
    .map((it, i) => {
      const name = escapeHtml(it.item_name || it.name || 'Item');
      const desc = multilineHtml(it.item_description || it.description || '');
      const tax = Number(it.cgst_amount || 0) + Number(it.sgst_amount || 0) + Number(it.igst_amount || 0);
      return `<tr>
        <td class="idx">${i + 1}</td>
        <td>
          <div class="item-name">${name}</div>
          ${desc ? `<div class="item-desc">${desc}</div>` : ''}
        </td>
        <td class="mono">${escapeHtml(it.hsn_code || '')}</td>
        <td class="right"><b>${fmtQty(it.quantity)}</b></td>
        <td class="mono">${escapeHtml(it.unit || 'PCS')}</td>
        <td class="right">${fmtPaise(Number(it.unit_price || 0))}</td>
        ${showTax ? `<td class="right">${fmtPaise(tax)}</td>` : ''}
        <td class="right amount">${fmtPaise(Number(it.total_amount || 0))}</td>
      </tr>`;
    })
    .join('');
}

function totalsRows(invoice: any): string {
  const rows: Array<[string, number, string?]> = [
    ['Sub Total', Number(invoice.subtotal || 0)],
    ['Discount', Number(invoice.discount_amount || 0)],
    ['Taxable Amount', Number(invoice.taxable_amount || 0)],
  ];
  if (Number(invoice.cgst_amount || 0)) rows.push(['CGST', Number(invoice.cgst_amount || 0)]);
  if (Number(invoice.sgst_amount || 0)) rows.push(['SGST', Number(invoice.sgst_amount || 0)]);
  if (Number(invoice.igst_amount || 0)) rows.push(['IGST', Number(invoice.igst_amount || 0)]);
  if (Number(invoice.round_off || 0)) rows.push(['Round Off', Number(invoice.round_off || 0)]);
  return rows
    .filter(([, amount], idx) => idx < 3 || amount !== 0)
    .map(([label, amount]) => `<div class="total-row"><span>${escapeHtml(label)}</span><b>₹${fmtPaise(amount)}</b></div>`)
    .join('');
}

function buildInvoiceHtml(args: {
  invoice: any;
  company: any;
  party: any | null;
  items: any[];
  kind: string;
  theme: string;
  logoSrc: string;
  signatureSrc: string;
  upiQr: string;
  einvBlock: string;
}) {
  const { invoice, company, party, items, kind, theme, logoSrc, signatureSrc, upiQr, einvBlock } = args;
  const palette = themePalette(theme, String(company.document_primary_color || ''));
  const isPurchase = Boolean(invoice.bill_number || invoice.purchase_invoice_id);
  const title = kind === 'performa' ? 'PROFORMA INVOICE' : isPurchase ? 'PURCHASE BILL' : 'INVOICE';
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
  const amountWords = escapeHtml(amountToWordsINR(Math.round(Number(invoice.total_amount || 0) / 100)));
  const balanceDue = Number(invoice.balance_due ?? Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0)));
  const terms = String(invoice.terms_and_conditions || company.terms_and_conditions || 'Thank you for your business.').trim();
  const notes = String(invoice.notes || company.invoice_notes || 'Thanks for your business.').trim();
  const logo = logoSrc ? `<img src="${logoSrc}" alt="${escapeHtml(legalCompanyName || 'Logo')}"/>` : `<div class="logo-fallback">${escapeHtml((legalCompanyName || 'M').slice(0, 1))}</div>`;
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
  const signBlock = `<div class="signature-card"><p>For <b>${escapeHtml(legalCompanyName)}</b></p>${signature}<p>Authorised Signatory</p></div>`;
  const itemsHead = `<thead><tr><th>#</th><th>Item & Description</th><th>HSN/SAC</th><th class="right">Qty</th><th>Unit</th><th class="right">Rate</th>${kind === 'simple' ? '' : '<th class="right">Tax</th>'}<th class="right">Amount</th></tr></thead>`;
  const itemTable = `<table class="items">${itemsHead}<tbody>${invoiceItemRows(items, kind)}</tbody></table>`;
  const totals = `<div class="totals">${totalsRows(invoice)}<div class="grand total-row"><span>Total</span><b>₹${fmtPaise(Number(invoice.total_amount || 0))}</b></div><div class="due total-row"><span>Balance Due</span><b>₹${fmtPaise(balanceDue)}</b></div></div>`;

  const baseCss = `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page{size:A4;margin:8mm}
    *{box-sizing:border-box}
    body{margin:0;color:${palette.ink};font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.34;background:#fff}
    .page{padding:8px 14px;position:relative}
    .muted,.item-desc,.item-meta{color:#71717a}.mono,.mono-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .logo img{max-width:150px;max-height:88px;object-fit:contain;display:block}.logo-fallback{width:68px;height:68px;border-radius:50%;background:${palette.primary};color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:900}
    .doc-title{font-size:38px;letter-spacing:.08em;font-weight:300;color:${palette.primary};margin:0}.doc-subtitle{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}
    .company-name,.party-name,.business-name{font-size:15px;font-weight:800;color:${palette.accent}}.address,.business-address{color:#52525b}.gst{font-size:10px;margin-top:3px}
    .business-block{line-height:1.45}.business-lines{font-size:10px;margin-top:4px;color:#374151}.business-lines .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.block-title{font-size:11px;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em;color:${palette.primary};font-weight:800}
    .bill-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.bill-card h3,.info-card h3{font-size:11px;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em;color:${palette.primary}}
    .bill-card{border:1px solid #e5e7eb;padding:10px;min-height:88px}.meta-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e5e7eb}.meta-grid div{padding:7px 9px;border-bottom:1px solid #e5e7eb}.meta-grid div:nth-child(odd){border-right:1px solid #e5e7eb}.meta-grid div:nth-last-child(-n+2){border-bottom:0}.meta-grid span{display:block;color:#71717a;font-size:10px}.meta-grid b{display:block;margin-top:1px}
    table.items{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}table.items th{background:${palette.primary};color:#fff;padding:8px 9px;text-align:left;font-weight:650}table.items td{padding:9px 9px;border-bottom:1px solid #e5e7eb;vertical-align:top}table.items tr:nth-child(even) td{background:#fafafa}.right{text-align:right}.idx{width:34px}.mono{white-space:nowrap}.item-name{font-weight:700;font-size:12px}.item-desc{white-space:pre-line;margin-top:2px}.item-meta{font-size:9.5px;margin-top:2px}.amount{font-weight:800}
    .lower{display:grid;grid-template-columns:1fr 330px;gap:18px;margin-top:10px}.totals{background:${palette.soft};padding:9px 12px}.total-row{display:flex;justify-content:space-between;gap:14px;padding:4px 0}.grand{font-size:14px;border-top:2px solid #d4d4d8;margin-top:3px;padding-top:8px}.due{margin:8px -12px -9px;padding:9px 12px;background:${palette.primary};color:#fff;font-size:14px;font-weight:900}
    .info-card{border:1px solid #e5e7eb;padding:10px;margin-bottom:8px}.bank-card{line-height:1.55}.tax-summary{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:10px;margin-top:6px;color:#52525b}.tax-summary span{color:#71717a}
    .note-block{margin-top:10px;color:#52525b}.note-block h3{font-size:13px;color:#111827;margin:0 0 3px}.signature-card{text-align:right;margin-top:10px;break-inside:avoid}.signature-card img{max-height:48px;max-width:160px;object-fit:contain}.signature-line{height:34px;border-bottom:1px solid #9ca3af;margin-left:auto;width:160px}.qr-card{display:inline-flex;gap:8px;align-items:center;border:1px solid #e5e7eb;padding:6px;margin-top:6px}.qr-card img{width:70px;height:70px}.einv{font-size:9px;border:1px dashed ${palette.primary};padding:6px;margin-top:6px;word-break:break-all}.einv img{width:76px;height:76px}
    .lower{break-inside:avoid}.footer-line{margin-top:10px;border-top:1px solid #e5e7eb;padding-top:5px;color:#71717a;font-size:9px}
  </style>`;

  const standard = `${baseCss}</head><body><main class="page standard">
    <section style="display:grid;grid-template-columns:1fr 1.05fr;gap:26px;align-items:start">
      <div><div class="logo">${logo}</div><div style="margin-top:12px">${sellerBlock}</div></div>
      <div style="text-align:right"><h1 class="doc-title">${title}</h1><div class="doc-subtitle"># ${escapeHtml(invoice.invoice_number || invoice.bill_number || '—')}</div></div>
    </section>
    <section class="bill-grid"><div class="bill-card">${primaryPartyBlock}</div><div>${invoiceMeta}</div></section>
    ${shipToSection}
    ${itemTable}<section class="lower"><div>${bank}${qrBlock}${einvBlock}<div class="note-block"><h3>Amount in Words</h3>${amountWords}</div><div class="note-block"><h3>Notes</h3>${escapeHtml(notes)}</div><div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div></div><div>${totals}${signBlock}</div></section>
    <div class="footer-line">${escapeHtml(legalCompanyName)}${company.gstin ? ` · GSTIN ${escapeHtml(company.gstin)}` : ''}${company.phone ? ` · ${escapeHtml(company.phone)}` : ''}</div>
  </main></body></html>`;

  const simple = `${baseCss}<style>@page{margin:0}.page{padding:0}.hero{background:${palette.accent};color:#fff;padding:24px 34px;display:grid;grid-template-columns:1fr 1fr;align-items:start}.hero .doc-title{color:#fff;font-size:40px}.hero .address,.hero .muted,.hero .business-address,.hero .business-lines,.hero .business-name,.hero .block-title{color:#fff!important}.simple-body{padding:24px 34px}.simple .bill-grid{grid-template-columns:1fr 330px}.simple table.items th{background:#fff;color:#85858b;border-bottom:1px solid #d4d4d8}.simple table.items td{border-bottom:1px solid #e4e4e7}.simple .totals{background:${palette.soft}}.simple .due{background:#dbeafe;color:#111827}</style></head><body><main class="page simple">
    <section class="hero"><div><h1 class="doc-title">${title}</h1></div><div style="text-align:right"><div class="logo" style="display:flex;justify-content:flex-end;margin-bottom:8px">${logo}</div>${sellerBlock}</div></section>
    <section style="background:${palette.soft};padding:10px 34px;text-align:right;font-size:18px">BALANCE DUE <b>₹${fmtPaise(balanceDue)}</b></section>
    <section class="simple-body"><div class="bill-grid"><div>${primaryPartyBlock}${shouldShowShipToBlock ? `<div style="margin-top:24px">${shipToBlock}</div>` : ''}</div>${invoiceMeta}</div>
    ${itemTable}<section class="lower"><div><div class="note-block"><h3>Amount in Words</h3>${amountWords}</div><div class="note-block">${escapeHtml(notes)}</div><div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div>${bank}${qrBlock}${einvBlock}</div><div>${totals}${signBlock}</div></section></section>
  </main></body></html>`;

  const performa = `${baseCss}<style>.performa{font-size:10.5px}.center{text-align:center}.performa .doc-title{font-size:40px;font-weight:800;color:${palette.primary};line-height:1.02;margin-top:6px}.performa .logo img{margin:0 auto;max-width:150px;max-height:82px}.performa .logo-fallback{margin:0 auto;width:64px;height:64px;font-size:30px}.performa .rule{height:2px;background:${palette.primary};margin:8px 0}.performa .bill-card{border:0;text-align:center;min-height:0;padding:4px}.performa .meta-grid div{padding:5px 8px}.performa table.items{margin-top:9px}.performa table.items th{background:#fff;color:${palette.primary};border-bottom:2px solid #e5e7eb;padding:6px 7px}.performa table.items td{border-bottom:1px solid #e5e7eb;padding:6px 7px}.performa .lower{grid-template-columns:1fr 310px;gap:14px;margin-top:8px}.performa .totals{background:#fff;padding:6px 10px}.performa .due{background:#fff;color:${palette.primary};border-top:2px solid ${palette.primary};border-bottom:2px solid ${palette.primary};margin-top:5px}.performa .note-block{margin-top:6px}.performa .signature-card{margin-top:6px}</style></head><body><main class="page performa">
    <section class="center"><div class="logo">${logo}</div><div style="margin-top:10px">${sellerBlock}</div><h1 class="doc-title">${title}</h1></section>
    <div class="rule"></div><section class="bill-card">${primaryPartyBlock}${shouldShowShipToBlock ? `<div style="margin-top:10px">${shipToBlock}</div>` : ''}</section><div class="rule"></div>
    ${invoiceMeta}${itemTable}<section class="lower"><div><div class="note-block"><h3>Amount in Words</h3>${amountWords}</div><div class="note-block"><h3>Notes</h3>${escapeHtml(notes)}</div><div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div>${bank}${qrBlock}${einvBlock}</div><div>${totals}${signBlock}</div></section>
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
    <section class="lower"><div>${einvBlock}<div class="info-card"><h3>Amount in Words</h3>${amountWords}</div>${bank}<div class="info-card"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div></div><div>${totals}${signBlock}</div></section>
    <div class="footer-line">${escapeHtml(notes || 'Thank you for your business.')}</div>
  </main></body></html>`;

  return kind === 'simple' ? simple : kind === 'performa' ? performa : kind === 'monochrome' ? monochrome : standard;
}

export async function generateInvoicePDF(
  invoice: any,
  company: any,
  party: any | null,
  items: any[],
  opts?: { templateOverride?: string },
): Promise<Buffer> {
  const rawKind = String(opts?.templateOverride || invoice.pdf_template || company.invoice_pdf_template || 'monochrome');
  const kind = ['standard', 'simple', 'performa', 'monochrome'].includes(rawKind) ? rawKind : 'monochrome';
  const docTheme = String(invoice.document_theme || company.document_theme || 'executive');

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

  const tpl = buildInvoiceHtml({ invoice, company, party, items, kind, theme: docTheme, logoSrc, signatureSrc, upiQr, einvBlock });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(tpl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await browser.close();
  return Buffer.from(pdf);
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
  const allowed = new Set<string>(BULK_SALES_INVOICE_ALLOWED_COLUMNS as readonly string[]);
  const raw = Array.isArray(input) ? input : [];
  const picked = raw.map((c) => String(c || '').trim()).filter((c) => allowed.has(c));
  const uniq = Array.from(new Set(picked));
  return uniq.length ? uniq : [...BULK_SALES_INVOICE_DEFAULT_COLUMNS];
}

function bulkCellValue(row: any, column: string, serial: number): string {
  if (column === 'serial_no') return String(serial);
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
}): Promise<Buffer> {
  const { company, party, rows, fromDate, toDate } = args;
  const columns = normalizeBulkSalesColumns(args.columns);
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
    .map((col) => `<th class="${BULK_NUMERIC_COLUMNS.has(col) ? 'num' : ''}">${escapeHtml(BULK_COLUMN_LABELS[col] || col)}</th>`)
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
  const taxCells = [
    totalCgst > 0 ? `<div><span>CGST</span><b>${fmtPaise(totalCgst)}</b></div>` : '',
    totalSgst > 0 ? `<div><span>SGST</span><b>${fmtPaise(totalSgst)}</b></div>` : '',
    totalIgst > 0 ? `<div><span>IGST</span><b>${fmtPaise(totalIgst)}</b></div>` : '',
  ].join('');

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
    <h1 class="title">Tax Invoice</h1>
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
        <div>Generated: ${escapeHtml(formatDocDate(new Date().toISOString()))}</div>
        <div>Total lines: ${rows.length}</div>
      </div>
    </section>
    <table>
      <thead><tr>${tableHead}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <section class="footer">
      <div>
        <div class="words"><b>Invoice Amount in Words:</b> ${escapeHtml(amountToWordsINR(totalAmount))}</div>
        <div class="terms"><b>Terms and Conditions</b><br/>${multilineHtml(company.terms_and_conditions || 'Thank you for your business.')}</div>
      </div>
      <div class="totals">
        ${qtyTotalCell}
        ${discountCell}
        <div><span>Taxable</span><b>${fmtPaise(totalTaxable)}</b></div>
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

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await browser.close();
  return Buffer.from(pdf);
}

export async function generateThermalReceipt(
  invoice: any,
  company: any,
  items: any[],
  widthMm: 58 | 80 = 80,
): Promise<Buffer> {
  const paperW = widthMm === 58 ? '58mm' : '72mm';
  let tpl = readTpl('thermal/receipt_80mm.html');
  const rows = items
    .map((it) => {
      const name = escapeHtml(String(it.item_name || '').slice(0, 24));
      return `<div class="row"><span style="max-width:70%">${name}</span></div>
        <div class="row"><span>${it.quantity} x ₹${fmtPaise(it.unit_price)}</span><span>₹${fmtPaise(it.total_amount)}</span></div>`;
    })
    .join('');

  const cgst = invoice.cgst_amount || 0;
  const sgst = invoice.sgst_amount || 0;
  const igst = invoice.igst_amount || 0;
  const rateGuess = items[0]?.gst_rate || 0;

  let barcodePng = '';
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: invoice.invoice_number,
      scale: 2,
      height: 8,
      includetext: false,
    });
    barcodePng = `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    barcodePng = '';
  }

  let upiQr = '';
  if (company.upi_id && invoice.payment_mode === 'upi') {
    const upiPayload = `upi://pay?pa=${encodeURIComponent(company.upi_id)}&pn=${encodeURIComponent(companyLegalDisplayName(company))}&cu=INR`;
    upiQr = await QRCode.toDataURL(upiPayload, { width: 160, margin: 0 });
  }

  const paid = invoice.paid_amount || 0;
  const change = paid > invoice.total_amount ? paid - invoice.total_amount : 0;

  const vars: Record<string, string> = {
    PAPER_WIDTH: paperW,
    COMPANY_NAME: escapeHtml(companyLegalDisplayName(company)),
    COMPANY_ADDRESS: escapeHtml(company.registered_address || ''),
    CITY_STATE_PIN: escapeHtml([company.city, company.state, company.pincode].filter(Boolean).join(', ')),
    GSTIN: escapeHtml(company.gstin || '—'),
    PHONE: escapeHtml(company.phone || '—'),
    INVOICE_NUMBER: escapeHtml(invoice.invoice_number),
    DATE: escapeHtml(String(invoice.invoice_date)),
    TIME: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
    PARTY_NAME: escapeHtml(invoice.party_name_snapshot || 'Walk-in Customer'),
    ITEM_LINES: rows,
    SUBTOTAL: fmtPaise(invoice.subtotal),
    DISCOUNT: fmtPaise(invoice.discount_amount || 0),
    CGST_LINE:
      cgst > 0 ? `<div class="row"><span>CGST @ ${rateGuess}%</span><span>₹${fmtPaise(cgst)}</span></div>` : '',
    SGST_LINE:
      sgst > 0 ? `<div class="row"><span>SGST @ ${rateGuess}%</span><span>₹${fmtPaise(sgst)}</span></div>` : '',
    IGST_LINE:
      igst > 0 ? `<div class="row"><span>IGST</span><span>₹${fmtPaise(igst)}</span></div>` : '',
    TOTAL: fmtPaise(invoice.total_amount),
    PAYMENT_MODE: escapeHtml(invoice.payment_mode || 'cash'),
    PAID: fmtPaise(paid),
    CHANGE_LINE:
      change > 0 ? `<div class="row"><span>Change</span><span>₹${fmtPaise(change)}</span></div>` : '',
    UPI_QR_BLOCK: upiQr
      ? `<div class="qr"><p>UPI</p><img src="${upiQr}" width="140" height="140" alt="UPI"/></div>`
      : '',
    FOOTER_MSG: escapeHtml(company.receipt_footer_message || 'Thank you for your business!'),
    BARCODE_IMG: barcodePng ? `<div class="bc"><img src="${barcodePng}" alt="barcode"/></div>` : '',
  };

  tpl = replaceAll(tpl, vars);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: Math.round((widthMm / 25.4) * 96), height: 1200, deviceScaleFactor: 2 });
  await page.setContent(tpl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const pdf = await page.pdf({
    width: `${widthMm}mm`,
    height: '297mm',
    printBackground: true,
    margin: { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' },
  });
  await browser.close();
  return Buffer.from(pdf);
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

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return Buffer.from(pdf);
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
  const theme = String(quotation.document_theme || company.document_theme || 'executive');
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

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await browser.close();
  return Buffer.from(pdf);
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
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return Buffer.from(pdf);
}
