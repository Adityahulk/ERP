import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { success, error } from '../lib/response';
import { query } from '../config/db';

// ── File upload config ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) =>
    cb(null, `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

export const ocrUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF and image files (JPG, PNG, WebP) are supported'));
  },
});

// ── Regex helpers ──────────────────────────────────────────────
const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;
const MONEY_RE = /(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d{1,2})?/i;
const execFileAsync = promisify(execFile);

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

type OcrDocumentType = 'purchase_bill' | 'sales_invoice' | 'quotation' | 'delivery_challan' | 'unknown';

interface OcrCandidate<T> {
  value: T;
  confidence: number;
  source: string;
  reason: string;
}

interface OcrItemCandidate {
  description: string;
  hsn_code: string | null;
  quantity: number | null;
  unit: string | null;
  rate_paise: number | null;
  amount_paise: number | null;
  discount_paise?: number | null;
  gst_rate?: number | null;
  cess_rate?: number | null;
  confidence: number;
  source: string;
}

interface OcrTaxSummary {
  taxable_amount_paise: number | null;
  cgst_paise: number | null;
  sgst_paise: number | null;
  igst_paise: number | null;
  cess_paise: number | null;
  discount_paise: number | null;
  round_off_paise: number | null;
  gst_rate: number | null;
}

/** Normalise a raw date string into YYYY-MM-DD */
function parseRawDate(raw: string): string | null {
  raw = raw.trim();

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (two digit years are common on invoices)
  let m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2}|\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31)
      return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  m = raw.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31)
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD Mon YYYY or D Mon YYYY
  m = raw.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{2}|\d{4})$/i);
  if (m) {
    const [, d, mon, y] = m;
    const mo = MONTHS[mon.toLowerCase().slice(0, 3)];
    const year = y.length === 2 ? `20${y}` : y;
    if (mo) return `${year}-${mo}-${d.padStart(2, '0')}`;
  }

  return null;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function pickBest<T>(candidates: OcrCandidate<T>[]): OcrCandidate<T> | null {
  return candidates.length ? [...candidates].sort((a, b) => b.confidence - a.confidence)[0] : null;
}

function normalizeOcrText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[|¦]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[₹]/g, '₹')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function detectDocumentType(text: string, context: string): OcrDocumentType {
  const hay = `${context}\n${text}`.toLowerCase();
  if (/quotation|estimate|proforma/.test(hay)) return 'quotation';
  if (/delivery\s*challan|dispatch\s*challan/.test(hay)) return 'delivery_challan';
  if (/purchase|supplier|vendor|grn|bill\s*from|billed\s*by/.test(hay)) return 'purchase_bill';
  if (/sales|customer|buyer|bill\s*to|tax\s*invoice/.test(hay)) return 'sales_invoice';
  return 'unknown';
}

/** Pull the first date that appears after a date keyword. Falls back to any date in the text. */
function extractDate(text: string): string | null {
  const keywordPat =
    /(?:date|bill\s*date|invoice\s*date|dated?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{2,4})/gi;
  let m = keywordPat.exec(text);
  if (m) {
    const d = parseRawDate(m[1]);
    if (d) return d;
  }

  // Fallback: first standalone date anywhere
  const anyDate =
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{2,4})\b/gi;
  for (const match of text.matchAll(anyDate)) {
    const d = parseRawDate(match[1]);
    if (d) return d;
  }
  return null;
}

function extractDateCandidates(text: string, lines: string[]): OcrCandidate<string>[] {
  const out: OcrCandidate<string>[] = [];
  const seen = new Set<string>();
  const patterns = [
    {
      re: /(?:invoice\s*date|bill\s*date|date\s*of\s*invoice|dated?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{2,4})/gi,
      score: 0.92,
      reason: 'date_label',
    },
    {
      re: /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{2,4})\b/gi,
      score: 0.62,
      reason: 'standalone_date',
    },
  ];
  for (const { re, score, reason } of patterns) {
    for (const match of text.matchAll(re)) {
      const raw = match[1];
      const parsed = parseRawDate(raw);
      if (!parsed || seen.has(parsed)) continue;
      seen.add(parsed);
      const source = lines.find(l => l.includes(raw)) || raw;
      const dt = new Date(`${parsed}T00:00:00`);
      const now = new Date();
      const tooFuture = dt.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000;
      out.push({ value: parsed, confidence: clampConfidence(score - (tooFuture ? 0.25 : 0)), source, reason });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

const DOC_NUMBER_STOP_RE = /\b(?:date|dated|invoice\s*date|bill\s*date|due\s*date|gstin|gst\s*no|pan|cin|fssai|state\s*code|place\s*of\s*supply|phone|mobile|email|amount|total|taxable|vehicle|eway|e-way|irn|ack|hsn|sac|qty|quantity|rate|info|details|type)\b/i;
const DOC_NUMBER_CONTEXT_RE = /\b(?:tax\s*)?(?:invoice|inv|bill|voucher|receipt|document|doc|credit\s*note|debit\s*note)\b/i;
const DOC_NUMBER_BAD_LINE_RE = /\b(?:gstin|gst\s*no|phone|mobile|email|fssai|pan|cin|state\s*code|place\s*of\s*supply|hsn|sac|qty|quantity|rate|amount|total|taxable|cgst|sgst|igst|eway|e-way|irn|ack|vehicle|pincode|pin\s*code)\b/i;
const DOC_NUMBER_BLACKLIST = new Set([
  'NO', 'NUM', 'NUMBER', 'DATE', 'DATED', 'INVOICE', 'INV', 'BILL', 'TAX', 'GSTIN', 'GST',
  'ORIGINAL', 'DUPLICATE', 'TRIPLICATE', 'COPY', 'HSN', 'SAC', 'PAN', 'CIN', 'IRN', 'ACK',
  'TO', 'FROM', 'BY', 'SHIP', 'BILLTO', 'BILLFROM', 'INFO', 'DETAILS', 'TYPE',
]);

function normalizeDocumentNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\\|_]+/g, '-')
    .replace(/[^A-Z0-9/.-]/g, '')
    .replace(/\.+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[./-]+|[./-]+$/g, '')
    .slice(0, 24);
}

function trimAfterNextField(raw: string): string {
  const idx = raw.search(DOC_NUMBER_STOP_RE);
  return idx >= 0 ? raw.slice(0, idx) : raw;
}

function looksLikeGstin(value: string): boolean {
  GSTIN_RE.lastIndex = 0;
  const ok = GSTIN_RE.test(value);
  GSTIN_RE.lastIndex = 0;
  return ok;
}

function isDateLikeToken(value: string): boolean {
  if (parseRawDate(value)) return true;
  return /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(value)
    || /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(value);
}

function sanitizeDocumentNumberSegment(raw: string): string | null {
  const withoutFieldTail = trimAfterNextField(raw)
    .replace(/^(?:no|number|num|#)\s*[:#.\-]*/i, '')
    .replace(/^[\s:#.\-]+/, '')
    .trim();
  const tokens = withoutFieldTail.match(/[A-Z0-9][A-Z0-9/.\-]{0,31}/gi) || [];
  for (const token of tokens) {
    const value = normalizeDocumentNumber(token);
    if (value && !DOC_NUMBER_BLACKLIST.has(value)) return value;
  }
  return null;
}

function isBadDocumentNumberCandidate(value: string, source: string, strongLabel: boolean): boolean {
  if (/^[A-Z]{1,5}-\d{1,6}$/.test(value)) return false;
  const v = normalizeDocumentNumber(value);
  if (!v) return true;
  if (DOC_NUMBER_BLACKLIST.has(v)) return true;
  if (!strongLabel && v.length < 2) return true;
  if (v.length > 24) return true;
  if (looksLikeGstin(v)) return true;
  if (isDateLikeToken(v)) return true;

  // Allow alphanumeric values like "US-001" by checking if it contains letters.
  const hasLetters = /[A-Z]/i.test(v);
  if (hasLetters) {
    return false; // Valid candidate if it has letters and passed basic blacklist/length checks
  }

  if (/^\d{10,}$/.test(v)) return true; // phone, e-way, ack, UPI, long serials
  if (/^\d{6}$/.test(v) && /\b(pin|pincode|address|state)\b/i.test(source)) return true;
  if (/^\d{4,8}$/.test(v) && /\b(hsn|sac|item|description|qty|quantity|rate|amount)\b/i.test(source)) return true;
  if (/^\d{1,2}$/.test(v) && /\b(state\s*code|gstin|hsn|sac|sl\.?\s*no|sr\.?\s*no|serial)\b/i.test(source)) return true;
  if (/^\d+(?:\.\d+)?$/.test(v) && /\b(amount|total|taxable|cgst|sgst|igst|rate|qty|quantity|discount)\b/i.test(source)) return true;
  if (!/[A-Z0-9]/.test(v)) return true;
  return false;
}

function addDocumentNumberCandidate(
  out: OcrCandidate<string>[],
  seen: Set<string>,
  raw: string,
  source: string,
  confidence: number,
  reason: string,
  strongLabel: boolean,
) {
  const value = sanitizeDocumentNumberSegment(raw);
  if (!value || seen.has(value)) return;
  if (isBadDocumentNumberCandidate(value, source, strongLabel)) return;
  seen.add(value);
  out.push({ value, confidence: clampConfidence(confidence), source, reason });
}

function labelOnlyDocumentNumberLine(line: string): boolean {
  return /^(?:tax\s*)?(?:invoice|inv|bill|voucher|receipt|document|doc|credit\s*note|debit\s*note)\s*(?:number|no\.?|#)\s*[:#.\-]*$/i.test(line.trim());
}

function extractInvoiceNumberCandidates(lines: string[]): OcrCandidate<string>[] {
  const out: OcrCandidate<string>[] = [];
  const seen = new Set<string>();

  // Strong global fallback: Scan full text (not just lines)
  const fullText = lines.join('\n');
  const globalMatch = fullText.match(/INVOICE\s*#\s*([A-Z0-9-]+)/i);
  if (globalMatch) {
    const val = normalizeDocumentNumber(globalMatch[1]);
    if (val && !seen.has(val)) {
      seen.add(val);
      out.push({
        value: val,
        confidence: 0.99,
        source: globalMatch[0],
        reason: 'global_invoice_hash_fallback'
      });
    }
  }

  const scanLines = lines.slice(0, 120);
  const strongInlinePatterns = [
    {
      re: /\binvoice\s*#\s*[:\-]?\s*([A-Z0-9-]+)/i,
      score: 0.99,
      reason: 'invoice_hash_pattern',
    },
    {
      re: /\b(?:tax\s*)?invoice\s*(?:number|no\.?|#)?\s*[:#.\-]?\s*(.+)$/i,
      score: 0.97,
      reason: 'invoice_label_inline',
    },
    {
      re: /\binv\.?\s*(?:number|no\.?|#)?\s*[:#.\-]?\s*(.+)$/i,
      score: 0.95,
      reason: 'inv_label_inline',
    },
    {
      re: /\b(?:bill|voucher|receipt)\s*(?:number|no\.?|#)?\s*[:#.\-]?\s*(.+)$/i,
      score: 0.9,
      reason: 'bill_label_inline',
    },
    {
      re: /\b(?:credit\s*note|debit\s*note|document|doc)\s*(?:number|no\.?|#)?\s*[:#.\-]?\s*(.+)$/i,
      score: 0.78,
      reason: 'document_label_inline',
    },
  ];

  scanLines.forEach((line, idx) => {
    const hasDocContext = DOC_NUMBER_CONTEXT_RE.test(line);
    if (/\bbill\s*(?:to|from)\b/i.test(line)) return;
    for (const pat of strongInlinePatterns) {
      const match = line.match(pat.re);
      if (!match?.[1]) continue;
      if (match[1].trimStart().search(DOC_NUMBER_STOP_RE) === 0 || /\b(?:invoice|bill|due)\s*date\b/i.test(line)) continue;
      addDocumentNumberCandidate(out, seen, match[1], line, pat.score + (idx < 35 ? 0.02 : -0.04), pat.reason, true);

      const parsedSameLine = sanitizeDocumentNumberSegment(match[1]);
      if (parsedSameLine) continue;
      for (let next = idx + 1; next <= Math.min(scanLines.length - 1, idx + 2); next++) {
        const nextLine = scanLines[next];
        if (!nextLine || DOC_NUMBER_BAD_LINE_RE.test(nextLine)) continue;
        addDocumentNumberCandidate(out, seen, nextLine, `${line} ${nextLine}`, pat.score - 0.08, `${pat.reason}_next_line`, true);
      }
    }

    if (labelOnlyDocumentNumberLine(line)) {
      for (let next = idx + 1; next <= Math.min(scanLines.length - 1, idx + 3); next++) {
        const nextLine = scanLines[next];
        if (!nextLine || DOC_NUMBER_BAD_LINE_RE.test(nextLine)) continue;
        addDocumentNumberCandidate(out, seen, nextLine, `${line} ${nextLine}`, idx < 40 ? 0.9 : 0.78, 'label_only_next_line', true);
        if (out.some(c => c.source === `${line} ${nextLine}`)) break;
      }
    }

    const nearby = scanLines.slice(Math.max(0, idx - 2), Math.min(scanLines.length, idx + 3)).join(' ');
    if (idx < 45 && (hasDocContext || DOC_NUMBER_CONTEXT_RE.test(nearby))) {
      const weak = line.match(/(?:^|[\s(])(?:no\.?|#)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/.\-]{1,23})\b/i);
      if (weak?.[1]) {
        addDocumentNumberCandidate(out, seen, weak[1], line, 0.58, 'weak_number_near_invoice_context', false);
      }
    }
  });

  const fullTextSpace = lines.join(' ');
  const match = fullTextSpace.match(/INVOICE\s*#\s*([A-Z0-9-]+)/i);

  if (match) {
    out.push({
      value: match[1],
      confidence: 0.99,
      source: match[0],
      reason: 'forced_invoice_hash',
    });
  }

  return out
    .sort((a, b) => b.confidence - a.confidence || a.value.length - b.value.length)
    .slice(0, 8);
}

/** Pull invoice / bill number */
function extractInvoiceNumber(lines: string[]): string | null {
  return pickBest(extractInvoiceNumberCandidates(lines))?.value || null;
}

function parseAmountToPaise(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (cleaned.length > 8) {
    const digitsOnly = cleaned.replace(/\./g, '');
    if (digitsOnly.length > 9) return null;
  }
  const digitsOnly = cleaned.replace(/\./g, '');
  if (digitsOnly.length > 9) return null;

  const v = parseFloat(cleaned);
  if (!Number.isFinite(v) || v <= 0) return null;
  
  // Reject values greater than 1 crore rupees (1_00_00_000 rupees)
  if (v > 10000000) return null;

  return Math.round(v * 100);
}

function parseLooseAmount(raw: string | undefined): number | null {
  return raw ? parseAmountToPaise(raw) : null;
}

function extractLabeledValue(lines: string[], labels: RegExp[], maxNextLines = 1): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = labels.find((pattern) => pattern.test(line));
    if (!label) continue;

    const inline = line
      .replace(label, '')
      .replace(/^[\s:#\-–—]+/, '')
      .trim();
    if (inline && !/^(?:no\.?|number|date|details?)$/i.test(inline)) return inline.slice(0, 240);

    for (let offset = 1; offset <= maxNextLines; offset += 1) {
      const next = lines[index + offset]?.trim();
      if (!next || /^(?:bill\s*to|ship\s*to|buyer|consignee|items?|description|qty|quantity)$/i.test(next)) continue;
      return next.slice(0, 240);
    }
  }
  return null;
}

function extractAddressBlock(lines: string[], labels: RegExp[], ownCompanyName?: string | null): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((pattern) => pattern.test(lines[index]))) continue;
    const block: string[] = [];
    const inline = lines[index].replace(labels.find((pattern) => pattern.test(lines[index]))!, '').replace(/^[\s:#\-–—]+/, '').trim();
    if (inline && inline.length > 3 && !isNoiseLine(inline)) block.push(inline);
    for (let offset = 1; offset <= 5; offset += 1) {
      const next = lines[index + offset]?.trim();
      if (!next) break;
      if (/^(?:bill\s*to|ship\s*to|buyer|consignee|invoice\s*(?:no|number)|items?|description|qty|quantity|total|tax|gstin|gst\s*no)/i.test(next)) break;
      if (isLikelyCompanyOwnLine(next, ownCompanyName) || /^(?:name|party)\s*[:\-]?$/i.test(next)) continue;
      block.push(next);
    }
    if (block.length) return block.join(', ').replace(/\s+,/g, ',').slice(0, 500);
  }
  return null;
}

function extractPhone(lines: string[]): string | null {
  for (const line of lines) {
    if (!/phone|mobile|contact|tel/i.test(line)) continue;
    const number = line.match(/(?:\+91[\s-]?)?[6-9]\d{9}|\b\d{10}\b/);
    if (number) return number[0].replace(/\s|-/g, '');
  }
  return null;
}

function extractTaxSummary(lines: string[]): OcrTaxSummary {
  const amountFor = (label: string) => {
    for (const line of lines) {
      const match = line.match(new RegExp(`\\b${label}\\b(?:\\s*@?\\s*\\d+(?:\\.\\d+)?%?)?[^\\d₹]{0,24}(?:₹|Rs\\.?|INR)?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'));
      if (match?.[1]) return parseLooseAmount(match[1]);
    }
    return null;
  };
  const rateLine = lines.find((line) => /(?:cgst|sgst|igst)\s*@?\s*\d+(?:\.\d+)?%/i.test(line));
  const rateMatch = rateLine?.match(/(?:cgst|sgst|igst)\s*@?\s*(\d+(?:\.\d+)?)%/i);
  const componentRate = rateMatch ? Number(rateMatch[1]) : null;
  const cgst = amountFor('cgst');
  const sgst = amountFor('sgst|utgst');
  const igst = amountFor('igst');
  return {
    taxable_amount_paise: amountFor('taxable(?:\\s+value|\\s+amount)?'),
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: igst,
    cess_paise: amountFor('cess'),
    discount_paise: amountFor('discount'),
    round_off_paise: amountFor('round\\s*off'),
    gst_rate: componentRate == null ? null : (igst != null ? componentRate : componentRate * 2),
  };
}

function extractReferenceFields(lines: string[]) {
  const date = (labels: RegExp[]) => {
    const value = extractLabeledValue(lines, labels);
    return value ? parseRawDate(value.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}[\s,]+\d{4}/)?.[0] || '') : null;
  };
  return {
    eway_bill_no: extractLabeledValue(lines, [/e[-\s]?way\s*bill\s*(?:no\.?|number)?/i]),
    delivery_note: extractLabeledValue(lines, [/delivery\s*note(?!\s*date)/i]),
    mode_terms_payment: extractLabeledValue(lines, [/(?:mode|terms?)\s*(?:of\s*)?payment/i]),
    reference_no_date: extractLabeledValue(lines, [/reference\s*(?:no\.?|number)?(?:\s*(?:&|and)\s*date)?/i]),
    other_references: extractLabeledValue(lines, [/other\s*references?/i]),
    buyer_order_no: extractLabeledValue(lines, [/(?:buyer'?s?|customer'?s?)\s*order\s*(?:no\.?|number)?/i]),
    buyer_order_date: date([/(?:buyer'?s?|customer'?s?)\s*order\s*date/i]),
    dispatch_doc_no: extractLabeledValue(lines, [/dispatch\s*(?:doc(?:ument)?|note)\s*(?:no\.?|number)?/i]),
    delivery_note_date: date([/delivery\s*note\s*date/i]),
    dispatched_through: extractLabeledValue(lines, [/dispatched\s*(?:through|via)/i]),
    destination: extractLabeledValue(lines, [/destination/i]),
    vessel_flight_no: extractLabeledValue(lines, [/(?:vessel|flight)\s*(?:no\.?|number)?/i]),
    receipt_by_shipper: extractLabeledValue(lines, [/place\s*of\s*receipt\s*by\s*shipper/i]),
    port_loading: extractLabeledValue(lines, [/(?:city|port)\s*of\s*loading/i]),
    port_discharge: extractLabeledValue(lines, [/(?:city|port)\s*of\s*discharge/i]),
    terms_delivery: extractLabeledValue(lines, [/terms?\s*of\s*delivery/i]),
  };
}

/** Extract largest "total" amount in paise */
function extractTotal(lines: string[]): number | null {
  const candidates = extractTotalCandidates(lines);
  return candidates[0]?.value || null;
}

function extractTotalCandidates(lines: string[]): OcrCandidate<number>[] {
  const out: OcrCandidate<number>[] = [];
  const seen = new Set<number>();
  const labels = [
    { re: /(?:grand\s*total|amount\s*payable|total\s*payable|net\s*amount|invoice\s*total|bill\s*total)[^\d₹$]*[₹$\s]*([\d,]+(?:\.\d{1,2})?)/i, score: 0.96, reason: 'grand_total_label' },
    { re: /(?:total\s*amount|total\s*value|total\s*due)[^\d₹$]*[₹$\s]*([\d,]+(?:\.\d{1,2})?)/i, score: 0.84, reason: 'total_label' },
    { re: /^total\s*[:\-]?\s*[₹$\s]*([\d,]+(?:\.\d{1,2})?)\s*$/i, score: 0.78, reason: 'plain_total_line' },
  ];
  lines.forEach((line, idx) => {
    // Ignore lines containing "date"
    if (/date/i.test(line)) return;

    // Only accept totals if the line contains "total", "amount", "₹", or "$"
    if (!/total|amount|₹|\$/i.test(line)) return;

    for (const label of labels) {
      const m = line.match(label.re);
      if (!m?.[1]) continue;

      // Skip matches where the number is 8+ digits without decimal (likely a date)
      const cleanedNum = m[1].replace(/,/g, '');
      if (/^\d{8,}$/.test(cleanedNum)) continue;

      const paise = parseAmountToPaise(m[1]);
      if (!paise || seen.has(paise)) continue;
      seen.add(paise);

      // Boost confidence for totals near "TOTAL"
      let finalScore = label.score;
      if (/total/i.test(line)) {
        finalScore += 0.04;
      }

      const bottomBoost = idx > lines.length * 0.55 ? 0.05 : 0;
      out.push({ value: paise, confidence: clampConfidence(finalScore + bottomBoost), source: line, reason: label.reason });
    }
  });

  // Fallback: only pick unlabeled totals from the bottom section, and only if they meet the strict criteria
  if (!out.length) {
    const bottom = lines.slice(Math.max(0, lines.length - 20));
    const bottomStartIndex = Math.max(0, lines.length - 20);
    bottom.forEach((line, relativeIdx) => {
      const idx = bottomStartIndex + relativeIdx;
      if (/tax|cgst|sgst|igst|rate|qty|discount/i.test(line)) return;
      if (/date/i.test(line)) return;
      if (!/total|amount|₹|\$/i.test(line)) return;

      const matches = [...line.matchAll(/(?:₹|\$|rs\.?|inr)?\s*([\d,]+\.\d{2}|[\d,]{4,})/gi)];
      for (const m of matches) {
        const cleanedNum = m[1].replace(/,/g, '');
        if (/^\d{8,}$/.test(cleanedNum)) continue;

        const paise = parseAmountToPaise(m[1]);
        if (!paise || seen.has(paise)) continue;
        seen.add(paise);

        // Decrease confidence for unlabeled numeric values / standalone large numbers
        out.push({ value: paise, confidence: 0.20, source: line, reason: 'large_amount_near_bottom' });
      }
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.value - a.value).slice(0, 6);
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|limited|ltd|llp|inc|company|co|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value: unknown): string[] {
  const normalized = normalizeName(value);
  return normalized ? normalized.split(' ').filter(t => t.length > 1) : [];
}

function nameSimilarity(a: unknown, b: unknown): number {
  const at = new Set(nameTokens(a));
  const bt = new Set(nameTokens(b));
  if (!at.size || !bt.size) return 0;
  let intersection = 0;
  for (const t of at) if (bt.has(t)) intersection += 1;
  return intersection / Math.max(at.size, bt.size);
}

function isLikelyCompanyOwnLine(line: string, ownCompanyName?: string | null): boolean {
  const own = normalizeName(ownCompanyName);
  const candidate = normalizeName(line);
  if (!own || !candidate) return false;
  return candidate === own || candidate.includes(own) || own.includes(candidate);
}

function cleanPartyCandidate(line: string): string {
  let cleaned = line
    .replace(/^(?:supplier|seller|vendor|party|customer|buyer|bill\s*from|bill\s*to|ship\s*to|billed\s*by|billed\s*to|name)\s*(?:name)?\s*[:\-]\s*/i, '')
    .replace(/\b(?:GSTIN|GST\s*No|GST|PAN|State|Code|Phone|Mobile|Email)\b.*$/i, '')
    .replace(GSTIN_RE, '')
    .replace(/\b[o0]{2,}\b/gi, '')
    .replace(/[^a-zA-Z0-9 .,&()-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Remove OCR garbage like standalone "oo", "o", "x" at start or end
  cleaned = cleaned.replace(/^\b(oo|o|x)\b\s+/i, '');
  cleaned = cleaned.replace(/\s+\b(oo|o|x)\b$/i, '');

  // Strip unwanted trailing/leading symbols (keeping trailing dot if it's after Inc./Ltd./Co./Corp.)
  cleaned = cleaned.replace(/^[\s,.:;\-\|\\\/_#+*!?&()]+/, '');
  
  // Custom trailing strip to preserve "Inc." / "Ltd." / "Co." / "Corp."
  cleaned = cleaned.replace(/[\s,.:;\-\|\\\/_#+*!?&()]+$/, (match) => {
    const trimmed = cleaned.slice(0, cleaned.length - match.length);
    if (match.includes('.') && /\b(inc|ltd|co|corp|pvt|pld|llp)$/i.test(trimmed)) {
      return '.';
    }
    return '';
  });

  // Normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

function isNoiseLine(line: string): boolean {
  const text = line.trim();
  if (text.length < 3) return true;
  if (/^\d+$/.test(text)) return true;
  if (GSTIN_RE.test(text)) {
    GSTIN_RE.lastIndex = 0;
    return true;
  }
  GSTIN_RE.lastIndex = 0;
  if (MONEY_RE.test(text) && /\b(total|amount|tax|cgst|sgst|igst|rate|qty|quantity|discount)\b/i.test(text)) return true;
  return /(?:tax\s*invoice|invoice|bill\s*of\s*supply|original|duplicate|triplicate|date|irn|ack\s*no|eway|e-way|address|mobile|phone|email|www\.|http|@|pan|fssai|cin|state\s*code|place\s*of\s*supply)/i.test(text);
}

function bestNameNearGstin(lines: string[], gstin: string, opts: { ownCompanyName?: string | null } = {}): string | null {
  const target = gstin.toUpperCase();
  const index = lines.findIndex(line => line.toUpperCase().includes(target));
  if (index < 0) return null;
  const candidates: Array<{ name: string; score: number }> = [];
  for (let i = Math.max(0, index - 5); i <= Math.min(lines.length - 1, index + 3); i++) {
    if (i === index) continue;
    const cleaned = cleanPartyCandidate(lines[i]);
    if (!cleaned || cleaned.length < 3) continue;
    if (isNoiseLine(cleaned)) continue;
    if (isLikelyCompanyOwnLine(cleaned, opts.ownCompanyName)) continue;
    let score = 20 - Math.abs(index - i);
    if (/\b(pvt|private|ltd|limited|llp|industries|enterprise|enterprises|traders|agency|agencies|company|corp|corporation|services|solutions)\b/i.test(cleaned)) score += 6;
    if (/^[A-Z0-9 .,&()/-]+$/.test(cleaned) && /[A-Z]{3}/.test(cleaned)) score += 2;
    candidates.push({ name: cleaned, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.name || null;
}

function choosePartyGstin(lines: string[], gstins: string[], ownGstin: string, context: string): string | null {
  const candidates = [...new Set(gstins.map(g => g.toUpperCase()).filter(g => g && g !== ownGstin))];
  if (!candidates.length) return null;
  const isPurchase = /purchase|supplier|vendor|grn/i.test(context);
  const positive = isPurchase
    ? /\b(supplier|seller|vendor|bill\s*from|billed\s*by|consignor)\b/i
    : /\b(customer|buyer|bill\s*to|billed\s*to|ship\s*to|consignee)\b/i;
  const negative = isPurchase
    ? /\b(customer|buyer|bill\s*to|ship\s*to|consignee)\b/i
    : /\b(supplier|seller|vendor|bill\s*from|billed\s*by|consignor)\b/i;

  let best = candidates[0];
  let bestScore = -999;
  for (const gstin of candidates) {
    const idx = lines.findIndex(line => line.toUpperCase().includes(gstin));
    let score = idx >= 0 ? 20 - Math.min(idx, 20) : 0;
    const nearby = lines.slice(Math.max(0, idx - 5), Math.min(lines.length, idx + 5)).join(' ');
    if (positive.test(nearby)) score += 30;
    if (negative.test(nearby)) score -= 25;
    const name = bestNameNearGstin(lines, gstin);
    if (name) score += 8;
    if (score > bestScore) {
      bestScore = score;
      best = gstin;
    }
  }
  return best;
}

function extractGstinCandidates(lines: string[], ownGstin: string, context: string): OcrCandidate<string>[] {
  const all = [...new Set(lines.join('\n').match(GSTIN_RE)?.map(g => g.toUpperCase()) || [])];
  GSTIN_RE.lastIndex = 0;
  return all.map(gstin => {
    if (gstin === ownGstin) {
      return { value: gstin, confidence: 0.2, source: lines.find(l => l.toUpperCase().includes(gstin)) || gstin, reason: 'own_company_gstin' };
    }
    const selected = choosePartyGstin(lines, all, ownGstin, context);
    const source = lines.find(l => l.toUpperCase().includes(gstin)) || gstin;
    return { value: gstin, confidence: gstin === selected ? 0.9 : 0.55, source, reason: gstin === selected ? 'context_role_match' : 'other_gstin' };
  }).sort((a, b) => b.confidence - a.confidence);
}

function extractSectionName(lines: string[], context: string, opts: { ownCompanyName?: string | null } = {}): string | null {
  const isPurchase = /purchase|supplier|vendor|grn/i.test(context);
  const labels = isPurchase
    ? [/bill\s*from/i, /supplier/i, /seller/i, /vendor/i, /billed\s*by/i, /party\s*name/i]
    : [/bill\s*to/i, /buyer/i, /customer/i, /ship\s*to/i, /billed\s*to/i, /party\s*name/i];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      if (!label.test(line)) continue;
      const inline = cleanPartyCandidate(line);
      if (inline && inline.length >= 3 && !isNoiseLine(inline) && !isLikelyCompanyOwnLine(inline, opts.ownCompanyName)) return inline;
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 4); j++) {
        const candidate = cleanPartyCandidate(lines[j]);
        if (candidate.length >= 3 && !isNoiseLine(candidate) && !isLikelyCompanyOwnLine(candidate, opts.ownCompanyName)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/** Guess party / supplier name from first meaningful lines */
function extractPartyName(lines: string[], opts: { ownCompanyName?: string | null; ownGstin?: string | null; supplierGstin?: string | null; context?: string } = {}): string | null {
  // 1. DETECT "ISSUED TO" BLOCK
  const idx = lines.findIndex(l => /issued to/i.test(l));
  if (idx !== -1) {
    const block = lines.slice(idx + 1, idx + 5);
    const cleaned = block.filter(line =>
      line.length > 3 &&
      !/\d{3,}/.test(line) && // remove address
      !/(street|st|road|rd|lane|city|zip)/i.test(line)
    );

    // Prefer lines containing company keywords: Inc, Ltd, LLC, Unlimited, Company, Pvt
    const preferred = cleaned.find(line =>
      /\b(inc|ltd|llc|unlimited|company|pvt)\b/i.test(line)
    );

    if (preferred) {
      return cleanPartyCandidate(preferred);
    }
    if (cleaned.length >= 2) {
      return cleanPartyCandidate(cleaned[1]); // company name
    }
    if (cleaned.length === 1) {
      return cleanPartyCandidate(cleaned[0]);
    }
  }

  const skipPat = /(?:GSTIN|GST\s*No|Tax\s*Invoice|Invoice|Date|Address|Mobile|Phone|Email|www\.|http|@|\d{10}|PAN|FSSAI|IRN|Ack\s*No)/i;
  const ownGstin = String(opts.ownGstin || '').toUpperCase();

  if (opts.supplierGstin) {
    const nearGstin = bestNameNearGstin(lines, opts.supplierGstin, opts);
    if (nearGstin) return nearGstin;
  }

  const sectionName = extractSectionName(lines, opts.context || '', opts);
  if (sectionName) return sectionName;

  const labeledPatterns = [
    /(?:supplier|seller|vendor|party)\s*(?:name)?\s*[:\-]\s*(.+)$/i,
    /bill\s*from\s*[:\-]\s*(.+)$/i,
    /billed\s*by\s*[:\-]\s*(.+)$/i,
    /bill\s*to\s*[:\-]\s*(.+)$/i,
  ];

  for (const line of lines.slice(0, 45)) {
    for (const pat of labeledPatterns) {
      const m = line.match(pat);
      const candidate = m?.[1] ? cleanPartyCandidate(m[1]) : '';
      if (candidate.length >= 3 && !skipPat.test(candidate) && !isLikelyCompanyOwnLine(candidate, opts.ownCompanyName)) return candidate;
    }
  }

  for (let i = 0; i < Math.min(lines.length, 35); i++) {
    const line = cleanPartyCandidate(lines[i]);
    if (line.length < 3) continue;
    if (/^\d+$/.test(line)) continue;
    const gstins = [...line.matchAll(GSTIN_RE)].map(m => m[1].toUpperCase());
    if (gstins.length) {
      if (ownGstin && gstins.includes(ownGstin)) continue;
      GSTIN_RE.lastIndex = 0;
      continue;
    }
    if (skipPat.test(line)) continue;
    if (isLikelyCompanyOwnLine(line, opts.ownCompanyName)) continue;
    if (/^(tax invoice|invoice|original for recipient|duplicate for transporter)$/i.test(line)) continue;
    // Looks like a company / person name
    return line;
  }
  return null;
}

async function findExistingParty(companyId: string, extracted: { party_name?: string | null; supplier_gstin?: string | null }) {
  const gstin = String(extracted.supplier_gstin || '').toUpperCase();
  if (gstin) {
    const exact = await query(
      `SELECT id, name, phone, gstin, city, state, state_code, billing_state_code,
              billing_address, shipping_address, billing_city, billing_state, billing_pincode,
              party_type, balance
       FROM parties
       WHERE company_id = $1 AND is_deleted = false AND is_active = true AND UPPER(gstin) = $2
       LIMIT 1`,
      [companyId, gstin],
    );
    if (exact.rows[0]) return { party: exact.rows[0], confidence: 1, reason: 'gstin_exact' };
  }

  const name = String(extracted.party_name || '').trim();
  if (name.length < 3) return null;
  const parties = await query(
    `SELECT id, name, phone, gstin, city, state, state_code, billing_state_code,
            billing_address, shipping_address, billing_city, billing_state, billing_pincode,
            party_type, balance
     FROM parties
     WHERE company_id = $1 AND is_deleted = false AND is_active = true
     LIMIT 500`,
    [companyId],
  );
  let best: any = null;
  let score = 0;
  for (const party of parties.rows) {
    const s = nameSimilarity(name, party.name);
    if (s > score) {
      score = s;
      best = party;
    }
  }
  return best && score >= 0.62 ? { party: best, confidence: score, reason: 'name_fuzzy' } : null;
}

function formatOcrDescription(desc: string): string {
  let text = desc;
  
  // Split lowercase-uppercase joins
  text = text.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Handle merged OCR words
  text = text.replace(/\bFrontand\b/g, 'Front and');
  text = text.replace(/\bfrontand\b/g, 'front and');
  text = text.replace(/\bFRONTAND\b/g, 'FRONT AND');
  text = text.replace(/\bNewsetof\b/g, 'New set of');
  text = text.replace(/\bnewsetof\b/g, 'new set of');
  text = text.replace(/\bNEWSETOF\b/g, 'NEW SET OF');

  // Normalize spacing
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractItemCandidates(lines: string[]): OcrItemCandidate[] {
  const itemRows: OcrItemCandidate[] = [];
  let tableStarted = false;

  for (const line of lines) {
    // 1. Detect Table Header: DESCRIPTION UNIT PRICE QTY TOTAL
    if (!tableStarted) {
      const isHeader =
        /description/i.test(line) &&
        /unit/i.test(line) &&
        /price/i.test(line) &&
        /qty|quantity/i.test(line) &&
        /total/i.test(line);

      if (isHeader) {
        tableStarted = true;
      }
      continue;
    }

    // Stop at total/subtotal sections
    if (/^(sub\s*total|total|grand\s*total|cgst|sgst|igst|round\s*off|terms|bank|amount\s*in\s*words)/i.test(line)) {
      break;
    }

    // 2. Parse Row Using Position
    // Match numbers, allowing decimals
    const numbers = line.match(/[\d]+(?:\.\d{1,2})?/g);
    if (numbers && numbers.length >= 3) {
      const amount = parseFloat(numbers[numbers.length - 1]);
      const qty = parseFloat(numbers[numbers.length - 2]);
      const rate = parseFloat(numbers[numbers.length - 3]);

      // 4. Validation Rule: Math.abs((qty * rate) - amount) < 1
      if (Math.abs((qty * rate) - amount) < 1) {
        // Extract description by replacing numbers, dots, and currency symbols
        let description = line.replace(/[\d$.₹]/g, '').trim();
        description = formatOcrDescription(description);
        description = description.replace(/^[\s,.:;\-\|\\\/_#+*!?&()]+|[\s,.:;\-\|\\\/_#+*!?&()]+$/g, '').trim();

        if (description.length >= 2) {
          itemRows.push({
            description: description.slice(0, 160),
            hsn_code: null,
            quantity: qty,
            unit: 'PCS',
            rate_paise: Math.round(rate * 100),
            amount_paise: Math.round(amount * 100),
            confidence: 0.9,
            source: line,
          });
        }
      }
    }
  }

  return itemRows;
}

/**
 * A tolerant item-table parser for real world GST bills. It deliberately does
 * not assume a fixed column order: vendor layouts often include Sl No., HSN,
 * unit and tax columns in different positions.
 */
function extractItemCandidatesV2(lines: string[], documentGstRate: number | null): OcrItemCandidate[] {
  const results: OcrItemCandidate[] = [];
  let inTable = false;
  let pendingDescription = '';
  const unitPattern = /\b(?:PCS?|NOS?|KGS?|KG|GMS?|GM|LTRS?|LIT(?:RE|ER)?S?|MTRS?|METERS?|BOX(?:ES)?|BAGS?|SETS?|HRS?|HOURS?|DAYS?)\b/i;

  const isHeader = (line: string) =>
    /(?:item|description|particulars?|goods|product|service)/i.test(line) &&
    /(?:qty|quantity|rate|price|amount|total|unit)/i.test(line);

  for (const line of lines) {
    if (!inTable) {
      if (isHeader(line)) inTable = true;
      continue;
    }
    if (/^(?:sub\s*total|grand\s*total|total\s*(?:amount)?|cgst|sgst|igst|round\s*off|terms|bank|amount\s*in\s*words|taxable\s*value)/i.test(line)) break;

    const tokens = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d{1,2})?/gi)]
      .map((match) => Number(match[0].replace(/[^\d.]/g, '').replace(/,(?=\d{3}\b)/g, '')))
      .filter(Number.isFinite);
    if (tokens.length < 3) {
      if (!/\d/.test(line) && line.length >= 2 && line.length <= 140 && !/^(?:hsn|sac|unit|rate|quantity|amount)$/i.test(line)) {
        pendingDescription = `${pendingDescription} ${line}`.trim().slice(0, 160);
      }
      continue;
    }

    const amount = tokens[tokens.length - 1];
    let best: { qty: number; rate: number; error: number } | null = null;
    for (let quantityIndex = 0; quantityIndex < tokens.length - 1; quantityIndex += 1) {
      for (let rateIndex = 0; rateIndex < tokens.length - 1; rateIndex += 1) {
        if (quantityIndex === rateIndex) continue;
        const quantity = tokens[quantityIndex];
        const rate = tokens[rateIndex];
        if (quantity <= 0 || rate <= 0 || quantity > 1_000_000 || rate > 10_000_000) continue;
        const taxableError = Math.abs((quantity * rate) - amount) / Math.max(amount, 1);
        const grossError = documentGstRate && documentGstRate > 0
          ? Math.abs((quantity * rate * (1 + documentGstRate / 100)) - amount) / Math.max(amount, 1)
          : taxableError;
        const error = Math.min(taxableError, grossError);
        if (!best || error < best.error) best = { qty: quantity, rate, error };
      }
    }
    if (!best || best.error > 0.06) continue;

    const hsnCode = line.match(/\b\d{4,8}\b/)?.[0] || null;
    const unit = line.match(unitPattern)?.[0]?.toUpperCase() || 'PCS';
    const description = formatOcrDescription(`${pendingDescription} ${line
      .replace(/(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d{1,2})?/gi, ' ')
      .replace(unitPattern, ' ')
      .replace(/[|_]+/g, ' ')}`)
      .replace(/^[\s,.:;\-\\/_#+*!?&()]+|[\s,.:;\-\\/_#+*!?&()]+$/g, '')
      .trim();
    if (!description || /^(?:total|subtotal|taxable|amount)$/i.test(description)) continue;

    results.push({
      description: description.slice(0, 160),
      hsn_code: hsnCode,
      quantity: best.qty,
      unit,
      rate_paise: Math.round(best.rate * 100),
      amount_paise: Math.round(amount * 100),
      gst_rate: documentGstRate,
      confidence: clampConfidence(0.9 - Math.min(best.error, 0.15)),
      source: line,
    });
    pendingDescription = '';
  }
  return results;
}

function buildWarnings(args: {
  docType: OcrDocumentType;
  invoiceNumber: string | null;
  billDate: string | null;
  partyName: string | null;
  supplierGstin: string | null;
  ownGstin: string;
  totalAmountPaise: number | null;
  items: OcrItemCandidate[];
  matchConfidence: number;
}): string[] {
  const warnings: string[] = [];
  if (!args.invoiceNumber) warnings.push('Invoice / bill number was not confidently detected.');
  if (!args.billDate) warnings.push('Bill date was not confidently detected.');
  if (!args.partyName && !args.supplierGstin) warnings.push('Party name/GSTIN was not confidently detected.');
  if (args.supplierGstin && args.supplierGstin === args.ownGstin) warnings.push('Detected GSTIN matches your own company GSTIN; party was not auto-selected from it.');
  if (!args.totalAmountPaise) warnings.push('Total amount was not confidently detected.');
  if (args.matchConfidence > 0 && args.matchConfidence < 0.85) warnings.push('Party match is based on name similarity. Please verify before applying.');
  const itemTotal = args.items.reduce((sum, item) => sum + (item.amount_paise || 0), 0);
  if (args.totalAmountPaise && itemTotal > 0 && Math.abs(itemTotal - args.totalAmountPaise) > Math.max(100, args.totalAmountPaise * 0.05)) {
    warnings.push('Detected item total does not match bill total. Please verify line items.');
  }
  if (args.docType === 'unknown') warnings.push('Document type was not clear; extraction was done conservatively.');
  return warnings;
}

/** Master extractor: works on any text blob */
async function extractInvoiceData(rawText: string, companyId: string, opts: { ownCompanyName?: string | null; ownGstin?: string | null; context?: string } = {}) {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const documentType = detectDocumentType(text, opts.context || '');

  const gstins = [...text.matchAll(GSTIN_RE)].map(m => m[1].toUpperCase());
  const uniqueGstins = [...new Set(gstins)];
  const ownGstin = String(opts.ownGstin || '').toUpperCase();
  const context = opts.context || documentType;
  const partyGstins = ownGstin ? uniqueGstins.filter(g => g !== ownGstin) : uniqueGstins;
  const gstinCandidates = extractGstinCandidates(lines, ownGstin, context);
  const dateCandidates = extractDateCandidates(text, lines);
  const numberCandidates = extractInvoiceNumberCandidates(lines);
  const totalCandidates = extractTotalCandidates(lines);
  const taxSummary = extractTaxSummary(lines);
  const parsedItems = extractItemCandidatesV2(lines, taxSummary.gst_rate);
  const itemCandidates = parsedItems.length > 0 ? parsedItems : extractItemCandidates(lines);
  const supplierGstin = pickBest(gstinCandidates.filter(c => c.value !== ownGstin))?.value
    ?? choosePartyGstin(lines, uniqueGstins, ownGstin, context)
    ?? partyGstins[0]
    ?? uniqueGstins[0]
    ?? null;
  const bestDate = pickBest(dateCandidates);
  const bestNumber = pickBest(numberCandidates);
  const bestTotal = pickBest(totalCandidates);
  const dueDateRaw = extractLabeledValue(lines, [/due\s*date/i, /payment\s*due/i]);
  const dueDate = dueDateRaw
    ? parseRawDate(dueDateRaw.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}[\s,]+\d{2,4}/)?.[0] || '')
    : null;
  const placeOfSupply = extractLabeledValue(lines, [/place\s*of\s*supply/i, /state\s*(?:code|name)/i]);
  const partyAddress = extractAddressBlock(lines, [/bill\s*to/i, /buyer(?:\s*\(bill\s*to\))?/i, /customer/i], opts.ownCompanyName);
  const shippingAddress = extractAddressBlock(lines, [/ship\s*to/i, /consignee/i, /delivery\s*address/i], opts.ownCompanyName);
  const referenceInvoice = extractReferenceFields(lines);
  const base = {
    invoice_number: bestNumber?.value ?? extractInvoiceNumber(lines),
    bill_date: bestDate?.value ?? extractDate(text),
    party_name: extractPartyName(lines, { ...opts, supplierGstin, context }),
    supplier_gstin: supplierGstin,
    buyer_gstin: ownGstin || partyGstins[1] || uniqueGstins[1] || null,
    total_amount_paise: bestTotal?.value ?? extractTotal(lines),
    due_date: dueDate,
    party_address: partyAddress,
    shipping_address: shippingAddress,
    party_phone: extractPhone(lines),
    place_of_supply: placeOfSupply,
    tax_summary: taxSummary,
    reference_invoice: referenceInvoice,
    raw_lines: lines.slice(0, 60),
  };

  const match = await findExistingParty(companyId, base);
  if (match?.party) {
    base.party_name = match.party.name || base.party_name;
  }
  const warnings = buildWarnings({
    docType: documentType,
    invoiceNumber: base.invoice_number,
    billDate: base.bill_date,
    partyName: base.party_name,
    supplierGstin: base.supplier_gstin,
    ownGstin,
    totalAmountPaise: base.total_amount_paise,
    items: itemCandidates,
    matchConfidence: match?.confidence ?? 0,
  });

  return {
    ...base,
    document_type: documentType,
    confidence: clampConfidence(
      ((bestNumber?.confidence || 0) + (bestDate?.confidence || 0) + (bestTotal?.confidence || 0) + (match?.confidence || 0)) / 4,
    ),
    fields: {
      invoice_number: bestNumber,
      bill_date: bestDate,
      party_name: base.party_name ? {
        value: base.party_name,
        confidence: clampConfidence(match?.confidence ?? (base.supplier_gstin ? 0.74 : 0.55)),
        source: match?.reason === 'gstin_exact' ? String(base.supplier_gstin) : (lines.find(l => normalizeName(l).includes(normalizeName(base.party_name))) || base.party_name),
        reason: match?.reason || (base.supplier_gstin ? 'near_party_gstin' : 'name_candidate'),
      } : null,
      supplier_gstin: pickBest(gstinCandidates.filter(c => c.value === base.supplier_gstin)) || null,
      total_amount_paise: bestTotal,
    },
    candidates: {
      invoice_numbers: numberCandidates,
      dates: dateCandidates,
      gstins: gstinCandidates,
      totals: totalCandidates,
    },
    items: itemCandidates,
    warnings,
    matched_party_id: match?.party?.id ?? null,
    matched_party_name: match?.party?.name ?? null,
    party_match_confidence: match?.confidence ?? 0,
    party_match_reason: match?.reason ?? null,
    matched_party: match?.party ?? null,
  };
}

// ── Controller ─────────────────────────────────────────────────
export async function extractOcrData(req: Request, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json(error('No file uploaded'));

  let text = '';
  let renderedPdfPath: string | null = null;
  try {
    const ext = path.extname(file.originalname).toLowerCase();

    const recognizeImage = async (imagePath: string) => {
      // Tesseract's automatic page segmentation is substantially more reliable
      // for photographed invoices than its default sparse-text behaviour.
      // Keeping spaces tells the table parser where columns were detected.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng', 1, { logger: () => {} });
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: '3',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        const { data } = await worker.recognize(imagePath);
        return data.text ?? '';
      } finally {
        await worker.terminate();
      }
    };

    if (ext === '.pdf') {
      // pdf-parse v2: PDFParse({ data }) + getText() — there is no .parse() on the instance
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PDFParse } = require('pdf-parse');
      const buffer = await fs.readFile(file.path);
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        text = result.text ?? '';
      } finally {
        await parser.destroy();
      }
      // PDFs from phone scanners are frequently image-only. Use the embedded
      // text when useful, otherwise rasterise page one at 300 DPI and OCR it.
      if (text.replace(/\s/g, '').length < 40) {
        const outputBase = path.join(os.tmpdir(), `ocr_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        try {
          await execFileAsync('pdftoppm', ['-f', '1', '-l', '1', '-r', '300', '-png', '-singlefile', file.path, outputBase]);
          renderedPdfPath = `${outputBase}.png`;
          text = await recognizeImage(renderedPdfPath);
        } catch {
          // Keep the text extraction result so the user receives a clear
          // response instead of masking a missing optional Poppler utility.
        }
      }
    } else {
      text = await recognizeImage(file.path);
    }

    if (!text.trim()) {
      return res.status(422).json(error('Could not extract text from the uploaded file. Try a clearer image or a text-based PDF.'));
    }

    const companyRes = await query('SELECT name, legal_name, gstin FROM companies WHERE id = $1', [req.user!.company_id]);
    const company = companyRes.rows[0] || {};
    const extracted = await extractInvoiceData(text, req.user!.company_id, {
      ownCompanyName: company.legal_name || company.name,
      ownGstin: company.gstin,
      context: String(req.body?.context || ''),
    });
    res.json(success(extracted));
  } catch (err: any) {
    console.error('[OCR] extraction error:', err.message);
    res.status(500).json(error('OCR extraction failed: ' + err.message));
  } finally {
    fs.unlink(file.path).catch(() => { });
    if (renderedPdfPath) fs.unlink(renderedPdfPath).catch(() => { });
  }
}
