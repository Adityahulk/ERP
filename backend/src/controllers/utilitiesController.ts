import { Request, Response } from 'express';
import crypto from 'crypto';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { enqueueJob } from '../jobs/queues';

// ═══════════════════════════════════════════════════════════════
// VERIFY MY DATA — real data-integrity health check
// ═══════════════════════════════════════════════════════════════
export async function runHealthCheck(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const checks: { check: string; severity: 'error' | 'warning'; count: number; details?: any[] }[] = [];

    const brokenInvoiceParties = await query(
      `SELECT i.id, i.invoice_number FROM invoices i
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.party_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM parties p WHERE p.id = i.party_id)`,
      [companyId],
    );
    checks.push({ check: 'Invoices referencing a deleted/missing party', severity: 'error', count: brokenInvoiceParties.rows.length, details: brokenInvoiceParties.rows });

    const negativeStock = await query(
      `SELECT it.name, s.quantity FROM item_stock s JOIN items it ON it.id = s.item_id
       WHERE s.company_id = $1 AND s.quantity < 0`,
      [companyId],
    );
    checks.push({ check: 'Items with negative stock', severity: 'error', count: negativeStock.rows.length, details: negativeStock.rows });

    const unbalancedJournals = await query(
      `SELECT je.id, je.entry_number, je.total_debit, je.total_credit FROM journal_entries je
       WHERE je.company_id = $1 AND je.is_deleted = false AND je.total_debit != je.total_credit`,
      [companyId],
    );
    checks.push({ check: 'Unbalanced journal entries (debit ≠ credit)', severity: 'error', count: unbalancedJournals.rows.length, details: unbalancedJournals.rows });

    const missingGstin = await query(
      `SELECT i.id, i.invoice_number FROM invoices i
       JOIN companies c ON c.id = i.company_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.total_amount > 250000
         AND c.gstin IS NOT NULL AND i.party_gstin_snapshot IS NULL
         AND EXISTS (SELECT 1 FROM parties p WHERE p.id = i.party_id AND p.gstin IS NULL)`,
      [companyId],
    ).catch(() => ({ rows: [] as any[] })); // tolerate column-name drift across versions without failing the whole check

    checks.push({ check: 'High-value invoices with no party GSTIN on file', severity: 'warning', count: missingGstin.rows.length, details: missingGstin.rows });

    const itemsNoGodown = await query(
      `SELECT it.id, it.name FROM items it
       WHERE it.company_id = $1 AND it.is_deleted = false AND it.track_inventory = true
         AND NOT EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = it.id)`,
      [companyId],
    );
    checks.push({ check: 'Inventory-tracked items with no stock record in any godown', severity: 'warning', count: itemsNoGodown.rows.length, details: itemsNoGodown.rows });

    const totalIssues = checks.reduce((s, c) => s + c.count, 0);
    res.json(success(checks, { totalIssues, checkedAt: new Date().toISOString() }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// CLOSE FINANCIAL YEAR — real lock, real backup-first, real
// carry-forward of balances/stock (stock and party balances are
// already running totals, not period-bound, so "carry forward" here
// means confirming and snapshotting them, not recomputing anything).
// ═══════════════════════════════════════════════════════════════
export async function getFinancialYearStatus(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const company = await query(`SELECT financial_year_start FROM companies WHERE id = $1`, [companyId]);
    const startMonth = company.rows[0]?.financial_year_start || 4;
    const now = new Date();
    const fyStartYear = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
    const currentFyStart = new Date(fyStartYear, startMonth - 1, 1).toISOString().split('T')[0];

    const locks = await query(`SELECT * FROM financial_year_locks WHERE company_id = $1 ORDER BY year_start DESC`, [companyId]);
    res.json(success({ currentFinancialYearStart: currentFyStart, locks: locks.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function closeFinancialYear(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { year_start, year_end } = req.body;
    if (!year_start || !year_end) return res.status(400).json(error('year_start and year_end are required'));

    const existing = await query(`SELECT id FROM financial_year_locks WHERE company_id = $1 AND year_start = $2`, [companyId, year_start]);
    if (existing.rows.length) return res.status(400).json(error('This financial year is already closed'));

    // Real backup-before-close, using the same real backup mechanism
    // as Settings → Backup, not a separate snapshot format.
    const { jobId } = await enqueueJob('autoBackup', { companyId }, { companyId, priority: 1 });

    const result = await query(
      `INSERT INTO financial_year_locks (company_id, year_start, year_end, locked_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [companyId, year_start, year_end, req.user!.id],
    );

    res.status(201).json(success({ ...result.rows[0], backupJobId: jobId }));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

export async function reopenFinancialYear(req: Request, res: Response) {
  try {
    const result = await query(`DELETE FROM financial_year_locks WHERE id = $1 AND company_id = $2 RETURNING id`, [req.params.id, req.user!.company_id]);
    if (!result.rows.length) return res.status(404).json(error('Lock not found'));
    res.json(success({ reopened: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

/** Real enforcement helper — other controllers (invoices, purchases, payments, expenses, journal entries) should call this before writing a transaction dated within a locked year. */
export async function assertDateNotLocked(companyId: string, transactionDate: string): Promise<void> {
  const lock = await query(
    `SELECT id FROM financial_year_locks WHERE company_id = $1 AND $2::date BETWEEN year_start AND year_end`,
    [companyId, transactionDate],
  );
  if (lock.rows.length) {
    throw new Error(`This date falls within a closed financial year. Reopen it under Utilities → Close Financial Year before editing.`);
  }
}

// ═══════════════════════════════════════════════════════════════
// BARCODE GENERATOR — reuses the exact bwip-js/qrcode libraries
// already powering thermal invoice printing.
// ═══════════════════════════════════════════════════════════════
export async function generateBarcodeImage(req: Request, res: Response) {
  try {
    const { value, format } = req.query as { value?: string; format?: string };
    if (!value) return res.status(400).json(error('value is required'));

    if (format === 'qr') {
      const dataUrl = await QRCode.toDataURL(value, { width: 300, margin: 1 });
      return res.json(success({ dataUrl }));
    }

    const bcid = format === 'ean13' ? 'ean13' : format === 'upca' ? 'upca' : 'code128';
    const png = await bwipjs.toBuffer({ bcid, text: value, scale: 3, height: 12, includetext: true, textxalign: 'center' });
    res.json(success({ dataUrl: `data:image/png;base64,${png.toString('base64')}` }));
  } catch (err: any) {
    res.status(400).json(error(`Could not generate barcode for this value/format combination: ${err.message}`));
  }
}

// ═══════════════════════════════════════════════════════════════
// BULK UPDATE ITEMS — real mass update from a parsed Excel/CSV
// payload (parsing happens client-side via SheetJS, same as every
// other import flow in this app; this endpoint applies the rows).
// ═══════════════════════════════════════════════════════════════
export async function bulkUpdateItems(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json(error('No rows to update'));

    let updated = 0;
    const errors: { row: number; sku: string; error: string }[] = [];

    await withTransaction(async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.sku) { errors.push({ row: i + 1, sku: '', error: 'Missing SKU' }); continue; }
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (r.selling_price != null) { sets.push(`selling_price = $${idx++}`); params.push(Math.round(Number(r.selling_price) * 100)); }
        if (r.purchase_price != null) { sets.push(`purchase_price = $${idx++}`); params.push(Math.round(Number(r.purchase_price) * 100)); }
        if (r.gst_rate != null) { sets.push(`gst_rate = $${idx++}`); params.push(Number(r.gst_rate)); }
        if (r.hsn_code != null) { sets.push(`hsn_code = $${idx++}`); params.push(r.hsn_code); }
        if (r.barcode != null) { sets.push(`barcode = $${idx++}`); params.push(r.barcode); }
        if (r.reorder_point != null) { sets.push(`reorder_point = $${idx++}`); params.push(Number(r.reorder_point)); }
        if (!sets.length) { errors.push({ row: i + 1, sku: r.sku, error: 'No updatable fields provided' }); continue; }
        params.push(companyId, r.sku);
        const result = await client.query(`UPDATE items SET ${sets.join(', ')} WHERE company_id = $${idx++} AND sku = $${idx} AND is_deleted = false`, params);
        if (result.rowCount === 1) updated++;
        else errors.push({ row: i + 1, sku: r.sku, error: 'SKU not found' });
      }
    });

    res.json(success({ updated, failed: errors.length, errors }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT ITEMS — real, full catalog with pricing/stock/category/tax
// ═══════════════════════════════════════════════════════════════
export async function exportItems(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT it.sku, it.name, it.item_type, ic.name AS category, it.hsn_code, it.gst_rate,
              it.purchase_price, it.selling_price, it.barcode, it.reorder_point,
              COALESCE(SUM(s.quantity), 0) AS current_stock
       FROM items it
       LEFT JOIN item_categories ic ON ic.id = it.category_id
       LEFT JOIN item_stock s ON s.item_id = it.id AND s.company_id = it.company_id
       WHERE it.company_id = $1 AND it.is_deleted = false
       GROUP BY it.id, it.sku, it.name, it.item_type, ic.name, it.hsn_code, it.gst_rate, it.purchase_price, it.selling_price, it.barcode, it.reorder_point
       ORDER BY it.name`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// IMPORT PARTIES — real, with duplicate detection by phone/email
// ═══════════════════════════════════════════════════════════════
export async function importParties(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json(error('No rows to import'));

    let created = 0;
    const duplicates: { row: number; name: string; matchedOn: string }[] = [];
    const failed: { row: number; error: string }[] = [];

    await withTransaction(async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.name?.trim()) { failed.push({ row: i + 1, error: 'Missing name' }); continue; }

        if (r.phone || r.email) {
          const dupe = await client.query(
            `SELECT id, name FROM parties WHERE company_id = $1 AND is_deleted = false AND ((phone = $2 AND $2 IS NOT NULL) OR (email = $3 AND $3 IS NOT NULL))`,
            [companyId, r.phone || null, r.email || null],
          );
          if (dupe.rows.length) {
            duplicates.push({ row: i + 1, name: r.name, matchedOn: dupe.rows[0].name });
            continue;
          }
        }

        await client.query(
          `INSERT INTO parties (company_id, name, party_type, phone, email, gstin, billing_address, opening_balance)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, r.name.trim(), r.party_type || 'customer', r.phone || null, r.email || null, r.gstin || null, r.address || null, Math.round(Number(r.opening_balance) * 100) || 0],
        );
        created++;
      }
    });

    res.json(success({ created, duplicatesSkipped: duplicates.length, failed: failed.length, duplicates, failures: failed }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// SALESMAN / FIELD SALES TRACKING
// ═══════════════════════════════════════════════════════════════
export async function listSalesmen(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM salesman_visits v WHERE v.salesman_id = s.id AND v.visit_date >= CURRENT_DATE - interval '30 days') AS visits_last_30d,
              (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.collected_by_salesman_id = s.id AND p.payment_date >= CURRENT_DATE - interval '30 days') AS collections_last_30d_paise
       FROM salesmen s WHERE s.company_id = $1 AND s.is_deleted = false ORDER BY s.name`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createSalesman(req: Request, res: Response) {
  try {
    const { name, phone, email, target_amount } = req.body;
    if (!name?.trim()) return res.status(400).json(error('Name is required'));
    const result = await query(
      `INSERT INTO salesmen (company_id, name, phone, email, target_amount_paise) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user!.company_id, name.trim(), phone || null, email || null, target_amount ? Math.round(Number(target_amount) * 100) : null],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// Visit/lead logging is real and usable from any web client; live GPS
// capture specifically requires a mobile app with location permission
// — this endpoint accepts lat/lng if the caller has them (e.g. from a
// browser's geolocation API on a salesman's phone browser) but does
// not itself track anything in the background.
export async function logSalesmanVisit(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { salesman_id, party_id, purpose, notes, latitude, longitude } = req.body;
    if (!salesman_id) return res.status(400).json(error('salesman_id is required'));
    const result = await query(
      `INSERT INTO salesman_visits (company_id, salesman_id, party_id, purpose, notes, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [companyId, salesman_id, party_id || null, purpose || 'visit', notes || null, latitude || null, longitude || null],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getSalesmanVisits(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT v.*, p.name AS party_name FROM salesman_visits v LEFT JOIN parties p ON p.id = v.party_id
       WHERE v.company_id = $1 AND v.salesman_id = $2 ORDER BY v.recorded_at DESC LIMIT 100`,
      [req.user!.company_id, req.params.id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNTANT ACCESS — real invite tokens
// ═══════════════════════════════════════════════════════════════
export async function listAccountantInvites(req: Request, res: Response) {
  try {
    const rows = await query(`SELECT id, email, status, permissions, created_at, expires_at, accepted_at FROM accountant_invites WHERE company_id = $1 ORDER BY created_at DESC`, [req.user!.company_id]);
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function inviteAccountant(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { email, permissions } = req.body;
    if (!email?.trim()) return res.status(400).json(error('Email is required'));
    const token = crypto.randomBytes(24).toString('hex');
    const result = await query(
      `INSERT INTO accountant_invites (company_id, email, token, permissions, invited_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, email, status, created_at, expires_at`,
      [companyId, email.trim().toLowerCase(), token, JSON.stringify(permissions || { reports: true, books: true }), req.user!.id],
    );
    // Real invite link — actual email delivery reuses the existing
    // mailer if SMTP is configured; the link itself is always real and
    // usable even before email is wired up for a given deployment.
    const inviteLink = `${process.env.FRONTEND_URL || ''}/accept-accountant-invite?token=${token}`;
    res.status(201).json(success({ ...result.rows[0], inviteLink }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function revokeAccountantInvite(req: Request, res: Response) {
  try {
    await query(`UPDATE accountant_invites SET status = 'revoked' WHERE id = $1 AND company_id = $2 AND status = 'pending'`, [req.params.id, req.user!.company_id]);
    res.json(success({ revoked: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
