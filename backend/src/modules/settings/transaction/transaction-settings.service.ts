import * as repo from './transaction-settings.repository';

const ROUND_TYPES = new Set(['NEAREST', 'FLOOR', 'CEIL']);
const ROUND_TO = new Set([1, 10, 100]);
const BILLING_TYPES = new Set(['LITE_SALE', 'FULL_SALE']);
const TERM_TYPES = new Set(['SALE', 'PURCHASE_ORDER', 'PURCHASE_BILL', 'PROFORMA_INVOICE', 'ESTIMATE_QUOTATION', 'DELIVERY_CHALLAN', 'SALE_ORDER', 'PAYMENT_IN']);
const THEMES = new Set(['THEME_1', 'THEME_2', 'THEME_3', 'THEME_4', 'GST_THEME_1', 'GST_THEME_2', 'GST_THEME_3', 'GST_THEME_4', 'GST_THEME_5']);
const TAX_RATES = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28]);
const PREFIX_RE = /^[A-Za-z0-9/-]{0,10}$/;
const SAC_RE = /^\d{6}$/;

function bool(value: unknown, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function str(value: unknown, max: number, fallback = '') {
  return String(value ?? fallback).trim().slice(0, max);
}

function optionalPrefix(value: unknown) {
  const v = String(value ?? '').trim();
  if (!v || v.toLowerCase() === 'none') return null;
  if (!PREFIX_RE.test(v)) throw new Error('Prefix must be max 10 characters and contain only letters, numbers, hyphen or slash.');
  return v;
}

function taxRate(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!TAX_RATES.has(n)) throw new Error('Invalid additional charge tax rate.');
  return n;
}

export async function getSettingsForFirm(firmId: string) {
  return repo.getAllTransactionSettings(firmId);
}

export async function updateSettings(firmId: string, body: Record<string, unknown>) {
  const roundOffType = String(body.roundOffType || 'NEAREST').toUpperCase();
  const roundOffTo = Number(body.roundOffTo ?? 1);
  const billingType = String(body.billingType || 'FULL_SALE').toUpperCase();
  if (!ROUND_TYPES.has(roundOffType)) throw new Error('Invalid round off type.');
  if (!ROUND_TO.has(roundOffTo)) throw new Error('Invalid round off value.');
  if (!BILLING_TYPES.has(billingType)) throw new Error('Invalid billing type.');
  return repo.updateMainSettings(firmId, {
    showInvoiceNumber: bool(body.showInvoiceNumber, true),
    addTimeOnTransactions: bool(body.addTimeOnTransactions),
    cashSaleByDefault: bool(body.cashSaleByDefault),
    showBillingNameOfParties: bool(body.showBillingNameOfParties),
    showCustomerPODetails: bool(body.showCustomerPODetails),
    showInclusiveExclusiveTax: bool(body.showInclusiveExclusiveTax, true),
    showPurchasePriceInItems: bool(body.showPurchasePriceInItems, true),
    showLast5SalePrice: bool(body.showLast5SalePrice),
    showLast5PurchasePrice: bool(body.showLast5PurchasePrice),
    showFreeItemQuantity: bool(body.showFreeItemQuantity),
    showCountColumn: bool(body.showCountColumn),
    countColumnLabel: str(body.countColumnLabel, 30, 'Count') || 'Count',
    enableTransactionWiseTax: bool(body.enableTransactionWiseTax),
    enableTransactionWiseDiscount: bool(body.enableTransactionWiseDiscount),
    roundOffTotal: bool(body.roundOffTotal, true),
    roundOffType,
    roundOffTo,
    enableEwayBill: bool(body.enableEwayBill),
    enableQuickEntry: bool(body.enableQuickEntry),
    doNotShowInvoicePreview: bool(body.doNotShowInvoicePreview),
    enablePasscodeForEditDelete: bool(body.enablePasscodeForEditDelete),
    enableDiscountDuringPayments: bool(body.enableDiscountDuringPayments),
    linkPaymentsToInvoices: bool(body.linkPaymentsToInvoices),
    enableDueDatesAndPaymentTerms: bool(body.enableDueDatesAndPaymentTerms),
    showProfitWhileMakingSaleInvoice: bool(body.showProfitWhileMakingSaleInvoice),
    enableTermsAndConditions: bool(body.enableTermsAndConditions, true),
    billingType,
    defaultUpiId: body.defaultUpiId !== undefined ? (body.defaultUpiId ? str(body.defaultUpiId, 50) : null) : undefined,
  });
}

export async function getPrefixes(firmId: string) {
  return repo.getPrefixes(firmId);
}

export async function updatePrefixes(firmId: string, body: Record<string, unknown>) {
  return repo.updatePrefixes(firmId, {
    sale: optionalPrefix(body.sale),
    creditNote: optionalPrefix(body.creditNote),
    saleOrder: optionalPrefix(body.saleOrder),
    purchaseOrder: optionalPrefix(body.purchaseOrder),
    estimate: optionalPrefix(body.estimate),
    proformaInvoice: optionalPrefix(body.proformaInvoice),
    deliveryChallan: optionalPrefix(body.deliveryChallan),
    paymentIn: optionalPrefix(body.paymentIn),
  });
}

export async function listTerms(firmId: string) {
  return repo.listTerms(firmId);
}

function normalizeTerm(body: Record<string, unknown>, partial = false) {
  const type = String(body.transactionType || '').toUpperCase();
  if (!partial || body.transactionType !== undefined) {
    if (!TERM_TYPES.has(type)) throw new Error('Invalid transaction type.');
  }
  const title = body.title === undefined && partial ? undefined : str(body.title, 100);
  const content = body.content === undefined && partial ? undefined : str(body.content, 2000);
  if (!partial && (!title || !content)) throw new Error('Terms title and content are required.');
  return {
    ...(body.transactionType !== undefined ? { transactionType: type } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(body.isDefault !== undefined ? { isDefault: bool(body.isDefault) } : {}),
    ...(body.sortOrder !== undefined ? { sortOrder: Math.max(0, Number(body.sortOrder) || 0) } : {}),
  };
}

export async function createTerm(firmId: string, body: Record<string, unknown>) {
  return repo.createTerm(firmId, normalizeTerm(body));
}

export async function updateTerm(firmId: string, id: string, body: Record<string, unknown>) {
  return repo.updateTerm(firmId, id, normalizeTerm(body, true));
}

export async function deleteTerm(firmId: string, id: string) {
  return repo.deleteTerm(firmId, id);
}

export async function getAdditionalFields(firmId: string) {
  return repo.getAdditionalFields(firmId);
}

export async function updateAdditionalFields(firmId: string, body: Record<string, unknown>) {
  const theme = String(body.invoiceTheme || 'THEME_1').toUpperCase();
  if (!THEMES.has(theme)) throw new Error('Invalid invoice theme.');
  return repo.updateAdditionalFields(firmId, {
    invoiceTheme: theme,
    firmField1Enabled: bool(body.firmField1Enabled),
    firmField1Label: str(body.firmField1Label, 50) || null,
    firmField2Enabled: bool(body.firmField2Enabled),
    firmField2Label: str(body.firmField2Label, 50) || null,
    txnField1Enabled: bool(body.txnField1Enabled),
    txnField1Label: str(body.txnField1Label, 50) || null,
    txnField2Enabled: bool(body.txnField2Enabled),
    txnField2Label: str(body.txnField2Label, 50) || null,
    txnField3Enabled: bool(body.txnField3Enabled),
    txnField3Label: str(body.txnField3Label, 50) || null,
    txnDateFieldEnabled: bool(body.txnDateFieldEnabled),
    txnDateFieldLabel: str(body.txnDateFieldLabel, 50) || null,
    showOnSales: bool(body.showOnSales),
    showOnPurchase: bool(body.showOnPurchase),
    showOnExpense: bool(body.showOnExpense),
    showOnPaymentIn: bool(body.showOnPaymentIn),
  });
}

export async function getTransportation(firmId: string) {
  return repo.getTransportation(firmId);
}

export async function updateTransportation(firmId: string, body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (let i = 1; i <= 6; i++) {
    out[`field${i}Label`] = str(body[`field${i}Label`], 50, `Field ${i}`) || `Field ${i}`;
    out[`field${i}Enabled`] = bool(body[`field${i}Enabled`]);
    out[`field${i}ShowInPrint`] = bool(body[`field${i}ShowInPrint`], true);
  }
  return repo.updateTransportation(firmId, out);
}

export async function getCharges(firmId: string) {
  return repo.getCharges(firmId);
}

export async function updateCharges(firmId: string, body: Record<string, unknown>) {
  const out: Record<string, unknown> = { masterEnabled: bool(body.masterEnabled) };
  for (let i = 1; i <= 3; i++) {
    const sac = str(body[`charge${i}SacCode`], 6);
    if (sac && !SAC_RE.test(sac)) throw new Error('SAC code must be a 6-digit number.');
    out[`charge${i}Label`] = str(body[`charge${i}Label`], 50, i === 1 ? 'Shipping' : i === 2 ? 'Packaging' : 'Adjustment');
    out[`charge${i}Enabled`] = bool(body[`charge${i}Enabled`]);
    out[`charge${i}SacCode`] = sac || null;
    out[`charge${i}TaxRate`] = taxRate(body[`charge${i}TaxRate`]);
    out[`charge${i}TaxEnabled`] = bool(body[`charge${i}TaxEnabled`]);
  }
  return repo.updateCharges(firmId, out);
}
