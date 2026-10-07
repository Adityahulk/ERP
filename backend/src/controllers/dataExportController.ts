import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { withTransaction } from '../config/db';
import { error } from '../lib/response';
import { type ImportClient } from '../services/itemImportPlan';

export async function exportImportDataset(client: ImportClient, companyId: string, type: string, godownId = '') {
  if (godownId) {
    const target = await client.query('SELECT id FROM godowns WHERE id=$1 AND company_id=$2 AND is_deleted=false', [godownId, companyId]);
    if (!target.rows.length) throw new Error('Export godown was not found in this company');
  }
  if (type === 'items' || type === 'stock') {
    const result = await client.query(`SELECT i.id, i.name, i.sku, i.barcode, i.hsn_code, i.brand, i.item_type,
      i.selling_price, i.purchase_price, i.gst_rate, i.reorder_point, i.is_serialized, i.custom_fields,
      s.quantity, s.avg_cost_price, g.name AS godown_name, g.code AS godown_code,
      sn.serial_number, sn.status AS serial_status
      FROM items i LEFT JOIN item_stock s ON s.item_id=i.id AND s.company_id=i.company_id
      LEFT JOIN godowns g ON g.id=s.godown_id AND g.company_id=i.company_id AND g.is_deleted=false
      LEFT JOIN item_serial_numbers sn ON sn.item_id=i.id AND sn.company_id=i.company_id
        AND sn.godown_id=s.godown_id AND sn.status='available'
      WHERE i.company_id=$1 AND i.is_deleted=false ${godownId ? 'AND s.godown_id=$2' : ''}
      ORDER BY i.name, i.id, g.name, sn.serial_number`, godownId ? [companyId, godownId] : [companyId]);
    return result.rows.filter((row) => !(row.is_serialized && !row.serial_number && Number(row.quantity || 0) === 0)).map((row) => ({
      'Item ID': row.id, 'Name': row.name, 'Serial No': row.serial_number || '', 'SKU': row.sku || '', 'Barcode': row.barcode || '',
      'Serial Reference': row.custom_fields?.import_serial_reference || '',
      'HSN Code': row.hsn_code || '', 'Brand': row.brand || '', 'Item Type': row.item_type,
      'Selling Price': Number(row.selling_price || 0) / 100,
      'Purchase Price': Number(row.avg_cost_price || row.purchase_price || 0) / 100,
      'GST Rate': Number(row.gst_rate || 0), 'Opening Stock': row.serial_number ? 1 : Number(row.quantity || 0),
      'Reorder Point': Number(row.reorder_point || 0), 'Godown Name': row.godown_name || '', 'Godown Code': row.godown_code || '',
      'Godown Stock Total': Number(row.quantity || 0),
    }));
  }
  if (type === 'parties') {
    const result = await client.query('SELECT * FROM parties WHERE company_id=$1 AND is_deleted=false ORDER BY name,id', [companyId]);
    return result.rows.map((p) => ({
      'Party ID': p.id, 'Name': p.name, 'Party Type': p.party_type, 'Phone': p.phone || '', 'Email': p.email || '',
      'GSTIN': p.gstin || '', 'PAN': p.pan || '', 'Billing Address': p.billing_address || '', 'Shipping Address': p.shipping_address || '',
      'City': p.billing_city || p.city || '', 'State': p.billing_state || p.state || '', 'Pincode': p.billing_pincode || p.pincode || '',
      'State Code': p.billing_state_code || p.state_code || '', 'Opening Balance': Math.abs(Number(p.opening_balance || 0)) / 100,
      'Balance Type': Number(p.opening_balance || 0) < 0 ? 'credit' : 'debit', 'Current Balance': Number(p.balance || 0) / 100,
      'Payment Terms Days': Number(p.payment_terms || p.credit_days || 0), 'Contact Person': p.contact_person || '', 'Notes': p.notes || '',
    }));
  }
  if (type === 'expenses') {
    const result = await client.query('SELECT * FROM expenses WHERE company_id=$1 AND is_deleted=false ORDER BY expense_date,id', [companyId]);
    return result.rows.map((e) => ({ 'Expense ID': e.id, 'Expense Date': e.expense_date,
      'Category': e.category, 'Amount': Number(e.amount || 0) / 100, 'Amount Includes GST': 'no', 'GST Rate': Number(e.gst_rate || 0),
      'Payment Mode': e.payment_mode, 'Reference Number': e.reference_number || '', 'Vendor Name': e.vendor_name || '',
      'Vendor GSTIN': e.vendor_gstin || '', 'Description': e.description || '', 'Notes': e.notes || '', 'Total Amount': Number(e.total_amount || 0) / 100 }));
  }
  if (type === 'purchases') {
    const result = await client.query(`SELECT p.*, party.name AS supplier_name, party.gstin AS supplier_gstin, g.name AS godown_name,
      line.item_id, line.item_name, line.hsn_code, line.quantity, line.unit, line.unit_price, line.discount_amount AS line_discount, line.gst_rate
      FROM purchase_invoices p JOIN purchase_invoice_items line ON line.purchase_invoice_id=p.id
      LEFT JOIN parties party ON party.id=p.party_id AND party.company_id=p.company_id
      LEFT JOIN godowns g ON g.id=p.godown_id AND g.company_id=p.company_id
      WHERE p.company_id=$1 AND p.is_deleted=false ${godownId ? 'AND p.godown_id=$2' : ''} ORDER BY p.bill_date,p.id,line.sort_order`, godownId ? [companyId, godownId] : [companyId]);
    return result.rows.map((p) => ({ 'Bill Number': p.bill_number, 'Bill Date': p.bill_date, 'Due Date': p.due_date || '',
      'Party ID': p.party_id, 'Supplier Name': p.supplier_name || '', 'Supplier GSTIN': p.supplier_gstin || '', 'Godown': p.godown_name || '',
      'Item ID': p.item_id || '', 'Item Name': p.item_name, 'HSN/SAC': p.hsn_code || '', 'Quantity': Number(p.quantity), 'Unit': p.unit,
      'Rate': Number(p.unit_price) / 100, 'Discount Amount': Number(p.line_discount || 0) / 100, 'GST Rate': Number(p.gst_rate || 0), 'Notes': p.notes || '' }));
  }
  if (type === 'cash') {
    const result = await client.query(`SELECT payment_type,payment_mode,amount,company_bank_account_id FROM payments
      WHERE company_id=$1 AND is_deleted=false AND COALESCE(status,'posted')<>'cancelled'`, [companyId]);
    const banks = await client.query('SELECT * FROM company_bank_accounts WHERE company_id=$1 AND is_deleted=false ORDER BY id', [companyId]);
    const bankModes = new Set(['bank_transfer', 'neft', 'rtgs', 'upi', 'online', 'card', 'cheque']);
    const incoming = new Set(['incoming', 'receipt', 'payment_in']);
    const outgoing = new Set(['outgoing', 'payment_out']);
    let cash = 0;
    const balances = new Map<string, number>();
    for (const payment of result.rows) {
      const amount = Number(payment.amount || 0);
      const sign = incoming.has(payment.payment_type) ? 1 : outgoing.has(payment.payment_type) ? -1 : 0;
      if (payment.payment_type === 'bank_deposit') cash -= amount;
      else if (payment.payment_type === 'bank_withdrawal') cash += amount;
      else if (payment.payment_mode === 'cash') cash += sign * amount;
      const bankSign = payment.payment_type === 'bank_deposit' ? 1 : payment.payment_type === 'bank_withdrawal' ? -1 : bankModes.has(payment.payment_mode) ? sign : 0;
      const id = payment.company_bank_account_id;
      if (id) balances.set(id, (balances.get(id) || 0) + bankSign * amount);
    }
    const date = new Date().toISOString().slice(0, 10);
    return [{ 'Account Type': 'cash', 'Account Label': 'Cash in Hand', 'Balance Date': date, 'Balance': cash / 100 },
      ...banks.rows.map((bank) => ({ 'Account Type': 'bank', 'Account Label': bank.account_label || bank.bank_name,
        'Bank Name': bank.bank_name, 'Account Number': bank.account_number || '', 'IFSC': bank.ifsc || '', 'Balance Date': date,
        'Balance': (balances.get(bank.id) || 0) / 100 }))];
  }
  throw new Error('Unsupported export type');
}

export function datasetWorkbook(type: string, rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, { cellDates: false });
  sheet['!cols'] = Object.keys(rows[0] || {}).map((header) => ({ wch: Math.min(40, Math.max(15, header.length + 3)) }));
  XLSX.utils.book_append_sheet(workbook, sheet, type);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Instructions'], ['Money values are in rupees. Item/Party/Expense IDs identify existing records in this company.'],
    ['Keep serial numbers as text. One serial row represents one unit. Godown Stock Total is informational, not an import quantity.'],
    ['Choose the target godown or keep the godown names on each row. Importing stock changes only that godown.'],
    ['Existing parties and expenses with their IDs are kept. Existing purchase bill numbers cannot be imported as new bills.'],
  ]), 'Instructions');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export async function downloadDataset(req: Request, res: Response) {
  try {
    const type = req.params.type;
    const rows = await withTransaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return exportImportDataset(client, req.user!.company_id, type, String(req.query.godown_id || ''));
    });
    if (!rows.length) return res.status(400).json(error('No records were found for this export'));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=microtechnique_${type}_export.xlsx`);
    return res.send(datasetWorkbook(type, rows));
  } catch (err: any) { return res.status(400).json(error(err.message)); }
}

export async function downloadCompanyBackup(req: Request, res: Response) {
  try {
    const backup = await withTransaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const columns = await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`);
      const has = (table: string, column: string) => columns.rows.some((row) => row.table_name === table && row.column_name === column);
      const tables: Record<string, unknown[]> = {};
      const scoped = new Set<string>(['companies', ...columns.rows.filter((row) => ['company_id', 'firm_id'].includes(row.column_name)).map((row) => row.table_name)]);
      const safeTable = (table: string) => /^[a-z][a-z0-9_]*$/.test(table) && !/refresh|token|password|verification|otp|session/i.test(table);
      for (const table of scoped) {
        if (!safeTable(table)) continue;
        const scopeColumn = table === 'companies' ? 'id' : has(table, 'company_id') ? 'company_id' : 'firm_id';
        const data = await client.query(`SELECT * FROM ${table} WHERE ${scopeColumn}=$1`, [req.user!.company_id]);
        tables[table] = data.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !/password|secret|token|api_key|license_key/i.test(key))));
      }
      const relations = await client.query(`SELECT child.relname AS child_table, parent.relname AS parent_table,
        ca.attname AS child_key, pa.attname AS parent_key
        FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_class parent ON parent.oid=fk.confrelid
        JOIN pg_namespace ns ON ns.oid=child.relnamespace
        JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
        WHERE fk.contype='f' AND ns.nspname='public' AND array_length(fk.conkey,1)=1`);
      for (const relation of relations.rows) {
        const { child_table: table, parent_table: parent, child_key: key, parent_key: parentKey } = relation;
        if (!safeTable(table) || tables[table] || !tables[parent] || has(table, 'company_id') || !/^[a-z][a-z0-9_]*$/.test(key)) continue;
        const scopeColumn = parent === 'companies' ? 'id' : has(parent, 'company_id') ? 'company_id' : has(parent, 'firm_id') ? 'firm_id' : null;
        if (!has(table, key) || !scopeColumn) continue;
        const data = await client.query(`SELECT d.* FROM ${table} d JOIN ${parent} p ON p.${parentKey}=d.${key} WHERE p.${scopeColumn}=$1`, [req.user!.company_id]);
        tables[table] = data.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !/password|secret|token|api_key|license_key/i.test(key))));
      }
      return { backup_format: 'microtechnique-company-data-v1', generated_at: new Date().toISOString(), money_unit: 'paise',
        company_id: req.user!.company_id, counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])), tables };
    });
    res.setHeader('Content-Disposition', 'attachment; filename=microtechnique_company_data.json');
    return res.json(backup);
  } catch (err: any) { return res.status(500).json(error(err.message)); }
}
