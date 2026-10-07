import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import '../middleware/auth';
import { loadItemImportRefs, planItemImport } from '../services/itemImportPlan';
import { saveItemImportPlan } from '../services/itemImportSave';
import { datasetWorkbook, exportImportDataset, downloadCompanyBackup } from '../controllers/dataExportController';
import { readImportRows, importRowReader } from '../services/importFile';
import { bulkImport } from '../controllers/itemController';
import { importData } from '../controllers/dataImportController';
import { tallyImport } from '../controllers/reportController';

async function main() {
  const db = new PGlite();
  const client = { query: async (sql: string, params?: any[]) => db.query<any>(sql, params) };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-import-export-'));
  const config = require('../config/db');
  const originalQuery = config.query;
  const originalTransaction = config.withTransaction;
  const originalPoolQuery = config.pool.query;
  try {
    const migrations = path.resolve(__dirname, '../db/migrations');
    for (const file of fs.readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
      try { await db.exec(fs.readFileSync(path.join(migrations, file), 'utf8')); }
      catch (err: any) { throw new Error(`Test database migration ${file}: ${err.message}`); }
    }
    const company = (await client.query("INSERT INTO companies (name,state_code) VALUES ('Import Test','24') RETURNING id")).rows[0].id;
    const otherCompany = (await client.query("INSERT INTO companies (name) VALUES ('Other Company') RETURNING id")).rows[0].id;
    const user = (await client.query("INSERT INTO users (company_id,name,password_hash,role) VALUES ($1,'Test Admin','never-login','admin') RETURNING id", [company])).rows[0].id;
    const varachha = (await client.query("INSERT INTO godowns (company_id,name,code,is_active) VALUES ($1,'Varachha','VAR',true) RETURNING id", [company])).rows[0].id;
    const nanpura = (await client.query("INSERT INTO godowns (company_id,name,code,is_active) VALUES ($1,'Nanpura','NAN',true) RETURNING id", [company])).rows[0].id;
    config.query = client.query;
    config.pool.query = client.query;
    config.withTransaction = async (callback: any) => db.transaction((tx) => callback({ query: (sql: string, params?: any[]) => tx.query(sql, params) }));
    const insertItem = async (name: string, serialized = false, gd = varachha, qty = 1) => {
      const id = (await client.query('INSERT INTO items (company_id,name,is_serialized,purchase_price) VALUES ($1,$2,$3,200000) RETURNING id', [company, name, serialized])).rows[0].id;
      await client.query('INSERT INTO item_stock (company_id,item_id,godown_id,quantity) VALUES ($1,$2,$3,$4)', [company, id, gd, qty]);
      return id;
    };
    const legacyFan = await insertItem('CPU FAN OG BLACK', true);
    await client.query("INSERT INTO item_serial_numbers (company_id,item_id,serial_number,status,godown_id) VALUES ($1,$2,'FAN-001','available',$3)", [company, legacyFan, varachha]);
    const numberedStand1 = await insertItem('LAPCARE LAPKOOL-II DUAL FAN LAPTOP STAND LLS-002', true);
    const numberedStand2 = await insertItem('LAPCARE LAPKOOL-II DUAL FAN LAPTOP STAND LLS-002', true);
    const wd = await insertItem('WD 1TB PURPLE HDD SATA', true);
    await client.query("INSERT INTO item_serial_numbers (company_id,item_id,serial_number,status,godown_id) VALUES ($1,$2,'WCC6Y4KXJH6V','available',$3)", [company, wd, varachha]);
    const rows = [
      { Name: 'CPU FAN OG BLACK', Qty: 1 }, { Name: 'CPU FAN OG BLACK', Qty: 60 },
      { Name: 'LAPCARE LAPKOOL-II DUAL FAN LAPTOP STAND LLS-002', Qty: 1 },
      { Name: 'LAPCARE LAPKOOL-II DUAL FAN LAPTOP STAND LLS-002', Qty: 1 },
      { Name: 'SEAGATE HDD 2TB SATA', 'Serial No': 'ZC2096QW', Qty: 1 },
      { Name: 'SEAGATE HDD 2TB SATA', 'Serial No': 'ZC2096QW', Qty: 1 },
      { Name: 'WD 1TB PURPLE HDD SATA', 'Serial No': 'WCC6Y4KXJH6V', Qty: 1 },
    ];
    let refs = await loadItemImportRefs(client, company);
    const first = planItemImport(rows, refs, { godownId: nanpura, resolutions: {} });
    assert.equal(first.errors.length, 1, 'Only the cross-godown serial requires a decision');
    assert.equal(first.alreadyPresent.length, 1, 'Identical repeated serial is counted once');
    assert.equal(first.preview.find((row) => row.data.name === 'CPU FAN OG BLACK')?.data.opening_stock, 61);
    const transferKey = first.errors[0].resolutionKey!;
    const plan = planItemImport(rows, refs, { godownId: nanpura, resolutions: { [transferKey]: 'transfer' } });
    assert.equal(plan.errors.length, 0);
    await config.withTransaction((tx: any) => saveItemImportPlan(tx, plan, company, user));
    assert.equal(Number((await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [legacyFan, varachha])).rows[0].quantity), 1);
    assert.equal(Number((await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [wd, varachha])).rows[0].quantity), 0);
    assert.equal(Number((await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [wd, nanpura])).rows[0].quantity), 1);
    const beforeRetry = (await client.query('SELECT item_id,godown_id,quantity FROM item_stock ORDER BY item_id,godown_id')).rows;
    refs = await loadItemImportRefs(client, company);
    await config.withTransaction((tx: any) => saveItemImportPlan(tx, planItemImport(rows, refs, { godownId: nanpura, resolutions: {} }), company, user));
    assert.deepEqual((await client.query('SELECT item_id,godown_id,quantity FROM item_stock ORDER BY item_id,godown_id')).rows, beforeRetry);

    const ambiguous1 = await insertItem('Ambiguous item');
    const ambiguous2 = await insertItem('Ambiguous item');
    const ambiguousRows = [{ Name: 'Ambiguous item', Qty: 5 }];
    refs = await loadItemImportRefs(client, company);
    const ambiguous = planItemImport(ambiguousRows, refs, { godownId: nanpura, resolutions: {} });
    assert.equal(ambiguous.errors[0].choices?.length, 4);
    const chosen = planItemImport(ambiguousRows, refs, { godownId: nanpura, resolutions: { [ambiguous.errors[0].resolutionKey!]: ambiguous2 } });
    assert.equal(chosen.preview[0].data.existing_item_id, ambiguous2);
    assert.notEqual(chosen.preview[0].data.existing_item_id, ambiguous1);
    assert.equal(planItemImport([{ Name: 'New unit', Qty: 1, 'Serial No': 'DUP' }, { Name: 'New unit', Qty: 0, 'Serial No': 'DUP' }], refs, { godownId: nanpura, resolutions: {} }).errors.length, 1);
    const mixedReference = planItemImport([{ Name: 'Bulk package', 'Serial No': 'BOX-A', Qty: 1 }, { Name: 'Bulk package', 'Serial No': 'BOX-A', Qty: 3 }], refs, { godownId: nanpura, resolutions: {} });
    assert.equal(mixedReference.preview.length, 1);
    assert.equal(mixedReference.preview[0].data.opening_stock, 4);
    assert.equal(mixedReference.preview[0].data.serial_reference, 'BOX-A');
    assert.equal(planItemImport([{ Name: 'Cross branch duplicate', 'Serial No': 'SAME', Qty: 1, 'Godown Name': 'Varachha' },
      { Name: 'Cross branch duplicate', 'Serial No': 'SAME', Qty: 1, 'Godown Name': 'Nanpura' }], refs, { godownId: '', resolutions: {} }).invalid, 1);
    assert.ok(numberedStand1 && numberedStand2);

    const call = async (controller: any, data: any[], type: string, body: any = {}, confirm = false) => {
      const file = path.join(directory, `upload-${Date.now()}-${Math.random()}.json`);
      fs.writeFileSync(file, JSON.stringify(data));
      const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } };
      await controller({ user: { id: user, company_id: company }, file: { path: file, originalname: 'upload.json' }, params: { type }, query: confirm ? { action: 'confirm' } : {}, body: { godown_id: nanpura, ...body } }, response);
      return response;
    };
    const newRows = [{ Name: 'Large stock', Qty: 2, 'Purchase Price': 90000000000 }];
    const preview = await call(bulkImport, newRows, 'items');
    assert.equal(preview.statusCode, 200);
    const saved = await call(bulkImport, newRows, 'items', { preview_hash: preview.body.data.preview_hash }, true);
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.inserted, 1);
    const changing = [{ Name: 'Large stock', Qty: 3 }];
    const outdated = await call(bulkImport, changing, 'items');
    await client.query('UPDATE item_stock SET quantity=4 WHERE godown_id=$1 AND item_id=(SELECT id FROM items WHERE company_id=$2 AND name=$3)', [nanpura, company, 'Large stock']);
    const blocked = await call(bulkImport, changing, 'items', { preview_hash: outdated.body.data.preview_hash }, true);
    assert.equal(blocked.statusCode, 409);
    const invalidRows = [{ Name: 'Valid partial', Qty: 1 }, { Name: 'Invalid partial', Qty: -1 }];
    const partial = await call(bulkImport, invalidRows, 'items');
    assert.equal((await call(bulkImport, invalidRows, 'items', { preview_hash: partial.body.data.preview_hash }, true)).statusCode, 400);
    assert.equal((await call(bulkImport, invalidRows, 'items', { preview_hash: partial.body.data.preview_hash, allow_partial: 'true' }, true)).statusCode, 200);
    const legacyHub = await insertItem('HP USB-C HUB', true, varachha, 10);
    await client.query("INSERT INTO item_serial_numbers (company_id,item_id,serial_number,status,godown_id) VALUES ($1,$2,'HUB-BATCH','available',$3)", [company, legacyHub, varachha]);
    const bulkReferenceRows = [{ Name: 'HP USB-C HUB', 'Serial No': 'HUB-BATCH', Qty: 10 }];
    const referencePreview = await call(bulkImport, bulkReferenceRows, 'items');
    const referenceSelections = JSON.stringify({ [referencePreview.body.data.errors[0].resolutionKey]: 'bulk_reference' });
    const chosenReference = await call(bulkImport, bulkReferenceRows, 'items', { resolutions: referenceSelections });
    assert.equal(chosenReference.body.data.conversions, 1);
    assert.equal((await call(bulkImport, bulkReferenceRows, 'items', { resolutions: referenceSelections, preview_hash: chosenReference.body.data.preview_hash }, true)).statusCode, 400);
    assert.equal((await call(bulkImport, bulkReferenceRows, 'items', { resolutions: referenceSelections, preview_hash: chosenReference.body.data.preview_hash, confirm_conversions: 'true' }, true)).statusCode, 200);
    assert.equal(Number((await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [legacyHub, varachha])).rows[0].quantity), 10);
    assert.equal(Number((await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [legacyHub, nanpura])).rows[0].quantity), 10);
    assert.equal((await client.query('SELECT is_serialized FROM items WHERE id=$1', [legacyHub])).rows[0].is_serialized, false);
    assert.equal((await call(bulkImport, bulkReferenceRows, 'items')).body.data.invalid, 0);
    const rollbackRefs = await loadItemImportRefs(client, company);
    const rollbackPlan = planItemImport([{ Name: 'Rollback item', Qty: 1 }], rollbackRefs, { godownId: nanpura, resolutions: {} });
    await assert.rejects(config.withTransaction((tx: any) => saveItemImportPlan(tx, rollbackPlan, company, '11111111-1111-4111-8111-111111111111')));
    assert.equal((await client.query("SELECT COUNT(*)::int count FROM items WHERE company_id=$1 AND name='Rollback item'", [company])).rows[0].count, 0);

    const supplier = [{ Name: 'Supplier Test', 'Party Type': 'both', 'Opening Balance': 90000000000 }];
    const partyPreview = await call(importData, supplier, 'parties');
    assert.equal((await call(importData, supplier, 'parties', { preview_hash: partyPreview.body.data.preview_hash }, true)).statusCode, 200);
    const expenses = [{ 'Expense Date': '2026-10-01', Category: 'Office', Amount: 1000, 'GST Rate': 18, 'Payment Mode': 'cash' }];
    const expensePreview = await call(importData, expenses, 'expenses');
    assert.equal(expensePreview.body.data.invalid, 0);
    assert.equal((await call(importData, expenses, 'expenses', { preview_hash: expensePreview.body.data.preview_hash }, true)).statusCode, 200);
    assert.equal((await call(importData, expenses, 'expenses')).body.data.alreadyPresent.length, 1);
    const purchases = [{ 'Bill Number': 'PUR-1', 'Bill Date': '2026-10-01', 'Supplier Name': 'Supplier Test', 'Item Name': 'Large stock', Quantity: 2, Rate: 2000, 'GST Rate': 18, 'Discount %': 10 }];
    const purchasePreview = await call(importData, purchases, 'purchases');
    assert.equal(purchasePreview.body.data.invalid, 0, JSON.stringify(purchasePreview.body));
    const purchaseSave = await call(importData, purchases, 'purchases', { preview_hash: purchasePreview.body.data.preview_hash }, true);
    assert.equal(purchaseSave.statusCode, 200, JSON.stringify(purchaseSave.body));
    assert.ok((await call(importData, [{ ...purchases[0], 'Bill Number': 'BAD-DISC', 'Discount %': 101 }], 'purchases')).body.data.invalid > 0);
    assert.ok((await call(importData, [{ ...purchases[0], 'Bill Number': 'BAD-ITEM', 'Item Name': 'Ambiguous item' }], 'purchases')).body.data.invalid > 0);
    const cash = [{ 'Account Type': 'cash', 'Balance Date': '2026-10-01', Balance: 50000 }];
    const cashPreview = await call(importData, cash, 'cash');
    assert.equal((await call(importData, cash, 'cash', { preview_hash: cashPreview.body.data.preview_hash }, true)).statusCode, 200);

    await client.query("INSERT INTO items (company_id,name) SELECT $1,'Export item ' || n FROM generate_series(1,125) n", [company]);
    const allRows = await exportImportDataset(client, company, 'items');
    assert.ok(allRows.length > 125);
    const exported = await exportImportDataset(client, company, 'stock', nanpura);
    const exportFile = path.join(directory, 'branch.xlsx');
    fs.writeFileSync(exportFile, datasetWorkbook('stock', exported));
    const importedRows = readImportRows({ path: exportFile, originalname: 'branch.xlsx' }, 'stock', [['Name']]);
    refs = await loadItemImportRefs(client, company);
    assert.equal(planItemImport(importedRows, refs, { godownId: nanpura, resolutions: {}, stockOnly: true }).invalid, 0);
    const otherItem = (await client.query("INSERT INTO items (company_id,name) VALUES ($1,'Foreign item') RETURNING id", [otherCompany])).rows[0].id;
    assert.equal(planItemImport([{ 'Item ID': otherItem, Name: 'Foreign item', Qty: 1 }], refs, { godownId: nanpura, resolutions: {} }).invalid, 1);
    const backupResponse: any = { setHeader() {}, status(code: number) { this.code = code; return this; }, json(value: any) { this.body = value; return this; } };
    await client.query('INSERT INTO transaction_settings (firm_id) VALUES ($1) ON CONFLICT DO NOTHING', [company]);
    await downloadCompanyBackup({ user: { company_id: company } } as any, backupResponse);
    assert.equal(backupResponse.body.backup_format, 'microtechnique-company-data-v1', JSON.stringify(backupResponse.body));
    assert.ok(backupResponse.body.counts.items > 125);
    assert.ok(backupResponse.body.counts.purchase_invoice_items > 0);
    assert.equal(backupResponse.body.counts.transaction_settings, 1);
    assert.equal(backupResponse.body.tables.users[0].password_hash, undefined);
    assert.ok(!backupResponse.body.tables.items.some((item: any) => item.id === otherItem));

    const xml = '<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE><UNIT NAME="Test Unit"><NAME>Test Unit</NAME><ORIGINALNAME>Tu</ORIGINALNAME></UNIT></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';
    const xmlFile = path.join(directory, 'tally.xml');
    fs.writeFileSync(xmlFile, xml);
    const tallyResponse: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } };
    await tallyImport({ user: { id: user, company_id: company }, file: { path: xmlFile, originalname: 'tally.xml' }, body: {}, query: {} } as any, tallyResponse);
    assert.equal(tallyResponse.statusCode, 200);
    assert.equal(tallyResponse.body.data.created_units, 1);
    assert.equal((await client.query("SELECT COUNT(*)::int count FROM item_units WHERE company_id=$1 AND name='Test Unit'", [company])).rows[0].count, 0, 'Preview does not write');
    fs.writeFileSync(xmlFile, xml);
    const tallySaved: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } };
    await tallyImport({ user: { id: user, company_id: company }, file: { path: xmlFile, originalname: 'tally.xml' }, body: { preview_hash: tallyResponse.body.data.preview_hash }, query: { action: 'confirm' } } as any, tallySaved);
    assert.equal(tallySaved.statusCode, 200, JSON.stringify(tallySaved.body));
    assert.equal((await client.query("SELECT COUNT(*)::int count FROM item_units WHERE company_id=$1 AND name='Test Unit'", [company])).rows[0].count, 1);
    const leading = XLSX.utils.sheet_to_json(XLSX.read(datasetWorkbook('items', [{ Name: 'Text serial', 'Serial No': '0000123' }])).Sheets.items)[0] as any;
    assert.equal(leading['Serial No'], '0000123');
    if (process.env.ITEM_IMPORT_FIXTURE_PATH) {
      const input = process.env.ITEM_IMPORT_FIXTURE_PATH;
      const original = readImportRows({ path: input, originalname: path.basename(input) }, 'items', [['Item Name', 'Name']]);
      const emptyRefs = { items: [], serials: [], stocks: [], godowns: refs.godowns };
      const originalPlan = planItemImport(original, emptyRefs, { godownId: nanpura, resolutions: {} });
      assert.equal(originalPlan.invalid, 0, JSON.stringify(originalPlan.errors.slice(0, 4)));
      assert.equal(originalPlan.alreadyPresent.length, 2);
      const originalQuantity = original.reduce((sum, row) => {
        const get = importRowReader(row);
        return sum + (get('Item Name', 'Name') ? parseFloat(String(get('QTY', 'Qty', 'Quantity') ?? '0')) : 0);
      }, 0);
      const plannedQuantity = originalPlan.preview.reduce((sum, record) => sum + record.data.opening_stock, 0);
      assert.equal(plannedQuantity, originalQuantity - originalPlan.alreadyPresent.reduce((sum, record) => sum + record.data.opening_stock, 0));
      console.log(`Original item workbook checked: ${originalPlan.total} source rows, ${originalPlan.valid} planned records, ${originalPlan.alreadyPresent.length} duplicate serial rows counted once.`);
    }
    console.log('Import/export SQL regression checks passed: legacy names, bulk/serial stock, serial transfer, retry, stale preview, partial consent, large currency, parties, expenses, purchases, cash, branch round-trip, full export, company isolation and XML preview.');
  } finally {
    config.query = originalQuery;
    config.withTransaction = originalTransaction;
    config.pool.query = originalPoolQuery;
    await config.pool.end();
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
