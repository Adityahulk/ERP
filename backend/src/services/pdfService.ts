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

function themeStyle(theme: string): string {
  if (theme === 'modern') {
    return `<style>
      body{font-family:Inter,Segoe UI,Arial,sans-serif}
      .inv-card,.panel,.box{border-radius:12px}
      table th{background:#eef2ff}
    </style>`;
  }
  if (theme === 'compact') {
    return `<style>
      body{font-size:12px}
      table th,table td{padding:4px 6px}
      .section,.inv-card,.panel{margin-bottom:6px}
    </style>`;
  }
  return '';
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
}

function itemRowsStandard(items: any[]): string {
  return items
    .map(
      (it, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.item_name || '')}</td>
      <td class="mono">${escapeHtml(it.hsn_code || '—')}</td>
      <td class="right">${it.quantity}</td>
      <td class="right">${fmtPaise(it.unit_price)}</td>
      <td class="right">${fmtPaise(it.discount_amount || 0)}</td>
      <td class="right">${fmtPaise(it.taxable_amount)}</td>
      <td class="right">${it.gst_rate || 0}%</td>
      <td class="right">${fmtPaise(it.cgst_amount)}</td>
      <td class="right">${fmtPaise(it.sgst_amount + it.igst_amount)}</td>
      <td class="right"><b>${fmtPaise(it.total_amount)}</b></td>
    </tr>`,
    )
    .join('');
}

function itemRowsSimple(items: any[]): string {
  return items
    .map(
      (it, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.item_name || '')}</td>
      <td class="right">${it.quantity}</td>
      <td class="right">${fmtPaise(it.unit_price)}</td>
      <td class="right"><b>${fmtPaise(it.total_amount)}</b></td>
    </tr>`,
    )
    .join('');
}

function itemRowsPerforma(items: any[]): string {
  return items
    .map(
      (it, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.item_name || '')}</td>
      <td class="mono">${escapeHtml(it.hsn_code || '—')}</td>
      <td class="right">${it.quantity}</td>
      <td class="right">${fmtPaise(it.unit_price)}</td>
      <td class="right"><b>${fmtPaise(it.total_amount)}</b></td>
    </tr>`,
    )
    .join('');
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function generateInvoicePDF(
  invoice: any,
  company: any,
  party: any | null,
  items: any[],
  opts?: { templateOverride?: string },
): Promise<Buffer> {
  const kind = (opts?.templateOverride || company.invoice_pdf_template || 'standard') as string;
  const tplName =
    kind === 'simple'
      ? 'invoices/template_simple.html'
      : kind === 'performa'
        ? 'invoices/template_performa.html'
        : 'invoices/template_standard.html';

  let tpl = readTpl(tplName);
  const color = company.document_primary_color || '#4F46E5';
  const docTheme = String(invoice.document_theme || company.document_theme || 'classic');
  const itemRows =
    kind === 'simple' ? itemRowsSimple(items) : kind === 'performa' ? itemRowsPerforma(items) : itemRowsStandard(items);

  const upi = company.upi_id || '';
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

  const buyerAddr = party
    ? [party.billing_address, party.billing_city, party.billing_state, party.billing_pincode].filter(Boolean).join(', ')
    : invoice.billing_address_snapshot || '';

  const vars: Record<string, string> = {
    PRIMARY_COLOR: color,
    COMPANY_NAME: escapeHtml(company.name || ''),
    COMPANY_ADDRESS: escapeHtml(company.registered_address || ''),
    COMPANY_CITY_STATE_PIN: escapeHtml([company.city, company.state, company.pincode].filter(Boolean).join(', ')),
    COMPANY_GSTIN: escapeHtml(company.gstin || ''),
    COMPANY_PHONE: escapeHtml(company.phone || ''),
    LOGO_BLOCK: company.logo_url ? `<img src="${escapeHtml(resolveAssetUrl(company.logo_url))}" style="max-height:56px"/>` : '',
    INVOICE_NUMBER: escapeHtml(invoice.invoice_number),
    INVOICE_DATE: escapeHtml(String(invoice.invoice_date)),
    DUE_DATE: invoice.due_date ? escapeHtml(String(invoice.due_date)) : '—',
    BUYER_NAME: escapeHtml(party?.name || invoice.party_name_snapshot || 'Walk-in Customer'),
    BUYER_GSTIN: escapeHtml(party?.gstin || invoice.party_gstin_snapshot || '—'),
    BUYER_ADDRESS: escapeHtml(buyerAddr),
    PLACE_OF_SUPPLY: escapeHtml(invoice.place_of_supply || company.state_code || '—'),
    ITEM_ROWS: itemRows,
    SUBTOTAL: fmtPaise(invoice.subtotal),
    DISCOUNT: fmtPaise(invoice.discount_amount || 0),
    TAXABLE: fmtPaise(invoice.taxable_amount),
    CGST: fmtPaise(invoice.cgst_amount),
    SGST: fmtPaise(invoice.sgst_amount),
    IGST: fmtPaise(invoice.igst_amount),
    ROUND_OFF: fmtPaise(invoice.round_off || 0),
    GRAND_TOTAL: fmtPaise(invoice.total_amount),
    AMOUNT_WORDS: escapeHtml(amountToWordsINR(Math.round(invoice.total_amount / 100))),
    BANK_LINES: escapeHtml(
      [company.bank_name, company.bank_account_number, company.bank_ifsc, company.bank_branch].filter(Boolean).join(' | '),
    ),
    UPI_QR_IMG: upiQr ? `<img src="${upiQr}" style="width:120px;height:120px" alt="UPI"/>` : '',
    EINVOICE_BLOCK: einvBlock,
    TERMS: escapeHtml((company.terms_and_conditions || '').split('\n').slice(0, 3).join(' ')),
    SIGNATURE_BLOCK: company.signature_url
      ? `<div class="sign"><p>For <b>${escapeHtml(company.name)}</b></p><img src="${escapeHtml(resolveAssetUrl(company.signature_url))}" style="max-height:48px"/><p>Authorised Signatory</p></div>`
      : `<div class="sign"><p>For <b>${escapeHtml(company.name)}</b></p><p>Authorised Signatory</p></div>`,
  };

  tpl = replaceAll(tpl, vars);
  const extraThemeStyle = themeStyle(docTheme);
  if (extraThemeStyle) {
    tpl = tpl.replace('</head>', `${extraThemeStyle}</head>`);
  }
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(tpl, { waitUntil: 'networkidle0' });
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
  await page.setContent(tpl, { waitUntil: 'networkidle0' });
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
  const qr = invoice.qr_code_url
    ? invoice.qr_code_url.startsWith('http') || invoice.qr_code_url.startsWith('data:')
      ? invoice.qr_code_url
      : `${env.FRONTEND_URL}${invoice.qr_code_url}`
    : await QRCode.toDataURL(JSON.stringify({ irn: invoice.irn, no: invoice.invoice_number }), { width: 180 });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px} .muted{color:#555;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px;text-align:left}
    th{background:#f3f4f6}
    .right{text-align:right}.mono{font-family:monospace}
  </style></head><body>
    <h1>e-Invoice</h1>
    <p class="muted">${escapeHtml(company.name)} &middot; GSTIN ${escapeHtml(company.gstin || '')}</p>
    <p><b>IRN:</b> <span class="mono">${escapeHtml(invoice.irn || '')}</span></p>
    <p><b>ACK:</b> ${escapeHtml(invoice.ack_number || '')} &nbsp; <b>Ack Date:</b> ${escapeHtml(String(invoice.ack_date || ''))}</p>
    <p><b>Invoice:</b> ${escapeHtml(invoice.invoice_number)} &nbsp; <b>Date:</b> ${escapeHtml(String(invoice.invoice_date))}</p>
    <p><b>Buyer:</b> ${escapeHtml(party?.name || invoice.party_name_snapshot || '')}</p>
    <img src="${qr}" width="180" height="180" alt="QR"/>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Taxable</th><th>Total</th></tr></thead><tbody>
    ${items
      .map(
        (it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.item_name)}</td><td class="mono">${escapeHtml(it.hsn_code || '')}</td>
      <td class="right">${it.quantity}</td><td class="right">${fmtPaise(it.taxable_amount)}</td><td class="right">${fmtPaise(it.total_amount)}</td></tr>`,
      )
      .join('')}
    </tbody></table>
    <p style="margin-top:16px"><b>Grand Total:</b> ₹${fmtPaise(invoice.total_amount)} (${escapeHtml(amountToWordsINR(Math.round(invoice.total_amount / 100)))})</p>
  </body></html>`;

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
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
  const buyerAddr = party
    ? [party.billing_address, party.billing_city, party.billing_state, party.billing_pincode].filter(Boolean).join(', ')
    : '';
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

  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    body{font-family:Arial,sans-serif;color:#111;padding:16px}
    .row{display:flex;justify-content:space-between;align-items:flex-start}
    .muted{color:#666;font-size:12px}
    h1{font-size:20px;margin:0}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
    th,td{border:1px solid #ddd;padding:6px}
    th{background:#f7f7f7}.right{text-align:right}.mono{font-family:monospace}
    .totals{margin-top:12px;display:flex;justify-content:flex-end}
    .totals table{width:320px}
  </style></head><body>
    <div class="row">
      <div>
        <h1>Quotation</h1>
        <p class="muted">${escapeHtml(company.name || '')}</p>
        <p class="muted">${escapeHtml(company.registered_address || '')}</p>
      </div>
      <div style="text-align:right">
        <p><b>Quote No:</b> ${escapeHtml(quotation.quotation_number || '')}</p>
        <p><b>Date:</b> ${escapeHtml(String(quotation.quotation_date || ''))}</p>
        <p><b>Valid Until:</b> ${escapeHtml(String(quotation.valid_until || '—'))}</p>
      </div>
    </div>
    <hr />
    <p><b>Customer:</b> ${escapeHtml(quotation.party_name_override || party?.name || 'Customer')}</p>
    <p class="muted">${escapeHtml(quotation.party_email_override || party?.email || '')} ${escapeHtml(quotation.party_phone_override || party?.phone || '')}</p>
    <p class="muted">${escapeHtml(buyerAddr)}</p>
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
  </body></html>`;

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await browser.close();
  return Buffer.from(pdf);
}
