import { Request, Response } from 'express';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { query, withTransaction, pool } from '../config/db';
import { success, error } from '../lib/response';
import {
  getOrCreateDefaultAccount,
  postExpenseAccounting,
  postJournalEntry,
  postPurchaseInvoiceAccounting,
  type Queryable,
} from '../services/accountingService';
import {
  calculateExpenseGstBreakdown,
  calculateInvoiceTotals,
  determineGSTType,
  stateCodeFromGstin,
} from '../services/gstService';
import { resolveStockImportGodown } from '../services/stockImportGodown';
import { readImportRows, importRowReader, importPreviewHash, importKey } from '../services/importFile';
import { isSafePaise } from '../lib/money';
import { type ImportClient } from '../services/itemImportPlan';
import { bulkImport } from './itemController';

type ImportType = 'parties' | 'purchases' | 'expenses' | 'stock' | 'cash';
type ImportError = { row: number; key?: string; errors: string[]; data: Record<string, unknown> };
type ImportPreview = { row: number; key?: string; data: Record<string, unknown>; warnings?: string[] };

const IMPORT_TYPES = new Set<ImportType>(['parties', 'purchases', 'expenses', 'stock', 'cash']);
const PAYMENT_MODES = new Set(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']);
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const templates: Record<ImportType, { sheet: string; headers: string[]; rows: unknown[][]; note: string }> = {
  parties: {
    sheet: 'Parties',
    headers: ['Name', 'Party Type', 'Phone', 'Email', 'GSTIN', 'PAN', 'Billing Address', 'Shipping Address', 'City', 'State', 'Pincode', 'State Code', 'Opening Balance', 'Balance Type', 'Payment Terms Days', 'Contact Person', 'Notes'],
    rows: [['ABC Traders', 'both', '9876543210', 'accounts@example.com', '24ABCDE1234F1Z5', 'ABCDE1234F', 'Surat, Gujarat', 'Surat, Gujarat', 'Surat', 'Gujarat', '395001', '24', 15000, 'debit', 30, 'Mr. Patel', 'Imported opening party']],
    note: 'Party Type must be customer, supplier, or both. Amounts are in rupees. Balance Type must be debit or credit. Name is required; duplicate phone/GSTIN rows are rejected with a reason.',
  },
  purchases: {
    sheet: 'Purchases',
    headers: ['Bill Number', 'Bill Date', 'Due Date', 'Supplier Name', 'Supplier GSTIN', 'Godown', 'Item Name', 'Item SKU', 'HSN/SAC', 'Quantity', 'Unit', 'Rate', 'Discount %', 'Discount Amount', 'GST Rate', 'Notes'],
    rows: [
      ['PB-1001', '2026-09-01', '2026-09-30', 'ABC Traders', '24ABCDE1234F1Z5', 'Main Godown', 'Basmati Rice 5kg', 'RICE-5KG', '1006', 10, 'PCS', 350, 0, 0, 5, 'September purchase'],
      ['PB-1001', '2026-09-01', '2026-09-30', 'ABC Traders', '24ABCDE1234F1Z5', 'Main Godown', 'Packaging Box', 'BOX-01', '4819', 20, 'PCS', 15, 2, 0, 18, ''],
    ],
    note: 'Use one row per bill item and repeat Bill Number for additional items. Import parties/items first. Amounts are in rupees.',
  },
  expenses: {
    sheet: 'Expenses',
    headers: ['Expense Date', 'Category', 'Amount', 'Amount Includes GST', 'GST Rate', 'Payment Mode', 'Reference Number', 'Vendor Name', 'Vendor GSTIN', 'Description', 'Notes'],
    rows: [['2026-09-01', 'Office Supplies', 1250, 'no', 18, 'cash', 'EXP-EXT-01', 'Stationery House', '', 'Printer paper and files', 'Imported expense']],
    note: 'Amount is in rupees. Payment Mode: cash, upi, bank_transfer, cheque, card or other.',
  },
  stock: {
    sheet: 'Stock Godowns',
    headers: ['Item ID', 'Item Name', 'Serial No', 'Item SKU', 'Godown Name', 'Godown Code', 'Opening Quantity', 'Average Cost'],
    rows: [['', 'Basmati Rice 5kg', '', 'RICE-5KG', 'Main Godown', 'MAIN', 100, 350]],
    note: 'Items and godowns must already exist. Choose one target godown or provide its exact name/code on each row. Opening Quantity replaces that item’s balance only in the matched godown; it never changes other branches.',
  },
  cash: {
    sheet: 'Cash Bank Balances',
    headers: ['Account Type', 'Account Label', 'Bank Name', 'Account Number', 'IFSC', 'Balance Date', 'Balance', 'Notes'],
    rows: [
      ['cash', 'Cash in Hand', '', '', '', '2026-09-01', 25000, 'Opening cash balance'],
      ['bank', 'Current Account', 'State Bank of India', '1234567890', 'SBIN0000001', '2026-09-01', 100000, 'Opening bank balance'],
    ],
    note: 'Balance is in rupees and is imported as the target account balance. Bank accounts missing from Settings are created from the supplied details.',
  },
};

function importType(value: unknown): ImportType | null {
  const type = String(value || '').trim().toLowerCase() as ImportType;
  return IMPORT_TYPES.has(type) ? type : null;
}

function normalizedKey(value: unknown) {
  return importKey(value);
}

const rowReader = importRowReader;

function cleanText(value: unknown, max = 1000): string {
  return String(value ?? '').trim().slice(0, max);
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const cleaned = String(value ?? '').replace(/[₹,$%\s]/g, '').replace(/,/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
}

function rupeesToPaise(value: unknown): number {
  const amount = numberValue(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

function booleanValue(value: unknown): boolean {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function validDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return validDateParts(parsed.y, parsed.m, parsed.d);
  }
  const raw = cleanText(value, 40);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const indian = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (indian) {
    const year = indian[3].length === 2 ? `20${indian[3]}` : indian[3];
    return validDateParts(Number(year), Number(indian[2]), Number(indian[1]));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizePhone(value: unknown): string {
  return cleanText(value, 30).replace(/\.0$/, '').replace(/\s+/g, '');
}

function normalizeGstin(value: unknown): string {
  return cleanText(value, 20).toUpperCase().replace(/\s+/g, '');
}

function fileRows(file: Express.Multer.File, type: ImportType) {
  const required: Record<ImportType, string[][]> = {
    parties: [['Name', 'Party Name', 'Customer Name', 'Supplier Name']],
    purchases: [['Bill Number', 'Invoice Number', 'Supplier Invoice No'], ['Item Name', 'Product', 'Description']],
    expenses: [['Category', 'Expense Category'], ['Amount', 'Expense Amount', 'Total Amount']],
    stock: [['Item Name', 'Name']],
    cash: [['Account Type', 'Type'], ['Balance', 'Opening Balance', 'Amount']],
  };
  return readImportRows(file, type, required[type]);
}

async function referenceData(companyId: string, client: ImportClient) {
  const [parties, items, godowns, banks, company] = await Promise.all([
    client.query(`SELECT id, name, phone, gstin, state_code FROM parties WHERE company_id=$1 AND is_deleted=false ORDER BY id`, [companyId]),
    client.query(`SELECT id, name, sku, barcode, hsn_code, item_type, track_inventory, is_serialized FROM items WHERE company_id=$1 AND is_deleted=false ORDER BY id`, [companyId]),
    client.query(`SELECT id, name, code, is_active FROM godowns WHERE company_id=$1 AND is_deleted=false ORDER BY id`, [companyId]),
    client.query(`SELECT id, account_label, bank_name, account_number, ifsc FROM company_bank_accounts WHERE company_id=$1 AND is_deleted=false ORDER BY id`, [companyId]),
    client.query(`SELECT state_code, gstin FROM companies WHERE id=$1`, [companyId]),
  ]);
  return { parties: parties.rows, items: items.rows, godowns: godowns.rows, banks: banks.rows, company: company.rows[0] || {} };
}

async function validateParties(rows: Record<string, unknown>[], refs: Awaited<ReturnType<typeof referenceData>>) {
  const preview: ImportPreview[] = [];
  const errors: ImportError[] = [];
  const alreadyPresent: Array<ImportPreview & { message: string }> = [];
  const existingPhone = new Set(refs.parties.map((p: any) => normalizePhone(p.phone)).filter(Boolean));
  const existingGstin = new Set(refs.parties.map((p: any) => normalizeGstin(p.gstin)).filter(Boolean));
  const filePhone = new Set<string>();
  const fileGstin = new Set<string>();
  rows.forEach((raw, index) => {
    const get = rowReader(raw);
    const name = cleanText(get('Name', 'Party Name', 'Customer Name', 'Supplier Name'), 500);
    const phone = normalizePhone(get('Phone', 'Phone Number', 'Mobile', 'Mobile Number'));
    const email = cleanText(get('Email', 'Email Address'), 200).toLowerCase();
    const gstin = normalizeGstin(get('GSTIN', 'GST No', 'GST Number'));
    const rawPartyType = cleanText(get('Party Type', 'Type') || 'both', 20).toLowerCase();
    const partyType = rawPartyType === 'customer' || rawPartyType === 'supplier' || rawPartyType === 'both'
      ? rawPartyType
      : '';
    const balanceType = cleanText(get('Balance Type', 'Opening Balance Type') || 'debit', 10).toLowerCase();
    const openingRupees = numberValue(get('Opening Balance', 'Balance'));
    const opening = Number.isFinite(openingRupees) ? Math.round(openingRupees * 100) * (['credit', 'cr'].includes(balanceType) ? -1 : 1) : 0;
    const data = {
      name, party_type: partyType, phone, email, gstin, pan: cleanText(get('PAN'), 10).toUpperCase(),
      billing_address: cleanText(get('Billing Address', 'Address'), 3000),
      shipping_address: cleanText(get('Shipping Address', 'Ship To'), 3000),
      city: cleanText(get('City'), 200), state: cleanText(get('State'), 200),
      pincode: cleanText(get('Pincode', 'PIN Code', 'Postal Code'), 10),
      state_code: cleanText(get('State Code'), 5), opening_balance: opening,
      payment_terms: Math.max(0, Math.round(numberValue(get('Payment Terms Days', 'Credit Days')) || 0)),
      contact_person: cleanText(get('Contact Person'), 300), notes: cleanText(get('Notes'), 3000),
    };
    const rowErrors: string[] = [];
    if (!name) rowErrors.push('Name is required');
    if (!partyType) rowErrors.push('Party Type must be customer, supplier, or both');
    if (phone && phone.length > 20) rowErrors.push('Phone must be 20 characters or fewer');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('Email format is invalid');
    if (gstin && !GSTIN_RE.test(gstin)) rowErrors.push('GSTIN format is invalid');
    if (balanceType && !['debit', 'credit', 'dr', 'cr'].includes(balanceType)) rowErrors.push('Balance Type must be debit or credit');
    if (get('Opening Balance', 'Balance') != null && (!Number.isFinite(openingRupees) || !isSafePaise(opening))) rowErrors.push('Opening Balance is invalid or exceeds the supported currency range');
    const partyId = cleanText(get('Party ID'));
    const match = partyId ? refs.parties.find((p: any) => p.id === partyId)
      : refs.parties.find((p: any) => normalizedKey(p.name) === normalizedKey(name) &&
          ((gstin && normalizeGstin(p.gstin) === gstin) || (phone && normalizePhone(p.phone) === phone)));
    if (match && !rowErrors.length) {
      alreadyPresent.push({ row: Number(raw.__sourceRow) || index + 2, key: name, data, message: 'Existing party is kept; its ledger and opening balance are unchanged.' });
      return;
    }
    if (partyId && !match) rowErrors.push('Party ID does not belong to an active party in this company');
    if (phone && (existingPhone.has(phone) || filePhone.has(phone))) rowErrors.push('Phone number already exists or is duplicated in this file');
    if (gstin && (existingGstin.has(gstin) || fileGstin.has(gstin))) rowErrors.push('GSTIN already exists or is duplicated in this file');
    if (phone) filePhone.add(phone);
    if (gstin) fileGstin.add(gstin);
    const record = { row: Number(raw.__sourceRow) || index + 2, key: name || `Row ${index + 2}`, data };
    if (rowErrors.length) errors.push({ ...record, errors: rowErrors }); else preview.push(record);
  });
  return { preview, errors, alreadyPresent };
}

async function validateExpenses(rows: Record<string, unknown>[], companyId: string, client: ImportClient) {
  const preview: ImportPreview[] = [];
  const errors: ImportError[] = [];
  const alreadyPresent: Array<ImportPreview & { message: string }> = [];
  const existing = await client.query(`SELECT id, reference_number, expense_date::text, total_amount FROM expenses WHERE company_id=$1 AND is_deleted=false`, [companyId]);
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const get = rowReader(raw);
    const amount = rupeesToPaise(get('Amount', 'Expense Amount', 'Total Amount'));
    const gstRate = numberValue(get('GST Rate', 'Tax Rate'));
    const paymentMode = cleanText(get('Payment Mode', 'Mode') || 'cash', 30).toLowerCase().replace(/\s+/g, '_');
    const data = {
      expense_date: dateValue(get('Expense Date', 'Date')),
      category: cleanText(get('Category', 'Expense Category'), 200), amount,
      amount_includes_gst: booleanValue(get('Amount Includes GST', 'Inclusive GST')),
      gst_rate: Number.isFinite(gstRate) ? gstRate : 0, payment_mode: paymentMode,
      reference_number: cleanText(get('Reference Number', 'Reference No', 'Bill Number'), 200),
      vendor_name: cleanText(get('Vendor Name', 'Supplier Name'), 200),
      vendor_gstin: normalizeGstin(get('Vendor GSTIN', 'Supplier GSTIN')),
      description: cleanText(get('Description', 'Particulars'), 3000), notes: cleanText(get('Notes'), 3000),
    };
    const rowErrors: string[] = [];
    const expenseId = cleanText(get('Expense ID'));
    if (expenseId) {
      if (existing.rows.some((expense) => expense.id === expenseId)) {
        alreadyPresent.push({ row: Number(raw.__sourceRow) || index + 2, data, message: 'This expense is already saved; it will not be posted twice.' });
        return;
      }
      rowErrors.push('Expense ID does not belong to this company');
    }
    if (!data.expense_date) rowErrors.push('Expense Date is required and must be a valid date');
    if (!data.category) rowErrors.push('Category is required');
    if (!Number.isFinite(amount) || amount <= 0) rowErrors.push('Amount must be a positive number in rupees');
    if (!isSafePaise(amount)) rowErrors.push('Amount exceeds the supported currency range');
    if (get('GST Rate', 'Tax Rate') != null && !Number.isFinite(gstRate)) rowErrors.push('GST Rate is invalid');
    if (data.gst_rate < 0 || data.gst_rate > 100) rowErrors.push('GST Rate must be between 0 and 100');
    if (!rowErrors.length && !isSafePaise(calculateExpenseGstBreakdown(amount, data.gst_rate, 'intra', data.amount_includes_gst).total_amount)) rowErrors.push('Expense total exceeds the supported currency range');
    if (!PAYMENT_MODES.has(paymentMode)) rowErrors.push(`Unsupported Payment Mode "${paymentMode}"`);
    if (data.vendor_gstin && !GSTIN_RE.test(data.vendor_gstin)) rowErrors.push('Vendor GSTIN format is invalid');
    const record = { row: Number(raw.__sourceRow) || index + 2, key: data.reference_number || `${data.category || 'Expense'} row ${index + 2}`, data };
    const generatedReference = !data.reference_number;
    if (generatedReference) data.reference_number = 'IMP-' + importPreviewHash({ row: record.row, data }).slice(0, 32);
    if (data.reference_number) {
      const reference = normalizedKey(data.reference_number);
      if (generatedReference && !rowErrors.length && existing.rows.some((expense) => normalizedKey(expense.reference_number) === reference)) {
        alreadyPresent.push({ ...record, message: 'This imported expense is already saved; it will not be posted twice.' });
        return;
      }
      if (seen.has(reference)) rowErrors.push('Duplicate expense reference in this file');
      if (existing.rows.some((expense) => normalizedKey(expense.reference_number) === reference)) rowErrors.push('Expense reference already exists; use its Expense ID from the export to keep it unchanged');
      seen.add(reference);
    }
    if (rowErrors.length) errors.push({ ...record, errors: rowErrors }); else preview.push(record);
  });
  return { preview, errors, alreadyPresent };
}

async function validateCash(rows: Record<string, unknown>[], refs: Awaited<ReturnType<typeof referenceData>>) {
  const preview: ImportPreview[] = [];
  const errors: ImportError[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const get = rowReader(raw);
    const accountType = cleanText(get('Account Type', 'Type') || 'cash', 20).toLowerCase();
    const balance = rupeesToPaise(get('Balance', 'Opening Balance', 'Amount'));
    const data = {
      account_type: accountType, account_label: cleanText(get('Account Label', 'Account Name'), 100),
      bank_name: cleanText(get('Bank Name'), 200), account_number: cleanText(get('Account Number', 'A/C No'), 50),
      ifsc: cleanText(get('IFSC', 'IFSC Code'), 20).toUpperCase(), balance_date: dateValue(get('Balance Date', 'Date')),
      balance, notes: cleanText(get('Notes', 'Description'), 3000),
    };
    const rowErrors: string[] = [];
    if (!['cash', 'bank'].includes(accountType)) rowErrors.push('Account Type must be cash or bank');
    if (accountType === 'bank' && !data.bank_name && !data.account_label) rowErrors.push('Bank Name or Account Label is required');
    if (!data.balance_date) rowErrors.push('Balance Date is required and must be valid');
    if (!Number.isFinite(balance)) rowErrors.push('Balance must be a number in rupees');
    if (!isSafePaise(balance)) rowErrors.push('Balance exceeds the supported currency range');
    const bankMatch = refs.banks.find((bank: any) =>
      (data.account_number && normalizedKey(bank.account_number) === normalizedKey(data.account_number)) ||
      (data.account_label && normalizedKey(bank.account_label) === normalizedKey(data.account_label))
    );
    const duplicateKey = accountType === 'cash'
      ? 'cash'
      : normalizedKey(data.account_number || data.account_label || data.bank_name);
    if (seen.has(duplicateKey)) rowErrors.push('Duplicate cash/bank account in this file');
    seen.add(duplicateKey);
    const record = { row: index + 2, key: accountType === 'cash' ? 'Cash in Hand' : data.account_label || data.bank_name, data: { ...data, bank_account_id: bankMatch?.id || '' } };
    if (rowErrors.length) errors.push({ ...record, errors: rowErrors }); else preview.push(record);
  });
  return { preview, errors };
}

async function validatePurchases(rows: Record<string, unknown>[], refs: Awaited<ReturnType<typeof referenceData>>, companyId: string, client: ImportClient, selectedGodownId: string) {
  const grouped = new Map<string, Array<{ raw: Record<string, unknown>; row: number }>>();
  rows.forEach((raw, index) => {
    const get = rowReader(raw);
    const key = cleanText(get('Bill Number', 'Invoice Number', 'Supplier Invoice No'), 200);
    const groupKey = normalizedKey(key) || `__row_${index + 2}`;
    grouped.set(groupKey, [...(grouped.get(groupKey) || []), { raw, row: Number(raw.__sourceRow) || index + 2 }]);
  });
  const existingBills = await client.query('SELECT bill_number FROM purchase_invoices WHERE company_id=$1 AND is_deleted=false', [companyId]);
  const billSet = new Set(existingBills.rows.map((row: any) => normalizedKey(row.bill_number)));
  const preview: ImportPreview[] = [];
  const errors: ImportError[] = [];
  for (const [, lines] of grouped) {
    const first = rowReader(lines[0].raw);
    const billNumber = cleanText(first('Bill Number', 'Invoice Number', 'Supplier Invoice No'), 200);
    const supplierName = cleanText(first('Supplier Name', 'Vendor Name', 'Party Name'), 500);
    const supplierGstin = normalizeGstin(first('Supplier GSTIN', 'Vendor GSTIN', 'GSTIN'));
    const partyId = cleanText(first('Party ID', 'Supplier ID'));
    const partyMatches = refs.parties.filter((party: any) => partyId ? party.id === partyId
      : supplierGstin ? normalizeGstin(party.gstin) === supplierGstin : normalizedKey(party.name) === normalizedKey(supplierName));
    const party = partyMatches.length === 1 ? partyMatches[0] : undefined;
    const resolved = resolveStockImportGodown(refs.godowns, selectedGodownId, cleanText(first('Godown', 'Godown Name', 'Warehouse')), cleanText(first('Godown Code')));
    const billDate = dateValue(first('Bill Date', 'Invoice Date', 'Date'));
    const dueDate = dateValue(first('Due Date'));
    const rowErrors: string[] = [];
    if (!billNumber) rowErrors.push('Bill Number is required');
    if (billSet.has(normalizedKey(billNumber))) rowErrors.push(`Bill Number "${billNumber}" already exists; the saved purchase is unchanged`);
    if (!billDate) rowErrors.push('Bill Date is required and must be valid');
    if (!party) rowErrors.push(partyMatches.length > 1 ? 'Supplier name matches multiple parties; provide Supplier GSTIN or Party ID' : 'Supplier not found; import the party first');
    if (party && supplierName && normalizedKey(party.name) !== normalizedKey(supplierName)) rowErrors.push('Supplier Name does not match the selected GSTIN/Party ID');
    if (first('Due Date') != null && !dueDate) rowErrors.push('Due Date is invalid');
    if (dueDate && billDate && dueDate < billDate) rowErrors.push('Due Date cannot be before Bill Date');
    const normalizedLines: any[] = [];
    lines.forEach(({ raw, row }) => {
      const get = rowReader(raw);
      for (const [aliases, expected] of [
        [['Bill Date', 'Invoice Date', 'Date'], billDate],
        [['Supplier Name', 'Vendor Name', 'Party Name'], supplierName],
        [['Supplier GSTIN', 'Vendor GSTIN', 'GSTIN'], supplierGstin],
        [['Godown', 'Godown Name', 'Warehouse'], cleanText(first('Godown', 'Godown Name', 'Warehouse'))],
      ] as Array<[string[], unknown]>) {
        const value = get(...aliases);
        if (value != null && (aliases[0] === 'Bill Date' ? dateValue(value) !== expected : normalizedKey(value) !== normalizedKey(expected))) {
          rowErrors.push(`Row ${row}: ${aliases[0]} differs from the other rows of this bill`);
        }
      }
      const itemName = cleanText(get('Item Name', 'Product', 'Description'), 500);
      const sku = cleanText(get('Item SKU', 'SKU', 'Item Code'), 200);
      const itemId = cleanText(get('Item ID'));
      const matches = refs.items.filter((item: any) => itemId ? item.id === itemId : sku ? normalizedKey(item.sku) === normalizedKey(sku) : normalizedKey(item.name) === normalizedKey(itemName));
      const item = matches.length === 1 ? matches[0] : undefined;
      const quantity = Math.round(numberValue(get('Quantity', 'Qty')) * 10_000) / 10_000;
      const unitPrice = rupeesToPaise(get('Rate', 'Unit Price', 'Price'));
      const gstRateCell = get('GST Rate', 'GST %', 'Tax Rate');
      const gstRate = gstRateCell == null ? 0 : numberValue(gstRateCell);
      const discountCell = get('Discount %', 'Discount Percent');
      const discountPercent = discountCell == null ? 0 : numberValue(discountCell);
      const flatCell = get('Discount Amount', 'Discount');
      let discountAmount = flatCell == null ? 0 : rupeesToPaise(flatCell);
      if (discountPercent > 0) discountAmount = Math.round(quantity * unitPrice * discountPercent / 100);
      if (matches.length > 1) rowErrors.push(`Row ${row}: multiple items have this name; use Item ID or a unique SKU`);
      if ((sku || itemId) && !item) rowErrors.push(`Row ${row}: Item ID/SKU was not found in this company`);
      if (item && itemName && normalizedKey(item.name) !== normalizedKey(itemName)) rowErrors.push(`Row ${row}: Item Name differs from Item ID/SKU`);
      if (!itemName && !item) rowErrors.push(`Row ${row}: Item Name is required`);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 100_000_000_000) rowErrors.push(`Row ${row}: Quantity must be greater than zero and below 100 billion`);
      if (!isSafePaise(unitPrice) || unitPrice < 0) rowErrors.push(`Row ${row}: Rate is invalid or exceeds the supported currency range`);
      if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) rowErrors.push(`Row ${row}: GST Rate must be between 0 and 100`);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || !isSafePaise(discountAmount) || discountAmount < 0 || discountAmount > quantity * unitPrice) rowErrors.push(`Row ${row}: Discount must be between zero and the item value (percentage 0–100)`);
      if (item?.is_serialized) rowErrors.push(`Row ${row}: use the Purchase Bill form for serial-tracked purchases so each serial is recorded`);
      if (item?.track_inventory && resolved.error) rowErrors.push(`Row ${row}: ${resolved.error}`);
      normalizedLines.push({
        item_id: item?.id || null, item_name: itemName || item?.name || 'Item', track_inventory: item?.track_inventory === true,
        hsn_code: cleanText(get('HSN/SAC', 'HSN Code', 'SAC Code'), 20) || item?.hsn_code || '',
        unit: cleanText(get('Unit', 'UOM'), 50) || 'PCS', quantity, unit_price: unitPrice,
        discount_amount: discountAmount, gst_rate: gstRate,
      });
    });
    const warnings = normalizedLines.some((line) => !line.item_id) ? ['Free-text items will not update inventory'] : [];
    if (!rowErrors.length) {
      const gstType = determineGSTType(party?.state_code || stateCodeFromGstin(party?.gstin) || refs.company.state_code, refs.company.state_code || stateCodeFromGstin(refs.company.gstin));
      const totals = calculateInvoiceTotals(normalizedLines.map((line) => ({ ...line, discount_type: 'flat' as const, discount_value: line.discount_amount })), gstType, 'none', 0);
      if (!isSafePaise(totals.totalAmount)) rowErrors.push('Bill total exceeds the supported currency range');
    }
    const data = { bill_number: billNumber, bill_date: billDate, due_date: dueDate, party_id: party?.id || '', party_name: party?.name || supplierName,
      godown_id: resolved.godown?.id || '', godown_name: resolved.godown?.name || '', notes: cleanText(first('Notes'), 3000), items: normalizedLines };
    const record = { row: lines[0].row, key: billNumber || `Row ${lines[0].row}`, data, warnings };
    if (rowErrors.length) errors.push({ ...record, errors: Array.from(new Set(rowErrors)) }); else preview.push(record);
  }
  return { preview, errors };
}

async function validate(type: ImportType, rows: Record<string, unknown>[], companyId: string, selectedGodownId = '', client: ImportClient = { query }) {
  const refs = await referenceData(companyId, client);
  if (type === 'parties') return validateParties(rows, refs);
  if (type === 'expenses') return validateExpenses(rows, companyId, client);
  if (type === 'stock') throw new Error('Stock import must use the shared item import workflow');
  if (type === 'cash') return validateCash(rows, refs);
  return validatePurchases(rows, refs, companyId, client, selectedGodownId);
}

async function importParties(records: ImportPreview[], companyId: string, userId: string, client: Queryable) {
  let inserted = 0;
  for (const record of records) {
    const d: any = record.data;
    const party = await client.query(
      `INSERT INTO parties (
        company_id, party_type, name, phone, email, gstin, pan, billing_address, shipping_address,
        billing_city, billing_state, billing_pincode, billing_state_code, city, state, pincode, state_code,
        credit_days, payment_terms, opening_balance, balance, contact_person, notes, custom_fields
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$10,$11,$12,$13,$14,$14,$15,$15,$16,$17,'{}') RETURNING id`,
      [companyId, d.party_type || 'both', d.name, d.phone || null, d.email || null, d.gstin || null, d.pan || null,
        d.billing_address || null, d.shipping_address || null, d.city || null, d.state || null,
        d.pincode || null, d.state_code || null, d.payment_terms || 0, d.opening_balance || 0,
        d.contact_person || null, d.notes || null],
    );
    if (d.opening_balance) {
      await client.query(
        `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, narration, created_by)
         VALUES ($1,$2,$3,$4,$5,'Opening Balance (data import)',$6)`,
        [companyId, party.rows[0].id, d.opening_balance > 0 ? 'debit' : 'credit', Math.abs(d.opening_balance), d.opening_balance, userId],
      );
    }
    inserted += 1;
  }
  return inserted;
}

async function importExpenses(records: ImportPreview[], companyId: string, userId: string, client: Queryable) {
  let inserted = 0;
  const count = await client.query(`SELECT COUNT(*)::int AS count FROM expenses WHERE company_id=$1`, [companyId]);
  let sequence = Number(count.rows[0]?.count || 0) + 1;
  const comp = await client.query(`SELECT state_code, gstin FROM companies WHERE id=$1`, [companyId]);
  const companyState = cleanText(comp.rows[0]?.state_code) || stateCodeFromGstin(comp.rows[0]?.gstin) || '';
  for (const record of records) {
    const d: any = record.data;
    const supplierState = stateCodeFromGstin(d.vendor_gstin) || companyState;
    const tax = calculateExpenseGstBreakdown(d.amount, d.gst_rate || 0, determineGSTType(supplierState, companyState || supplierState), !!d.amount_includes_gst);
    const expenseNumber = `EXP-${String(sequence++).padStart(5, '0')}`;
    const result = await client.query(
      `INSERT INTO expenses (
        company_id, expense_number, expense_date, category, amount, gst_rate, tax_amount, gst_amount,
        cgst_amount, sgst_amount, igst_amount, total_amount, amount_includes_gst, payment_mode,
        reference_number, vendor_name, vendor_gstin, description, notes, is_reimbursable, status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,'approved',$19) RETURNING *`,
      [companyId, expenseNumber, d.expense_date, d.category, tax.taxable_amount, d.gst_rate || 0,
        tax.gst_amount, tax.cgst_amount, tax.sgst_amount, tax.igst_amount, tax.total_amount,
        !!d.amount_includes_gst, d.payment_mode, d.reference_number || null, d.vendor_name || null,
        d.vendor_gstin || null, d.description || null, d.notes || null, userId],
    );
    await postExpenseAccounting(client, companyId, result.rows[0], userId);
    inserted += 1;
  }
  return inserted;
}

async function importPurchases(records: ImportPreview[], companyId: string, userId: string, client: Queryable) {
  let inserted = 0;
  for (const record of records) {
    const d: any = record.data;
    const company = await client.query(`SELECT state_code,gstin FROM companies WHERE id=$1`, [companyId]);
    const companyState = cleanText(company.rows[0]?.state_code) || stateCodeFromGstin(company.rows[0]?.gstin) || '';
    const party = await client.query(`SELECT state_code,gstin FROM parties WHERE id=$1 AND company_id=$2`, [d.party_id, companyId]);
    const partyState = cleanText(party.rows[0]?.state_code) || stateCodeFromGstin(party.rows[0]?.gstin) || companyState;
    const gstType = determineGSTType(partyState, companyState || partyState);
    const items = (d.items as any[]).map((item) => ({
      ...item,
      discount_type: Number(item.discount_amount || 0) > 0 ? 'flat' as const : 'none' as const,
      discount_value: Number(item.discount_amount || 0),
    }));
    const totals = calculateInvoiceTotals(items, gstType, 'none', 0);
    const invoice = await client.query(
      `INSERT INTO purchase_invoices (
        company_id,godown_id,bill_number,bill_date,due_date,party_id,subtotal,discount_amount,taxable_amount,
        cgst_amount,sgst_amount,igst_amount,total_amount,paid_amount,payment_status,status,notes,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,'unpaid','received',$14,$15) RETURNING *`,
      [companyId, d.godown_id || null, d.bill_number, d.bill_date, d.due_date || null, d.party_id,
        totals.subtotal, totals.totalDiscount, totals.totalTaxable, totals.totalCgst, totals.totalSgst,
        totals.totalIgst, totals.totalAmount, d.notes || null, userId],
    );
    for (const [index, item] of (d.items as any[]).entries()) {
      const line = totals.lines[index];
      await client.query(
        `INSERT INTO purchase_invoice_items (
          purchase_invoice_id,item_id,item_name,hsn_code,unit,quantity,unit_price,discount_amount,taxable_amount,
          gst_rate,cgst_amount,sgst_amount,igst_amount,total_amount,sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [invoice.rows[0].id, item.item_id || null, item.item_name, item.hsn_code || null, item.unit || 'PCS',
          item.quantity, item.unit_price, line.totalDiscount, line.taxableAmount, item.gst_rate,
          line.cgstAmount, line.sgstAmount, line.igstAmount, line.totalAmount, index],
      );
      if (item.item_id && item.track_inventory && d.godown_id) {
        await client.query(
          `INSERT INTO item_stock (company_id,item_id,godown_id,quantity,avg_cost_price)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (item_id,godown_id) DO UPDATE SET
             avg_cost_price=CASE WHEN item_stock.quantity+EXCLUDED.quantity > 0 THEN
               ROUND(((item_stock.quantity*item_stock.avg_cost_price)+(EXCLUDED.quantity*EXCLUDED.avg_cost_price))/(item_stock.quantity+EXCLUDED.quantity))
               ELSE EXCLUDED.avg_cost_price END,
             quantity=item_stock.quantity+EXCLUDED.quantity`,
          [companyId, item.item_id, d.godown_id, item.quantity, item.unit_price],
        );
        const balance = await client.query(`SELECT quantity FROM item_stock WHERE company_id=$1 AND item_id=$2 AND godown_id=$3`, [companyId, item.item_id, d.godown_id]);
        await client.query(
          `INSERT INTO stock_movements (company_id,item_id,godown_id,movement_type,reference_type,reference_id,quantity,unit_cost,balance_after,notes,created_by)
           VALUES ($1,$2,$3,'purchase','purchase_invoice',$4,$5,$6,$7,'Purchase data import',$8)`,
          [companyId, item.item_id, d.godown_id, invoice.rows[0].id, item.quantity, item.unit_price, balance.rows[0]?.quantity || 0, userId],
        );
      }
    }
    await client.query(`UPDATE parties SET balance=balance-$1 WHERE id=$2`, [totals.totalAmount, d.party_id]);
    const partyBalance = await client.query(`SELECT balance FROM parties WHERE id=$1`, [d.party_id]);
    await client.query(
      `INSERT INTO party_ledger (company_id,party_id,type,amount,balance_after,reference_type,reference_id,narration,created_by)
       VALUES ($1,$2,'credit',$3,$4,'purchase_invoice',$5,$6,$7)`,
      [companyId, d.party_id, totals.totalAmount, partyBalance.rows[0]?.balance || 0, invoice.rows[0].id, `Purchase Bill ${d.bill_number} (import)`, userId],
    );
    await postPurchaseInvoiceAccounting(client, companyId, invoice.rows[0], userId);
    inserted += 1;
  }
  return inserted;
}

async function currentCashBalance(client: any, companyId: string, bankAccountId?: string) {
  const bankModes = `('bank_transfer','neft','rtgs','upi','online','card','cheque')`;
  if (bankAccountId) {
    const result = await client.query(
      `SELECT COALESCE(SUM(CASE
        WHEN payment_type='bank_deposit' THEN amount WHEN payment_type='bank_withdrawal' THEN -amount
        WHEN payment_mode IN ${bankModes} AND payment_type IN ('incoming','receipt','payment_in') THEN amount
        WHEN payment_mode IN ${bankModes} AND payment_type IN ('outgoing','payment_out') THEN -amount ELSE 0 END),0)::bigint balance
       FROM payments WHERE company_id=$1 AND company_bank_account_id=$2 AND is_deleted=false AND COALESCE(status,'posted')<>'cancelled'`,
      [companyId, bankAccountId],
    );
    return Number(result.rows[0]?.balance || 0);
  }
  const result = await client.query(
    `SELECT COALESCE(SUM(CASE
      WHEN payment_type='bank_deposit' THEN -amount WHEN payment_type='bank_withdrawal' THEN amount
      WHEN payment_mode='cash' AND payment_type IN ('incoming','receipt','payment_in') THEN amount
      WHEN payment_mode='cash' AND payment_type IN ('outgoing','payment_out') THEN -amount ELSE 0 END),0)::bigint balance
     FROM payments WHERE company_id=$1 AND is_deleted=false AND COALESCE(status,'posted')<>'cancelled'`,
    [companyId],
  );
  return Number(result.rows[0]?.balance || 0);
}

async function importCash(records: ImportPreview[], companyId: string, userId: string, client: Queryable) {
  let inserted = 0;
  const equity = await getOrCreateDefaultAccount(client, companyId, "Owner's Equity", 'equity', 'Equities & Liabilities');
  const cashAccount = await getOrCreateDefaultAccount(client, companyId, 'Cash', 'asset', 'Current Assets');
  const bankLedger = await getOrCreateDefaultAccount(client, companyId, 'Bank Accounts', 'asset', 'Current Assets');
  for (const [index, record] of records.entries()) {
    const d: any = record.data;
    let bankAccountId: string | null = d.bank_account_id || null;
    if (d.account_type === 'bank' && !bankAccountId) {
      const created = await client.query(
        `INSERT INTO company_bank_accounts (company_id,account_label,bank_name,account_number,ifsc,is_primary,is_active)
         VALUES ($1,$2,$3,$4,$5,false,true) RETURNING id`,
        [companyId, d.account_label || d.bank_name, d.bank_name || d.account_label, d.account_number || null, d.ifsc || null],
      );
      bankAccountId = created.rows[0].id;
    }
    const current = await currentCashBalance(client, companyId, bankAccountId || undefined);
    const delta = Number(d.balance) - current;
    if (delta === 0) continue;
    const incoming = delta > 0;
    const payment = await client.query(
      `INSERT INTO payments (
        company_id,payment_type,payment_number,payment_date,amount,payment_mode,reference_number,
        company_bank_account_id,notes,status,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'posted',$10) RETURNING *`,
      [companyId, incoming ? 'payment_in' : 'payment_out', `OPEN-${Date.now()}-${index + 1}`,
        d.balance_date, Math.abs(delta), d.account_type === 'cash' ? 'cash' : 'bank_transfer',
        'DATA-IMPORT', bankAccountId, d.notes || 'Opening balance data import', userId],
    );
    await postJournalEntry(client, {
      companyId, entryDate: d.balance_date, entryType: 'system', voucherType: 'opening_balance',
      voucherNumber: payment.rows[0].payment_number, referenceType: 'payment', referenceId: payment.rows[0].id,
      description: d.notes || `${d.account_type === 'cash' ? 'Cash' : 'Bank'} opening balance import`, createdBy: userId,
      lines: incoming
        ? [{ accountId: d.account_type === 'cash' ? cashAccount : bankLedger, debit: Math.abs(delta) }, { accountId: equity, credit: Math.abs(delta) }]
        : [{ accountId: equity, debit: Math.abs(delta) }, { accountId: d.account_type === 'cash' ? cashAccount : bankLedger, credit: Math.abs(delta) }],
    });
    inserted += 1;
  }
  return inserted;
}

export async function downloadImportTemplate(req: Request, res: Response) {
  const type = importType(req.params.type);
  if (!type) return res.status(400).json(error('Unsupported import type'));
  try {
    const template = templates[type];
    const sheet = XLSX.utils.aoa_to_sheet([template.headers, ...template.rows]);
    sheet['!cols'] = template.headers.map((header) => ({ wch: Math.max(14, Math.min(32, header.length + 4)) }));
    const instructions = XLSX.utils.aoa_to_sheet([
      ['Import instructions'],
      [template.note],
      ['Important'],
      ['Do not rename or remove required columns. Delete the example rows before adding production data.'],
      ['Amounts'],
      ['All money columns in these templates are entered in rupees; the ERP converts them to paise internally.'],
    ]);
    instructions['!cols'] = [{ wch: 110 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, template.sheet);
    XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=microtechnique_${type}_import_template.xlsx`);
    return res.send(buffer);
  } catch (err: any) {
    console.error('downloadImportTemplate error:', err.message);
    return res.status(500).json(error('Could not generate the import template'));
  }
}

export async function importData(req: Request, res: Response) {
  const type = importType(req.params.type);
  if (!type) return res.status(400).json(error('Unsupported import type'));
  if (type === 'stock') return bulkImport(req, res);
  if (!req.file) return res.status(400).json(error('Choose an XLSX, XLS, CSV or JSON file'));
  try {
    const rows = fileRows(req.file, type);
    if (!rows.length) return res.status(400).json(error('The uploaded file has no data rows'));
    const companyId = req.user!.company_id;
    const selectedGodownId = String(req.body?.godown_id || '').trim();
    const run = async (client: Queryable, confirm: boolean) => {
      if (confirm) await client.query('SELECT id FROM companies WHERE id=$1 FOR UPDATE', [companyId]);
      const result = await validate(type, rows, companyId, selectedGodownId, client);
      const alreadyPresent = 'alreadyPresent' in result && Array.isArray(result.alreadyPresent) ? result.alreadyPresent : [];
      const snapshot = { type, total: rows.length, valid: result.preview.length, invalid: result.errors.length,
        preview: result.preview, errors: result.errors, alreadyPresent, note: templates[type].note };
      const plan = { ...snapshot, preview_hash: importPreviewHash(snapshot) };
      if (!confirm) return { status: 200, body: success(plan) };
      if (!req.body?.preview_hash || req.body.preview_hash !== plan.preview_hash) return {
        status: 409, body: { ...error('Data changed since the preview. Review the refreshed results before saving.'), data: plan },
      };
      if (result.errors.length && req.body?.allow_partial !== 'true') return {
        status: 400, body: { ...error('Resolve the errors or choose to import valid records only.'), data: plan },
      };
      if (!result.preview.length) return { status: 400, body: error('No valid records are ready to import') };
      let inserted = 0;
      if (type === 'parties') inserted = await importParties(result.preview, companyId, req.user!.id, client);
      if (type === 'expenses') inserted = await importExpenses(result.preview, companyId, req.user!.id, client);
      if (type === 'purchases') inserted = await importPurchases(result.preview, companyId, req.user!.id, client);
      if (type === 'cash') inserted = await importCash(result.preview, companyId, req.user!.id, client);
      return { status: 200, body: success({ type, inserted, skipped: result.errors.length + alreadyPresent.length }) };
    };
    const result = req.query.action === 'confirm' ? await withTransaction((client) => run(client, true)) : await run(pool, false);
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    return res.status(400).json(error(err.message || 'Data import failed'));
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* upload cleanup */ }
  }
}
