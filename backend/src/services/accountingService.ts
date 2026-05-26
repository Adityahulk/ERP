import type { PoolClient } from 'pg';

export type Queryable = Pick<PoolClient, 'query'>;

type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
type NormalBalance = 'debit' | 'credit';

export type JournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  partyId?: string | null;
  costCenter?: string | null;
  referenceNumber?: string | null;
  instrumentDetails?: Record<string, unknown> | null;
};

export type JournalInput = {
  companyId: string;
  entryDate: string;
  description: string;
  lines: JournalLineInput[];
  createdBy?: string | null;
  entryType?: string;
  voucherType?: string;
  voucherNumber?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  remarks?: string | null;
  attachmentUrl?: string | null;
  replaceExisting?: boolean;
  skipIfEmpty?: boolean;
};

const COA: Array<{
  name: string;
  code: string;
  type: AccountType;
  subtype: string;
  category: string;
  children?: Array<{ name: string; code: string; subtype: string; category?: string }>;
}> = [
  {
    name: 'Fixed Assets',
    code: '1000',
    type: 'asset',
    subtype: 'fixed_assets',
    category: 'Assets',
  },
  {
    name: 'Current Assets',
    code: '1100',
    type: 'asset',
    subtype: 'current_assets',
    category: 'Assets',
    children: [
      { name: 'Sundry Debtors', code: '1110', subtype: 'sundry_debtors' },
      { name: 'Input Duties & Taxes', code: '1120', subtype: 'input_taxes' },
      { name: 'Input GST', code: '1121', subtype: 'input_gst' },
      { name: 'Input CGST', code: '1122', subtype: 'input_cgst' },
      { name: 'Input SGST', code: '1123', subtype: 'input_sgst' },
      { name: 'Input IGST', code: '1124', subtype: 'input_igst' },
      { name: 'Bank Accounts', code: '1130', subtype: 'bank' },
      { name: 'Cash Accounts', code: '1140', subtype: 'cash' },
      { name: 'Cash', code: '1141', subtype: 'cash' },
      { name: 'Other Current Assets', code: '1150', subtype: 'other_current_assets' },
    ],
  },
  { name: 'Other Assets', code: '1200', type: 'asset', subtype: 'other_assets', category: 'Assets' },
  {
    name: 'Capital Account',
    code: '3000',
    type: 'equity',
    subtype: 'capital',
    category: 'Equities & Liabilities',
    children: [
      { name: "Owner's Equity", code: '3010', subtype: 'owner_equity' },
      { name: 'Reserves & Surplus', code: '3020', subtype: 'reserves_surplus' },
      { name: 'Retained Earnings', code: '3030', subtype: 'retained_earnings' },
    ],
  },
  {
    name: 'Current Liabilities',
    code: '2100',
    type: 'liability',
    subtype: 'current_liabilities',
    category: 'Equities & Liabilities',
    children: [
      { name: 'Sundry Creditors', code: '2110', subtype: 'sundry_creditors' },
      { name: 'Outward Duties & Taxes', code: '2120', subtype: 'output_taxes' },
      { name: 'Output GST', code: '2121', subtype: 'output_gst' },
      { name: 'Output CGST', code: '2122', subtype: 'output_cgst' },
      { name: 'Output SGST', code: '2123', subtype: 'output_sgst' },
      { name: 'Output IGST', code: '2124', subtype: 'output_igst' },
      { name: 'Other Current Liabilities', code: '2130', subtype: 'other_current_liabilities' },
    ],
  },
  { name: 'Long-term Liabilities', code: '2200', type: 'liability', subtype: 'long_term_liabilities', category: 'Equities & Liabilities' },
  { name: 'Other Liabilities', code: '2300', type: 'liability', subtype: 'other_liabilities', category: 'Equities & Liabilities' },
  {
    name: 'Sale Accounts',
    code: '4000',
    type: 'income',
    subtype: 'sales',
    category: 'Incomes',
    children: [
      { name: 'Sale (Revenue) Account', code: '4010', subtype: 'sales_revenue' },
      { name: 'Additional Charges on Sale', code: '4020', subtype: 'sale_charges' },
    ],
  },
  { name: 'Other Incomes (Direct)', code: '4100', type: 'income', subtype: 'direct_income', category: 'Incomes' },
  { name: 'Other Incomes (Indirect)', code: '4200', type: 'income', subtype: 'indirect_income', category: 'Incomes' },
  {
    name: 'Purchase Accounts',
    code: '5000',
    type: 'expense',
    subtype: 'purchase',
    category: 'Expenses',
    children: [
      { name: 'Purchase', code: '5010', subtype: 'purchase_goods' },
      { name: 'Additional Charges on Purchase', code: '5020', subtype: 'purchase_charges' },
    ],
  },
  {
    name: 'Direct Expenses',
    code: '5100',
    type: 'expense',
    subtype: 'direct_expense',
    category: 'Expenses',
    children: [
      { name: 'Salary', code: '5110', subtype: 'salary' },
      { name: 'Transport', code: '5120', subtype: 'transport' },
      { name: 'Rent', code: '5130', subtype: 'rent' },
    ],
  },
  { name: 'Indirect Expenses', code: '5200', type: 'expense', subtype: 'indirect_expense', category: 'Expenses' },
];

function normalBalance(type: string): NormalBalance {
  return ['asset', 'expense'].includes(String(type).toLowerCase()) ? 'debit' : 'credit';
}

function toSqlDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function upsertAccount(
  db: Queryable,
  companyId: string,
  account: {
    name: string;
    code?: string;
    type: AccountType;
    subtype?: string;
    category?: string;
    parentId?: string | null;
    displayOrder?: number;
    isSystem?: boolean;
    isLocked?: boolean;
  },
): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM accounts
     WHERE company_id = $1 AND lower(name) = lower($2)
       AND COALESCE(parent_id::text, '') = COALESCE($3::text, '')
       AND is_deleted = false
     LIMIT 1`,
    [companyId, account.name, account.parentId || null],
  );
  const nb = normalBalance(account.type);
  if (existing.rows[0]?.id) {
    await db.query(
      `UPDATE accounts SET
         code = COALESCE(NULLIF($1, ''), code),
         account_type = $2,
         account_subtype = COALESCE($3, account_subtype),
         account_category = COALESCE($4, account_category),
         normal_balance = COALESCE(normal_balance, $5),
         opening_balance_type = COALESCE(opening_balance_type, $5),
         is_system = CASE WHEN $6 THEN true ELSE is_system END,
         is_locked = CASE WHEN $7 THEN true ELSE COALESCE(is_locked, false) END,
         is_default = CASE WHEN $6 THEN true ELSE COALESCE(is_default, false) END,
         display_order = COALESCE($8, display_order),
         currency_code = COALESCE(currency_code, 'INR'),
         updated_at = NOW()
       WHERE id = $9`,
      [
        account.code || null,
        account.type,
        account.subtype || null,
        account.category || null,
        nb,
        !!account.isSystem,
        !!account.isLocked,
        account.displayOrder || 0,
        existing.rows[0].id,
      ],
    );
    return existing.rows[0].id;
  }

  const inserted = await db.query(
    `INSERT INTO accounts (
       company_id, name, code, account_type, account_subtype, account_category, parent_id,
       normal_balance, opening_balance_type, is_system, is_locked, is_default, display_order, currency_code, is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$9,$11,'INR',true)
     RETURNING id`,
    [
      companyId,
      account.name,
      account.code || null,
      account.type,
      account.subtype || null,
      account.category || null,
      account.parentId || null,
      nb,
      !!account.isSystem,
      !!account.isLocked,
      account.displayOrder || 0,
    ],
  );
  return inserted.rows[0].id;
}

export async function ensureDefaultChartOfAccounts(db: Queryable, companyId: string) {
  let order = 1;
  const ids = new Map<string, string>();
  for (const root of COA) {
    const rootId = await upsertAccount(db, companyId, {
      ...root,
      displayOrder: order++,
      isSystem: true,
      isLocked: true,
    });
    ids.set(root.name, rootId);
    for (const child of root.children || []) {
      const childId = await upsertAccount(db, companyId, {
        name: child.name,
        code: child.code,
        type: root.type,
        subtype: child.subtype,
        category: child.category || root.category,
        parentId: rootId,
        displayOrder: order++,
        isSystem: true,
        isLocked: true,
      });
      ids.set(child.name, childId);
    }
  }
  return ids;
}

export async function getOrCreateDefaultAccount(
  db: Queryable,
  companyId: string,
  name: string,
  type: AccountType,
  parentName?: string,
) {
  await ensureDefaultChartOfAccounts(db, companyId);
  const res = await db.query(
    `SELECT a.id
     FROM accounts a
     LEFT JOIN accounts p ON p.id = a.parent_id
     WHERE a.company_id = $1 AND lower(a.name) = lower($2) AND a.is_deleted = false
       AND ($3::text IS NULL OR lower(p.name) = lower($3))
     ORDER BY a.is_system DESC, a.created_at ASC
     LIMIT 1`,
    [companyId, name, parentName || null],
  );
  if (res.rows[0]?.id) return res.rows[0].id as string;
  let parentId: string | null = null;
  if (parentName) {
    const parent = await db.query(
      `SELECT id FROM accounts
       WHERE company_id = $1 AND lower(name) = lower($2) AND is_deleted = false
       ORDER BY is_system DESC, created_at ASC
       LIMIT 1`,
      [companyId, parentName],
    );
    parentId = parent.rows[0]?.id || null;
  }
  return upsertAccount(db, companyId, {
    name,
    type,
    parentId,
    category: parentName ? undefined : type,
    isSystem: true,
    isLocked: true,
  });
}

export async function postJournalEntry(db: Queryable, input: JournalInput) {
  const lines = input.lines
    .map((line) => ({
      ...line,
      debit: Math.round(Number(line.debit) || 0),
      credit: Math.round(Number(line.credit) || 0),
    }))
    .filter((line) => line.debit > 0 || line.credit > 0);
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  if ((!lines.length || totalDebit <= 0) && input.skipIfEmpty) return null;
  if (!lines.length || totalDebit <= 0) throw new Error('Journal entry cannot be empty');
  if (totalDebit !== totalCredit) throw new Error('Debits and credits must be equal');

  if (input.referenceType && input.referenceId) {
    const existing = await db.query(
      `SELECT id FROM journal_entries
       WHERE company_id = $1 AND reference_type = $2 AND reference_id = $3
         AND is_deleted = false AND COALESCE(status, 'posted') <> 'reversed'
       LIMIT 1`,
      [input.companyId, input.referenceType, input.referenceId],
    );
    if (existing.rows[0]?.id && !input.replaceExisting) return existing.rows[0];
    if (existing.rows[0]?.id) {
      await db.query(`UPDATE journal_entries SET is_deleted = true, status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [existing.rows[0].id]);
    }
  }

  const seqRes = await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1`, [input.companyId]);
  const prefix = input.voucherType === 'reversal' ? 'JV-REV' : input.voucherType === 'payment' ? 'PAY-JV' : input.voucherType === 'sale' ? 'SALE-JV' : input.voucherType === 'purchase' ? 'PUR-JV' : 'JV';
  const generatedNo = `${prefix}/${new Date().getFullYear().toString().slice(-2)}/${String(Number(seqRes.rows[0]?.c || 0) + 1).padStart(4, '0')}`;
  const voucherNumber = input.voucherNumber || generatedNo;

  const je = await db.query(
    `INSERT INTO journal_entries (
       company_id, entry_number, voucher_number, entry_date, entry_type, voucher_type,
       reference_type, reference_id, description, remarks, attachment_url,
       total_debit, total_credit, status, created_by
     ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'posted',$13)
     RETURNING *`,
    [
      input.companyId,
      voucherNumber,
      toSqlDate(input.entryDate),
      input.entryType || 'manual',
      input.voucherType || input.entryType || 'manual',
      input.referenceType || null,
      input.referenceId || null,
      input.description,
      input.remarks || null,
      input.attachmentUrl || null,
      totalDebit,
      totalCredit,
      input.createdBy || null,
    ],
  );

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    await db.query(
      `INSERT INTO journal_entry_lines (
         entry_id, company_id, account_id, debit, credit, description, party_id,
         sort_order, cost_center, reference_number, instrument_details
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        je.rows[0].id,
        input.companyId,
        line.accountId,
        line.debit,
        line.credit,
        line.description || null,
        line.partyId || null,
        i,
        line.costCenter || null,
        line.referenceNumber || null,
        line.instrumentDetails ? JSON.stringify(line.instrumentDetails) : null,
      ],
    );
  }

  return je.rows[0];
}

export async function postSalesInvoiceAccounting(db: Queryable, companyId: string, invoice: any, createdBy?: string | null) {
  const debtor = await getOrCreateDefaultAccount(db, companyId, 'Sundry Debtors', 'asset', 'Current Assets');
  const sales = await getOrCreateDefaultAccount(db, companyId, 'Sale (Revenue) Account', 'income', 'Sale Accounts');
  const outCgst = await getOrCreateDefaultAccount(db, companyId, 'Output CGST', 'liability', 'Current Liabilities');
  const outSgst = await getOrCreateDefaultAccount(db, companyId, 'Output SGST', 'liability', 'Current Liabilities');
  const outIgst = await getOrCreateDefaultAccount(db, companyId, 'Output IGST', 'liability', 'Current Liabilities');
  return postJournalEntry(db, {
    companyId,
    entryDate: toSqlDate(invoice.invoice_date),
    entryType: 'system',
    voucherType: 'sale',
    voucherNumber: invoice.invoice_number,
    referenceType: 'invoice',
    referenceId: invoice.id,
    description: `Sales invoice ${invoice.invoice_number}`,
    createdBy,
    skipIfEmpty: true,
    lines: [
      { accountId: debtor, debit: Number(invoice.total_amount || 0), partyId: invoice.party_id || null },
      { accountId: sales, credit: Number(invoice.taxable_amount || invoice.subtotal || 0) },
      { accountId: outCgst, credit: Number(invoice.cgst_amount || 0) },
      { accountId: outSgst, credit: Number(invoice.sgst_amount || 0) },
      { accountId: outIgst, credit: Number(invoice.igst_amount || 0) },
    ],
  });
}

export async function postPurchaseInvoiceAccounting(db: Queryable, companyId: string, invoice: any, createdBy?: string | null) {
  const creditors = await getOrCreateDefaultAccount(db, companyId, 'Sundry Creditors', 'liability', 'Current Liabilities');
  const purchase = await getOrCreateDefaultAccount(db, companyId, 'Purchase', 'expense', 'Purchase Accounts');
  const inCgst = await getOrCreateDefaultAccount(db, companyId, 'Input CGST', 'asset', 'Current Assets');
  const inSgst = await getOrCreateDefaultAccount(db, companyId, 'Input SGST', 'asset', 'Current Assets');
  const inIgst = await getOrCreateDefaultAccount(db, companyId, 'Input IGST', 'asset', 'Current Assets');
  return postJournalEntry(db, {
    companyId,
    entryDate: toSqlDate(invoice.bill_date),
    entryType: 'system',
    voucherType: 'purchase',
    voucherNumber: invoice.bill_number,
    referenceType: 'purchase_invoice',
    referenceId: invoice.id,
    description: `Purchase bill ${invoice.bill_number}`,
    createdBy,
    skipIfEmpty: true,
    lines: [
      { accountId: purchase, debit: Number(invoice.taxable_amount || invoice.subtotal || 0) },
      { accountId: inCgst, debit: Number(invoice.cgst_amount || 0) },
      { accountId: inSgst, debit: Number(invoice.sgst_amount || 0) },
      { accountId: inIgst, debit: Number(invoice.igst_amount || 0) },
      { accountId: creditors, credit: Number(invoice.total_amount || 0), partyId: invoice.party_id || null },
    ],
  });
}

export async function postExpenseAccounting(db: Queryable, companyId: string, expense: any, createdBy?: string | null) {
  const expenseAccount = await getOrCreateDefaultAccount(db, companyId, String(expense.category || 'Indirect Expenses'), 'expense', 'Indirect Expenses');
  const cash = await getOrCreateDefaultAccount(db, companyId, 'Cash', 'asset', 'Current Assets');
  const bank = await getOrCreateDefaultAccount(db, companyId, 'Bank Accounts', 'asset', 'Current Assets');
  const creditAccount = ['cash'].includes(String(expense.payment_mode || '').toLowerCase()) ? cash : bank;
  return postJournalEntry(db, {
    companyId,
    entryDate: toSqlDate(expense.expense_date),
    entryType: 'system',
    voucherType: 'expense',
    voucherNumber: expense.expense_number,
    referenceType: 'expense',
    referenceId: expense.id,
    description: `Expense ${expense.expense_number}`,
    createdBy,
    skipIfEmpty: true,
    lines: [
      { accountId: expenseAccount, debit: Number(expense.total_amount || expense.amount || 0) },
      { accountId: creditAccount, credit: Number(expense.total_amount || expense.amount || 0), referenceNumber: expense.reference_number || null },
    ],
  });
}

export async function postPaymentAccounting(db: Queryable, companyId: string, payment: any, createdBy?: string | null) {
  const cash = await getOrCreateDefaultAccount(db, companyId, 'Cash', 'asset', 'Current Assets');
  const bank = await getOrCreateDefaultAccount(db, companyId, 'Bank Accounts', 'asset', 'Current Assets');
  const debtors = await getOrCreateDefaultAccount(db, companyId, 'Sundry Debtors', 'asset', 'Current Assets');
  const creditors = await getOrCreateDefaultAccount(db, companyId, 'Sundry Creditors', 'liability', 'Current Liabilities');
  const mode = String(payment.payment_mode || '').toLowerCase();
  const isCash = mode === 'cash';
  const isIncoming = ['incoming', 'receipt', 'payment_in'].includes(String(payment.payment_type || '').toLowerCase());
  const assetAccount = isCash ? cash : bank;
  const amount = Number(payment.amount || 0);

  if (String(payment.payment_type) === 'bank_deposit') {
    return postJournalEntry(db, {
      companyId,
      entryDate: toSqlDate(payment.payment_date),
      entryType: 'system',
      voucherType: 'payment',
      voucherNumber: payment.payment_number,
      referenceType: 'payment',
      referenceId: payment.id,
      description: payment.notes || `Cash deposit ${payment.payment_number}`,
      createdBy,
      skipIfEmpty: true,
      lines: [
        { accountId: bank, debit: amount },
        { accountId: cash, credit: amount },
      ],
    });
  }
  if (String(payment.payment_type) === 'bank_withdrawal') {
    return postJournalEntry(db, {
      companyId,
      entryDate: toSqlDate(payment.payment_date),
      entryType: 'system',
      voucherType: 'payment',
      voucherNumber: payment.payment_number,
      referenceType: 'payment',
      referenceId: payment.id,
      description: payment.notes || `Cash withdrawal ${payment.payment_number}`,
      createdBy,
      skipIfEmpty: true,
      lines: [
        { accountId: cash, debit: amount },
        { accountId: bank, credit: amount },
      ],
    });
  }

  return postJournalEntry(db, {
    companyId,
    entryDate: toSqlDate(payment.payment_date),
    entryType: 'system',
    voucherType: 'payment',
    voucherNumber: payment.payment_number,
    referenceType: 'payment',
    referenceId: payment.id,
    description: payment.notes || `Payment ${payment.payment_number}`,
    createdBy,
    skipIfEmpty: true,
    lines: isIncoming
      ? [
          { accountId: assetAccount, debit: amount, referenceNumber: payment.reference_number || null },
          { accountId: debtors, credit: amount, partyId: payment.party_id || null },
        ]
      : [
          { accountId: creditors, debit: amount, partyId: payment.party_id || null },
          { accountId: assetAccount, credit: amount, referenceNumber: payment.reference_number || null },
        ],
  });
}

export async function reverseAccountingForReference(
  db: Queryable,
  companyId: string,
  referenceType: string,
  referenceId: string,
  createdBy?: string | null,
) {
  const existing = await db.query(
    `SELECT * FROM journal_entries
     WHERE company_id = $1 AND reference_type = $2 AND reference_id = $3
       AND is_deleted = false AND COALESCE(status, 'posted') = 'posted'
     LIMIT 1`,
    [companyId, referenceType, referenceId],
  );
  if (!existing.rows.length) return null;
  const lines = await db.query(`SELECT * FROM journal_entry_lines WHERE entry_id = $1 ORDER BY sort_order ASC`, [existing.rows[0].id]);
  const reversed = await postJournalEntry(db, {
    companyId,
    entryDate: new Date().toISOString().slice(0, 10),
    entryType: 'system',
    voucherType: 'reversal',
    referenceType: `${referenceType}_reversal`,
    referenceId,
    description: `Reversal of ${existing.rows[0].entry_number}`,
    createdBy,
    lines: lines.rows.map((line: any) => ({
      accountId: line.account_id,
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      partyId: line.party_id || null,
      description: `Reversal of ${existing.rows[0].entry_number}`,
    })),
  });
  await db.query(`UPDATE journal_entries SET status = 'reversed', reversed_by = $1, updated_at = NOW() WHERE id = $2`, [reversed.id, existing.rows[0].id]);
  return reversed;
}
