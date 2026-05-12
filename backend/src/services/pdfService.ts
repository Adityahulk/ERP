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

function companyAddress(company: any): string {
  const line1 = company.registered_address || company.gstin_address || company.address || '';
  const line2 = [company.city, company.state, company.pincode].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(', ');
}

/** Build the buyer address from a party — prefers `billing_*` fields but falls back to legacy `city/state/pincode`. */
function buyerAddress(party: any): string {
  if (!party) return '';
  const city = party.billing_city || party.city || '';
  const state = party.billing_state || party.state || '';
  const pincode = party.billing_pincode || party.pincode || '';
  return [party.billing_address, city, state, pincode].filter(Boolean).join(', ');
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
    .split(/\n|,\s*/)
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
      const meta = [
        it.unit ? `Unit: ${it.unit}` : '',
        Number(it.gst_rate || 0) ? `GST: ${it.gst_rate}%` : '',
      ].filter(Boolean).join(' · ');
      const tax = Number(it.cgst_amount || 0) + Number(it.sgst_amount || 0) + Number(it.igst_amount || 0);
      return `<tr>
        <td class="idx">${i + 1}</td>
        <td>
          <div class="item-name">${name}</div>
          ${desc ? `<div class="item-desc">${desc}</div>` : ''}
          ${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ''}
        </td>
        <td class="mono">${escapeHtml(it.hsn_code || '')}</td>
        <td class="right">
          <b>${fmtQty(it.quantity)}</b>
          ${it.unit ? `<div class="item-meta">${escapeHtml(it.unit)}</div>` : ''}
        </td>
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
  const sellerName = isPurchase ? (party?.name || invoice.party_name_snapshot || 'Supplier') : (company.name || '');
  const buyerName = isPurchase ? (company.name || '') : (party?.name || invoice.party_name_snapshot || 'Walk-in Customer');
  const sellerGstin = isPurchase ? (party?.gstin || invoice.party_gstin_snapshot || '') : (company.gstin || '');
  const buyerGstin = isPurchase ? (company.gstin || '') : (party?.gstin || invoice.party_gstin_snapshot || '');
  const sellerAddr = isPurchase ? (party ? buyerAddress(party) : invoice.billing_address_snapshot || '') : companyAddress(company);
  const buyerAddr = isPurchase ? companyAddress(company) : (party ? buyerAddress(party) : invoice.billing_address_snapshot || '');
  const shipAddr = invoice.shipping_address_snapshot || party?.shipping_address || buyerAddr;
  const primaryPartyName = isPurchase ? sellerName : buyerName;
  const primaryPartyGstin = isPurchase ? sellerGstin : buyerGstin;
  const primaryPartyAddr = isPurchase ? sellerAddr : buyerAddr;
  const amountWords = escapeHtml(amountToWordsINR(Math.round(Number(invoice.total_amount || 0) / 100)));
  const balanceDue = Number(invoice.balance_due ?? Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0)));
  const terms = String(invoice.terms_and_conditions || company.terms_and_conditions || 'Thank you for your business.').trim();
  const notes = String(invoice.notes || company.invoice_notes || 'Thanks for your business.').trim();
  const logo = logoSrc ? `<img src="${logoSrc}" alt="${escapeHtml(company.name || 'Logo')}"/>` : `<div class="logo-fallback">${escapeHtml((company.name || 'M').slice(0, 1))}</div>`;
  const signature = signatureSrc
    ? `<img src="${signatureSrc}" alt="Signature" />`
    : '<div class="signature-line"></div>';
  const qrBlock = upiQr ? `<div class="qr-card"><img src="${upiQr}" alt="UPI QR"/><span>Scan to pay</span></div>` : '';
  const invoiceMeta = `
    <div class="meta-grid">
      <div><span>Invoice#</span><b>${escapeHtml(invoice.invoice_number || invoice.bill_number || '—')}</b></div>
      <div><span>Invoice Date</span><b>${formatDocDate(invoice.invoice_date || invoice.bill_date)}</b></div>
      <div><span>Due Date</span><b>${formatDocDate(invoice.due_date)}</b></div>
      <div><span>Place of Supply</span><b>${escapeHtml(invoice.place_of_supply || company.state_code || '—')}</b></div>
    </div>`;
  const gstSummary = `
    <div class="tax-summary">
      <div>${fieldLine('Seller GSTIN', sellerGstin, 'mono-line')}</div>
      <div>${fieldLine('Buyer GSTIN', buyerGstin, 'mono-line')}</div>
      <div>${fieldLine('Company Phone', company.phone)}</div>
      <div>${fieldLine('Company Email', company.email)}</div>
    </div>`;
  const bank = `<div class="info-card bank-card"><h3>Bank Details</h3>${bankBlock(company)}</div>`;
  const signBlock = `<div class="signature-card"><p>For <b>${escapeHtml(company.name || '')}</b></p>${signature}<p>Authorised Signatory</p></div>`;
  const itemsHead = `<thead><tr><th>#</th><th>Item & Description</th><th>HSN/SAC</th><th class="right">Qty</th><th class="right">Rate</th>${kind === 'simple' ? '' : '<th class="right">Tax</th>'}<th class="right">Amount</th></tr></thead>`;
  const itemTable = `<table class="items">${itemsHead}<tbody>${invoiceItemRows(items, kind)}</tbody></table>`;
  const totals = `<div class="totals">${totalsRows(invoice)}<div class="grand total-row"><span>Total</span><b>₹${fmtPaise(Number(invoice.total_amount || 0))}</b></div><div class="due total-row"><span>Balance Due</span><b>₹${fmtPaise(balanceDue)}</b></div></div>`;

  const baseCss = `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page{size:A4;margin:8mm}
    *{box-sizing:border-box}
    body{margin:0;color:${palette.ink};font-family:Inter,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.34;background:#fff}
    .page{min-height:281mm;padding:8px 14px;position:relative}
    .muted,.item-desc,.item-meta{color:#71717a}.mono,.mono-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .logo img{max-width:112px;max-height:66px;object-fit:contain;display:block}.logo-fallback{width:58px;height:58px;border-radius:50%;background:${palette.primary};color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900}
    .doc-title{font-size:38px;letter-spacing:.08em;font-weight:300;color:${palette.primary};margin:0}.doc-subtitle{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}
    .company-name,.party-name{font-size:15px;font-weight:800;color:${palette.accent}}.address{color:#52525b}.gst{font-size:10px;margin-top:3px}
    .bill-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.bill-card h3,.info-card h3{font-size:11px;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em;color:${palette.primary}}
    .bill-card{border:1px solid #e5e7eb;padding:10px;min-height:88px}.meta-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e5e7eb}.meta-grid div{padding:7px 9px;border-bottom:1px solid #e5e7eb}.meta-grid div:nth-child(odd){border-right:1px solid #e5e7eb}.meta-grid div:nth-last-child(-n+2){border-bottom:0}.meta-grid span{display:block;color:#71717a;font-size:10px}.meta-grid b{display:block;margin-top:1px}
    table.items{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}table.items th{background:${palette.primary};color:#fff;padding:8px 9px;text-align:left;font-weight:650}table.items td{padding:9px 9px;border-bottom:1px solid #e5e7eb;vertical-align:top}table.items tr:nth-child(even) td{background:#fafafa}.right{text-align:right}.idx{width:34px}.mono{white-space:nowrap}.item-name{font-weight:700;font-size:12px}.item-desc{white-space:pre-line;margin-top:2px}.item-meta{font-size:9.5px;margin-top:2px}.amount{font-weight:800}
    .lower{display:grid;grid-template-columns:1fr 330px;gap:18px;margin-top:10px}.totals{background:${palette.soft};padding:9px 12px}.total-row{display:flex;justify-content:space-between;gap:14px;padding:4px 0}.grand{font-size:14px;border-top:2px solid #d4d4d8;margin-top:3px;padding-top:8px}.due{margin:8px -12px -9px;padding:9px 12px;background:${palette.primary};color:#fff;font-size:14px;font-weight:900}
    .info-card{border:1px solid #e5e7eb;padding:10px;margin-bottom:8px}.bank-card{line-height:1.55}.tax-summary{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:10px;margin-top:6px;color:#52525b}.tax-summary span{color:#71717a}
    .note-block{margin-top:10px;color:#52525b}.note-block h3{font-size:13px;color:#111827;margin:0 0 3px}.signature-card{text-align:right;margin-top:10px;break-inside:avoid}.signature-card img{max-height:48px;max-width:160px;object-fit:contain}.signature-line{height:34px;border-bottom:1px solid #9ca3af;margin-left:auto;width:160px}.qr-card{display:inline-flex;gap:8px;align-items:center;border:1px solid #e5e7eb;padding:6px;margin-top:6px}.qr-card img{width:70px;height:70px}.einv{font-size:9px;border:1px dashed ${palette.primary};padding:6px;margin-top:6px;word-break:break-all}.einv img{width:76px;height:76px}
    .footer-line{position:absolute;left:14px;right:14px;bottom:6px;border-top:1px solid #e5e7eb;padding-top:5px;color:#71717a;font-size:9px}
  </style>`;

  const standard = `${baseCss}</head><body><main class="page standard">
    <section style="display:grid;grid-template-columns:1fr 1.05fr;gap:26px;align-items:start">
      <div><div class="logo">${logo}</div><div class="company-name" style="margin-top:12px">${escapeHtml(company.name || '')}</div><div class="address">${addressHtml(companyAddress(company))}</div>${fieldLine('GSTIN', company.gstin, 'gst mono')}</div>
      <div style="text-align:right"><h1 class="doc-title">${title}</h1><div class="doc-subtitle"># ${escapeHtml(invoice.invoice_number || invoice.bill_number || '—')}</div><div style="font-size:13px;margin-top:28px">Balance Due</div><div style="font-size:24px;font-weight:900">₹${fmtPaise(balanceDue)}</div></div>
    </section>
    <section class="bill-grid"><div class="bill-card"><h3>${isPurchase ? 'Bill From' : 'Bill To'}</h3><div class="party-name">${escapeHtml(primaryPartyName)}</div><div class="address">${addressHtml(primaryPartyAddr)}</div>${fieldLine('GSTIN', primaryPartyGstin, 'gst mono')}</div><div>${invoiceMeta}</div></section>
    <section class="bill-grid" style="margin-top:0"><div class="bill-card"><h3>${isPurchase ? 'Bill To' : 'Ship To'}</h3><div class="address">${addressHtml(isPurchase ? buyerAddr : shipAddr)}</div></div><div>${gstSummary}</div></section>
    ${itemTable}<section class="lower"><div>${bank}${qrBlock}${einvBlock}<div class="note-block"><h3>Amount in Words</h3>${amountWords}</div><div class="note-block"><h3>Notes</h3>${escapeHtml(notes)}</div><div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div></div><div>${totals}${signBlock}</div></section>
    <div class="footer-line">${escapeHtml(company.name || '')}${company.gstin ? ` · GSTIN ${escapeHtml(company.gstin)}` : ''}${company.phone ? ` · ${escapeHtml(company.phone)}` : ''}</div>
  </main></body></html>`;

  const simple = `${baseCss}<style>@page{margin:0}.page{padding:0}.hero{background:${palette.accent};color:#fff;padding:24px 34px;display:grid;grid-template-columns:1fr 1fr;align-items:start}.hero .doc-title{color:#fff;font-size:40px}.hero .address,.hero .muted{color:#e5e7eb}.simple-body{padding:24px 34px}.simple .bill-grid{grid-template-columns:1fr 330px}.simple table.items th{background:#fff;color:#85858b;border-bottom:1px solid #d4d4d8}.simple table.items td{border-bottom:1px solid #e4e4e7}.simple .totals{background:${palette.soft}}.simple .due{background:#dbeafe;color:#111827}</style></head><body><main class="page simple">
    <section class="hero"><div><h1 class="doc-title">${title}</h1></div><div style="text-align:right"><div class="logo" style="display:flex;justify-content:flex-end;margin-bottom:8px">${logo}</div><div class="company-name" style="color:#fff">${escapeHtml(company.name || '')}</div><div class="address">${addressHtml(companyAddress(company))}</div>${fieldLine('GSTIN', company.gstin, 'gst mono')}</div></section>
    <section style="background:${palette.soft};padding:10px 34px;text-align:right;font-size:18px">BALANCE DUE <b>₹${fmtPaise(balanceDue)}</b></section>
    <section class="simple-body"><div class="bill-grid"><div><div class="party-name">${escapeHtml(primaryPartyName)}</div><div class="address">${addressHtml(primaryPartyAddr)}</div>${fieldLine('GSTIN', primaryPartyGstin, 'gst mono')}<div style="margin-top:24px"><h3>${isPurchase ? 'Bill To' : 'Ship To'}</h3><div class="address">${addressHtml(isPurchase ? buyerAddr : shipAddr)}</div></div></div>${invoiceMeta}</div>
    ${itemTable}<section class="lower"><div><div class="note-block"><h3>Amount in Words</h3>${amountWords}</div><div class="note-block">${escapeHtml(notes)}</div><div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div>${bank}${qrBlock}${einvBlock}</div><div>${totals}${signBlock}</div></section></section>
  </main></body></html>`;

  const performa = `${baseCss}<style>.center{text-align:center}.performa .doc-title{font-size:48px;font-weight:800;color:${palette.primary};line-height:1.05;margin-top:8px}.performa .logo img{margin:0 auto}.performa .logo-fallback{margin:0 auto;width:52px;height:52px;font-size:26px}.performa .rule{height:2px;background:${palette.primary};margin:12px 0}.performa .bill-card{border:0;text-align:center;min-height:0;padding:6px}.performa table.items{margin-top:12px}.performa table.items th{background:#fff;color:${palette.primary};border-bottom:2px solid #e5e7eb}.performa table.items td{border-bottom:1px solid #e5e7eb}.performa .totals{background:#fff}.performa .due{background:#fff;color:${palette.primary};border-top:2px solid ${palette.primary};border-bottom:2px solid ${palette.primary}}</style></head><body><main class="page performa">
    <section class="center"><div class="logo">${logo}</div><div class="company-name" style="margin-top:10px">${escapeHtml(company.name || '')}</div><div class="address">${addressHtml(companyAddress(company))}</div>${fieldLine('GSTIN', company.gstin, 'gst mono')}<h1 class="doc-title">${title}</h1></section>
    <div class="rule"></div><section class="bill-card"><h3>Bill To</h3><div class="party-name">${escapeHtml(buyerName)}</div><div class="address">${addressHtml(buyerAddr)}</div>${fieldLine('GSTIN', buyerGstin, 'gst mono')}</section><div class="rule"></div>
    ${invoiceMeta}${itemTable}<section class="lower"><div><div class="note-block"><h3>Amount in Words</h3>${amountWords}</div><div class="note-block"><h3>Notes</h3>${escapeHtml(notes)}</div><div class="note-block"><h3>Terms & Conditions</h3>${escapeHtml(terms)}</div>${bank}${qrBlock}${einvBlock}</div><div>${totals}${signBlock}</div></section>
  </main></body></html>`;

  return kind === 'simple' ? simple : kind === 'performa' ? performa : standard;
}

export async function generateInvoicePDF(
  invoice: any,
  company: any,
  party: any | null,
  items: any[],
  opts?: { templateOverride?: string },
): Promise<Buffer> {
  const rawKind = String(opts?.templateOverride || invoice.pdf_template || company.invoice_pdf_template || 'standard');
  const kind = ['standard', 'simple', 'performa'].includes(rawKind) ? rawKind : 'standard';
  const docTheme = String(invoice.document_theme || company.document_theme || 'classic');

  const upi = company.upi_id || invoice.upi_id_snapshot || '';
  let upiQr = '';
  if (upi) {
    const upiPayload = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(company.name)}&am=${(invoice.total_amount / 100).toFixed(2)}&cu=INR`;
    upiQr = await QRCode.toDataURL(upiPayload, { width: 160, margin: 1 });
  }

  let einvBlock = '';
  if (kind !== 'performa' && invoice.irn) {
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
    const upiPayload = `upi://pay?pa=${encodeURIComponent(company.upi_id)}&pn=${encodeURIComponent(company.name)}&cu=INR`;
    upiQr = await QRCode.toDataURL(upiPayload, { width: 160, margin: 0 });
  }

  const paid = invoice.paid_amount || 0;
  const change = paid > invoice.total_amount ? paid - invoice.total_amount : 0;

  const vars: Record<string, string> = {
    PAPER_WIDTH: paperW,
    COMPANY_NAME: escapeHtml(company.name || ''),
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
  const sellerAddress = companyAddress(company);
  const buyerAddressText = invoice.billing_address_snapshot || buyerAddress(party);
  const primary = String(company.document_primary_color || '#174EA6');
  const rows = items.map((it, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td><b>${escapeHtml(it.item_name || '')}</b>${it.item_description ? `<div class="muted small">${multilineHtml(it.item_description)}</div>` : ''}</td>
    <td class="mono center">${escapeHtml(it.hsn_code || '—')}</td>
    <td class="right">${Number(it.quantity) || 0}</td>
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
    .company{font-size:18px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.box{border:1px solid #d9e2ec;border-radius:8px;padding:12px;min-height:96px}
    .box h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:${escapeHtml(primary)};letter-spacing:.04em}.kv{display:grid;grid-template-columns:92px 1fr;gap:6px}.irn{word-break:break-all;line-height:1.45}
    .qrbox{display:flex;gap:12px;align-items:center;border:1px solid #d9e2ec;border-radius:8px;padding:10px;margin-top:12px}.qrbox img{width:132px;height:132px;object-fit:contain}
    table{width:100%;border-collapse:collapse;margin-top:14px}th{background:${escapeHtml(primary)};color:#fff;padding:8px;text-align:left;font-size:11px}td{border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top}
    .right{text-align:right}.center{text-align:center}.totals{display:grid;grid-template-columns:1fr 310px;gap:18px;margin-top:12px}.totals table{margin-top:0}.totals td{padding:7px;border-bottom:1px solid #e5e7eb}.grand td{font-size:15px;font-weight:800;color:#111827}
    .seal{margin-top:12px;padding:10px;border-radius:8px;background:#eef6ff;color:#174a7c}.footer{margin-top:16px;border-top:1px solid #e5e7eb;padding-top:10px;color:#667085}
  </style></head><body>
    <section class="top">
      <div class="brand">${logoSrc ? `<img class="logo" src="${logoSrc}" />` : ''}<div><div class="company">${escapeHtml(company.legal_name || company.name || '')}</div><div class="muted">${addressHtml(sellerAddress)}</div><div class="small"><b>GSTIN:</b> <span class="mono">${escapeHtml(company.gstin || '—')}</span>${company.email ? ` · ${escapeHtml(company.email)}` : ''}${company.phone ? ` · ${escapeHtml(company.phone)}` : ''}</div></div></div>
      <div class="title"><h1>e-INVOICE</h1><div class="muted">Government registered tax invoice</div></div>
    </section>
    <section class="grid">
      <div class="box"><h3>Bill To</h3><b>${escapeHtml(invoice.party_name_snapshot || party?.name || 'Customer')}</b><div class="muted">${addressHtml(buyerAddressText)}</div><div class="small"><b>GSTIN:</b> <span class="mono">${escapeHtml(invoice.party_gstin_snapshot || party?.gstin || 'URP')}</span></div></div>
      <div class="box"><h3>Invoice Details</h3><div class="kv"><span>Invoice No</span><b>${escapeHtml(invoice.invoice_number || '')}</b><span>Date</span><b>${formatDocDate(invoice.invoice_date)}</b><span>Ack No</span><b>${escapeHtml(invoice.ack_number || '—')}</b><span>Ack Date</span><b>${escapeHtml(ackDate && !Number.isNaN(ackDate.getTime()) ? ackDate.toLocaleString('en-IN') : String(invoice.ack_date || '—'))}</b></div></div>
    </section>
    <section class="qrbox"><img src="${qr}" alt="Signed QR Code" /><div><h3 style="margin:0 0 6px;color:${escapeHtml(primary)}">IRN</h3><div class="mono irn">${escapeHtml(invoice.irn || '')}</div><div class="seal small">Scan the QR code to verify the signed e-invoice details from IRP.</div></div></section>
    <table><thead><tr><th class="center">#</th><th>Item</th><th class="center">HSN/SAC</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">GST</th><th class="right">Taxable</th><th class="right">Total</th></tr></thead><tbody>${rows}</tbody></table>
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
  const theme = String(quotation.document_theme || company.document_theme || 'classic');
  const logoSrc = inlineAssetAsDataUri(company.logo_url) || resolveAssetUrl(company.logo_url);
  const signatureSrc = inlineAssetAsDataUri(company.signature_url) || resolveAssetUrl(company.signature_url);
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" style="max-height:72px;display:block;margin-bottom:8px" alt="${escapeHtml(company.name || 'Logo')}" />`
    : '';
  const signatureBlock = signatureSrc
    ? `<div style="text-align:right;margin-top:26px"><p style="margin:0 0 6px">For <b>${escapeHtml(company.name || '')}</b></p><img src="${signatureSrc}" style="max-height:52px"/><p style="margin:6px 0 0">Authorised Signatory</p></div>`
    : `<div style="text-align:right;margin-top:26px"><p>For <b>${escapeHtml(company.name || '')}</b></p><p>Authorised Signatory</p></div>`;

  let html = `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body{font-family:Arial,sans-serif;color:#111;padding:16px}
    .row{display:flex;justify-content:space-between;align-items:flex-start}
    .muted{color:#666;font-size:12px}
    h1{font-size:20px;margin:0}
    .header{background:${escapeHtml(primaryColor)};color:#fff;padding:16px 18px;border-radius:8px}
    .header .muted{color:rgba(255,255,255,.82)}
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
        <p class="muted">${escapeHtml(company.name || '')}</p>
        <p class="muted">${escapeHtml(company.registered_address || '')}</p>
        <p class="muted">GSTIN ${escapeHtml(company.gstin || '—')} · ${escapeHtml(company.phone || company.email || '—')}</p>
      </div>
      <div style="text-align:right">
        <p><b>Quote No:</b> ${escapeHtml(quotation.quotation_number || '')}</p>
        <p><b>Date:</b> ${escapeHtml(String(quotation.quotation_date || ''))}</p>
        <p><b>Valid Until:</b> ${escapeHtml(String(quotation.valid_until || '—'))}</p>
      </div>
    </div>
    <div class="grid2">
      <div class="box">
        <b>Seller</b>
        <p style="margin:6px 0 0">${escapeHtml(company.name || '')}</p>
        <p class="muted" style="margin:4px 0">${escapeHtml(company.registered_address || '')}</p>
        <p class="muted" style="margin:4px 0">${escapeHtml([company.city, company.state, company.pincode].filter(Boolean).join(', '))}</p>
        <p class="muted" style="margin:4px 0">GSTIN: ${escapeHtml(company.gstin || '—')}</p>
      </div>
      <div class="box">
        <b>Buyer</b>
        <p style="margin:6px 0 0">${escapeHtml(quotation.party_name_override || party?.name || 'Customer')}</p>
        <p class="muted" style="margin:4px 0">${escapeHtml(quotation.party_email_override || party?.email || '')} ${escapeHtml(quotation.party_phone_override || party?.phone || '')}</p>
        <p class="muted" style="margin:4px 0">${escapeHtml(buyerAddr || '—')}</p>
        <p class="muted" style="margin:4px 0">GSTIN: ${escapeHtml(party?.gstin || '—')}</p>
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
