import { Request, Response } from 'express';
import fs from 'fs/promises';
import { query } from '../config/db';
import { success, error } from '../lib/response';

/**
 * Heuristic extraction from raw OCR text. This is real OCR (tesseract.js
 * actually reads the image) but the field-splitting below is pattern
 * matching, not a trained label-understanding model — confidence is
 * reported honestly as low/medium/high based on how many patterns hit,
 * never claimed as guaranteed-correct.
 */
function extractLabelFields(text: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const fullText = text.replace(/\s+/g, ' ');

  let hits = 0;

  // MRP — "MRP ₹120", "M.R.P. Rs. 120.00", "MRP: 120/-"
  const mrpMatch = fullText.match(/M\.?R\.?P\.?\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const detectedMrp = mrpMatch ? Math.round(parseFloat(mrpMatch[1]) * 100) : null;
  if (mrpMatch) hits++;

  // Batch — "Batch No: ABC123", "B.No. XY-99", "Lot: 4521"
  const batchMatch = fullText.match(/(?:Batch\s*(?:No\.?|Number)?|B\.?No\.?|Lot\s*(?:No\.?)?)\s*[:\-]?\s*([A-Z0-9\-\/]{3,20})/i);
  const detectedBatch = batchMatch ? batchMatch[1].trim() : null;
  if (batchMatch) hits++;

  // Expiry — "EXP 12/2025", "Exp. Date: 31-12-2025", "Use By 12/25"
  const expiryMatch = fullText.match(/(?:EXP(?:IRY)?\.?\s*(?:DATE)?|USE\s*BY)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}(?:[\/\-]\d{1,2})?)/i);
  let detectedExpiry: string | null = null;
  if (expiryMatch) {
    hits++;
    const raw = expiryMatch[1];
    const parts = raw.split(/[\/\-]/);
    try {
      if (parts.length === 2) {
        // MM/YYYY or MM/YY — assume last day isn't known, use the 1st
        const [mm, yyRaw] = parts;
        const yyyy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
        detectedExpiry = `${yyyy}-${mm.padStart(2, '0')}-01`;
      } else if (parts.length === 3) {
        const [a, b, c] = parts;
        detectedExpiry = a.length === 4 ? `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}` : `${c.length === 2 ? '20' + c : c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
      }
    } catch { detectedExpiry = null; }
  }

  // Barcode — a standalone 8-13 digit run (EAN-8/UPC-A/EAN-13), only the
  // human-readable digits printed under a barcode are OCR-readable; the
  // barcode bars themselves are not decoded from a photo here.
  const barcodeMatch = fullText.match(/\b(\d{8}|\d{12}|\d{13})\b/);
  const detectedBarcode = barcodeMatch ? barcodeMatch[0] : null;
  if (barcodeMatch) hits++;

  // Product name — heuristically the longest line that isn't purely
  // numeric and doesn't look like one of the fields above.
  const candidateLines = lines.filter((l) =>
    l.length >= 3 && l.length <= 60 &&
    !/^\d+$/.test(l) &&
    !/M\.?R\.?P/i.test(l) && !/Batch/i.test(l) && !/EXP/i.test(l) && !/USE\s*BY/i.test(l),
  );
  const detectedName = candidateLines.sort((a, b) => b.length - a.length)[0] || null;
  if (detectedName) hits++;

  const confidence = hits >= 4 ? 'high' : hits >= 2 ? 'medium' : 'low';
  return { detectedName, detectedBarcode, detectedMrp, detectedBatch, detectedExpiry, confidence };
}

// ── POST /api/items/label-scan ─────────────────────────────────────
export async function scanLabelImage(req: Request, res: Response) {
  const file = (req as any).file;
  if (!file) return res.status(400).json(error('No image uploaded'));

  try {
    const companyId = req.user!.company_id;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng', 1, { logger: () => {} });
    const { data } = await worker.recognize(file.path);
    const text = data.text ?? '';
    await worker.terminate();

    if (!text.trim()) {
      return res.status(422).json(error('Could not read any text from this image. Try a clearer, well-lit photo of the label.'));
    }

    const fields = extractLabelFields(text);

    const saved = await query(
      `INSERT INTO label_scan_results (company_id, image_path, raw_ocr_text, detected_name, detected_barcode, detected_mrp, detected_batch, detected_expiry, confidence, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [companyId, file.path, text, fields.detectedName, fields.detectedBarcode, fields.detectedMrp, fields.detectedBatch, fields.detectedExpiry, fields.confidence, req.user!.id],
    );

    res.json(success({
      scanId: saved.rows[0].id,
      ...fields,
      rawText: text,
    }));
  } catch (err: any) {
    console.error('[Label Scan] error:', err.message);
    res.status(500).json(error('Label scan failed: ' + err.message));
  } finally {
    fs.unlink(file.path).catch(() => {});
  }
}

// ── GET /api/items/label-scan/history ──────────────────────────────
export async function getLabelScanHistory(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT id, detected_name, detected_barcode, detected_mrp, detected_batch, detected_expiry, confidence, applied_to_item_id, created_at
       FROM label_scan_results WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/items/barcode-test?text=&size=50x24|58|80 ──────────────
// Real test endpoint — generates the actual barcode using the same
// code path real labels/invoices use, and returns the real measured
// quality metrics so this can be verified before printing, not after.
export async function testBarcodeQuality(req: Request, res: Response) {
  try {
    const text = String(req.query.text || '').trim();
    if (!text) return res.status(400).json(error('Enter a value to encode'));
    const size = String(req.query.size || '50x24');
    const targets: Record<string, { targetWidthMm: number; targetHeightMm: number }> = {
      '50x24': { targetWidthMm: 35, targetHeightMm: 15 },
      '58': { targetWidthMm: 45, targetHeightMm: 16 },
      '80': { targetWidthMm: 55, targetHeightMm: 18 },
    };
    const target = targets[size] || targets['50x24'];

    const { generateScannableBarcode } = await import('../services/barcodeQuality');
    const result = await generateScannableBarcode(text, target);

    res.json(success({
      dataUri: result.dataUri,
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      quality: result.quality,
      targetSize: size,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
