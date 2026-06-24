import { Request, Response } from 'express';
import { generateInvoicePDF } from '../services/pdfService';
import { resolveBankSnapshotsForInsert, resolveCompanyRowForInvoicePdf, type Queryable } from '../lib/bankAccountSnapshots';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import { calculateInvoiceTotals, determineGSTType } from '../services/gstService';
import { postPurchaseInvoiceAccounting } from '../services/accountingService';
import { normalizeInvoicePrintTheme } from '../lib/printThemes';

// ── Helpers ───────────────────────────────────────────────────
const PURCHASE_BILL_NUMBER_PATTERN = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const PURCHASE_BILL_NUMBER_MESSAGE =
  'Bill number must be 1-16 characters, start with A-Z or 1-9, and only contain letters, numbers, / or -.';

function validatePurchaseBillNumber(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!PURCHASE_BILL_NUMBER_PATTERN.test(s)) {
    throw new Error(PURCHASE_BILL_NUMBER_MESSAGE);
  }
  return s;
}

async function assertPurchaseBillNumberAvailable(
  db: Queryable,
  companyId: string,
  billNumber: string,
  excludeBillId?: string,
) {
  const params: any[] = [companyId, billNumber];
  let excludeSql = '';
  if (excludeBillId) {
    params.push(excludeBillId);
    excludeSql = ` AND id <> $${params.length}`;
  }
  const dup = await db.query(
    `SELECT id FROM purchase_invoices
     WHERE company_id = $1 AND bill_number = $2 AND is_deleted = false${excludeSql}
     LIMIT 1`,
    params,
  );
  if (dup.rows.length) {
    throw new Error(`Bill number "${billNumber}" is already used. Please enter a unique bill number.`);
  }
}

async function resolvePurchaseBillNumber(
  db: Queryable,
  companyId: string,
  requested: unknown,
  excludeBillId?: string,
): Promise<string> {
  const manual = String(requested ?? '').trim();
  if (manual) {
    const billNumber = validatePurchaseBillNumber(manual);
    await assertPurchaseBillNumberAvailable(db, companyId, billNumber, excludeBillId);
    return billNumber;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cntRes = await db.query(
      `SELECT COUNT(*) FROM purchase_invoices WHERE company_id = $1 AND created_at >= date_trunc('year', now())`,
      [companyId],
    );
    const seq = parseInt(cntRes.rows[0].count) + 1 + attempt;
    const yr = new Date().getFullYear().toString().slice(-2);
    const billNumber = validatePurchaseBillNumber(`BILL/${yr}/${String(seq).padStart(4, '0')}`);
    try {
      await assertPurchaseBillNumberAvailable(db, companyId, billNumber, excludeBillId);
      return billNumber;
    } catch (err: any) {
      if (attempt === 4 || !/already used/i.test(err?.message || '')) throw err;
    }
  }

  throw new Error('Could not generate a unique bill number');
}

async function generatePONumber(companyId: string): Promise<string> {
  const prefixRes = await query('SELECT po_prefix FROM companies WHERE id = $1', [companyId]);
  const prefix = prefixRes.rows[0]?.po_prefix || 'PO';

  const countRes = await query(
    `SELECT COUNT(*) as count FROM purchase_orders WHERE company_id = $1 AND created_at >= date_trunc('year', now())`,
    [companyId]
  );
  const nextSeq = parseInt(countRes.rows[0].count) + 1;
  const yearStr = new Date().getFullYear().toString().slice(-2);
  
  return `${prefix}/${yearStr}/${String(nextSeq).padStart(4, '0')}`;
}

// ── Purchase Orders ───────────────────────────────────────────
export async function createPurchaseOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;

    const result = await withTransaction(async (client) => {
      const poNumber = await generatePONumber(companyId);

      const pRes = await client.query('SELECT state_code, name FROM parties WHERE id = $1', [d.party_id]);
      if (!pRes.rows.length) throw new Error('Supplier not found');

      const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      const gstType = determineGSTType(pRes.rows[0].state_code, cRes.rows[0].state_code);
      const isGstInvoice = d.is_gst_invoice !== false;

      const itemsForTotals = Array.isArray(d.items)
        ? d.items.map((item: any) => ({ ...item, gst_rate: isGstInvoice ? item.gst_rate : 0 }))
        : [];
      const totals = calculateInvoiceTotals(itemsForTotals, gstType, 'none', 0);

      const poRes = await client.query(
        `INSERT INTO purchase_orders (
          company_id, godown_id, po_number, po_date, expected_date, party_id, party_name_snapshot,
          subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
          status, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16) RETURNING *`,
        [
          companyId, d.godown_id, poNumber, d.po_date || new Date().toISOString().split('T')[0],
          d.expected_date, d.party_id, pRes.rows[0].name,
          totals.subtotal, totals.globalDiscountAmount, totals.totalTaxable,
          totals.totalCgst, totals.totalSgst, totals.totalIgst, totals.totalAmount,
          d.notes, req.user!.id
        ]
      );

      const poId = poRes.rows[0].id;

      for (const item of d.items) {
        const itemForTax = { ...item, gst_rate: isGstInvoice ? item.gst_rate : 0 };
        const itemTax = calculateInvoiceTotals([itemForTax], gstType, 'none', 0);
        await client.query(
          `INSERT INTO purchase_order_items (
            po_id, item_id, item_name, hsn_code, quantity_ordered, unit_price,
            discount_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            poId, item.item_id, item.item_name || 'Item', item.hsn_code,
            item.quantity, item.unit_price, itemTax.totalDiscountLineLevel,
            isGstInvoice ? item.gst_rate || 0 : 0, itemTax.totalCgst, itemTax.totalSgst, itemTax.totalIgst,
            itemTax.totalAmount
          ]
        );
      }

      return poRes.rows[0];
    });

    await logAction(req.user!.id, companyId, 'create', 'purchase_order', result.id);
    res.status(201).json(success(result));
  } catch (err: any) {
    console.error('purchaseController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

export async function listPurchaseOrders(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status } = req.query;
    
    let where = 'company_id = $1 AND is_deleted = false';
    const params: any[] = [req.user!.company_id];
    let idx = 2;

    if (status) { where += ` AND status = $${idx++}`; params.push(status); }

    const countRes = await query(`SELECT COUNT(*) FROM purchase_orders WHERE ${where}`, params);
    const result = await query(
      `SELECT po.*,
              COALESCE((SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.po_id = po.id), 0) AS item_count,
              COALESCE((SELECT SUM(poi.quantity_ordered) FROM purchase_order_items poi WHERE poi.po_id = po.id), 0) AS total_quantity
       FROM purchase_orders po WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit)));
  } catch (err: any) {
    console.error('purchaseController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

export async function getPurchaseOrder(req: Request, res: Response) {
  try {
    const po = await query('SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2', [req.params.id, req.user!.company_id]);
    if (!po.rows.length) return res.status(404).json(error('Not found'));
    const items = await query('SELECT * FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    res.json(success({ ...po.rows[0], items: items.rows }));
  } catch (err: any) {
    console.error('purchaseController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

export async function updatePurchaseOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const poId = req.params.id;
    const d = req.body;

    const result = await withTransaction(async (client) => {
      const statusRes = await client.query(
        'SELECT status FROM purchase_orders WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [poId, companyId],
      );
      if (!statusRes.rows.length) throw new Error('PO not found');
      if (statusRes.rows[0].status !== 'draft') throw new Error('Only draft POs can be edited');

      const pRes = await client.query('SELECT state_code, name FROM parties WHERE id = $1', [d.party_id]);
      if (!pRes.rows.length) throw new Error('Supplier not found');

      const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      const gstType = determineGSTType(pRes.rows[0].state_code, cRes.rows[0].state_code);
      const totals = calculateInvoiceTotals(d.items, gstType, 'none', 0);

      await client.query(
        `UPDATE purchase_orders SET
          godown_id = $1, expected_date = $2, party_id = $3, party_name_snapshot = $4,
          subtotal = $5, discount_amount = $6, taxable_amount = $7,
          cgst_amount = $8, sgst_amount = $9, igst_amount = $10, total_amount = $11,
          notes = $12
        WHERE id = $13 AND company_id = $14`,
        [
          d.godown_id,
          d.expected_date,
          d.party_id,
          pRes.rows[0].name,
          totals.subtotal,
          totals.globalDiscountAmount,
          totals.totalTaxable,
          totals.totalCgst,
          totals.totalSgst,
          totals.totalIgst,
          totals.totalAmount,
          d.notes ?? null,
          poId,
          companyId,
        ],
      );

      await client.query('DELETE FROM purchase_order_items WHERE po_id = $1', [poId]);

      for (const item of d.items) {
        const itemTax = calculateInvoiceTotals([item], gstType, 'none', 0);
        await client.query(
          `INSERT INTO purchase_order_items (
            po_id, item_id, item_name, hsn_code, quantity_ordered, unit_price,
            discount_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            poId,
            item.item_id,
            item.item_name || 'Item',
            item.hsn_code,
            item.quantity,
            item.unit_price,
            itemTax.totalDiscountLineLevel,
            item.gst_rate || 0,
            itemTax.totalCgst,
            itemTax.totalSgst,
            itemTax.totalIgst,
            itemTax.totalAmount,
          ],
        );
      }

      const out = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [poId]);
      return out.rows[0];
    });

    await logAction(req.user!.id, companyId, 'update', 'purchase_order', poId);
    res.json(success(result));
  } catch (err: any) {
    console.error('receiveStock error:', err.message, err.detail, err.position);
    res.status(400).json(error(err.message));
  }
}

export async function confirmPurchaseOrder(req: Request, res: Response) {
  try {
    await query("UPDATE purchase_orders SET status = 'confirmed' WHERE id = $1 AND status = 'draft'", [req.params.id]);
    res.json(success({ message: 'PO Confirmed' }));
  } catch (err: any) {
    console.error('purchaseController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

export async function cancelPurchaseOrder(req: Request, res: Response) {
  try {
    await query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1 AND status IN ('draft','confirmed')", [req.params.id]);
    res.json(success({ message: 'PO Cancelled' }));
  } catch (err: any) {
    console.error('purchaseController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── Receive Stock (GRN) ───────────────────────────────────────
export async function receiveStock(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const d = req.body; // { bill_number, bill_date, items: [{ po_item_id, quantity_received, unit_price, ...}]}

    const result = await withTransaction(async (client) => {
      const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, companyId]);
      if (!poRes.rows.length) throw new Error('PO not found');
      const po = poRes.rows[0];

      if (po.status === 'received' || po.status === 'cancelled') throw new Error('Cannot receive stock for this PO state');

      // 1. Calculate totals for actual received invoice
      const pRes = await client.query('SELECT state_code FROM parties WHERE id = $1', [po.party_id]);
      const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      const gstType = determineGSTType(pRes.rows[0].state_code, cRes.rows[0].state_code);
      const isGstInvoice = d.is_gst_invoice !== false;

      const poItemsRes = await client.query('SELECT * FROM purchase_order_items WHERE po_id = $1', [id]);
      const poItemById = new Map<string, Record<string, unknown>>(
        poItemsRes.rows.map((r: Record<string, unknown>) => [String(r.id), r]),
      );

      const itemsForTotals: Array<{
        unit_price: number;
        quantity: number;
        gst_rate: number;
        discount_type: 'none';
        discount_value: number;
      }> = [];
      for (const reqItem of d.items as Array<Record<string, unknown>>) {
        const qty = Number(reqItem.quantity_received);
        if (!qty || qty <= 0) continue;
        const poItem = poItemById.get(String(reqItem.po_item_id));
        if (!poItem) throw new Error('PO line not found for one or more items');
        const unitPricePaise =
          Number(reqItem.unit_price) > 0 ? Number(reqItem.unit_price) : Number(poItem.unit_price) || 0;
        itemsForTotals.push({
          unit_price: unitPricePaise,
          quantity: qty,
          gst_rate: isGstInvoice ? Number(reqItem.gst_rate ?? poItem.gst_rate ?? 0) : 0,
          discount_type: 'none',
          discount_value: 0,
        });
      }
      if (itemsForTotals.length === 0) throw new Error('No quantities to receive');

      const invoiceTotals = calculateInvoiceTotals(itemsForTotals, gstType, 'none', 0);

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const grnBillNumber = await resolvePurchaseBillNumber(client, companyId, d.bill_number);

      // 2. Create Purchase Invoice
      const invRes = await client.query(
        `INSERT INTO purchase_invoices (
          company_id, godown_id, bill_number, bill_date, po_id, party_id,
          subtotal, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
          status, created_by, pdf_template, document_theme,
          company_bank_account_id, bank_label_snapshot, bank_name_snapshot, bank_account_number_snapshot,
          bank_ifsc_snapshot, bank_branch_snapshot, upi_id_snapshot
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'received',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [
          companyId, po.godown_id, grnBillNumber, d.bill_date, po.id, po.party_id,
          invoiceTotals.subtotal, invoiceTotals.totalTaxable,
          invoiceTotals.totalCgst, invoiceTotals.totalSgst, invoiceTotals.totalIgst,
          invoiceTotals.totalAmount, req.user!.id,
          normalizeInvoicePrintTheme(d.pdf_template || d.document_theme),
          normalizeInvoicePrintTheme(d.document_theme || d.pdf_template),
          bankSnap.company_bank_account_id,
          bankSnap.bank_label_snapshot,
          bankSnap.bank_name_snapshot,
          bankSnap.bank_account_number_snapshot,
          bankSnap.bank_ifsc_snapshot,
          bankSnap.bank_branch_snapshot,
          bankSnap.upi_id_snapshot,
        ]
      );
      const invoice = invRes.rows[0];

      // 3. Process each received item
      let fullyReceived = true;

      for (const reqItem of d.items) {
        if (!reqItem.quantity_received || reqItem.quantity_received <= 0) continue;

        const poItem = poItemById.get(String(reqItem.po_item_id));
        if (!poItem) throw new Error('PO Item reference missing');

        // Ensure received doesn't exceed ordered completely unless explicitly allowing excess. For simplicity, assume exact matching limits
        const ordered = Number(poItem.quantity_ordered);
        const newReceived = Number(poItem.quantity_received) + Number(reqItem.quantity_received);
        if (newReceived > ordered) {
          throw new Error(
            `Receive quantity exceeds ordered for line "${poItem.item_name}": ordered ${ordered}, already ${poItem.quantity_received}, receiving ${reqItem.quantity_received}`,
          );
        }
        if (newReceived < ordered) fullyReceived = false;

        const unitPricePaise =
          Number(reqItem.unit_price) > 0 ? Number(reqItem.unit_price) : Number(poItem.unit_price) || 0;
        const lineForTax = {
          unit_price: unitPricePaise,
          quantity: Number(reqItem.quantity_received),
          gst_rate: isGstInvoice ? Number(reqItem.gst_rate ?? poItem.gst_rate ?? 0) : 0,
          discount_type: 'none' as const,
          discount_value: 0,
        };

        // Update PO Item quantity tracker
        await client.query('UPDATE purchase_order_items SET quantity_received = $1 WHERE id = $2', [newReceived, reqItem.po_item_id]);

        const lineTax = calculateInvoiceTotals([lineForTax], gstType, 'none', 0);

        // Optional Batch Creation
        let batchId = null;
        if (reqItem.batch_number) {
          const bRes = await client.query(
            `INSERT INTO item_batches (company_id, item_id, batch_number, manufacturing_date, expiry_date, quantity, purchase_price, godown_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
             [companyId, poItem.item_id, reqItem.batch_number, reqItem.mfg_date || null, reqItem.expiry_date || null, reqItem.quantity_received, unitPricePaise, po.godown_id]
          );
          batchId = bRes.rows[0].id;
        }

        // Insert Purchase Invoice Line
        await client.query(
          `INSERT INTO purchase_invoice_items (
            purchase_invoice_id, item_id, item_name, quantity, unit_price,
            gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount, batch_id, serial_numbers
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            invoice.id, poItem.item_id, poItem.item_name, reqItem.quantity_received, unitPricePaise,
            isGstInvoice ? (reqItem.gst_rate || poItem.gst_rate) : 0, lineTax.totalCgst, lineTax.totalSgst, lineTax.totalIgst, lineTax.totalAmount, batchId, (reqItem.serial_numbers && reqItem.serial_numbers.length > 0) ? reqItem.serial_numbers : null
          ]
        );

        // Stock Addition via explicit UPSERT
        if (poItem.item_id && po.godown_id) {
          const stockMerge = await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET
               quantity = item_stock.quantity + EXCLUDED.quantity,
               avg_cost_price = CASE 
                 WHEN item_stock.quantity + EXCLUDED.quantity > 0 
                 THEN ROUND(((item_stock.quantity * item_stock.avg_cost_price) + (EXCLUDED.quantity * EXCLUDED.avg_cost_price)) / (item_stock.quantity + EXCLUDED.quantity))
                 ELSE EXCLUDED.avg_cost_price END
             RETURNING quantity, avg_cost_price`,
            [companyId, poItem.item_id, po.godown_id, reqItem.quantity_received, unitPricePaise]
          );

          const mergedRow = stockMerge.rows[0];
          const avgCost = Number(mergedRow?.avg_cost_price ?? unitPricePaise);

          // Update Global Master weighted cost (simplification, using the godown merged price globally for consistency)
          await client.query('UPDATE items SET purchase_price = $1 WHERE id = $2', [avgCost, poItem.item_id]);

          // Insert Movement
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, unit_cost, balance_after, created_by)
             VALUES ($1, $2, $3, 'purchase', 'purchase_invoice', $4, $5, $6, $7, $8)`,
            [companyId, poItem.item_id, po.godown_id, invoice.id, reqItem.quantity_received, unitPricePaise, mergedRow.quantity, req.user!.id]
          );
        }

        // Serial Insertions
        if (reqItem.serial_numbers && reqItem.serial_numbers.length > 0) {
           for (const serial of reqItem.serial_numbers) {
              await client.query(
                `INSERT INTO item_serial_numbers (company_id, item_id, serial_number, status, purchase_invoice_id, godown_id)
                 VALUES ($1, $2, $3, 'available', $4, $5)`,
                 [companyId, poItem.item_id, serial, invoice.id, po.godown_id]
              );
           }
        }
      }

      // Update PO Status
      await client.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', [fullyReceived ? 'received' : 'partial', po.id]);

      // Update Party outstanding Ledger
      await client.query('UPDATE parties SET balance = balance - $1 WHERE id = $2', [invoiceTotals.totalAmount, po.party_id]);
      const partyBalRes = await client.query('SELECT balance FROM parties WHERE id = $1', [po.party_id]);
      const partyBalanceAfter = partyBalRes.rows[0]?.balance ?? 0;
      await client.query(
        `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
         VALUES ($1, $2, 'credit', $3, $4, 'purchase_invoice', $5, $6, $7)`,
        [companyId, po.party_id, invoiceTotals.totalAmount, partyBalanceAfter, invoice.id, `Received GRN Bill ${grnBillNumber}`, req.user!.id]
      );

      await postPurchaseInvoiceAccounting(client, companyId, invoice, req.user!.id);
      return invoice;
    });

    res.json(success(result));
  } catch (err: any) {
    console.error('purchaseController error:', err.message, err.detail, err.position);
    const msg = err?.message || 'Failed to receive stock';
    const status = /Bill number|PO not found|Cannot receive|No quantities|not found/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

// ── CREATE Purchase Invoice directly (without PO) ─────────────
export async function createPurchaseInvoiceDirect(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.party_id) return res.status(400).json(error('party_id is required'));
    if (!d.bill_date) return res.status(400).json(error('bill_date is required'));
    if (!Array.isArray(d.items) || d.items.length === 0) return res.status(400).json(error('items are required'));

    const result = await withTransaction(async (client) => {
      const billNumber = await resolvePurchaseBillNumber(client, companyId, d.bill_number);

      const pRes = await client.query('SELECT state_code FROM parties WHERE id = $1', [d.party_id]);
      if (!pRes.rows.length) throw new Error('Party not found');
      const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      const gstType = determineGSTType(pRes.rows[0].state_code, cRes.rows[0].state_code);
      const isGst = d.is_gst_invoice !== false;

      const itemsForTotals = d.items.map((it: any) => ({
        unit_price: Number(it.unit_price) || 0,
        quantity: Number(it.quantity) || 0,
        gst_rate: isGst ? Number(it.gst_rate) || 0 : 0,
        discount_type: 'none' as const,
        discount_value: 0,
      }));
      const totals = calculateInvoiceTotals(itemsForTotals, gstType, 'none', 0);

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const invRes = await client.query(
        `INSERT INTO purchase_invoices (
          company_id, godown_id, bill_number, bill_date, po_id, party_id,
          subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
          paid_amount, payment_status, status, notes, created_by,
          company_bank_account_id, bank_label_snapshot, bank_name_snapshot, bank_account_number_snapshot,
          bank_ifsc_snapshot, bank_branch_snapshot, upi_id_snapshot
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,'unpaid','received',$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [
          companyId, d.godown_id || null, billNumber, d.bill_date,
          d.po_id || null, d.party_id,
          totals.subtotal, 0, totals.totalTaxable,
          totals.totalCgst, totals.totalSgst, totals.totalIgst, totals.totalAmount,
          d.notes || null, req.user!.id,
          bankSnap.company_bank_account_id,
          bankSnap.bank_label_snapshot,
          bankSnap.bank_name_snapshot,
          bankSnap.bank_account_number_snapshot,
          bankSnap.bank_ifsc_snapshot,
          bankSnap.bank_branch_snapshot,
          bankSnap.upi_id_snapshot,
        ],
      );
      const inv = invRes.rows[0];

      for (const item of d.items) {
        const lineTotals = calculateInvoiceTotals(
          [{ unit_price: Number(item.unit_price)||0, quantity: Number(item.quantity)||0, gst_rate: isGst ? Number(item.gst_rate)||0 : 0, discount_type: 'none' as const, discount_value: 0 }],
          gstType, 'none', 0,
        );
        await client.query(
          `INSERT INTO purchase_invoice_items (
            purchase_invoice_id, item_id, item_name, hsn_code, unit, quantity, unit_price,
            gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            inv.id, item.item_id || null, item.item_name || 'Item',
            item.hsn_code || null, item.unit || 'PCS',
            Number(item.quantity)||0, Number(item.unit_price)||0,
            isGst ? Number(item.gst_rate)||0 : 0,
            lineTotals.totalCgst, lineTotals.totalSgst, lineTotals.totalIgst, lineTotals.totalAmount,
          ],
        );

        // Update stock if item tracked and godown provided
        if (item.item_id && d.godown_id) {
          await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET
               quantity = item_stock.quantity + EXCLUDED.quantity,
               avg_cost_price = CASE WHEN item_stock.quantity + EXCLUDED.quantity > 0
                 THEN ROUND(((item_stock.quantity * item_stock.avg_cost_price) + (EXCLUDED.quantity * EXCLUDED.avg_cost_price)) / (item_stock.quantity + EXCLUDED.quantity))
                 ELSE EXCLUDED.avg_cost_price END`,
            [companyId, item.item_id, d.godown_id, Number(item.quantity)||0, Number(item.unit_price)||0],
          );
        }
      }

      // Update party ledger (purchase increases payable = decreases balance)
      await client.query('UPDATE parties SET balance = balance - $1 WHERE id = $2', [totals.totalAmount, d.party_id]);
      const balRes = await client.query('SELECT balance FROM parties WHERE id = $1', [d.party_id]);
      await client.query(
        `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
         VALUES ($1,$2,'credit',$3,$4,'purchase_invoice',$5,$6,$7)`,
        [companyId, d.party_id, totals.totalAmount, balRes.rows[0].balance, inv.id, `Purchase Bill ${billNumber}`, req.user!.id],
      );

      await postPurchaseInvoiceAccounting(client, companyId, inv, req.user!.id);
      return inv;
    });

    await logAction(req.user!.id, companyId, 'create', 'purchase_invoice', result.id);
    res.status(201).json(success(result));
  } catch (err: any) {
    console.error('createPurchaseInvoiceDirect error:', err.message);
    const msg = err?.message || 'Failed to create bill';
    const status = /Bill number|party_id|bill_date|items are required|Party not found/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

// ── GET Invoices ──────────────────────────────────────────────
export async function listPurchaseInvoices(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { payment_status, party_id, search } = req.query;

    let where = 'pi.company_id = $1 AND pi.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;
    if (payment_status) { where += ` AND pi.payment_status = $${idx++}`; params.push(payment_status); }
    if (party_id) { where += ` AND pi.party_id = $${idx++}`; params.push(party_id); }
    if (search) { where += ` AND (pi.bill_number ILIKE $${idx} OR p.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM purchase_invoices pi LEFT JOIN parties p ON pi.party_id = p.id WHERE ${where}`, params);
    const result = await query(
      `SELECT pi.*, p.name as party_name, p.phone as party_phone,
              COALESCE((SELECT COUNT(*) FROM purchase_invoice_items pii WHERE pii.purchase_invoice_id = pi.id), 0) AS item_count,
              COALESCE((SELECT SUM(pii.quantity) FROM purchase_invoice_items pii WHERE pii.purchase_invoice_id = pi.id), 0) AS total_quantity
       FROM purchase_invoices pi LEFT JOIN parties p ON pi.party_id = p.id
       WHERE ${where} ORDER BY pi.bill_date DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset],
    );

    // Stats
    const statsRes = await query(
      `SELECT
         COALESCE(SUM(total_amount),0) as total_amount,
         COALESCE(SUM(paid_amount),0) as total_paid,
         COALESCE(SUM(total_amount - paid_amount),0) as total_unpaid
       FROM purchase_invoices WHERE company_id = $1 AND is_deleted = false`,
      [companyId],
    );

    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit), statsRes.rows[0]));
  } catch(err: any) { res.status(500).json(error(err.message)); }
}

export async function getPurchaseInvoice(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const result = await query(
      'SELECT * FROM purchase_invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false',
      [req.params.id, companyId],
    );
    if (!result.rows.length) return res.status(404).json(error('Not found'));
    const items = await query('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = $1', [req.params.id]);
    res.json(success({ ...result.rows[0], items: items.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

/** PATCH supplier bill (direct bills only, unpaid): reverses stock & party effect, replaces lines. */
export async function updatePurchaseInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.party_id) return res.status(400).json(error('party_id is required'));
    if (!d.bill_date) return res.status(400).json(error('bill_date is required'));
    if (!Array.isArray(d.items) || d.items.length === 0) return res.status(400).json(error('items are required'));

    const result = await withTransaction(async (client) => {
      const piRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!piRes.rows.length) throw new Error('Bill not found');
      const pi = piRes.rows[0];
      if (Number(pi.paid_amount || 0) > 0) throw new Error('Cannot edit a bill that has payments recorded');
      if (pi.po_id) {
        throw new Error('Cannot edit a bill created from a purchase order. Adjust stock on the order / GRN instead.');
      }

      const oldLines = await client.query(
        'SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = $1 ORDER BY id',
        [id],
      );

      await client.query(
        `DELETE FROM party_ledger WHERE company_id = $1 AND reference_type = 'purchase_invoice' AND reference_id = $2`,
        [companyId, id],
      );

      const oldTotal = Number(pi.total_amount || 0);
      const oldParty = pi.party_id;
      if (oldParty && oldTotal) {
        await client.query(`UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3`, [
          oldTotal,
          oldParty,
          companyId,
        ]);
      }

      const oldGodown = pi.godown_id;
      for (const line of oldLines.rows) {
        if (!line.item_id || !oldGodown) continue;
        const qty = Number(line.quantity) || 0;
        if (qty <= 0) continue;
        const stockRes = await client.query(
          `SELECT quantity FROM item_stock WHERE company_id = $1 AND item_id = $2 AND godown_id = $3 FOR UPDATE`,
          [companyId, line.item_id, oldGodown],
        );
        if (!stockRes.rows.length) throw new Error(`No stock row for "${line.item_name}" — cannot reverse this bill safely.`);
        const q = Number(stockRes.rows[0].quantity || 0);
        if (q < qty) {
          throw new Error(
            `Cannot edit: on-hand stock for "${line.item_name}" is ${q} but this bill added ${qty}. Sell or adjust stock first.`,
          );
        }
        await client.query(
          `UPDATE item_stock SET quantity = quantity - $1 WHERE company_id = $2 AND item_id = $3 AND godown_id = $4`,
          [qty, companyId, line.item_id, oldGodown],
        );
      }

      await client.query(`DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = $1`, [id]);

      const pRes = await client.query(
        'SELECT state_code FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false',
        [d.party_id, companyId],
      );
      if (!pRes.rows.length) throw new Error('Party not found');
      const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      const gstType = determineGSTType(pRes.rows[0].state_code, cRes.rows[0].state_code);
      const isGst = d.is_gst_invoice !== false;

      const itemsForTotals = d.items.map((it: any) => ({
        unit_price: Number(it.unit_price) || 0,
        quantity: Number(it.quantity) || 0,
        gst_rate: isGst ? Number(it.gst_rate) || 0 : 0,
        discount_type: 'none' as const,
        discount_value: 0,
      }));
      const totals = calculateInvoiceTotals(itemsForTotals, gstType, 'none', 0);

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const billNumber = d.bill_number !== undefined
        ? await resolvePurchaseBillNumber(client, companyId, d.bill_number, id)
        : validatePurchaseBillNumber(pi.bill_number);

      const pdfTpl = normalizeInvoicePrintTheme(d.pdf_template || d.document_theme || pi.pdf_template || pi.document_theme);
      const docTheme = normalizeInvoicePrintTheme(d.document_theme || d.pdf_template || pi.document_theme || pi.pdf_template);

      await client.query(
        `UPDATE purchase_invoices SET
          party_id = $1, godown_id = $2, bill_number = $3, bill_date = $4,
          subtotal = $5, discount_amount = 0, taxable_amount = $6,
          cgst_amount = $7, sgst_amount = $8, igst_amount = $9, total_amount = $10,
          notes = $11, is_gst_invoice = $12,
          company_bank_account_id = $13, bank_label_snapshot = $14, bank_name_snapshot = $15,
          bank_account_number_snapshot = $16, bank_ifsc_snapshot = $17, bank_branch_snapshot = $18, upi_id_snapshot = $19,
          pdf_template = $20, document_theme = $21,
          updated_at = NOW()
        WHERE id = $22 AND company_id = $23`,
        [
          d.party_id,
          d.godown_id || null,
          billNumber,
          d.bill_date,
          totals.subtotal,
          totals.totalTaxable,
          totals.totalCgst,
          totals.totalSgst,
          totals.totalIgst,
          totals.totalAmount,
          d.notes ?? pi.notes,
          isGst,
          bankSnap.company_bank_account_id,
          bankSnap.bank_label_snapshot,
          bankSnap.bank_name_snapshot,
          bankSnap.bank_account_number_snapshot,
          bankSnap.bank_ifsc_snapshot,
          bankSnap.bank_branch_snapshot,
          bankSnap.upi_id_snapshot,
          pdfTpl,
          docTheme,
          id,
          companyId,
        ],
      );

      const godownId = d.godown_id || null;
      for (const item of d.items) {
        const lineTotals = calculateInvoiceTotals(
          [
            {
              unit_price: Number(item.unit_price) || 0,
              quantity: Number(item.quantity) || 0,
              gst_rate: isGst ? Number(item.gst_rate) || 0 : 0,
              discount_type: 'none' as const,
              discount_value: 0,
            },
          ],
          gstType,
          'none',
          0,
        );
        await client.query(
          `INSERT INTO purchase_invoice_items (
            purchase_invoice_id, item_id, item_name, hsn_code, unit, quantity, unit_price,
            gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            item.item_id || null,
            item.item_name || item.name || 'Item',
            item.hsn_code || null,
            item.unit || 'PCS',
            Number(item.quantity) || 0,
            Number(item.unit_price) || 0,
            isGst ? Number(item.gst_rate) || 0 : 0,
            lineTotals.totalCgst,
            lineTotals.totalSgst,
            lineTotals.totalIgst,
            lineTotals.totalAmount,
          ],
        );

        if (item.item_id && godownId) {
          await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET
               quantity = item_stock.quantity + EXCLUDED.quantity,
               avg_cost_price = CASE WHEN item_stock.quantity + EXCLUDED.quantity > 0
                 THEN ROUND(((item_stock.quantity * item_stock.avg_cost_price) + (EXCLUDED.quantity * EXCLUDED.avg_cost_price)) / (item_stock.quantity + EXCLUDED.quantity))
                 ELSE EXCLUDED.avg_cost_price END`,
            [companyId, item.item_id, godownId, Number(item.quantity) || 0, Number(item.unit_price) || 0],
          );
        }
      }

      await client.query('UPDATE parties SET balance = balance - $1 WHERE id = $2 AND company_id = $3', [
        totals.totalAmount,
        d.party_id,
        companyId,
      ]);
      const balRes = await client.query('SELECT balance FROM parties WHERE id = $1', [d.party_id]);
      await client.query(
        `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
         VALUES ($1,$2,'credit',$3,$4,'purchase_invoice',$5,$6,$7)`,
        [companyId, d.party_id, totals.totalAmount, balRes.rows[0].balance, id, `Purchase Bill ${billNumber}`, req.user!.id],
      );

      const fresh = await client.query(`SELECT * FROM purchase_invoices WHERE id = $1 AND company_id = $2`, [id, companyId]);
      return fresh.rows[0];
    });

    await logAction(
      req.user!.id,
      companyId,
      'update',
      'purchase_invoice',
      id,
      null,
      { bill_number: result.bill_number },
      req.ip,
      req.get('User-Agent'),
    );
    res.json(success(result));
  } catch (err: any) {
    console.error('updatePurchaseInvoice error:', err.message);
    const msg = err?.message || 'Failed to update bill';
    const status = /not found|Cannot edit|No stock|Party not found|items are required|Bill number/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

export async function payPurchaseInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    const companyId = req.user!.company_id;

    const billRes = await query(
      'SELECT total_amount, paid_amount FROM purchase_invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false',
      [id, companyId]
    );
    if (!billRes.rows.length) return res.status(404).json(error('Bill not found'));

    const bill = billRes.rows[0];
    const newPaid = Number(bill.paid_amount || 0) + Number(amount);
    const total = Number(bill.total_amount || 0);
    const paymentStatus =
      newPaid <= 0 ? 'unpaid' :
      newPaid >= total ? 'paid' : 'partial';

    await query(
      'UPDATE purchase_invoices SET paid_amount = $1, payment_status = $2 WHERE id = $3',
      [newPaid, paymentStatus, id]
    );
    res.json(success({ message: 'Payment recorded', payment_status: paymentStatus }));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getPurchaseInvoicePDF(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const invRes = await query(
      `SELECT * FROM purchase_invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, req.user!.company_id],
    );
    if (!invRes.rows.length) return res.status(404).json(error('Purchase bill not found'));

    const companyRes = await query('SELECT * FROM companies WHERE id = $1', [req.user!.company_id]);
    const bankRes = await query(
      `SELECT * FROM company_bank_accounts
       WHERE company_id = $1 AND is_deleted = false AND is_active = true
       ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      [req.user!.company_id],
    );
    const companyForPdf = await resolveCompanyRowForInvoicePdf(
      ({ query } as Queryable),
      req.user!.company_id,
      companyRes.rows[0],
      invRes.rows[0],
      bankRes.rows[0] || null,
    );

    const partyRes = invRes.rows[0].party_id
      ? await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [invRes.rows[0].party_id, req.user!.company_id])
      : { rows: [null] };
    const itemsRes = await query(
      `SELECT
         purchase_invoice_id as invoice_id,
         item_id,
         item_name,
         hsn_code,
         unit,
         quantity,
         unit_price,
         discount_amount,
         taxable_amount,
         gst_rate,
         cgst_amount,
         sgst_amount,
         igst_amount,
         total_amount
       FROM purchase_invoice_items
       WHERE purchase_invoice_id = $1
       ORDER BY sort_order, id`,
      [id],
    );

    const invoiceLike = {
      ...invRes.rows[0],
      invoice_number: invRes.rows[0].bill_number || `PB-${String(id).slice(0, 8)}`,
      invoice_date: invRes.rows[0].bill_date,
      due_date: invRes.rows[0].due_date || null,
      party_name_snapshot: invRes.rows[0].party_name_snapshot,
      party_gstin_snapshot: partyRes.rows[0]?.gstin || null,
      billing_address_snapshot: partyRes.rows[0]?.billing_address || null,
      shipping_address_snapshot: partyRes.rows[0]?.shipping_address || null,
    };

    const pdfBuffer = await generateInvoicePDF(invoiceLike, companyForPdf, partyRes.rows[0], itemsRes.rows, {
      themeOverride: normalizeInvoicePrintTheme(invRes.rows[0].pdf_template || invRes.rows[0].document_theme),
    });
    const inline = String(req.query.inline || '') === '1';
    const filename = `${invoiceLike.invoice_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename=${filename}`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
