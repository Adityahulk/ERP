import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
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

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Normalise a raw date string into YYYY-MM-DD */
function parseRawDate(raw: string): string | null {
  raw = raw.trim();

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  let m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31)
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  m = raw.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31)
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD Mon YYYY or D Mon YYYY
  m = raw.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{4})$/i);
  if (m) {
    const [, d, mon, y] = m;
    const mo = MONTHS[mon.toLowerCase().slice(0, 3)];
    if (mo) return `${y}-${mo}-${d.padStart(2, '0')}`;
  }

  return null;
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

/** Pull the first date that appears after a date keyword. Falls back to any date in the text. */
function extractDate(text: string): string | null {
  const keywordPat =
    /(?:date|bill\s*date|invoice\s*date|dated?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{4})/gi;
  let m = keywordPat.exec(text);
  if (m) {
    const d = parseRawDate(m[1]);
    if (d) return d;
  }

  // Fallback: first standalone date anywhere
  const anyDate =
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{4})\b/gi;
  for (const match of text.matchAll(anyDate)) {
    const d = parseRawDate(match[1]);
    if (d) return d;
  }
  return null;
}

/** Pull invoice / bill number */
function extractInvoiceNumber(lines: string[]): string | null {
  const patterns = [
    /(?:invoice\s*no|bill\s*no|inv\s*no|invoice\s*number|bill\s*number|voucher\s*no|receipt\s*no)[\.:\s#]*([A-Z0-9][A-Z0-9\-\/]{1,24})/i,
    /(?:^|[\s:])(?:no|#)\s*[:\.]?\s*([A-Z0-9][A-Z0-9\-\/]{2,20})/i,
  ];
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m?.[1] && m[1].length >= 2) return m[1].trim();
    }
  }
  return null;
}

/** Extract largest "total" amount in paise */
function extractTotal(lines: string[]): number | null {
  const patterns = [
    /(?:grand\s*total|total\s*amount|net\s*amount|amount\s*payable|total\s*payable|total\s*due|invoice\s*total|total\s*value)[^\d₹]*[₹\s]*([\d,]+(?:\.\d{1,2})?)/i,
    /^total\s*[:\-]?\s*[₹\s]*([\d,]+(?:\.\d{1,2})?)\s*$/i,
  ];
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m?.[1]) {
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(v) && v > 0) return Math.round(v * 100);
      }
    }
  }
  return null;
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
  return line
    .replace(/^(?:supplier|seller|vendor|party|customer|buyer|bill\s*from|bill\s*to|ship\s*to|billed\s*by|billed\s*to|name)\s*(?:name)?\s*[:\-]\s*/i, '')
    .replace(/\b(?:GSTIN|GST\s*No|GST|PAN|State|Code|Phone|Mobile|Email)\b.*$/i, '')
    .replace(GSTIN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

/** Master extractor: works on any text blob */
async function extractInvoiceData(rawText: string, companyId: string, opts: { ownCompanyName?: string | null; ownGstin?: string | null; context?: string } = {}) {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const gstins = [...text.matchAll(GSTIN_RE)].map(m => m[1].toUpperCase());
  const uniqueGstins = [...new Set(gstins)];
  const ownGstin = String(opts.ownGstin || '').toUpperCase();
  const partyGstins = ownGstin ? uniqueGstins.filter(g => g !== ownGstin) : uniqueGstins;
  const supplierGstin = choosePartyGstin(lines, uniqueGstins, ownGstin, opts.context || '') ?? partyGstins[0] ?? uniqueGstins[0] ?? null;
  const base = {
    invoice_number: extractInvoiceNumber(lines),
    bill_date: extractDate(text),
    party_name: extractPartyName(lines, { ...opts, supplierGstin }),
    supplier_gstin: supplierGstin,
    buyer_gstin: ownGstin || partyGstins[1] || uniqueGstins[1] || null,
    total_amount_paise: extractTotal(lines),
    raw_lines: lines.slice(0, 60),
  };

  const match = await findExistingParty(companyId, base);
  if (match?.party) {
    base.party_name = match.party.name || base.party_name;
  }

  return {
    ...base,
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
  try {
    const ext = path.extname(file.originalname).toLowerCase();

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
    } else {
      // Image → Tesseract OCR
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng', 1, { logger: () => {} });
      const { data } = await worker.recognize(file.path);
      text = data.text ?? '';
      await worker.terminate();
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
    fs.unlink(file.path).catch(() => {});
  }
}
