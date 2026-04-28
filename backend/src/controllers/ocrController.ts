import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { success, error } from '../lib/response';

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

/** Guess party / supplier name from first meaningful lines */
function extractPartyName(lines: string[]): string | null {
  const skipPat = /(?:GSTIN|GST\s*No|Tax\s*Invoice|Bill|Invoice|Date|Address|Mobile|Phone|Email|www\.|http|@|\d{10})/i;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i];
    if (line.length < 3) continue;
    if (/^\d+$/.test(line)) continue;
    if (GSTIN_RE.test(line)) { GSTIN_RE.lastIndex = 0; continue; }
    if (skipPat.test(line)) continue;
    // Looks like a company / person name
    return line;
  }
  return null;
}

/** Master extractor: works on any text blob */
function extractInvoiceData(rawText: string) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  const gstins = [...rawText.matchAll(GSTIN_RE)].map(m => m[1].toUpperCase());
  const uniqueGstins = [...new Set(gstins)];

  return {
    invoice_number: extractInvoiceNumber(lines),
    bill_date: extractDate(rawText),
    party_name: extractPartyName(lines),
    supplier_gstin: uniqueGstins[0] ?? null,
    buyer_gstin: uniqueGstins[1] ?? null,
    total_amount_paise: extractTotal(lines),
    raw_lines: lines.slice(0, 30), // first 30 lines for UI preview
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
      // pdf-parse — works on digital (searchable) PDFs instantly
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      const buffer = await fs.readFile(file.path);
      const parsed = await pdfParse(buffer);
      text = parsed.text ?? '';
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

    const extracted = extractInvoiceData(text);
    res.json(success(extracted));
  } catch (err: any) {
    console.error('[OCR] extraction error:', err.message);
    res.status(500).json(error('OCR extraction failed: ' + err.message));
  } finally {
    fs.unlink(file.path).catch(() => {});
  }
}
