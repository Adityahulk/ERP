import * as crypto from 'crypto';
import bwipjs from 'bwip-js';

// EAN-13 Generator
// 2-digit country prefix (20 for internal use)
// + 5-digit company sequence
// + 5-digit item sequence
// + 1-digit check digit
export function generateEAN13(companyId: string, itemSequence: number): string {
  const prefix = '20';
  
  // Create a 5-digit integer deterministic hash from company ID string
  const hash = crypto.createHash('md5').update(companyId).digest('hex');
  const compSeq = parseInt(hash.substring(0, 4), 16).toString().padStart(5, '0').slice(-5);
  
  const itemSeqStr = itemSequence.toString().padStart(5, '0');
  
  const code = prefix + compSeq + itemSeqStr;
  
  // Calculate EAN-13 check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(code[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  
  return code + checkDigit.toString();
}

// Generate Code-128
export async function generateCode128(text: string): Promise<Buffer> {
  return await bwipjs.toBuffer({
    bcid: 'code128',       // Barcode type
    text: text,            // Text to encode
    scale: 3,              // 3x scaling factor
    height: 12,            // Bar height, in millimeters
    includetext: true,     // Show human-readable text
    textxalign: 'center',  // Always good to set this
  });
}

// Generate QR Code
export async function generateQRCode(data: any): Promise<Buffer> {
  let text = typeof data === 'string' ? data : JSON.stringify(data);
  return await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: text,
    scale: 3,
  });
}

// NOTE: generateItemLabel & generateBulkLabels require Puppeteer parsing.
// We will place shell wrappers here for now. A full PDF engine is implemented in pdfService
export async function generateItemLabel(item: any, company: any, labelSize = '58x40'): Promise<Buffer> {
  // Logic shifted to pdfService that will render HTML using Chromium
  throw new Error("Label generation should use pdfService.ts directly");
}
