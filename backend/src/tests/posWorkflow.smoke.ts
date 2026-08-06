import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../middleware/auth';
import { pool } from '../config/db';
import { deductSaleStockAllowNegative } from '../controllers/invoiceController';
import { getOrCreateItemBarcode, registerItemBarcodeAlias } from '../utils/barcodeUtils';
import { generateThermalReceipt } from '../services/pdfService';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fixture = await client.query(
      `SELECT i.id AS item_id, i.company_id, s.godown_id, s.quantity, u.id AS user_id
       FROM items i
       JOIN item_stock s
         ON s.item_id = i.id AND s.company_id = i.company_id AND s.quantity >= 1
       JOIN users u
         ON u.company_id = i.company_id AND u.is_active = true AND u.is_deleted = false
       WHERE i.is_deleted = false AND i.is_active = true AND i.track_inventory = true
       ORDER BY s.quantity DESC
       LIMIT 1`,
    );
    if (!fixture.rows.length) {
      console.log('POS workflow smoke: skipped stock mutation checks (no stocked local fixture).');
    } else {
      const row = fixture.rows[0];
      const barcode = await getOrCreateItemBarcode(row.item_id, row.company_id, client);
      assert.ok(barcode.length >= 3);
      const alias = `POS-TEST-${Date.now()}`;
      await registerItemBarcodeAlias(row.item_id, row.company_id, alias, client);
      const aliasResult = await client.query(
        `SELECT item_id FROM barcode_registry WHERE company_id = $1 AND barcode = $2`,
        [row.company_id, alias],
      );
      assert.equal(aliasResult.rows[0]?.item_id, row.item_id);

      const before = Number(row.quantity);
      await deductSaleStockAllowNegative(client, {
        companyId: row.company_id,
        itemId: row.item_id,
        godownId: row.godown_id,
        invoiceId: '00000000-0000-0000-0000-000000000001',
        quantity: 1,
        userId: row.user_id,
        allowNegative: false,
      });
      const after = await client.query(
        `SELECT quantity FROM item_stock WHERE company_id = $1 AND item_id = $2 AND godown_id = $3`,
        [row.company_id, row.item_id, row.godown_id],
      );
      assert.equal(Number(after.rows[0].quantity), before - 1);

      await assert.rejects(
        () => deductSaleStockAllowNegative(client, {
          companyId: row.company_id,
          itemId: row.item_id,
          godownId: row.godown_id,
          invoiceId: '00000000-0000-0000-0000-000000000001',
          quantity: before + 1,
          userId: row.user_id,
          allowNegative: false,
        }),
        /available in the selected godown/,
      );
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  const invoiceResult = await pool.query(
    `SELECT i.*
     FROM invoices i
     WHERE i.is_deleted = false
     ORDER BY i.created_at DESC
     LIMIT 1`,
  );
  if (invoiceResult.rows.length) {
    const invoice = invoiceResult.rows[0];
    const companyResult = await pool.query('SELECT * FROM companies WHERE id = $1', [invoice.company_id]);
    const items = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
      [invoice.id],
    );
    const pdf = await generateThermalReceipt(invoice, companyResult.rows[0], items.rows, 80);
    assert.ok(pdf.length > 1_000);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    if (process.env.POS_RECEIPT_OUTPUT) {
      fs.writeFileSync(process.env.POS_RECEIPT_OUTPUT, pdf);
    }
  } else {
    console.log('POS workflow smoke: skipped thermal PDF check (no local invoice fixture).');
  }

  await pool.end();
  console.log('POS workflow smoke checks passed.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
