/**
 * barcodeUtils.ts
 *
 * Smart Barcode encode / decode utilities.
 *
 * Format:  SC|{companyId}|{itemId}
 * Example: SC|a3f2c1d4-9b1e-4f2a-8c3d-1234567890ab|7f8e9d0c-1b2a-3c4d-5e6f-7890abcdef12
 *
 * - "SC" prefix   → identifies this as a Smart Code (vs. plain SKU or EAN-13)
 * - "|" delimiter → safe inside Code-128, completely unambiguous with UUID values
 * - UUID-safe     → no single-digit-length-header issues; split('|') always works
 *
 * Used by:
 *   - routes/labels.ts  (encode at print time)
 *   - itemController.ts (decode at scan time)
 */

import { query } from '../config/db';

const SMART_PREFIX = 'SC';
const SEP = '|';

/**
 * Gets the existing barcode for an item, or generates a new sequential 10-digit barcode.
 * Updates both items and barcode_registry tables.
 */
export async function getOrCreateItemBarcode(itemId: string, companyId: string, client?: any): Promise<string> {
  const db = client || { query };
  
  // 1. Check if item already has a barcode
  const itemRes = await db.query(
    'SELECT barcode, sku FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false',
    [itemId, companyId]
  );
  if (!itemRes.rows.length) {
    throw new Error('Item not found');
  }
  
  const item = itemRes.rows[0];
  if (item.barcode) {
    return item.barcode;
  }
  
  // 2. Generate a new sequential 10-digit numeric barcode
  let barcodeText = '';
  let unique = false;
  let attempts = 0;
  
  while (!unique && attempts < 100) {
    attempts++;
    const seqRes = await db.query("SELECT nextval('barcode_num_seq')");
    const nextVal = seqRes.rows[0].nextval;
    barcodeText = String(nextVal).padStart(10, '0');
    
    // Check if it's already used in items or barcode_registry
    const dupRes = await db.query(
      `SELECT 1 FROM items WHERE barcode = $1 AND is_deleted = false
       UNION
       SELECT 1 FROM barcode_registry WHERE barcode = $1`,
      [barcodeText]
    );
    if (dupRes.rows.length === 0) {
      unique = true;
    }
  }
  
  if (!unique) {
    throw new Error('Failed to generate a unique sequential barcode after multiple attempts.');
  }
  
  // 3. Save the generated barcode to the item
  await db.query('UPDATE items SET barcode = $1 WHERE id = $2', [barcodeText, itemId]);
  
  // 4. Save to barcode_registry
  await db.query(
    'INSERT INTO barcode_registry (barcode, item_id) VALUES ($1, $2) ON CONFLICT (barcode) DO NOTHING',
    [barcodeText, itemId]
  );
  
  return barcodeText;
}

/**
 * Encodes a companyId + itemId into a single smart barcode string.
 * The resulting string is passed to bwip-js as Code-128.
 */
export function encodeSmartBarcode(companyId: string, itemId: string): string {
  return `${SMART_PREFIX}${SEP}${companyId}${SEP}${itemId}`;
}

/**
 * Returns true if the raw string looks like a Smart Code.
 * Fast prefix-check — does not validate the UUID segments.
 */
export function isSmartBarcode(raw: string): boolean {
  return raw.startsWith(`${SMART_PREFIX}${SEP}`);
}

/**
 * Decodes a smart barcode string into its components.
 * Returns null if the string is not a valid smart barcode.
 */
export function decodeSmartBarcode(
  raw: string
): { companyId: string; itemId: string } | null {
  if (!isSmartBarcode(raw)) return null;
  const parts = raw.split(SEP);
  // Expected: ['SC', companyId, itemId]
  if (parts.length !== 3) return null;
  const companyId = parts[1]?.trim();
  const itemId = parts[2]?.trim();
  if (!companyId || !itemId) return null;
  return { companyId, itemId };
}
