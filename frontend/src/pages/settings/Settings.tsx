import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Building2, MapPin, Users, FileText, Package, Database, AlertCircle, AlertTriangle, Upload, Power, Plus, Search, Trash2, UserRound, Download, Pencil, X, Printer, ReceiptText, Calculator, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCompany, useUpdateCompany } from '@/hooks/useBusiness';
import api, { getApiBaseURL } from '@/lib/api';
import { normalizeRole, roleLabel } from '@/lib/roles';
import { normalizeCurrencyCode, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/formatters';
import { normalizeInvoiceThemeId } from '@/components/invoices/InvoicePreviewWorkspace';
import {
  DEFAULT_PRINT_LAYOUT_COLORS,
  PRINT_COLOR_PALETTE,
  PRINT_LAYOUT_BY_ID,
  PRINT_LAYOUT_LEGACY_ID_MAP,
  PRINT_LAYOUT_OPTIONS,
  PrintInvoiceLayoutPreview,
  PrintLayoutPicker,
  type PrintLayoutId,
} from '@/components/settings/PrintLayoutPreview';

type SalesCustomFieldDef = {
  id: string;
  label: string;
  scope: 'item';
  type: 'text' | 'number' | 'date';
  required: boolean;
  enabled: boolean;
};

type ItemCustomFieldDef = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date';
  enabled: boolean;
  show_in_print: boolean;
};

type ItemSettingsState = {
  enable_item: boolean;
  sell_type: 'product' | 'service' | 'both';
  barcode_scan: boolean;
  stock_maintenance: boolean;
  manufacturing: boolean;
  show_low_stock_dialog: boolean;
  items_unit: boolean;
  default_unit: boolean;
  item_category: boolean;
  party_wise_item_rate: boolean;
  description: boolean;
  item_wise_tax: boolean;
  item_wise_discount: boolean;
  update_sale_price_from_transaction: boolean;
  quantity_decimal_places: number;
  wholesale_price: boolean;
  mrp: boolean;
  calculate_tax_based_on_mrp: boolean;
  serial_tracking: boolean;
  batch_tracking: boolean;
  exp_date: boolean;
  mfg_date: boolean;
  model_no: boolean;
  size: boolean;
};

type PrintColumnKey =
  | 'serial_no' | 'item_name' | 'item_code' | 'hsn_code' | 'quantity' | 'unit' | 'unit_price'
  | 'discount_amount' | 'discount_percent' | 'taxable_amount' | 'gst_rate' | 'tax_amount'
  | 'amount' | 'description' | 'batch_no' | 'exp_date' | 'mfg_date' | 'mrp' | 'size'
  | 'model_no' | 'brand' | 'material';

type PrintSettingsState = {
  regular: {
    default: boolean;
    layout: string;
    paper_size: 'A4' | 'Letter';
    orientation: 'portrait' | 'landscape';
    company_name_text_size: 'small' | 'medium' | 'large';
    invoice_text_size: 'small' | 'medium' | 'large';
    repeat_header: boolean;
    print_original_duplicate: boolean;
    extra_top_space: number;
    min_item_rows: number;
  };
  header: {
    company_name: boolean;
    company_logo: boolean;
    address: boolean;
    email: boolean;
    phone: boolean;
    gstin: boolean;
  };
  item_table: { columns: PrintColumnKey[] };
  layout_colors: Record<string, string>;
  totals: {
    total_item_quantity: boolean;
    amount_with_decimal: boolean;
    received_amount: boolean;
    balance_amount: boolean;
    current_balance_of_party: boolean;
    tax_details: boolean;
    you_saved: boolean;
    print_amount_with_grouping: boolean;
    amount_in_words: 'indian' | 'international';
  };
  footer: {
    print_description: boolean;
    print_terms: boolean;
    print_received_by: boolean;
    print_delivered_by: boolean;
    signature_enabled: boolean;
    signature_text: string;
    payment_mode: boolean;
    acknowledgement: boolean;
  };
  transaction_names: Record<string, string | boolean>;
  reference_invoice: {
    fields: Record<string, boolean>;
    show_item_custom_fields: boolean;
    include_eway_appendix: boolean;
    declaration: string;
    terms: string;
  };
};

type TaxRateRow = { id: string; label: string; type: 'IGST' | 'CGST' | 'SGST' | 'CESS'; rate: number; active: boolean };
type TaxGroupRow = { id: string; label: string; rate: number; components: Array<{ type: 'CGST' | 'SGST' | 'IGST' | 'CESS'; rate: number }>; active: boolean };
type CustomTaxRateRow = { id: string; name: string; rate: number; isActive: boolean };
type TaxSettingsState = {
  enable_gst: boolean;
  enable_hsn_sac: boolean;
  additional_cess_on_item: boolean;
  reverse_charge: boolean;
  enable_place_of_supply: boolean;
  composite_scheme: boolean;
  enable_tcs: boolean;
  enable_tds: boolean;
  enabledSlabs: number[];
  customRates: CustomTaxRateRow[];
  rates: TaxRateRow[];
  groups: TaxGroupRow[];
};
type TaxSettingsFlagKey = Exclude<keyof TaxSettingsState, 'enabledSlabs' | 'customRates' | 'rates' | 'groups'>;

type TransactionSettingsState = {
  showInvoiceNumber: boolean;
  addTimeOnTransactions: boolean;
  cashSaleByDefault: boolean;
  showBillingNameOfParties: boolean;
  showCustomerPODetails: boolean;
  showInclusiveExclusiveTax: boolean;
  showPurchasePriceInItems: boolean;
  showLast5SalePrice: boolean;
  showLast5PurchasePrice: boolean;
  showFreeItemQuantity: boolean;
  showCountColumn: boolean;
  countColumnLabel: string;
  enableTransactionWiseTax: boolean;
  enableTransactionWiseDiscount: boolean;
  roundOffTotal: boolean;
  roundOffType: 'NEAREST' | 'FLOOR' | 'CEIL';
  roundOffTo: 1 | 10 | 100;
  enableEwayBill: boolean;
  enableQuickEntry: boolean;
  doNotShowInvoicePreview: boolean;
  enablePasscodeForEditDelete: boolean;
  enableDiscountDuringPayments: boolean;
  linkPaymentsToInvoices: boolean;
  enableDueDatesAndPaymentTerms: boolean;
  showProfitWhileMakingSaleInvoice: boolean;
  enableTermsAndConditions: boolean;
  billingType: 'LITE_SALE' | 'FULL_SALE';
};

type TransactionPrefixesState = {
  sale: string;
  creditNote: string;
  saleOrder: string;
  purchaseOrder: string;
  estimate: string;
  proformaInvoice: string;
  deliveryChallan: string;
  paymentIn: string;
};

type TermsEntry = { id?: string; transactionType: string; title: string; content: string; isDefault: boolean; sortOrder?: number };
type AdditionalFieldsState = Record<string, any>;
type TransportationState = Record<string, any>;
type AdditionalChargesState = Record<string, any>;

const DEFAULT_ITEM_SETTINGS: ItemSettingsState = {
  enable_item: true,
  sell_type: 'both',
  barcode_scan: false,
  stock_maintenance: true,
  manufacturing: false,
  show_low_stock_dialog: true,
  items_unit: true,
  default_unit: false,
  item_category: true,
  party_wise_item_rate: false,
  description: false,
  item_wise_tax: true,
  item_wise_discount: true,
  update_sale_price_from_transaction: false,
  quantity_decimal_places: 2,
  wholesale_price: false,
  mrp: false,
  calculate_tax_based_on_mrp: false,
  serial_tracking: false,
  batch_tracking: false,
  exp_date: false,
  mfg_date: false,
  model_no: false,
  size: false,
};

const PRINT_COLUMNS: { key: PrintColumnKey; label: string; group: 'item' | 'additional' | 'amount' }[] = [
  { key: 'serial_no', label: 'SI No.', group: 'item' },
  { key: 'item_name', label: 'Item name', group: 'item' },
  { key: 'item_code', label: 'Item Code', group: 'item' },
  { key: 'hsn_code', label: 'HSN/SAC', group: 'item' },
  { key: 'batch_no', label: 'Batch No.', group: 'additional' },
  { key: 'exp_date', label: 'Exp. Date', group: 'additional' },
  { key: 'mfg_date', label: 'Mfg. Date', group: 'additional' },
  { key: 'mrp', label: 'MRP', group: 'additional' },
  { key: 'size', label: 'Size', group: 'additional' },
  { key: 'model_no', label: 'Model No.', group: 'additional' },
  { key: 'description', label: 'Description', group: 'additional' },
  { key: 'brand', label: 'Brand', group: 'additional' },
  { key: 'material', label: 'Material', group: 'additional' },
  { key: 'quantity', label: 'Quantity', group: 'amount' },
  { key: 'unit', label: 'Unit', group: 'amount' },
  { key: 'unit_price', label: 'Price/Unit', group: 'amount' },
  { key: 'discount_amount', label: 'Discount', group: 'amount' },
  { key: 'discount_percent', label: 'Discount%', group: 'amount' },
  { key: 'taxable_amount', label: 'Taxable Amount', group: 'amount' },
  { key: 'tax_amount', label: 'Tax Amount', group: 'amount' },
  { key: 'gst_rate', label: 'Tax%', group: 'amount' },
  { key: 'amount', label: 'Amount', group: 'amount' },
];

const TRANSACTION_NAME_FIELDS = [
  ['sale', 'Sale'],
  ['purchase', 'Purchase'],
  ['payment_in', 'Payment-In'],
  ['payment_out', 'Payment-Out'],
  ['expense', 'Expense'],
  ['other_income', 'Other Income'],
  ['sale_order', 'Sale Order'],
  ['purchase_order', 'Purchase Order'],
  ['estimate', 'Estimate'],
  ['proforma_invoice', 'Proforma Invoice'],
  ['delivery_challan', 'Delivery Challan'],
  ['credit_note', 'Credit Note'],
  ['debit_note', 'Debit Note'],
] as const;

const REFERENCE_INVOICE_FIELDS = [
  ['eway_bill_no', 'e-Way Bill No.'],
  ['delivery_note', 'Delivery Note'],
  ['mode_terms_payment', 'Mode/Terms of Payment'],
  ['reference_no_date', 'Reference No. & Date'],
  ['other_references', 'Other References'],
  ['buyer_order_no', "Buyer's Order No."],
  ['buyer_order_date', "Buyer's Order Date"],
  ['dispatch_doc_no', 'Dispatch Doc No.'],
  ['delivery_note_date', 'Delivery Note Date'],
  ['dispatched_through', 'Dispatched through'],
  ['destination', 'Destination'],
  ['vessel_flight_no', 'Vessel/Flight No.'],
  ['receipt_by_shipper', 'Place of receipt by shipper'],
  ['port_loading', 'City/Port of Loading'],
  ['port_discharge', 'City/Port of Discharge'],
  ['terms_delivery', 'Terms of Delivery'],
] as const;

const DEFAULT_REFERENCE_FIELD_VISIBILITY = Object.fromEntries(REFERENCE_INVOICE_FIELDS.map(([key]) => [key, true])) as Record<string, boolean>;

const DEFAULT_PRINT_SETTINGS: PrintSettingsState = {
  regular: {
    default: true,
    layout: 'business-theme-1',
    paper_size: 'A4',
    orientation: 'portrait',
    company_name_text_size: 'large',
    invoice_text_size: 'medium',
    repeat_header: true,
    print_original_duplicate: false,
    extra_top_space: 0,
    min_item_rows: 0,
  },
  header: {
    company_name: true,
    company_logo: true,
    address: true,
    email: true,
    phone: true,
    gstin: true,
  },
  item_table: {
    columns: ['serial_no', 'item_name', 'hsn_code', 'quantity', 'unit', 'unit_price', 'tax_amount', 'amount'],
  },
  layout_colors: DEFAULT_PRINT_LAYOUT_COLORS,
  totals: {
    total_item_quantity: true,
    amount_with_decimal: true,
    received_amount: true,
    balance_amount: true,
    current_balance_of_party: false,
    tax_details: true,
    you_saved: true,
    print_amount_with_grouping: true,
    amount_in_words: 'indian',
  },
  footer: {
    print_description: true,
    print_terms: true,
    print_received_by: true,
    print_delivered_by: true,
    signature_enabled: true,
    signature_text: 'Authorized Signatory',
    payment_mode: false,
    acknowledgement: false,
  },
  transaction_names: {
    sale: 'Tax Invoice',
    purchase: 'Bill',
    payment_in: 'Payment Receipt',
    payment_out: 'Payment Out',
    expense: 'Expense',
    other_income: 'Other Income',
    sale_order: 'Sale Order',
    purchase_order: 'Purchase Order',
    estimate: 'Estimate',
    proforma_invoice: 'Proforma Invoice',
    delivery_challan: 'Delivery Challan',
    credit_note: 'Credit Note',
    debit_note: 'Debit Note',
    non_tax_bill: false,
  },
  reference_invoice: {
    fields: DEFAULT_REFERENCE_FIELD_VISIBILITY,
    show_item_custom_fields: true,
    include_eway_appendix: true,
    declaration: '',
    terms: '1. Goods Once Sold Will Not Be Accepted.\n2. Subject to Ahemdabad jurisdiction. E. & O.E.\n3. Payment within 30 Days.\n4. Interest @ 18% will be charged from Due Date.',
  },
};

const STANDARD_GST_SLABS = [0, 0.1, 0.25, 0.5, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28, 40];
const DEFAULT_GST_GROUP_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
const DEFAULT_TAX_SETTINGS: TaxSettingsState = {
  enable_gst: true,
  enable_hsn_sac: true,
  additional_cess_on_item: false,
  reverse_charge: false,
  enable_place_of_supply: true,
  composite_scheme: false,
  enable_tcs: false,
  enable_tds: false,
  enabledSlabs: [...STANDARD_GST_SLABS],
  customRates: [],
  rates: DEFAULT_GST_GROUP_RATES.flatMap((rate) => {
    const half = Number((rate / 2).toFixed(3));
    return [
      { id: `igst_${rate}`, label: `IGST@${rate}%`, type: 'IGST' as const, rate, active: true },
      { id: `sgst_${half}`, label: `SGST@${half}%`, type: 'SGST' as const, rate: half, active: true },
      { id: `cgst_${half}`, label: `CGST@${half}%`, type: 'CGST' as const, rate: half, active: true },
    ];
  }),
  groups: DEFAULT_GST_GROUP_RATES.map((rate) => {
    const half = Number((rate / 2).toFixed(3));
    return {
      id: `gst_${rate}`,
      label: `GST@${rate}%`,
      rate,
      components: [{ type: 'SGST' as const, rate: half }, { type: 'CGST' as const, rate: half }],
      active: true,
    };
  }),
};

const DEFAULT_TRANSACTION_SETTINGS: TransactionSettingsState = {
  showInvoiceNumber: true,
  addTimeOnTransactions: false,
  cashSaleByDefault: false,
  showBillingNameOfParties: false,
  showCustomerPODetails: false,
  showInclusiveExclusiveTax: true,
  showPurchasePriceInItems: true,
  showLast5SalePrice: false,
  showLast5PurchasePrice: false,
  showFreeItemQuantity: false,
  showCountColumn: false,
  countColumnLabel: 'Count',
  enableTransactionWiseTax: false,
  enableTransactionWiseDiscount: false,
  roundOffTotal: true,
  roundOffType: 'NEAREST',
  roundOffTo: 1,
  enableEwayBill: false,
  enableQuickEntry: false,
  doNotShowInvoicePreview: false,
  enablePasscodeForEditDelete: false,
  enableDiscountDuringPayments: false,
  linkPaymentsToInvoices: false,
  enableDueDatesAndPaymentTerms: false,
  showProfitWhileMakingSaleInvoice: false,
  enableTermsAndConditions: true,
  billingType: 'FULL_SALE',
};

const DEFAULT_PREFIXES: TransactionPrefixesState = {
  sale: '',
  creditNote: '',
  saleOrder: '',
  purchaseOrder: '',
  estimate: '',
  proformaInvoice: '',
  deliveryChallan: '',
  paymentIn: '',
};

const DEFAULT_ADDITIONAL_FIELDS: AdditionalFieldsState = {
  invoiceTheme: 'THEME_1',
  firmField1Enabled: false,
  firmField1Label: '',
  firmField2Enabled: false,
  firmField2Label: '',
  txnField1Enabled: false,
  txnField1Label: '',
  txnField2Enabled: false,
  txnField2Label: '',
  txnField3Enabled: false,
  txnField3Label: '',
  txnDateFieldEnabled: false,
  txnDateFieldLabel: '',
  showOnSales: false,
  showOnPurchase: false,
  showOnExpense: false,
  showOnPaymentIn: false,
};

const DEFAULT_TRANSPORTATION: TransportationState = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => {
    const n = i + 1;
    const label = ['Transport Name', 'Vehicle Number', 'Delivery Date', 'Delivery Location', 'Field 5', 'Field 6'][i];
    return [[`field${n}Label`, label], [`field${n}Enabled`, false], [`field${n}ShowInPrint`, true]];
  }).flat(),
);

const DEFAULT_CHARGES: AdditionalChargesState = {
  masterEnabled: false,
  charge1Label: 'Shipping',
  charge1Enabled: false,
  charge1SacCode: '',
  charge1TaxRate: '',
  charge1TaxEnabled: false,
  charge2Label: 'Packaging',
  charge2Enabled: false,
  charge2SacCode: '',
  charge2TaxRate: '',
  charge2TaxEnabled: false,
  charge3Label: 'Adjustment',
  charge3Enabled: false,
  charge3SacCode: '',
  charge3TaxRate: '',
  charge3TaxEnabled: false,
};

const TRANSACTION_TYPES = [
  ['SALE', 'Sale'],
  ['PURCHASE_ORDER', 'Purchase Order'],
  ['PURCHASE_BILL', 'Purchase Bill'],
  ['PROFORMA_INVOICE', 'Proforma Invoice'],
  ['ESTIMATE_QUOTATION', 'Estimate Quotation'],
  ['DELIVERY_CHALLAN', 'Delivery Challan'],
  ['SALE_ORDER', 'Sale Order'],
  ['PAYMENT_IN', 'Payment In'],
] as const;

function normalizeFieldId(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function normalizeSalesCustomFields(value: unknown): SalesCustomFieldDef[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row: any) => ({
      id: normalizeFieldId(String(row?.id || row?.label || '')),
      label: String(row?.label || row?.id || '').trim(),
      scope: 'item' as SalesCustomFieldDef['scope'],
      type: (['number', 'date'].includes(String(row?.type)) ? row.type : 'text') as SalesCustomFieldDef['type'],
      required: Boolean(row?.required),
      enabled: row?.enabled !== false,
    }))
    .filter((row) => row.id && row.label);
}

function prepareSalesCustomFields(fields: SalesCustomFieldDef[]) {
  const seen = new Set<string>();
  return fields
    .map((field) => ({
      id: normalizeFieldId(field.id || field.label),
      label: String(field.label || field.id || '').trim(),
      scope: 'item',
      type: field.type === 'number' || field.type === 'date' ? field.type : 'text',
      required: Boolean(field.required),
      enabled: field.enabled !== false,
    }))
    .filter((field) => {
      if (!field.id || !field.label || seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });
}

function normalizeItemCustomFields(value: unknown): ItemCustomFieldDef[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row: any, index) => {
      const label = String(row?.label || row?.key || row?.id || '').trim();
      const id = normalizeFieldId(String(row?.id || row?.key || label || `item_custom_${index + 1}`));
      return {
        id,
        label,
        type: (['number', 'date'].includes(String(row?.type)) ? row.type : 'text') as ItemCustomFieldDef['type'],
        enabled: Boolean(row?.enabled),
        show_in_print: Boolean(row?.show_in_print),
      };
    })
    .filter((row) => row.id && row.label);
}

function prepareItemCustomFields(fields: ItemCustomFieldDef[]) {
  const seen = new Set<string>();
  return fields
    .map((field) => ({
      id: normalizeFieldId(field.id || field.label),
      key: normalizeFieldId(field.id || field.label),
      label: String(field.label || field.id || '').trim(),
      type: field.type === 'number' || field.type === 'date' ? field.type : 'text',
      enabled: Boolean(field.enabled),
      show_in_print: Boolean(field.show_in_print),
    }))
    .filter((field) => {
      if (!field.id || !field.label || seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });
}

function normalizeItemSettings(value: unknown): ItemSettingsState {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ItemSettingsState> : {};
  const sellType = raw.sell_type === 'product' || raw.sell_type === 'service' || raw.sell_type === 'both' ? raw.sell_type : DEFAULT_ITEM_SETTINGS.sell_type;
  return {
    ...DEFAULT_ITEM_SETTINGS,
    ...raw,
    sell_type: sellType,
    quantity_decimal_places: Math.max(0, Math.min(4, Number(raw.quantity_decimal_places ?? DEFAULT_ITEM_SETTINGS.quantity_decimal_places) || 0)),
  };
}

function normalizePrintSettings(value: unknown): PrintSettingsState {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<PrintSettingsState> : {};
  const regular = (raw.regular || {}) as Partial<PrintSettingsState['regular']>;
  const header = (raw.header || {}) as Partial<PrintSettingsState['header']>;
  const itemTable = (raw.item_table || {}) as Partial<PrintSettingsState['item_table']>;
  const totals = (raw.totals || {}) as Partial<PrintSettingsState['totals']>;
  const footer = (raw.footer || {}) as Partial<PrintSettingsState['footer']>;
  const referenceInvoice = (raw.reference_invoice || {}) as Partial<PrintSettingsState['reference_invoice']>;
  const layoutColors = raw.layout_colors && typeof raw.layout_colors === 'object' && !Array.isArray(raw.layout_colors)
    ? raw.layout_colors as Record<string, unknown>
    : {};
  const rawLayout = String(regular.layout || '');
  const layout = (PRINT_LAYOUT_BY_ID[rawLayout as PrintLayoutId]?.id || PRINT_LAYOUT_LEGACY_ID_MAP[rawLayout] || DEFAULT_PRINT_SETTINGS.regular.layout) as PrintLayoutId;
  const normalizedLayoutColors = PRINT_LAYOUT_OPTIONS.reduce<Record<string, string>>((acc, entry) => {
    const legacyColor = Object.entries(PRINT_LAYOUT_LEGACY_ID_MAP).find(([oldId, newId]) => newId === entry.id && layoutColors[oldId])?.[0];
    const color = String(layoutColors[entry.id] || (legacyColor ? layoutColors[legacyColor] : '') || DEFAULT_PRINT_LAYOUT_COLORS[entry.id]).trim();
    acc[entry.id] = /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : DEFAULT_PRINT_LAYOUT_COLORS[entry.id];
    return acc;
  }, {});
  const columns = Array.isArray(itemTable.columns)
    ? itemTable.columns.filter((col: PrintColumnKey): col is PrintColumnKey => PRINT_COLUMNS.some((entry) => entry.key === col))
    : DEFAULT_PRINT_SETTINGS.item_table.columns;
  return {
    regular: {
      ...DEFAULT_PRINT_SETTINGS.regular,
      ...regular,
      layout,
      paper_size: regular.paper_size === 'Letter' ? 'Letter' : 'A4',
      orientation: regular.orientation === 'landscape' ? 'landscape' : 'portrait',
      company_name_text_size: ['small', 'medium', 'large'].includes(String(regular.company_name_text_size)) ? regular.company_name_text_size! : DEFAULT_PRINT_SETTINGS.regular.company_name_text_size,
      invoice_text_size: ['small', 'medium', 'large'].includes(String(regular.invoice_text_size)) ? regular.invoice_text_size! : DEFAULT_PRINT_SETTINGS.regular.invoice_text_size,
      extra_top_space: Math.max(0, Math.min(80, Number(regular.extra_top_space ?? 0) || 0)),
      min_item_rows: Math.max(0, Math.min(30, Number(regular.min_item_rows ?? 0) || 0)),
    },
    header: { ...DEFAULT_PRINT_SETTINGS.header, ...header },
    item_table: { columns: columns.length ? columns : DEFAULT_PRINT_SETTINGS.item_table.columns },
    layout_colors: normalizedLayoutColors,
    totals: {
      ...DEFAULT_PRINT_SETTINGS.totals,
      ...totals,
      amount_in_words: totals.amount_in_words === 'international' ? 'international' : 'indian',
    },
    footer: {
      ...DEFAULT_PRINT_SETTINGS.footer,
      ...footer,
      signature_text: String(footer.signature_text || DEFAULT_PRINT_SETTINGS.footer.signature_text),
    },
    transaction_names: { ...DEFAULT_PRINT_SETTINGS.transaction_names, ...(raw.transaction_names || {}) },
    reference_invoice: {
      ...DEFAULT_PRINT_SETTINGS.reference_invoice,
      ...referenceInvoice,
      fields: {
        ...DEFAULT_REFERENCE_FIELD_VISIBILITY,
        ...(referenceInvoice.fields && typeof referenceInvoice.fields === 'object' ? referenceInvoice.fields : {}),
      },
      declaration: String(referenceInvoice.declaration ?? DEFAULT_PRINT_SETTINGS.reference_invoice.declaration),
      terms: String(referenceInvoice.terms ?? DEFAULT_PRINT_SETTINGS.reference_invoice.terms),
      show_item_custom_fields: referenceInvoice.show_item_custom_fields !== false,
      include_eway_appendix: referenceInvoice.include_eway_appendix !== false,
    },
  };
}

function normalizeTaxSettings(value: unknown): TaxSettingsState {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<TaxSettingsState> : {};
  const rates = Array.isArray(raw.rates)
    ? raw.rates.map((row: any, index): TaxRateRow | null => {
        const type = ['IGST', 'CGST', 'SGST', 'CESS'].includes(String(row?.type || '').toUpperCase())
          ? String(row.type).toUpperCase() as TaxRateRow['type']
          : 'IGST';
        const rate = Math.max(0, Math.min(100, Number(row?.rate ?? 0) || 0));
        return {
          id: String(row?.id || `tax_rate_${index + 1}`),
          label: String(row?.label || `${type}@${rate}%`),
          type,
          rate,
          active: row?.active !== false,
        };
      }).filter(Boolean) as TaxRateRow[]
    : DEFAULT_TAX_SETTINGS.rates;
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((row: any, index): TaxGroupRow | null => {
        const rate = Math.max(0, Math.min(100, Number(row?.rate ?? 0) || 0));
        const half = Number((rate / 2).toFixed(3));
        const components = Array.isArray(row?.components) && row.components.length
          ? row.components.map((part: any) => ({
              type: ['CGST', 'SGST', 'IGST', 'CESS'].includes(String(part?.type || '').toUpperCase())
                ? String(part.type).toUpperCase() as TaxGroupRow['components'][number]['type']
                : 'CGST',
              rate: Math.max(0, Math.min(100, Number(part?.rate ?? 0) || 0)),
            }))
          : [{ type: 'SGST' as const, rate: half }, { type: 'CGST' as const, rate: half }];
        return {
          id: String(row?.id || `tax_group_${index + 1}`),
          label: String(row?.label || `GST@${rate}%`),
          rate,
          components,
          active: row?.active !== false,
        };
      }).filter(Boolean) as TaxGroupRow[]
    : DEFAULT_TAX_SETTINGS.groups;
  const enabledSlabsRaw = Array.isArray((raw as any).enabledSlabs)
    ? (raw as any).enabledSlabs
    : (Array.isArray((raw as any).enabled_slabs) ? (raw as any).enabled_slabs : []);
  const enabledSlabs: number[] = Array.from(new Set<number>(enabledSlabsRaw
    .map((rate: any) => Number(rate))
    .filter((rate: number) => STANDARD_GST_SLABS.includes(rate))))
    .sort((a, b) => a - b);
  const customRatesRaw = Array.isArray((raw as any).customRates)
    ? (raw as any).customRates
    : (Array.isArray((raw as any).custom_rates) ? (raw as any).custom_rates : []);
  const customRates = customRatesRaw
    .map((row: any, index: number) => ({
      id: String(row?.id || `custom_tax_${index + 1}`),
      name: String(row?.name || row?.label || '').trim(),
      rate: Math.max(0.01, Math.min(100, Number(row?.rate ?? 0) || 0)),
      isActive: row?.isActive !== false && row?.active !== false,
    }))
    .filter((row: CustomTaxRateRow) => row.name);
  return {
    ...DEFAULT_TAX_SETTINGS,
    ...raw,
    enabledSlabs: enabledSlabs.length ? enabledSlabs : DEFAULT_TAX_SETTINGS.enabledSlabs,
    customRates,
    rates: rates.length ? rates : DEFAULT_TAX_SETTINGS.rates,
    groups: groups.length ? groups : DEFAULT_TAX_SETTINGS.groups,
  };
}

export default function Settings() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = ['admin', 'super_admin'].includes(normalizeRole(user?.role));
  const { data: company, isLoading: companyLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const [einvEnabled, setEinvEnabled] = useState(false);
  const [einvTurnover, setEinvTurnover] = useState(false);
  const [einvSandbox, setEinvSandbox] = useState(true);
  const [einvUser, setEinvUser] = useState('');
  const [einvPass, setEinvPass] = useState('');
  const [ewayBillOnlyAbove50k, setEwayBillOnlyAbove50k] = useState(false);
  const [printerType, setPrinterType] = useState<'a4' | 'thermal80' | 'thermal58'>('a4');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [companyCity, setCompanyCity] = useState('');
  const [companyState, setCompanyState] = useState('');
  const [companyPincode, setCompanyPincode] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [gstinDetails, setGstinDetails] = useState<any>(null);
  const [gstinFetching, setGstinFetching] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [upiId, setUpiId] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [invoiceTerms, setInvoiceTerms] = useState('');
  const [invoiceTemplate, setInvoiceTemplate] = useState('business-theme-1');
  const [, setDocumentTheme] = useState('business-theme-1');
  const [documentPrimaryColor, setDocumentPrimaryColor] = useState('#4F46E5');
  const [enabledCurrencies, setEnabledCurrencies] = useState<CurrencyCode[]>(['INR']);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>('INR');
  const [deliveryChallanShowPricing, setDeliveryChallanShowPricing] = useState(false);
  const [salesCustomFields, setSalesCustomFields] = useState<SalesCustomFieldDef[]>([]);
  const [itemSettings, setItemSettings] = useState<ItemSettingsState>(DEFAULT_ITEM_SETTINGS);
  const [itemCustomFields, setItemCustomFields] = useState<ItemCustomFieldDef[]>([]);
  const [itemCustomModalOpen, setItemCustomModalOpen] = useState(false);
  const [printSettings, setPrintSettings] = useState<PrintSettingsState>(DEFAULT_PRINT_SETTINGS);
  const [printSection, setPrintSection] = useState<'layout' | 'colors'>('layout');
  const [transactionNamesOpen, setTransactionNamesOpen] = useState(false);
  const [itemTablePrintOpen, setItemTablePrintOpen] = useState(false);
  const [taxSettings, setTaxSettings] = useState<TaxSettingsState>(DEFAULT_TAX_SETTINGS);
  const [taxListOpen, setTaxListOpen] = useState(false);
  const [editingTaxRate, setEditingTaxRate] = useState<TaxRateRow | null>(null);
  const [editingTaxGroup, setEditingTaxGroup] = useState<TaxGroupRow | null>(null);
  const [editingCustomTaxRate, setEditingCustomTaxRate] = useState<CustomTaxRateRow | null>(null);
  const [transactionSettings, setTransactionSettings] = useState<TransactionSettingsState>(DEFAULT_TRANSACTION_SETTINGS);
  const [transactionPrefixes, setTransactionPrefixes] = useState<TransactionPrefixesState>(DEFAULT_PREFIXES);
  const [termsGrouped, setTermsGrouped] = useState<Record<string, TermsEntry[]>>({});
  const [additionalFields, setAdditionalFields] = useState<AdditionalFieldsState>(DEFAULT_ADDITIONAL_FIELDS);
  const [transportation, setTransportation] = useState<TransportationState>(DEFAULT_TRANSPORTATION);
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalChargesState>(DEFAULT_CHARGES);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [additionalFieldsOpen, setAdditionalFieldsOpen] = useState(false);
  const [transportationOpen, setTransportationOpen] = useState(false);
  const [chargesOpen, setChargesOpen] = useState(false);
  const [termForm, setTermForm] = useState<TermsEntry | null>(null);
  const [expandedTerms, setExpandedTerms] = useState<Set<string>>(new Set());
  const [termsBanner, setTermsBanner] = useState(true);
  const [itemTerminologySingular, setItemTerminologySingular] = useState('Item');
  const [itemTerminologyPlural, setItemTerminologyPlural] = useState('Items');
  const [defaultGstRate, setDefaultGstRate] = useState('18');
  const [newUser, setNewUser] = useState({ name: '', email: '', phone: '', role: 'staff', password: '' });
  const [newGodown, setNewGodown] = useState({ name: '', code: '', city: '', state: '', is_default: false });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingGodownId, setEditingGodownId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', email: '', phone: '', role: 'staff', is_active: true });
  const [editGodownForm, setEditGodownForm] = useState({ name: '', code: '', city: '', state: '', is_default: false, is_active: true });
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const tallyImportFileRef = useRef<HTMLInputElement | null>(null);
  const pendingImportFile = useRef<File | null>(null);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const signatureFileRef = useRef<HTMLInputElement | null>(null);
  const lastAutoFetchedGstin = useRef('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    preview?: { row: number; data: Record<string, unknown>; valid: boolean }[];
    errors?: { row: number; errors: string[]; data: unknown }[];
    total?: number;
    valid?: number;
    invalid?: number;
  } | null>(null);

  if (!isAdmin) {
     return <Navigate to="/dashboard" replace />;
  }

  const uploadsBase = () => getApiBaseURL().replace(/\/api$/, '');
  const logoSrc =
    company?.logo_url &&
    (String(company.logo_url).startsWith('http') ? company.logo_url : `${uploadsBase()}${company.logo_url}`);
  const signatureSrc =
    company?.signature_url &&
    (String(company.signature_url).startsWith('http')
      ? company.signature_url
      : `${uploadsBase()}${company.signature_url}`);

  const [tab, setTab] = useState('company');
  const [settingsSidebarCollapsed, setSettingsSidebarCollapsed] = useState(() => localStorage.getItem('settings_sidebar_collapsed') !== 'false');

  const [deleteConf, setDeleteConf] = useState('');
  const [dataDumping, setDataDumping] = useState(false);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  const [testPrintRunning, setTestPrintRunning] = useState(false);
  const [tallyExporting, setTallyExporting] = useState(false);
  const [tallyImporting, setTallyImporting] = useState(false);

  useEffect(() => {
    localStorage.setItem('settings_sidebar_collapsed', settingsSidebarCollapsed ? 'true' : 'false');
  }, [settingsSidebarCollapsed]);

  const { data: usersPage, isLoading: usersLoading } = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => api.get('/users', { params: { page: 1, limit: 50 } }).then((r) => r.data?.data ?? r.data),
  });
  const users = (usersPage as any)?.data ?? [];

  const { data: godownsData, isLoading: godownsLoading } = useQuery({
    queryKey: ['settings-godowns'],
    queryFn: () => api.get('/godowns').then((r) => r.data?.data ?? r.data),
  });
  const godownRows = (godownsData as any) ?? [];

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['company-bank-accounts'],
    queryFn: () => api.get('/company/bank-accounts').then((r) => r.data?.data ?? r.data),
  });
  const { data: transactionConfig } = useQuery({
    queryKey: ['transaction-settings'],
    queryFn: () => api.get('/settings/transaction').then((r) => r.data?.data ?? r.data),
  });

  useEffect(() => {
    if (!transactionConfig) return;
    setTransactionSettings({ ...DEFAULT_TRANSACTION_SETTINGS, ...(transactionConfig.settings || {}) });
    setTransactionPrefixes({ ...DEFAULT_PREFIXES, ...(transactionConfig.prefixes || {}) });
    setAdditionalFields({ ...DEFAULT_ADDITIONAL_FIELDS, ...(transactionConfig.additionalFields || {}) });
    setTransportation({ ...DEFAULT_TRANSPORTATION, ...(transactionConfig.transportation || {}) });
    setAdditionalCharges({ ...DEFAULT_CHARGES, ...(transactionConfig.charges || {}) });
    setTermsGrouped(transactionConfig.terms || {});
  }, [transactionConfig]);
  const [bankForm, setBankForm] = useState({
    account_label: '',
    bank_name: '',
    account_number: '',
    ifsc: '',
    branch: '',
    upi_id: '',
    is_primary: false,
  });

  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editBankForm, setEditBankForm] = useState({
    account_label: '',
    bank_name: '',
    account_number: '',
    ifsc: '',
    branch: '',
    upi_id: '',
    is_primary: false,
  });

  const saveBankAccount = useMutation({
    mutationFn: () => api.post('/company/bank-accounts', bankForm),
    onSuccess: () => {
      toast.success('Bank account added');
      setBankForm({ account_label: '', bank_name: '', account_number: '', ifsc: '', branch: '', upi_id: '', is_primary: false });
      qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Bank save failed'),
  });

  const updateBankAccount = useMutation({
    mutationFn: (payload: {
      id: string;
      account_label: string | null;
      bank_name: string;
      account_number: string | null;
      ifsc: string | null;
      branch: string | null;
      upi_id: string | null;
      is_primary: boolean;
    }) => {
      const { id, ...body } = payload;
      return api.patch(`/company/bank-accounts/${id}`, body);
    },
    onSuccess: () => {
      toast.success('Bank account updated');
      setEditingBankId(null);
      qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const removeBankAccount = useMutation({
    mutationFn: (id: string) => api.delete(`/company/bank-accounts/${id}`),
    onSuccess: (_data, deletedId) => {
      toast.success('Bank account removed');
      setEditingBankId((cur) => (cur === deletedId ? null : cur));
      qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Remove failed'),
  });

  const createUser = useMutation({
    mutationFn: () => api.post('/users', newUser),
    onSuccess: () => {
      toast.success('User invited');
      setNewUser({ name: '', email: '', phone: '', role: 'staff', password: '' });
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Invite failed'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/users/${id}`, data),
    onSuccess: () => {
      toast.success('User updated');
      setEditingUserId(null);
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const createGodown = useMutation({
    mutationFn: () => api.post('/godowns', newGodown),
    onSuccess: () => {
      toast.success('Godown added');
      setNewGodown({ name: '', code: '', city: '', state: '', is_default: false });
      qc.invalidateQueries({ queryKey: ['settings-godowns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Add failed'),
  });

  const updateGodown = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/godowns/${id}`, data),
    onSuccess: () => {
      toast.success('Godown updated');
      setEditingGodownId(null);
      qc.invalidateQueries({ queryKey: ['settings-godowns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const openEditGodown = (g: any) => {
    setEditingGodownId(g.id);
    setEditGodownForm({
      name: g.name || '',
      code: g.code || '',
      city: g.city || '',
      state: g.state || '',
      is_default: !!g.is_default,
      is_active: !!g.is_active,
    });
  };

  const downloadItemsTemplate = async () => {
    setTemplateDownloading(true);
    const t = toast.loading('Preparing template…');
    try {
      const res = await api.get('/items/import-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'microtechnique_item_import_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Template downloaded', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Template download failed', { id: t });
    } finally {
      setTemplateDownloading(false);
    }
  };

  const previewImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setImporting(true);
      pendingImportFile.current = file;
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/items/bulk-import', fd);
      const d = res.data?.data ?? res.data;
      setImportPreview(d);
      if (!d.preview?.length && (d.errors?.length || 0) > 0) {
        toast.error('No valid rows — fix errors and try again.');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Preview failed');
      pendingImportFile.current = null;
      setImportPreview(null);
    } finally {
      setImporting(false);
    }
  };

  const confirmImportFile = async () => {
    const file = pendingImportFile.current;
    if (!file) {
      toast.error('Choose a file first');
      return;
    }
    try {
      setImporting(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/items/bulk-import?action=confirm', fd);
      const d = res.data?.data ?? res.data;
      toast.success(`Import complete. Inserted ${d.inserted || 0} items`);
      setImportPreview(null);
      pendingImportFile.current = null;
      qc.invalidateQueries({ queryKey: ['items'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const uploadAsset = async (file: File | undefined, kind: 'logo' | 'signature') => {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append(kind, file);
      await api.post(kind === 'logo' ? '/company/logo' : '/company/signature', fd);
      toast.success(kind === 'logo' ? 'Logo updated' : 'Signature / stamp updated');
      qc.invalidateQueries({ queryKey: ['company'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Upload failed');
    } finally {
      if (kind === 'logo' && logoFileRef.current) logoFileRef.current.value = '';
      if (kind === 'signature' && signatureFileRef.current) signatureFileRef.current.value = '';
    }
  };

  const deleteWorkspace = useMutation({
    mutationFn: () => api.post('/company/delete-workspace', { confirm: 'DELETE-MY-COMPANY' as const }),
    onSuccess: () => {
      toast.success('Workspace closed');
      logout();
      window.location.href = '/login';
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Request failed'),
  });

  const dumpData = async () => {
    setDataDumping(true);
    const t = toast.loading('Gathering export…');
    try {
      const [companyRes, itemsRes, partiesRes, invoicesRes, godownsRes, usersRes] = await Promise.all([
        api.get('/company'),
        api.get('/items', { params: { page: 1, limit: 5000 } }),
        api.get('/parties', { params: { page: 1, limit: 5000 } }),
        api.get('/invoices', { params: { page: 1, limit: 5000 } }),
        api.get('/godowns'),
        api.get('/users', { params: { page: 1, limit: 5000 } }),
      ]);
      const dump = {
        generated_at: new Date().toISOString(),
        company: companyRes.data?.data ?? companyRes.data,
        items: (itemsRes.data?.data ?? itemsRes.data)?.data ?? [],
        parties: (partiesRes.data?.data ?? partiesRes.data)?.data ?? [],
        invoices: (invoicesRes.data?.data ?? invoicesRes.data)?.data ?? [],
        godowns: godownsRes.data?.data ?? godownsRes.data,
        users: (usersRes.data?.data ?? usersRes.data)?.data ?? [],
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bizflow-data-dump-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Data dump downloaded', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Export failed', { id: t });
    } finally {
      setDataDumping(false);
    }
  };

  useEffect(() => {
    if (!company) return;
    setEinvEnabled(!!company.einvoice_enabled);
    setEinvTurnover(!!company.einvoice_turnover_above_5cr);
    setEinvSandbox(company.einvoice_sandbox !== false);
    setEinvUser(company.einvoice_gsp_username || '');
    setEwayBillOnlyAbove50k(!!company.eway_bill_only_above_50k);
    const saved = localStorage.getItem('bizflow_printer_type') as 'a4' | 'thermal80' | 'thermal58' | null;
    if (saved === 'thermal80' || saved === 'thermal58' || saved === 'a4') setPrinterType(saved);
    setLegalName(company.legal_name || company.name || '');
    setGstin(company.gstin || '');
    setRegisteredAddress(company.registered_address || '');
    setCompanyCity(company.city || '');
    setCompanyState(company.state || '');
    setCompanyPincode(company.pincode || '');
    setCompanyPhone(company.phone || '');
    setCompanyEmail(company.email || '');
    setBusinessType(company.business_type || '');
    setBusinessCategory(company.business_category || '');
    setGstinDetails(company.gstin ? {
      legal_name: company.gstin_legal_name,
      trade_name: company.gstin_trade_name,
      status: company.gstin_status,
      taxpayer_type: company.gstin_taxpayer_type,
      address: company.gstin_address,
      state_code: company.state_code,
      state: company.state,
      source: company.gstin_lookup_payload ? 'saved' : undefined,
    } : null);
    setBankName(company.bank_name || '');
    setBankAccountNumber(company.bank_account_number || '');
    setBankIfsc(company.bank_ifsc || '');
    setUpiId(company.upi_id || '');
    setInvoicePrefix(company.invoice_prefix || 'INV');
    setInvoiceTerms(company.terms_and_conditions || '');
    setInvoiceTemplate(normalizeInvoiceThemeId(company.invoice_pdf_template));
    setDocumentTheme(normalizeInvoiceThemeId(company.document_theme));
    setDocumentPrimaryColor(company.document_primary_color || '#4F46E5');
    const currencies = Array.isArray(company.enabled_currencies)
      ? company.enabled_currencies
          .map((c: unknown) => normalizeCurrencyCode(c))
          .filter((c: CurrencyCode, idx: number, arr: CurrencyCode[]) => arr.indexOf(c) === idx)
      : ['INR'];
    setEnabledCurrencies(currencies.length ? currencies : ['INR']);
    setDefaultCurrency(normalizeCurrencyCode(company.default_currency || company.currency || 'INR'));
    setDeliveryChallanShowPricing(!!company.delivery_challan_show_pricing);
    setSalesCustomFields(normalizeSalesCustomFields(company.sales_invoice_custom_fields));
    setItemSettings(normalizeItemSettings(company.item_settings));
    setItemCustomFields(normalizeItemCustomFields(company.item_custom_fields));
    setPrintSettings(normalizePrintSettings(company.print_settings));
    setTaxSettings(normalizeTaxSettings(company.tax_settings));
    setItemTerminologySingular(company.item_terminology || 'Item');
    setItemTerminologyPlural(company.item_terminology_plural || 'Items');
    setDefaultGstRate(String(company.default_gst_rate ?? 18));
  }, [company]);

  const saveProfile = async () => {
    try {
      await updateCompany.mutateAsync({
        legal_name: legalName.trim() || null,
        gstin: gstin.trim().toUpperCase() || null,
        registered_address: registeredAddress.trim() || null,
        city: companyCity.trim() || null,
        pincode: companyPincode.trim() || null,
        phone: companyPhone.trim() || null,
        email: companyEmail.trim() || null,
        business_type: businessType || null,
        business_category: businessCategory.trim() || null,
        gstin_legal_name: gstinDetails?.legal_name || null,
        gstin_trade_name: gstinDetails?.trade_name || null,
        gstin_status: gstinDetails?.status || null,
        gstin_taxpayer_type: gstinDetails?.taxpayer_type || null,
        gstin_address: gstinDetails?.address || null,
        state_code: gstinDetails?.state_code || company?.state_code || null,
        state: companyState.trim() || gstinDetails?.state || company?.state || null,
        gstin_last_fetched_at: gstinDetails?.source ? new Date().toISOString() : company?.gstin_last_fetched_at || null,
        gstin_lookup_payload: gstinDetails?.raw || company?.gstin_lookup_payload || null,
        bank_name: bankName.trim() || null,
        bank_account_number: bankAccountNumber.trim() || null,
        bank_ifsc: bankIfsc.trim().toUpperCase() || null,
        upi_id: upiId.trim() || null,
      });
      toast.success('Company profile updated');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const fetchGstin = async (options?: { silent?: boolean }) => {
    const silent = !!options?.silent;
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15) {
      if (!silent) toast.error('Enter a 15-character GSTIN first');
      return;
    }
    setGstinFetching(true);
    const t = silent ? null : toast.loading('Fetching GSTIN details…');
    try {
      const res = await api.get(`/company/gstin/${g}`);
      const details = res.data?.data ?? res.data;
      setGstinDetails(details);
      if (details.legal_name || details.trade_name) setLegalName(details.legal_name || details.trade_name);
      if (details.address) setRegisteredAddress(details.address);
      if (details.city) setCompanyCity(details.city);
      if (details.pincode) setCompanyPincode(details.pincode);
      if (details.state) setCompanyState(details.state);
      if (!silent) {
        toast.success(details.source === 'provider' ? 'GSTIN details fetched' : 'GSTIN verified locally', { id: t ?? undefined });
      }
    } catch (e: any) {
      if (!silent) toast.error(e.response?.data?.error || 'GSTIN lookup failed', { id: t ?? undefined });
    } finally {
      setGstinFetching(false);
    }
  };

  useEffect(() => {
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15 || g === lastAutoFetchedGstin.current) return;
    const timer = window.setTimeout(() => {
      lastAutoFetchedGstin.current = g;
      fetchGstin({ silent: true });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [gstin]);

  const saveInvoicePreferences = async () => {
    try {
      const selectedLayout = normalizeInvoiceThemeId(invoiceTemplate) as PrintLayoutId;
      const selectedColor = documentPrimaryColor || DEFAULT_PRINT_LAYOUT_COLORS[selectedLayout] || '#4F46E5';
      const nextPrintSettings: PrintSettingsState = {
        ...printSettings,
        invoiceTheme: selectedLayout,
        regular: {
          ...printSettings.regular,
          layout: selectedLayout,
        },
        layout_colors: {
          ...printSettings.layout_colors,
          [selectedLayout]: selectedColor,
        },
      } as PrintSettingsState;
      await updateCompany.mutateAsync({
        invoice_prefix: invoicePrefix.trim() || 'INV',
        terms_and_conditions: invoiceTerms.trim() || null,
        invoice_pdf_template: selectedLayout,
        document_theme: selectedLayout,
        document_primary_color: selectedColor,
        print_settings: nextPrintSettings,
        enabled_currencies: enabledCurrencies,
        default_currency: enabledCurrencies.includes(defaultCurrency) ? defaultCurrency : enabledCurrencies[0],
        currency: enabledCurrencies.includes(defaultCurrency) ? defaultCurrency : enabledCurrencies[0],
        delivery_challan_show_pricing: deliveryChallanShowPricing,
        sales_invoice_custom_fields: prepareSalesCustomFields(salesCustomFields),
      });
      setInvoiceTemplate(selectedLayout);
      setDocumentTheme(selectedLayout);
      setDocumentPrimaryColor(selectedColor);
      setPrintSettings(nextPrintSettings);
      toast.success('Invoice preferences saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const updatePrintSetting = <S extends keyof PrintSettingsState, K extends keyof PrintSettingsState[S]>(
    section: S,
    key: K,
    value: PrintSettingsState[S][K],
  ) => {
    setPrintSettings((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as Record<string, unknown>),
        [key]: value,
      },
    }));
  };

  const updateTransactionName = (key: string, value: string | boolean) => {
    setPrintSettings((prev) => ({
      ...prev,
      transaction_names: { ...prev.transaction_names, [key]: value },
    }));
  };

  const updatePrintLayoutColor = (layoutId: string, color: string) => {
    setPrintSettings((prev) => ({
      ...prev,
      layout_colors: {
        ...prev.layout_colors,
        [layoutId]: color,
      },
    }));
  };

  const togglePrintColumn = (key: PrintColumnKey, checked: boolean) => {
    if (key === 'item_name') return;
    setPrintSettings((prev) => {
      const columns = checked
        ? (prev.item_table.columns.includes(key) ? prev.item_table.columns : [...prev.item_table.columns, key])
        : prev.item_table.columns.filter((col) => col !== key);
      return {
        ...prev,
        item_table: { columns },
      };
    });
  };

  const updateReferenceInvoiceSetting = <K extends keyof PrintSettingsState['reference_invoice']>(
    key: K,
    value: PrintSettingsState['reference_invoice'][K],
  ) => {
    setPrintSettings((prev) => ({
      ...prev,
      reference_invoice: {
        ...prev.reference_invoice,
        [key]: value,
      },
    }));
  };

  const toggleReferenceInvoiceField = (key: string, checked: boolean) => {
    setPrintSettings((prev) => ({
      ...prev,
      reference_invoice: {
        ...prev.reference_invoice,
        fields: {
          ...prev.reference_invoice.fields,
          [key]: checked,
        },
      },
    }));
  };

  const savePrintSettings = async () => {
    try {
      await updateCompany.mutateAsync({ print_settings: printSettings });
      toast.success('Print settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const updateTaxFlag = (key: TaxSettingsFlagKey, value: boolean) => {
    setTaxSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleEnabledGstSlab = (rate: number, checked: boolean) => {
    setTaxSettings((prev) => {
      const enabledSlabs = checked
        ? Array.from(new Set([...prev.enabledSlabs, rate])).sort((a, b) => a - b)
        : prev.enabledSlabs.filter((entry) => entry !== rate);
      return { ...prev, enabledSlabs: enabledSlabs.length ? enabledSlabs : [0] };
    });
  };

  const saveTaxSettings = async () => {
    try {
      await updateCompany.mutateAsync({ tax_settings: taxSettings });
      qc.invalidateQueries({ queryKey: ['settings', 'taxes'] });
      toast.success('Taxes & GST settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const saveTaxRateRow = () => {
    if (!editingTaxRate) return;
    const row = {
      ...editingTaxRate,
      rate: Math.max(0, Math.min(100, Number(editingTaxRate.rate) || 0)),
      label: editingTaxRate.label.trim() || `${editingTaxRate.type}@${editingTaxRate.rate}%`,
    };
    setTaxSettings((prev) => ({
      ...prev,
      rates: prev.rates.some((rate) => rate.id === row.id)
        ? prev.rates.map((rate) => rate.id === row.id ? row : rate)
        : [...prev.rates, row],
    }));
    setEditingTaxRate(null);
  };

  const saveCustomTaxRateRow = () => {
    if (!editingCustomTaxRate) return;
    const row = {
      ...editingCustomTaxRate,
      name: editingCustomTaxRate.name.trim().slice(0, 50),
      rate: Math.max(0.01, Math.min(100, Number(editingCustomTaxRate.rate) || 0)),
      isActive: editingCustomTaxRate.isActive !== false,
    };
    if (!row.name) {
      toast.error('Custom tax rate name is required');
      return;
    }
    setTaxSettings((prev) => ({
      ...prev,
      customRates: prev.customRates.some((rate) => rate.id === row.id)
        ? prev.customRates.map((rate) => rate.id === row.id ? row : rate)
        : [...prev.customRates, row],
    }));
    setEditingCustomTaxRate(null);
  };

  const saveTaxGroupRow = () => {
    if (!editingTaxGroup) return;
    const rate = Math.max(0, Math.min(100, Number(editingTaxGroup.rate) || 0));
    const half = Number((rate / 2).toFixed(3));
    const row = {
      ...editingTaxGroup,
      rate,
      label: editingTaxGroup.label.trim() || `GST@${rate}%`,
      components: editingTaxGroup.components.length ? editingTaxGroup.components : [{ type: 'SGST' as const, rate: half }, { type: 'CGST' as const, rate: half }],
    };
    setTaxSettings((prev) => ({
      ...prev,
      groups: prev.groups.some((group) => group.id === row.id)
        ? prev.groups.map((group) => group.id === row.id ? row : group)
        : [...prev.groups, row],
    }));
    setEditingTaxGroup(null);
  };

  const saveTransactionSettings = async () => {
    try {
      await api.put('/settings/transaction', transactionSettings);
      await api.put('/settings/transaction/prefixes', transactionPrefixes);
      toast.success('Transaction settings saved');
      qc.invalidateQueries({ queryKey: ['transaction-settings'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const saveAdditionalFields = async () => {
    try {
      const res = await api.put('/settings/transaction/additional-fields', additionalFields);
      setAdditionalFields({ ...DEFAULT_ADDITIONAL_FIELDS, ...(res.data?.data ?? res.data) });
      toast.success('Additional fields saved');
      setAdditionalFieldsOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const saveTransportation = async () => {
    try {
      const res = await api.put('/settings/transaction/transportation', transportation);
      setTransportation({ ...DEFAULT_TRANSPORTATION, ...(res.data?.data ?? res.data) });
      toast.success('Transportation details saved');
      setTransportationOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const saveAdditionalCharges = async () => {
    try {
      const res = await api.put('/settings/transaction/charges', additionalCharges);
      setAdditionalCharges({ ...DEFAULT_CHARGES, ...(res.data?.data ?? res.data) });
      toast.success('Additional charges saved');
      setChargesOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const saveTerm = async () => {
    if (!termForm) return;
    try {
      if (termForm.id) {
        await api.put(`/settings/transaction/terms/${termForm.id}`, termForm);
      } else {
        await api.post('/settings/transaction/terms', termForm);
      }
      const res = await api.get('/settings/transaction/terms');
      setTermsGrouped(res.data?.data ?? res.data ?? {});
      setTermForm(null);
      toast.success('Terms saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const deleteTerm = async (entry: TermsEntry) => {
    if (!entry.id) return;
    if (!window.confirm('Delete this terms and condition entry?')) return;
    try {
      await api.delete(`/settings/transaction/terms/${entry.id}`);
      const res = await api.get('/settings/transaction/terms');
      setTermsGrouped(res.data?.data ?? res.data ?? {});
      toast.success('Terms deleted');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const addSalesCustomField = () => {
    const base = `field_${salesCustomFields.length + 1}`;
    setSalesCustomFields((prev) => [
      ...prev,
      { id: base, label: 'New Field', scope: 'item', type: 'text', required: false, enabled: true },
    ]);
  };

  const updateSalesCustomField = (idx: number, patch: Partial<SalesCustomFieldDef>) => {
    setSalesCustomFields((prev) => prev.map((field, i) => {
      if (i !== idx) return field;
      const next = { ...field, ...patch };
      if (patch.label !== undefined && (!field.id || field.id.startsWith('field_'))) {
        next.id = normalizeFieldId(String(patch.label)) || field.id;
      }
      if (patch.id !== undefined) next.id = normalizeFieldId(String(patch.id));
      return next;
    }));
  };

  const removeSalesCustomField = (idx: number) => {
    setSalesCustomFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateItemSetting = <K extends keyof ItemSettingsState>(key: K, value: ItemSettingsState[K]) => {
    setItemSettings((prev) => ({ ...prev, [key]: value }));
  };

  const addItemCustomField = () => {
    const base = `item_field_${itemCustomFields.length + 1}`;
    setItemCustomFields((prev) => [
      ...prev,
      { id: base, label: '', type: 'text', enabled: true, show_in_print: false },
    ]);
  };

  const updateItemCustomField = (idx: number, patch: Partial<ItemCustomFieldDef>) => {
    setItemCustomFields((prev) => prev.map((field, i) => {
      if (i !== idx) return field;
      const next = { ...field, ...patch };
      if (patch.label !== undefined && (!field.id || field.id.startsWith('item_field_'))) {
        next.id = normalizeFieldId(String(patch.label)) || field.id;
      }
      if (patch.id !== undefined) next.id = normalizeFieldId(String(patch.id));
      return next;
    }));
  };

  const removeItemCustomField = (idx: number) => {
    setItemCustomFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleCurrency = (code: CurrencyCode, enabled: boolean) => {
    setEnabledCurrencies((prev) => {
      if (code === 'INR') return ['INR', ...prev.filter((c) => c !== 'INR')];
      const next = enabled ? Array.from(new Set([...prev, code])) : prev.filter((c) => c !== code);
      if (!next.length) return ['INR'];
      if (!next.includes(defaultCurrency)) setDefaultCurrency(next[0]);
      return next;
    });
  };

  const applyItemSchema = async () => {
    try {
      await updateCompany.mutateAsync({
        item_terminology: itemTerminologySingular.trim() || 'Item',
        item_terminology_plural: itemTerminologyPlural,
        default_gst_rate: Math.round(Math.min(100, Math.max(0, Number(defaultGstRate) || 0))),
        item_settings: itemSettings,
        item_custom_fields: prepareItemCustomFields(itemCustomFields),
      });
      toast.success('Item settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Apply failed');
    }
  };

  const saveEinvoice = async () => {
    try {
      await updateCompany.mutateAsync({
        einvoice_enabled: einvEnabled,
        einvoice_turnover_above_5cr: einvTurnover,
        einvoice_sandbox: einvSandbox,
        einvoice_gsp_username: einvUser || null,
        eway_bill_only_above_50k: ewayBillOnlyAbove50k,
        ...(einvPass ? { einvoice_gsp_password: einvPass } : {}),
      });
      setEinvPass('');
      toast.success('e-Invoice settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const savePrinter = () => {
    localStorage.setItem('bizflow_printer_type', printerType);
    toast.success('Printer preference saved');
  };

  const syncEmployeesToHr = async () => {
    try {
      const r = await api.post('/users/sync-employee-profiles');
      const msg = r.data?.data?.message ?? 'Sync done';
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Sync failed');
    }
  };

  const testPrint = async () => {
    setTestPrintRunning(true);
    const t = toast.loading('Preparing sample print…');
    try {
      const res = await api.get('/invoices', { params: { page: 1, limit: 1 } });
      const page = res.data?.data;
      const first = page?.data?.[0];
      if (!first?.id) {
        toast.error('No invoice found for sample print', { id: t });
        return;
      }
      const w = printerType === 'thermal58' ? '58' : '80';
      const pdfRes = await api.get(`/print/receipt/${first.id}`, { params: { width: w }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      toast.success('Opening sample receipt…', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Test print failed', { id: t });
    } finally {
      setTestPrintRunning(false);
    }
  };

  const exportTally = async (format: 'json' | 'xml') => {
    setTallyExporting(true);
    try {
      const res = await api.get('/reports/tally-export', { params: { format }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tally-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Tally ${format.toUpperCase()} exported`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Tally export failed');
    } finally {
      setTallyExporting(false);
    }
  };

  const importTally = async (file?: File) => {
    if (!file) return;
    setTallyImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/reports/tally-import', fd);
      const d = res.data?.data ?? res.data;
      toast.success(`Imported from Tally: ${d.created_items || 0} items, ${d.created_parties || 0} parties, ${d.created_units || 0} units`);
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['item-units'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Tally import failed');
    } finally {
      setTallyImporting(false);
      if (tallyImportFileRef.current) tallyImportFileRef.current.value = '';
    }
  };

  const selectedPrintLayoutId = (PRINT_LAYOUT_BY_ID[printSettings.regular.layout as PrintLayoutId]?.id || PRINT_LAYOUT_LEGACY_ID_MAP[printSettings.regular.layout] || 'business-theme-1') as PrintLayoutId;
  const selectedPrintLayout = PRINT_LAYOUT_BY_ID[selectedPrintLayoutId];
  const selectedLayoutColor = printSettings.layout_colors?.[selectedPrintLayoutId] || DEFAULT_PRINT_LAYOUT_COLORS[selectedPrintLayoutId] || '#7C3AED';
  const selectedLayoutColorName = PRINT_COLOR_PALETTE.find((color) => color.value.toLowerCase() === selectedLayoutColor.toLowerCase())?.name || 'Custom';
  const savedCompanyName = company?.legal_name || company?.name || 'Company Name';
  const savedCompanyAddress = [
    company?.registered_address,
    company?.city,
    company?.state,
    company?.pincode,
  ].filter(Boolean).join(', ') || 'Saved company address';
  const savedCompanyPhone = company?.phone || 'Phone number';
  const savedCompanyEmail = company?.email || 'email@example.com';
  const savedCompanyGstin = company?.gstin || 'GSTIN';
  const primaryBank = Array.isArray(bankAccounts)
    ? (bankAccounts as any[]).find((account) => account?.is_primary) || (bankAccounts as any[])[0]
    : null;
  const savedBankName = primaryBank?.bank_name || company?.bank_name || 'Bank name';
  const savedBankAccount = primaryBank?.account_number || company?.bank_account_number || 'Account number';
  const savedBankIfsc = primaryBank?.ifsc || company?.bank_ifsc || 'IFSC';
  const previewAccent = selectedLayoutColor;
  const previewTitle = String(printSettings.transaction_names.sale || 'Tax Invoice');
  const previewMoney = (amount: number) => {
    const options = printSettings.totals.amount_with_decimal
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: Boolean(printSettings.totals.print_amount_with_grouping) }
      : { maximumFractionDigits: 0, useGrouping: Boolean(printSettings.totals.print_amount_with_grouping) };
    return `₹${amount.toLocaleString('en-IN', options)}`;
  };
  const previewColumns = PRINT_COLUMNS
    .filter((column) => column.key === 'item_name' || printSettings.item_table.columns.includes(column.key));
  const previewValueForColumn = (key: string, row: 1 | 2) => {
    const rows = {
      1: {
        serial_no: '1', item_name: 'Premium Service', item_code: 'SVC001', hsn_code: '9983', quantity: '1.00', unit: 'N',
        unit_price: previewMoney(500), discount_amount: previewMoney(25), discount_percent: '5%', taxable_amount: previewMoney(475),
        gst_rate: '18%', tax_amount: previewMoney(85.5), amount: previewMoney(560.5), description: 'Service desc',
        batch_no: 'B001', exp_date: '31-12-2026', mfg_date: '01-01-2026', mrp: previewMoney(600), size: 'M',
        model_no: 'M001', brand: 'Brand A', material: 'Cotton',
      },
      2: {
        serial_no: '2', item_name: 'Implementation', item_code: 'IMP-02', hsn_code: '9985', quantity: '2.00', unit: 'Hrs',
        unit_price: previewMoney(350), discount_amount: previewMoney(0), discount_percent: '0%', taxable_amount: previewMoney(700),
        gst_rate: '18%', tax_amount: previewMoney(126), amount: previewMoney(826), description: 'Setup work',
        batch_no: 'B002', exp_date: '31-12-2026', mfg_date: '01-01-2026', mrp: previewMoney(700), size: 'L',
        model_no: 'M002', brand: 'Brand B', material: 'Service',
      },
    };
    return rows[row][key as PrintColumnKey] || '-';
  };

  const TABS = [
     { id: 'company', label: 'Company Profile', icon: Building2 },
     { id: 'godowns', label: 'Locations / Godowns', icon: MapPin },
     { id: 'users', label: 'Users & Roles', icon: Users },
     { id: 'print', label: 'Print', icon: Printer },
     { id: 'transaction', label: 'Transaction', icon: ReceiptText },
     { id: 'invoices', label: 'Invoice Settings', icon: FileText },
     { id: 'taxes', label: 'Taxes & GST', icon: Calculator },
     { id: 'items', label: 'Item Configuration', icon: Package },
     { id: 'data', label: 'Data Management', icon: Database },
     { id: 'danger', label: 'Danger Zone', icon: AlertTriangle, error: true },
  ];

  return (
    <div className="w-full p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
         <h1 className="text-2xl font-bold text-slate-900">Platform Settings</h1>
         <p className="text-slate-500 text-sm">Manage enterprise parameters, users, and core configurations.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
         {/* Navigation Sidebar */}
         <div className={`shrink-0 rounded-xl border bg-white p-2 shadow-sm transition-all duration-200 ease-in-out ${settingsSidebarCollapsed ? 'md:w-14' : 'md:w-64'} flex flex-col gap-1`}>
            <button
              type="button"
              onClick={() => setSettingsSidebarCollapsed((value) => !value)}
              className="mb-1 flex h-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title={settingsSidebarCollapsed ? 'Expand settings sidebar' : 'Collapse settings sidebar'}
            >
              {settingsSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            {TABS.map(t => (
               <button 
                  key={t.id} 
                  onClick={() => {
                    setTab(t.id);
                    setSettingsSidebarCollapsed(true);
                  }}
                  title={settingsSidebarCollapsed ? t.label : undefined}
                  className={`flex items-center rounded-lg text-sm font-medium transition-colors ${settingsSidebarCollapsed ? 'h-10 justify-center px-0' : 'gap-3 px-4 py-3'} ${
                     tab === t.id 
                       ? t.error ? 'border-l-4 border-red-500 bg-red-50 text-red-700' : 'border-l-4 border-indigo-500 bg-indigo-50 text-indigo-700'
                       : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
               >
                  <t.icon className={`w-4 h-4 ${tab === t.id && t.error ? 'text-red-600' : tab === t.id ? 'text-indigo-600' : 'text-slate-400'}`} /> 
                  {!settingsSidebarCollapsed && <span className="truncate">{t.label}</span>}
               </button>
            ))}
         </div>

         {/* Content Area */}
         <div className="min-w-0 flex-1">
            <Card className="min-h-[500px]">
               {tab === 'company' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold mb-4">Company Profile</h2>
                     {companyLoading && <p className="text-sm text-muted-foreground">Loading company…</p>}
                     <div className="grid md:grid-cols-2 gap-6 border-b pb-6">
                        <div>
                           <label className="text-sm font-medium text-slate-700 block mb-2">Branding (PDFs & prints)</label>
                           <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAsset(e.target.files?.[0], 'logo')} />
                           <input ref={signatureFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAsset(e.target.files?.[0], 'signature')} />
                           <div className="flex items-center gap-4">
                              <button
                                type="button"
                                onClick={() => logoFileRef.current?.click()}
                                className="w-24 h-24 bg-slate-100 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-slate-500 cursor-pointer hover:bg-slate-50 overflow-hidden relative"
                              >
                                 {logoSrc ? (
                                   <img src={logoSrc} alt="Logo" className="absolute inset-0 w-full h-full object-contain p-1" />
                                 ) : (
                                   <>
                                     <Upload className="w-6 h-6 mb-1" /> <span className="text-[10px] uppercase">Logo</span>
                                   </>
                                 )}
                              </button>
                              <button
                                type="button"
                                onClick={() => signatureFileRef.current?.click()}
                                className="w-32 h-24 bg-slate-100 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-slate-500 cursor-pointer hover:bg-slate-50 overflow-hidden relative"
                              >
                                 {signatureSrc ? (
                                   <img src={signatureSrc} alt="Signature" className="absolute inset-0 w-full h-full object-contain p-1" />
                                 ) : (
                                   <>
                                     <Upload className="w-6 h-6 mb-1" /> <span className="text-[10px] uppercase text-center px-1">Stamp / sign</span>
                                   </>
                                 )}
                              </button>
                           </div>
                           <p className="text-xs text-slate-500 mt-2">Uploads are stored on the server and used on invoices and quotations.</p>
                        </div>
                        <div className="space-y-4">
                           <div>
                              <label className="text-sm font-medium text-slate-700">Legal Name</label>
                             <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="mt-1" />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSTIN</label>
                             <div className="mt-1 flex gap-2">
                               <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="uppercase font-mono" maxLength={15} />
                               <Button type="button" variant="outline" size="icon" onClick={() => fetchGstin()} loading={gstinFetching} aria-label="Fetch GSTIN details">
                                 <Search className="h-4 w-4" />
                               </Button>
                             </div>
                             {gstinDetails && (
                               <div className="mt-2 rounded-md border bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                                 <p><span className="font-semibold">Legal:</span> {gstinDetails.legal_name || 'Verified GSTIN format only'}</p>
                                 {gstinDetails.trade_name && <p><span className="font-semibold">Trade:</span> {gstinDetails.trade_name}</p>}
                                 {gstinDetails.address && <p><span className="font-semibold">Address:</span> {gstinDetails.address}</p>}
                                 {(gstinDetails.city || gstinDetails.pincode) && <p><span className="font-semibold">City/PIN:</span> {[gstinDetails.city, gstinDetails.pincode].filter(Boolean).join(' - ')}</p>}
                                 <p><span className="font-semibold">State:</span> {[gstinDetails.state_code, gstinDetails.state].filter(Boolean).join(' - ') || '—'}</p>
                                 {gstinDetails.status && <p><span className="font-semibold">Status:</span> {gstinDetails.status}</p>}
                               </div>
                             )}
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Registered Address</label>
                             <textarea
                               className="mt-1 w-full min-h-[92px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                               value={registeredAddress}
                               onChange={(e) => setRegisteredAddress(e.target.value)}
                               placeholder="Building, street, area"
                             />
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                             <div>
                                <label className="text-sm font-medium text-slate-700">City</label>
                               <Input value={companyCity} onChange={(e) => setCompanyCity(e.target.value)} className="mt-1" />
                             </div>
                             <div>
                                <label className="text-sm font-medium text-slate-700">State</label>
                               <Input value={companyState} onChange={(e) => setCompanyState(e.target.value)} className="mt-1" />
                             </div>
                             <div>
                                <label className="text-sm font-medium text-slate-700">Pincode</label>
                               <Input value={companyPincode} onChange={(e) => setCompanyPincode(e.target.value)} className="mt-1" maxLength={10} />
                             </div>
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                             <div>
                                <label className="text-sm font-medium text-slate-700">Phone No.</label>
                               <Input value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} className="mt-1" inputMode="tel" placeholder="Company phone number" />
                             </div>
                             <div>
                                <label className="text-sm font-medium text-slate-700">Email ID</label>
                               <Input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} className="mt-1" type="email" />
                             </div>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Business Type</label>
                             <select className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                               <option value="">Select business type</option>
                               <option value="retail">Retail</option>
                               <option value="wholesaler">Wholesaler</option>
                               <option value="manufacturing">Manufacturing</option>
                               <option value="distributor">Distributor</option>
                               <option value="service">Service</option>
                               <option value="others">Others</option>
                             </select>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Business Category</label>
                             <Input list="business-category-suggestions" value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} className="mt-1" placeholder="e.g. Accounting CA, Salon, Shop" />
                             <datalist id="business-category-suggestions">
                               <option value="Accounting / CA Firm" />
                               <option value="Salon / Beauty Studio" />
                               <option value="Retail Shop" />
                               <option value="Manufacturing Unit" />
                               <option value="Distributor / Trader" />
                               <option value="Professional Services" />
                               <option value="Restaurant / Cafe" />
                               <option value="Healthcare / Clinic" />
                             </datalist>
                           </div>
                        </div>
                     </div>

                     <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">Banking Details</h3>
                          <Input placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                          <Input placeholder="Account Number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
                          <Input placeholder="IFSC Code" className="uppercase" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} />
                        </div>
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">UPI Context</h3>
                          <Input placeholder="UPI ID (e.g. upi@hdfcbank)" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
                           <p className="text-xs text-slate-500">QR Code will be dynamically generated on the invoice PDF based on total payload requirements automatically.</p>
                        </div>
                     </div>
                     <div className="border-t pt-6 space-y-4">
                       <div className="flex items-center justify-between">
                         <h3 className="font-semibold text-slate-900">Multiple Bank Accounts</h3>
                         <span className="text-xs text-slate-500">Primary account is used first on PDFs.</span>
                       </div>
                       <div className="grid gap-3">
                         {(bankAccounts as any[]).map((b: any) => (
                           <div key={b.id} className="rounded-lg border bg-slate-50 overflow-hidden">
                             <div className="flex items-center justify-between gap-2 p-3">
                               <div className="min-w-0 flex-1">
                                 <p className="font-medium text-sm">
                                   {b.account_label || b.bank_name}{' '}
                                   {b.is_primary ? <span className="text-xs text-indigo-600">(Primary)</span> : null}
                                 </p>
                                 <p className="text-xs text-slate-500 break-words">
                                   {b.bank_name || '—'} • {b.account_number || '—'} • {b.ifsc || '—'}
                                   {b.branch ? ` • ${b.branch}` : ''}
                                   {b.upi_id ? ` • ${b.upi_id}` : ''}
                                 </p>
                               </div>
                               <div className="flex shrink-0 items-center gap-1">
                                 <Button
                                   type="button"
                                   variant="ghost"
                                   size="sm"
                                   className="h-8 gap-1 text-xs"
                                   onClick={() => {
                                     if (editingBankId === b.id) {
                                       setEditingBankId(null);
                                       return;
                                     }
                                     setEditingBankId(b.id);
                                     setEditBankForm({
                                       account_label: b.account_label || '',
                                       bank_name: b.bank_name || '',
                                       account_number: b.account_number || '',
                                       ifsc: b.ifsc || '',
                                       branch: b.branch || '',
                                       upi_id: b.upi_id || '',
                                       is_primary: !!b.is_primary,
                                     });
                                   }}
                                 >
                                   <Pencil className="h-3.5 w-3.5" />
                                   {editingBankId === b.id ? 'Close' : 'Edit'}
                                 </Button>
                                 <Button
                                   variant="ghost"
                                   size="icon"
                                   className="h-8 w-8"
                                   onClick={() => removeBankAccount.mutate(b.id)}
                                   aria-label="Remove bank"
                                 >
                                   <Trash2 className="h-4 w-4 text-red-600" />
                                 </Button>
                               </div>
                             </div>
                             {editingBankId === b.id && (
                               <div className="border-t bg-white p-4 space-y-3">
                                 <div className="grid sm:grid-cols-2 gap-3">
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">Display label</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.account_label}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, account_label: e.target.value }))}
                                       placeholder="e.g. Main current"
                                     />
                                   </div>
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">Bank name</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.bank_name}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, bank_name: e.target.value }))}
                                     />
                                   </div>
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">Account number</label>
                                     <Input
                                       className="mt-1 h-9 font-mono text-sm"
                                       value={editBankForm.account_number}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, account_number: e.target.value }))}
                                     />
                                   </div>
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">IFSC</label>
                                     <Input
                                       className="mt-1 h-9 font-mono text-sm uppercase"
                                       value={editBankForm.ifsc}
                                       onChange={(e) =>
                                         setEditBankForm((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))
                                       }
                                     />
                                   </div>
                                   <div className="sm:col-span-2">
                                     <label className="text-xs font-medium text-slate-600">Branch</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.branch}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, branch: e.target.value }))}
                                     />
                                   </div>
                                   <div className="sm:col-span-2">
                                     <label className="text-xs font-medium text-slate-600">UPI ID</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.upi_id}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, upi_id: e.target.value }))}
                                       placeholder="name@upi"
                                     />
                                   </div>
                                 </div>
                                 <label className="flex items-center gap-2 text-sm">
                                   <input
                                     type="checkbox"
                                     checked={editBankForm.is_primary}
                                     onChange={(e) =>
                                       setEditBankForm((s) => ({ ...s, is_primary: e.target.checked }))
                                     }
                                   />
                                   Primary (shown first on invoices when none is selected)
                                 </label>
                                 <div className="flex flex-wrap gap-2 pt-1">
                                   <Button
                                     type="button"
                                     size="sm"
                                     loading={updateBankAccount.isPending}
                                     disabled={
                                       !editBankForm.bank_name.trim() && !editBankForm.account_label.trim()
                                     }
                                     onClick={() =>
                                       updateBankAccount.mutate({
                                         id: b.id,
                                         account_label: editBankForm.account_label.trim() || null,
                                         bank_name:
                                           editBankForm.bank_name.trim() ||
                                           editBankForm.account_label.trim() ||
                                           'Bank account',
                                         account_number: editBankForm.account_number.trim() || null,
                                         ifsc: editBankForm.ifsc.trim() || null,
                                         branch: editBankForm.branch.trim() || null,
                                         upi_id: editBankForm.upi_id.trim() || null,
                                         is_primary: editBankForm.is_primary,
                                       })
                                     }
                                   >
                                     Save changes
                                   </Button>
                                   <Button
                                     type="button"
                                     variant="outline"
                                     size="sm"
                                     onClick={() => setEditingBankId(null)}
                                   >
                                     Cancel
                                   </Button>
                                 </div>
                               </div>
                             )}
                           </div>
                         ))}
                       </div>
                       <div className="grid md:grid-cols-4 gap-3 rounded-lg border p-4">
                         <Input placeholder="Label" value={bankForm.account_label} onChange={(e) => setBankForm((s) => ({ ...s, account_label: e.target.value }))} />
                         <Input placeholder="Bank name" value={bankForm.bank_name} onChange={(e) => setBankForm((s) => ({ ...s, bank_name: e.target.value }))} />
                         <Input placeholder="Account number" value={bankForm.account_number} onChange={(e) => setBankForm((s) => ({ ...s, account_number: e.target.value }))} />
                         <Input placeholder="IFSC" className="uppercase" value={bankForm.ifsc} onChange={(e) => setBankForm((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))} />
                         <Input placeholder="Branch" value={bankForm.branch} onChange={(e) => setBankForm((s) => ({ ...s, branch: e.target.value }))} />
                         <Input placeholder="UPI ID" value={bankForm.upi_id} onChange={(e) => setBankForm((s) => ({ ...s, upi_id: e.target.value }))} />
                         <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={bankForm.is_primary} onChange={(e) => setBankForm((s) => ({ ...s, is_primary: e.target.checked }))} />Primary</label>
                         <Button type="button" onClick={() => saveBankAccount.mutate()} disabled={!bankForm.bank_name.trim() && !bankForm.account_label.trim()} loading={saveBankAccount.isPending} className="gap-1">
                           <Plus className="h-4 w-4" /> Add bank
                         </Button>
                       </div>
                     </div>
                    <div className="pt-4"><Button onClick={saveProfile} loading={updateCompany.isPending}>Save Profile</Button></div>
                    <div className="border-t pt-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={syncEmployeesToHr}
                        >
                          Sync Employees to HR
                        </Button>
                        <Button
                          className="gap-2"
                          onClick={() => {
                            setTab('users');
                            setEditingUserId('new');
                          }}
                        >
                          <Users className="w-4 h-4" /> Invite User
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => navigate('/hr/employees')}
                        >
                          <UserRound className="w-4 h-4" /> Add Employees
                        </Button>
                      </div>
                    </div>

                     <div className="border-t pt-8 space-y-4">
                        <h3 className="font-semibold text-slate-900">e-Invoice (GST / NIC)</h3>
                        <p className="text-xs text-slate-500">GSP password is encrypted at rest. Leave password blank to keep the current secret.</p>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Enable e-Invoice</span>
                           <Switch checked={einvEnabled} onCheckedChange={setEinvEnabled} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Turnover above ₹5 Cr (statutory / reporting flag)</span>
                           <Switch checked={einvTurnover} onCheckedChange={setEinvTurnover} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Sandbox mode</span>
                           <Switch checked={einvSandbox} onCheckedChange={setEinvSandbox} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                           <div>
                              <p className="text-sm font-medium text-slate-900">Allow E-Way Bill only above ₹50,000</p>
                              <p className="text-xs text-slate-600">When enabled, users cannot generate E-Way Bills for smaller invoices.</p>
                           </div>
                           <Switch checked={ewayBillOnlyAbove50k} onCheckedChange={setEwayBillOnlyAbove50k} />
                        </div>
                        <div className="grid md:grid-cols-2 gap-4 max-w-xl">
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSP username</label>
                              <Input className="mt-1" value={einvUser} onChange={(e) => setEinvUser(e.target.value)} />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSP password</label>
                              <Input type="password" className="mt-1" value={einvPass} onChange={(e) => setEinvPass(e.target.value)} placeholder={company?.has_einvoice_gsp_password ? '••••••••' : ''} />
                           </div>
                        </div>
                        <Button onClick={saveEinvoice} loading={updateCompany.isPending}>Save e-Invoice settings</Button>
                     </div>
                  </CardContent>
               )}

               {tab === 'users' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Users & Roles</h2>
                        <Button className="gap-2" onClick={() => setEditingUserId('new')}><Users className="w-4 h-4"/> Invite User</Button>
                     </div>
                     {editingUserId === 'new' && (
                        <div className="mb-4 rounded-lg border p-4 grid md:grid-cols-5 gap-3">
                           <Input placeholder="Name" value={newUser.name} onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))} />
                           <Input placeholder="Email" value={newUser.email} onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))} />
                           <Input placeholder="Phone" value={newUser.phone} onChange={(e) => setNewUser((s) => ({ ...s, phone: e.target.value }))} />
                           <select className="h-10 rounded-md border bg-white px-3 text-sm" value={newUser.role} onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}>
                              <option value="staff">Staff</option>
                              <option value="manager">Cashier / Manager</option>
                              <option value="admin">Admin</option>
                           </select>
                           <Input type="password" placeholder="Password" value={newUser.password} onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))} />
                           <div className="md:col-span-5 flex gap-2">
                              <Button onClick={() => createUser.mutate()} disabled={!newUser.name || !newUser.password} loading={createUser.isPending}>Create User</Button>
                              <Button variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                           </div>
                        </div>
                     )}
                     <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm text-left">
                           <thead className="bg-slate-50 border-b">
                              <tr>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Employee</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Role</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Location</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                                 <th className="px-4 py-3 font-semibold text-right">Actions</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y">
                              {usersLoading && (
                                <tr><td className="px-4 py-3 text-muted-foreground" colSpan={5}>Loading users…</td></tr>
                              )}
                              {users.map((u: any) => (
                                <tr key={u.id} className="hover:bg-slate-50/50">
                                  <td className="px-4 py-3"><p className="font-semibold text-slate-900">{u.name}</p><p className="text-xs text-slate-500">{u.email || '—'}</p></td>
                                  <td className="px-4 py-3"><span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold uppercase">{roleLabel(u.role)}</span></td>
                                  <td className="px-4 py-3">{u.godown_name || '—'}</td>
                                  <td className="px-4 py-3"><span className={`font-medium text-xs ${u.is_active ? 'text-emerald-600' : 'text-slate-500'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                                  <td className="px-4 py-3 text-right space-x-2">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Open employee profile"
                                      onClick={() => navigate(`/hr/employees/${u.id}`)}
                                    >
                                      <UserRound className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      loading={updateUser.isPending && updateUser.variables?.id === u.id}
                                      onClick={() => updateUser.mutate({ id: u.id, data: { is_active: !u.is_active } })}
                                    >
                                      {u.is_active ? 'Disable' : 'Enable'}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                     {editingUserId && editingUserId !== 'new' && (
                       <div className="mt-4 rounded-lg border p-4 grid md:grid-cols-5 gap-3">
                         <Input placeholder="Name" value={editUserForm.name} onChange={(e) => setEditUserForm((s) => ({ ...s, name: e.target.value }))} />
                         <Input placeholder="Email" value={editUserForm.email} onChange={(e) => setEditUserForm((s) => ({ ...s, email: e.target.value }))} />
                         <Input placeholder="Phone" value={editUserForm.phone} onChange={(e) => setEditUserForm((s) => ({ ...s, phone: e.target.value }))} />
                         <select className="h-10 rounded-md border bg-white px-3 text-sm" value={editUserForm.role} onChange={(e) => setEditUserForm((s) => ({ ...s, role: e.target.value }))}>
                           <option value="staff">Staff</option>
                           <option value="manager">Cashier / Manager</option>
                           <option value="admin">Admin</option>
                         </select>
                         <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={editUserForm.is_active} onChange={(e) => setEditUserForm((s) => ({ ...s, is_active: e.target.checked }))} />Active</label>
                         <div className="md:col-span-5 flex gap-2">
                           <Button onClick={() => updateUser.mutate({ id: editingUserId!, data: editUserForm })} disabled={!editUserForm.name} loading={updateUser.isPending}>Save changes</Button>
                           <Button variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                         </div>
                       </div>
                     )}
                  </CardContent>
               )}

               {tab === 'godowns' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Godowns & Warehouses</h2>
                        <Button variant="outline" className="gap-2" onClick={() => setEditingGodownId('new')}><MapPin className="w-4 h-4"/> Add Godown</Button>
                     </div>
                     {editingGodownId === 'new' && (
                        <div className="mb-4 rounded-lg border p-4 grid md:grid-cols-4 gap-3">
                           <Input placeholder="Name" value={newGodown.name} onChange={(e) => setNewGodown((s) => ({ ...s, name: e.target.value }))} />
                           <Input placeholder="Code" value={newGodown.code} onChange={(e) => setNewGodown((s) => ({ ...s, code: e.target.value }))} />
                           <Input placeholder="City" value={newGodown.city} onChange={(e) => setNewGodown((s) => ({ ...s, city: e.target.value }))} />
                           <Input placeholder="State" value={newGodown.state} onChange={(e) => setNewGodown((s) => ({ ...s, state: e.target.value }))} />
                           <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={newGodown.is_default} onChange={(e) => setNewGodown((s) => ({ ...s, is_default: e.target.checked }))} />Set as default</label>
                           <div className="md:col-span-4 flex gap-2">
                              <Button onClick={() => createGodown.mutate()} disabled={!newGodown.name} loading={createGodown.isPending}>Create Godown</Button>
                              <Button variant="outline" onClick={() => setEditingGodownId(null)}>Cancel</Button>
                           </div>
                        </div>
                     )}
                     <div className="grid gap-4">
                        {godownsLoading && <div className="text-sm text-muted-foreground">Loading godowns…</div>}
                        {godownRows.map((g: any) => (
                          <div key={g.id} className="p-4 border rounded-lg flex items-center justify-between hover:border-indigo-300 transition-colors bg-slate-50/50">
                            <div className="flex gap-4 items-center">
                              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold">{(g.code || g.name || 'G').slice(0, 2).toUpperCase()}</div>
                              <div>
                                <p className="font-semibold text-slate-900">{g.name} {g.is_default ? <span className="text-xs text-indigo-600">(Default)</span> : null}</p>
                                <p className="text-xs text-slate-500">{[g.city, g.state].filter(Boolean).join(', ') || '—'} • {g.manager_name || 'No manager'}</p>
                              </div>
                            </div>
                            <div className="space-x-2">
                              <Button variant="ghost" size="sm" onClick={() => openEditGodown(g)}>Edit</Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={updateGodown.isPending && updateGodown.variables?.id === g.id}
                                onClick={() => updateGodown.mutate({ id: g.id, data: { is_active: !g.is_active } })}
                              >
                                {g.is_active ? 'Disable' : 'Enable'}
                              </Button>
                            </div>
                          </div>
                        ))}
                     </div>
                     {editingGodownId && editingGodownId !== 'new' && (
                       <div className="mt-4 rounded-lg border p-4 grid md:grid-cols-4 gap-3">
                         <Input placeholder="Name" value={editGodownForm.name} onChange={(e) => setEditGodownForm((s) => ({ ...s, name: e.target.value }))} />
                         <Input placeholder="Code" value={editGodownForm.code} onChange={(e) => setEditGodownForm((s) => ({ ...s, code: e.target.value }))} />
                         <Input placeholder="City" value={editGodownForm.city} onChange={(e) => setEditGodownForm((s) => ({ ...s, city: e.target.value }))} />
                         <Input placeholder="State" value={editGodownForm.state} onChange={(e) => setEditGodownForm((s) => ({ ...s, state: e.target.value }))} />
                         <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={editGodownForm.is_default} onChange={(e) => setEditGodownForm((s) => ({ ...s, is_default: e.target.checked }))} />Set as default</label>
                         <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={editGodownForm.is_active} onChange={(e) => setEditGodownForm((s) => ({ ...s, is_active: e.target.checked }))} />Active</label>
                         <div className="md:col-span-4 flex gap-2">
                           <Button onClick={() => updateGodown.mutate({ id: editingGodownId!, data: editGodownForm })} disabled={!editGodownForm.name} loading={updateGodown.isPending}>Save changes</Button>
                           <Button variant="outline" onClick={() => setEditingGodownId(null)}>Cancel</Button>
                         </div>
                       </div>
                     )}
                  </CardContent>
               )}

               {tab === 'print' && (
                  <CardContent className="p-0">
                     <div className="border-b bg-white px-6 pt-5">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                           <div>
                              <h2 className="text-xl font-bold">Print Settings</h2>
                              <p className="mt-1 text-sm text-slate-500">Configure regular printer invoice layout and PDF content. The sample invoice updates immediately; saved invoices and PDFs use these settings after you save.</p>
                           </div>
                           <Button onClick={savePrintSettings} loading={updateCompany.isPending}>Save Print Settings</Button>
                        </div>
                        <div className="mt-5 flex gap-2">
                           <button type="button" className="border-b-2 border-indigo-600 px-5 py-3 text-sm font-bold text-indigo-700">REGULAR PRINTER</button>
                           <button type="button" disabled className="px-5 py-3 text-sm font-bold text-slate-400">THERMAL PRINTER</button>
                        </div>
                     </div>

                     <div className="grid gap-0 xl:grid-cols-[360px_minmax(0,1fr)]">
                        <div className="max-h-[calc(100vh-220px)] overflow-auto border-r bg-white p-5">
                           <div className="mb-5 flex border-b">
                              <button
                                 type="button"
                                 onClick={() => setPrintSection('layout')}
                                 className={`px-5 py-3 text-sm font-bold ${printSection === 'layout' ? 'border-b-2 border-rose-500 text-blue-600' : 'text-slate-600'}`}
                              >
                                 CHANGE LAYOUT
                              </button>
                              <button
                                 type="button"
                                 onClick={() => setPrintSection('colors')}
                                 className={`px-5 py-3 text-sm font-bold ${printSection === 'colors' ? 'border-b-2 border-rose-500 text-blue-600' : 'text-slate-400'}`}
                              >
                                 CHANGE COLORS
                              </button>
                           </div>

                           {printSection === 'colors' ? (
                              <div className="space-y-4">
                                 <div className="rounded-lg border bg-slate-50 p-4">
                                    <p className="text-xs font-semibold uppercase text-slate-500">Active Layout</p>
                                    <div className="mt-2 flex items-center gap-3">
                                       <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: selectedLayoutColor }} />
                                       <div className="min-w-0">
                                          <p className="truncate text-sm font-bold text-slate-900">{selectedPrintLayout.label}</p>
                                          <p className="text-xs text-slate-500">{selectedLayoutColorName}</p>
                                       </div>
                                    </div>
                                 </div>
                                 <div className="grid grid-cols-5 gap-3">
                                    {PRINT_COLOR_PALETTE.map((color) => {
                                      const checked = selectedLayoutColor.toLowerCase() === color.value.toLowerCase();
                                      return (
                                        <button
                                          key={color.value}
                                          type="button"
                                          onClick={() => updatePrintLayoutColor(selectedPrintLayout.id, color.value)}
                                          className="group flex flex-col items-center gap-2 rounded-lg p-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                                          title={color.name}
                                        >
                                          <span
                                            className={`flex h-10 w-10 items-center justify-center rounded-full border text-white shadow-sm transition ${checked ? 'ring-2 ring-indigo-500 ring-offset-2' : 'ring-0'}`}
                                            style={{ backgroundColor: color.value }}
                                          >
                                            {checked ? '✓' : ''}
                                          </span>
                                          <span className="max-w-full truncate">{color.name}</span>
                                        </button>
                                      );
                                    })}
                                 </div>
                              </div>
	                           ) : (
	                              <div className="space-y-7">
	                                 <PrintLayoutPicker
	                                    value={selectedPrintLayoutId}
	                                    onChange={(layoutId) => updatePrintSetting('regular', 'layout', layoutId)}
	                                 />

	                                 <section className="space-y-4">
                                    <h3 className="border-b pb-3 text-lg font-bold">Print Company Info / Header</h3>
                                    {[
                                      ['default', 'Make Regular Printer Default'],
                                      ['repeat_header', 'Print repeat header in all pages'],
                                      ['print_original_duplicate', 'Print Original/Duplicate'],
                                    ].map(([key, label]) => (
                                      <label key={key} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                                         <Switch checked={Boolean(printSettings.regular[key as keyof PrintSettingsState['regular']])} onCheckedChange={(v) => updatePrintSetting('regular', key as keyof PrintSettingsState['regular'], v as never)} />
                                         {label}
                                      </label>
                                    ))}
                                    <div className="grid gap-3">
                                       {[
                                         ['company_name', 'Company Name', savedCompanyName],
                                         ['company_logo', 'Company Logo', 'Logo from company profile'],
                                         ['address', 'Address', savedCompanyAddress],
                                         ['email', 'Email', savedCompanyEmail],
                                         ['phone', 'Phone Number', savedCompanyPhone],
                                         ['gstin', 'GSTIN on Sale', savedCompanyGstin],
                                       ].map(([key, label, sample]) => (
                                          <div key={key} className="flex items-center gap-3">
                                             <Switch checked={Boolean(printSettings.header[key as keyof PrintSettingsState['header']])} onCheckedChange={(v) => updatePrintSetting('header', key as keyof PrintSettingsState['header'], v as never)} />
                                             <div className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2">
                                                <p className="text-[11px] text-slate-500">{label}</p>
                                                <p className="truncate text-sm font-medium text-slate-800">{sample}</p>
                                             </div>
                                          </div>
                                       ))}
                                    </div>
                                 </section>

                                 <section className="grid gap-4 border-t pt-5">
                                    <label className="text-sm font-medium text-slate-700">Paper Size
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={printSettings.regular.paper_size} onChange={(e) => updatePrintSetting('regular', 'paper_size', e.target.value as 'A4' | 'Letter')}>
                                          <option value="A4">A4</option>
                                          <option value="Letter">Letter</option>
                                       </select>
                                    </label>
                                    <label className="text-sm font-medium text-slate-700">Orientation
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={printSettings.regular.orientation} onChange={(e) => updatePrintSetting('regular', 'orientation', e.target.value as 'portrait' | 'landscape')}>
                                          <option value="portrait">Portrait</option>
                                          <option value="landscape">Landscape</option>
                                       </select>
                                    </label>
                                    <label className="text-sm font-medium text-slate-700">Company Name Text Size
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={printSettings.regular.company_name_text_size} onChange={(e) => updatePrintSetting('regular', 'company_name_text_size', e.target.value as 'small' | 'medium' | 'large')}>
                                          <option value="small">Small</option>
                                          <option value="medium">Medium</option>
                                          <option value="large">Large</option>
                                       </select>
                                    </label>
                                    <label className="text-sm font-medium text-slate-700">Invoice Text Size
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={printSettings.regular.invoice_text_size} onChange={(e) => updatePrintSetting('regular', 'invoice_text_size', e.target.value as 'small' | 'medium' | 'large')}>
                                          <option value="small">Small</option>
                                          <option value="medium">Medium</option>
                                          <option value="large">Large</option>
                                       </select>
                                    </label>
                                    <label className="text-sm font-medium text-slate-700">Extra space on Top of PDF
                                       <Input type="number" min={0} max={80} className="mt-1" value={printSettings.regular.extra_top_space} onChange={(e) => updatePrintSetting('regular', 'extra_top_space', Number(e.target.value) as never)} />
                                    </label>
                                    <label className="text-sm font-medium text-slate-700">Min No. of Rows in Item Table
                                       <Input type="number" min={0} max={30} className="mt-1" value={printSettings.regular.min_item_rows} onChange={(e) => updatePrintSetting('regular', 'min_item_rows', Number(e.target.value) as never)} />
                                    </label>
                                 </section>

                                 <section className="space-y-4 border-t pt-5">
                                    <button type="button" className="text-sm font-semibold text-blue-600" onClick={() => setTransactionNamesOpen(true)}>Change Transaction Names &gt;</button>
                                    <div>
                                       <h3 className="mb-3 text-lg font-bold">Item Table</h3>
                                       <button type="button" className="text-sm font-semibold text-blue-600" onClick={() => setItemTablePrintOpen(true)}>Item Table Customization &gt;</button>
                                    </div>
                                 </section>

                                 <section className="space-y-4 border-t pt-5">
                                    <h3 className="text-lg font-bold">Totals & Taxes</h3>
                                    <div className="grid gap-3">
                                       {[
                                         ['total_item_quantity', 'Total Item Quantity'],
                                         ['amount_with_decimal', 'Amount with Decimal'],
                                         ['received_amount', 'Received Amount'],
                                         ['balance_amount', 'Balance Amount'],
                                         ['current_balance_of_party', 'Current Balance of Party'],
                                         ['tax_details', 'Tax Details'],
                                         ['you_saved', 'You Saved'],
                                         ['print_amount_with_grouping', 'Print Amount with Grouping'],
                                       ].map(([key, label]) => (
                                          <label key={key} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={Boolean(printSettings.totals[key as keyof PrintSettingsState['totals']])} onCheckedChange={(v) => updatePrintSetting('totals', key as keyof PrintSettingsState['totals'], v as never)} />
                                             {label}
                                          </label>
                                       ))}
                                       <label className="text-sm font-medium text-slate-700">Amount in Words
                                          <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={printSettings.totals.amount_in_words} onChange={(e) => updatePrintSetting('totals', 'amount_in_words', e.target.value as 'indian' | 'international')}>
                                             <option value="indian">Indian</option>
                                             <option value="international">International</option>
                                          </select>
                                       </label>
                                    </div>
                                 </section>

                                 <section className="space-y-4 border-t pt-5">
                                    <h3 className="text-base font-bold text-slate-900">Footer</h3>
                                    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                                       <div className="space-y-4">
                                          <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={printSettings.footer.print_description} onCheckedChange={(v) => updatePrintSetting('footer', 'print_description', v)} />
                                             <span className="min-w-0 pt-0.5">Print Description</span>
                                          </label>
                                          <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={printSettings.footer.print_received_by} onCheckedChange={(v) => updatePrintSetting('footer', 'print_received_by', v)} />
                                             <span className="min-w-0 pt-0.5">Print Received by details</span>
                                          </label>
                                          <div>
                                             <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                                <Switch checked={printSettings.footer.signature_enabled} onCheckedChange={(v) => updatePrintSetting('footer', 'signature_enabled', v)} />
                                                <span className="min-w-0 pt-0.5">Print Signature Text</span>
                                             </label>
                                             {printSettings.footer.signature_enabled && (
                                                <div className="mt-2 pl-8">
                                                   <label className="block text-xs font-semibold text-slate-500">Signature Text</label>
                                                   <select
                                                      className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm"
                                                      value={['Authorized Sign', 'Authorized Signatory'].includes(printSettings.footer.signature_text) ? 'authorized' : 'custom'}
                                                      onChange={(e) => updatePrintSetting('footer', 'signature_text', e.target.value === 'authorized' ? 'Authorized Sign' : 'Custom Text')}
                                                   >
                                                      <option value="authorized">Authorized Sign</option>
                                                      <option value="custom">Custom Text</option>
                                                   </select>
                                                   {!['Authorized Sign', 'Authorized Signatory'].includes(printSettings.footer.signature_text) && (
                                                      <Input className="mt-2" value={printSettings.footer.signature_text} onChange={(e) => updatePrintSetting('footer', 'signature_text', e.target.value)} />
                                                   )}
                                                </div>
                                             )}
                                          </div>
                                          <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={printSettings.footer.acknowledgement} onCheckedChange={(v) => updatePrintSetting('footer', 'acknowledgement', v)} />
                                             <span className="min-w-0 pt-0.5">Print Acknowledgement</span>
                                          </label>
                                       </div>
                                       <div className="space-y-4">
                                          <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={printSettings.footer.print_terms} onCheckedChange={(v) => updatePrintSetting('footer', 'print_terms', v)} />
                                             <span className="min-w-0 pt-0.5">Print Terms and Conditions</span>
                                          </label>
                                          <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={printSettings.footer.print_delivered_by} onCheckedChange={(v) => updatePrintSetting('footer', 'print_delivered_by', v)} />
                                             <span className="min-w-0 pt-0.5">Print Delivered by details</span>
                                          </label>
                                          <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                             <Switch checked={printSettings.footer.payment_mode} onCheckedChange={(v) => updatePrintSetting('footer', 'payment_mode', v)} />
                                             <span className="min-w-0 pt-0.5">Payment Mode</span>
                                          </label>
                                       </div>
                                    </div>
                                 </section>

                              </div>
                           )}
                        </div>

                        <aside className="border-t bg-slate-100/70 p-5 xl:border-l xl:border-t-0">
                           <div className="xl:sticky xl:top-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                 <div>
                                    <p className="text-xs font-semibold uppercase text-slate-500">Live Sample</p>
                                    <h3 className="font-bold text-slate-900">{selectedPrintLayout.label}</h3>
                                 </div>
                                 <span className="rounded-full border bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                    {printSettings.regular.paper_size} · {printSettings.regular.orientation}
                                 </span>
                              </div>
                              <PrintInvoiceLayoutPreview
                                 layoutId={selectedPrintLayoutId}
                                 accentColor={selectedLayoutColor}
                                 columns={previewColumns}
                                 getCellValue={previewValueForColumn}
                                 data={{
                                   firm: {
                                     name: printSettings.header.company_name ? savedCompanyName : 'Firm Name',
                                     address: printSettings.header.address ? savedCompanyAddress : '',
                                     phone: printSettings.header.phone ? savedCompanyPhone : '',
                                     email: printSettings.header.email ? savedCompanyEmail : '',
                                     gstin: printSettings.header.gstin ? savedCompanyGstin : '',
                                     state: company?.state || 'Gujarat',
                                     logo: printSettings.header.company_logo ? logoSrc || undefined : undefined,
                                     signature: printSettings.footer.signature_enabled ? signatureSrc || undefined : undefined,
                                   },
                                   invoice: {
                                     number: 'INV-101',
                                     date: '27-05-2026',
                                     time: '12:30 PM',
                                     dueDate: '03-06-2026',
                                     type: previewTitle,
                                   },
                                   billTo: { name: 'Classic enterprises', address: 'Plot No. 1, Surat, Gujarat', contact: 'Contact No.: 8888888888' },
                                   shipTo: { name: 'Mehta Textiles', address: 'Bengaluru, Karnataka, 560034' },
                                   footer: {
                                     description: 'Sale Description',
                                     termsAndConditions: company?.terms_and_conditions || 'Thanks for doing business with us!',
                                     bankName: savedBankName,
                                     bankAccount: savedBankAccount,
                                     bankIfsc: savedBankIfsc,
                                     authorizedSignature: printSettings.footer.signature_text || 'Authorized Sign',
                                     showQR: true,
                                   },
                                 }}
                                 amountInWords={printSettings.totals.amount_in_words === 'indian' ? 'Rupees One Thousand Three Hundred Eighty Six and Fifty Paise only' : 'One Thousand Three Hundred Eighty Six and Fifty Cents only'}
                                 showDescription={printSettings.footer.print_description}
                                 showTerms={printSettings.footer.print_terms}
                                 showReceived={printSettings.totals.received_amount}
                                 showBalance={printSettings.totals.balance_amount}
                                 showYouSaved={printSettings.totals.you_saved}
                                 showTaxDetails={printSettings.totals.tax_details}
                                 showPaymentMode={printSettings.footer.payment_mode}
                                 showAcknowledgement={printSettings.footer.acknowledgement}
                                 showReceivedBy={printSettings.footer.print_received_by}
                                 showDeliveredBy={printSettings.footer.print_delivered_by}
                                 showSignature={printSettings.footer.signature_enabled}
                              />
                           </div>
                        </aside>
                     </div>

                     {transactionNamesOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
                              <div className="mb-5 flex items-center justify-between">
                                 <h3 className="text-xl font-bold">Change Transaction Names</h3>
                                 <Button variant="ghost" size="icon" onClick={() => setTransactionNamesOpen(false)}><X className="h-5 w-5" /></Button>
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                 {TRANSACTION_NAME_FIELDS.map(([key, label]) => (
                                    <label key={key} className="text-sm font-medium text-slate-700">{label}
                                       <Input className="mt-1" value={String(printSettings.transaction_names[key] || '')} onChange={(e) => updateTransactionName(key, e.target.value)} />
                                    </label>
                                 ))}
                              </div>
                              <label className="mt-4 flex items-center gap-3 text-sm font-medium text-slate-700">
                                 <Switch checked={Boolean(printSettings.transaction_names.non_tax_bill)} onCheckedChange={(v) => updateTransactionName('non_tax_bill', v)} />
                                 Bill of Supply for Non Tax Transaction
                              </label>
                              <div className="mt-6 flex justify-end gap-2">
                                 <Button variant="outline" onClick={() => setTransactionNamesOpen(false)}>Cancel</Button>
                                 <Button onClick={() => setTransactionNamesOpen(false)}>Save</Button>
                              </div>
                           </div>
                        </div>
                     )}

                     {itemTablePrintOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
                              <div className="mb-5 flex items-center justify-between">
                                 <h3 className="text-xl font-bold">Item Table Customization</h3>
                                 <Button variant="ghost" size="icon" onClick={() => setItemTablePrintOpen(false)}><X className="h-5 w-5" /></Button>
                              </div>
                              <div className="mb-6 overflow-x-auto rounded border">
                                 <div
                                    className="grid min-w-max px-3 py-3 text-xs font-bold text-white"
                                    style={{ gridTemplateColumns: `repeat(${previewColumns.length}, minmax(92px, 1fr))`, backgroundColor: previewAccent }}
                                 >
                                    {previewColumns.map((col) => <span key={col.key} className="truncate pr-2" title={col.label}>{col.label}</span>)}
                                 </div>
                                 <div
                                    className="grid min-w-max border-t px-3 py-3 text-xs"
                                    style={{ gridTemplateColumns: `repeat(${previewColumns.length}, minmax(92px, 1fr))` }}
                                 >
                                    {previewColumns.map((col) => <span key={col.key} className="truncate pr-2" title={previewValueForColumn(col.key, 1)}>{previewValueForColumn(col.key, 1)}</span>)}
                                 </div>
                              </div>
                              <div className="grid gap-6 md:grid-cols-3">
                                 {(['item', 'additional', 'amount'] as const).map((group) => (
                                    <div key={group}>
                                       <h4 className="mb-3 border-b pb-2 font-semibold">{group === 'item' ? 'Item related columns' : group === 'additional' ? 'Additional Item Columns' : 'Amounts, Totals & Taxes'}</h4>
                                       <div className="space-y-3">
                                          {PRINT_COLUMNS.filter((column) => column.group === group).map((column) => (
                                             <label key={column.key} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                                                <Switch
                                                   disabled={column.key === 'item_name'}
                                                   checked={column.key === 'item_name' || printSettings.item_table.columns.includes(column.key)}
                                                   onCheckedChange={(checked) => togglePrintColumn(column.key, checked)}
                                                />
                                                {column.label}
                                             </label>
                                          ))}
                                       </div>
                                    </div>
                                 ))}
                              </div>
                              <div className="mt-6 flex justify-end">
                                 <Button onClick={() => setItemTablePrintOpen(false)}>Done</Button>
                              </div>
                           </div>
                        </div>
                     )}
                  </CardContent>
               )}

               {tab === 'transaction' && (
                  <CardContent className="p-6 space-y-6">
                     <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                           <h2 className="text-xl font-bold">Transaction Settings</h2>
                           <p className="mt-1 text-sm text-slate-500">Configure how transactions behave across billing, invoicing and payments.</p>
                        </div>
                        <Button onClick={saveTransactionSettings}>Save Transaction Settings</Button>
                     </div>

                     <div className="grid gap-6 xl:grid-cols-3">
                        <section className="space-y-6">
                           <div className="space-y-3">
                              <h3 className="border-b pb-3 font-semibold">Transaction Header</h3>
                              {[
                                ['showInvoiceNumber', 'Invoice/Bill No.'],
                                ['addTimeOnTransactions', 'Add Time on Transactions'],
                                ['cashSaleByDefault', 'Cash Sale by default'],
                                ['showBillingNameOfParties', 'Billing Name of Parties'],
                                ['showCustomerPODetails', 'Customers P.O. Details on Transactions'],
                              ].map(([key, label]) => (
                                 <label key={key} className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                    <span>{label} <span className="text-slate-400">ⓘ</span></span>
                                    <Switch checked={Boolean(transactionSettings[key as keyof TransactionSettingsState])} onCheckedChange={(v) => setTransactionSettings((p) => ({ ...p, [key]: v }))} />
                                 </label>
                              ))}
                           </div>

                           <div className="space-y-3">
                              <h3 className="border-b pb-3 font-semibold">More Transaction Features</h3>
                              {[
                                ['enableEwayBill', 'E-way bill no.'],
                                ['enableQuickEntry', 'Quick Entry'],
                                ['doNotShowInvoicePreview', 'Do not Show Invoice Preview'],
                                ['enablePasscodeForEditDelete', 'Enable Passcode for transaction edit/delete'],
                                ['enableDiscountDuringPayments', 'Discount During Payments'],
                                ['linkPaymentsToInvoices', 'Link Payments to Invoices'],
                                ['enableDueDatesAndPaymentTerms', 'Due Dates and Payment Terms'],
                                ['showProfitWhileMakingSaleInvoice', 'Show Profit while making Sale Invoice'],
                                ['enableTermsAndConditions', 'Terms and Conditions'],
                              ].map(([key, label]) => (
                                 <div key={key} className="rounded-md border bg-white px-3 py-2">
                                    <label className="flex items-center justify-between gap-3 text-sm">
                                       <span>{label} <span className="text-slate-400">ⓘ</span></span>
                                       <Switch checked={Boolean(transactionSettings[key as keyof TransactionSettingsState])} onCheckedChange={(v) => setTransactionSettings((p) => ({ ...p, [key]: v }))} />
                                    </label>
                                    {key === 'enableTermsAndConditions' && (
                                       <button type="button" className="mt-2 text-xs font-semibold text-blue-600" onClick={() => setTermsModalOpen(true)}>Set Terms and Conditions</button>
                                    )}
                                 </div>
                              ))}
                              <div className="grid gap-2">
                                 <Button type="button" variant="outline" onClick={() => setAdditionalFieldsOpen(true)}>Additional Fields &gt;</Button>
                                 <Button type="button" variant="outline" onClick={() => setTransportationOpen(true)}>Transportation Details &gt;</Button>
                                 <Button type="button" variant="outline" onClick={() => setChargesOpen(true)}>Additional Charges &gt;</Button>
                              </div>
                           </div>
                        </section>

                        <section className="space-y-6">
                           <div className="space-y-3">
                              <h3 className="border-b pb-3 font-semibold">Items Table</h3>
                              {[
                                ['showInclusiveExclusiveTax', 'Inclusive/Exclusive Tax on Rate (Price/Unit)'],
                                ['showPurchasePriceInItems', 'Display Purchase Price of Items'],
                                ['showLast5SalePrice', 'Show last 5 Sale Price of Items'],
                                ['showLast5PurchasePrice', 'Show last 5 Purchase Price of Items'],
                                ['showFreeItemQuantity', 'Free Item Quantity'],
                                ['showCountColumn', 'Count'],
                              ].map(([key, label]) => (
                                 <label key={key} className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                    <span>{key === 'showCountColumn' ? transactionSettings.countColumnLabel || label : label}</span>
                                    <Switch checked={Boolean(transactionSettings[key as keyof TransactionSettingsState])} onCheckedChange={(v) => setTransactionSettings((p) => ({ ...p, [key]: v }))} />
                                 </label>
                              ))}
                              <Input className="max-w-xs" value={transactionSettings.countColumnLabel} maxLength={30} onChange={(e) => setTransactionSettings((p) => ({ ...p, countColumnLabel: e.target.value }))} placeholder="Count column label" />
                           </div>

                           <div className="space-y-3">
                              <h3 className="border-b pb-3 font-semibold">Transaction Prefixes</h3>
                              <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={company?.name || ''} disabled>
                                 <option>{company?.name || legalName || 'Current firm'}</option>
                              </select>
                              <div className="grid gap-3 sm:grid-cols-2">
                                 {[
                                   ['sale', 'Sale'], ['creditNote', 'Credit Note'], ['saleOrder', 'Sale Order'], ['purchaseOrder', 'Purchase Order'],
                                   ['estimate', 'Estimate'], ['proformaInvoice', 'Proforma Invoice'], ['deliveryChallan', 'Delivery Challan'], ['paymentIn', 'Payment In'],
                                 ].map(([key, label]) => (
                                    <label key={key} className="text-xs font-medium text-slate-600">{label}
                                       <Input
                                          className="mt-1"
                                          list="prefix-options"
                                          maxLength={10}
                                          value={transactionPrefixes[key as keyof TransactionPrefixesState] || ''}
                                          onChange={(e) => setTransactionPrefixes((p) => ({ ...p, [key]: e.target.value }))}
                                          placeholder="None"
                                       />
                                    </label>
                                 ))}
                                 <datalist id="prefix-options">
                                    {['', 'INV-', 'BILL-', 'ORD-', 'EST-', 'PO-', 'CN-', 'DC-', 'PI-'].map((p) => <option key={p || 'none'} value={p}>{p || 'None'}</option>)}
                                 </datalist>
                              </div>
                           </div>
                        </section>

                        <section className="space-y-6">
                           <div className="space-y-3">
                              <h3 className="border-b pb-3 font-semibold">Taxes, Discount & Totals</h3>
                              {[
                                ['enableTransactionWiseTax', 'Transaction wise Tax'],
                                ['enableTransactionWiseDiscount', 'Transaction wise Discount'],
                                ['roundOffTotal', 'Round Off Total'],
                              ].map(([key, label]) => (
                                 <label key={key} className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                    <span>{label}</span>
                                    <Switch checked={Boolean(transactionSettings[key as keyof TransactionSettingsState])} onCheckedChange={(v) => setTransactionSettings((p) => ({ ...p, [key]: v }))} />
                                 </label>
                              ))}
                              {transactionSettings.roundOffTotal && (
                                 <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md border bg-slate-50 p-3 text-sm">
                                    <select className="h-10 rounded-md border bg-white px-3" value={transactionSettings.roundOffType} onChange={(e) => setTransactionSettings((p) => ({ ...p, roundOffType: e.target.value as TransactionSettingsState['roundOffType'] }))}>
                                       <option value="NEAREST">Nearest</option><option value="FLOOR">Floor</option><option value="CEIL">Ceil</option>
                                    </select>
                                    <span>To</span>
                                    <select className="h-10 rounded-md border bg-white px-3" value={transactionSettings.roundOffTo} onChange={(e) => setTransactionSettings((p) => ({ ...p, roundOffTo: Number(e.target.value) as 1 | 10 | 100 }))}>
                                       <option value={1}>1</option><option value={10}>10</option><option value={100}>100</option>
                                    </select>
                                 </div>
                              )}
                           </div>
                           <div className="space-y-3">
                              <h3 className="border-b pb-3 font-semibold">Billing Type</h3>
                              {[
                                ['LITE_SALE', 'Lite Sale'],
                                ['FULL_SALE', 'Full Sale'],
                              ].map(([value, label]) => (
                                 <label key={value} className="flex items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                    <input type="radio" checked={transactionSettings.billingType === value} onChange={() => setTransactionSettings((p) => ({ ...p, billingType: value as TransactionSettingsState['billingType'] }))} />
                                    {label}
                                 </label>
                              ))}
                           </div>
                        </section>
                     </div>

                     {termsModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-lg bg-white shadow-xl">
                              <div className="flex items-center justify-between border-b px-6 py-4">
                                 <h3 className="text-xl font-bold">Terms & Conditions <span className="text-slate-400">ⓘ</span></h3>
                                 <div className="flex items-center gap-2">
                                    <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => setTermForm({ transactionType: 'SALE', title: '', content: '', isDefault: false })}>+ Add Terms & Condition</Button>
                                    <Button variant="ghost" size="icon" onClick={() => setTermsModalOpen(false)}><X className="h-5 w-5" /></Button>
                                 </div>
                              </div>
                              {termsBanner && (
                                 <div className="m-6 rounded-md bg-blue-50 p-4 text-sm text-blue-900">
                                    <div className="flex justify-between gap-4"><b>What has improved?</b><button onClick={() => setTermsBanner(false)}>×</button></div>
                                    <p>Now you can add multiple terms and conditions for a transaction type, and choose between them when creating a transaction.</p>
                                 </div>
                              )}
                              <div className="px-6 pb-6">
                                 <div className="grid grid-cols-[1fr_110px] border-b py-2 text-xs font-bold text-slate-500"><span>HEADER</span><span>ACTIONS</span></div>
                                 {TRANSACTION_TYPES.map(([type, label]) => (
                                    <div key={type} className="border-b">
                                       <div className="grid grid-cols-[1fr_110px] items-center py-3">
                                          <button className="text-left font-medium" onClick={() => setExpandedTerms((prev) => { const n = new Set(prev); n.has(type) ? n.delete(type) : n.add(type); return n; })}>{expandedTerms.has(type) ? '▾' : '▸'} {label}</button>
                                          <div className="flex gap-2">
                                             <Button variant="ghost" size="icon" onClick={() => setTermForm({ transactionType: type, title: '', content: '', isDefault: false })}><Pencil className="h-4 w-4" /></Button>
                                             <Button variant="ghost" size="icon" onClick={() => (termsGrouped[type] || []).forEach(deleteTerm)}><Trash2 className="h-4 w-4" /></Button>
                                          </div>
                                       </div>
                                       {expandedTerms.has(type) && (
                                          <div className="space-y-2 pb-3 pl-5">
                                             {(termsGrouped[type] || []).length === 0 && <p className="text-sm text-slate-500">No saved terms.</p>}
                                             {(termsGrouped[type] || []).map((entry) => (
                                                <div key={entry.id || entry.title} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2 text-sm">
                                                   <span>{entry.title}{entry.isDefault ? ' (Default)' : ''}</span>
                                                   <div><Button variant="ghost" size="sm" onClick={() => setTermForm(entry)}>Edit</Button><Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteTerm(entry)}>Delete</Button></div>
                                                </div>
                                             ))}
                                          </div>
                                       )}
                                    </div>
                                 ))}
                              </div>
                           </div>
                        </div>
                     )}

                     {termForm && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
                           <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
                              <h3 className="mb-4 text-lg font-bold">{termForm.id ? 'Edit' : 'Add'} Terms & Condition</h3>
                              <div className="space-y-3">
                                 <select className="h-10 w-full rounded-md border bg-white px-3" value={termForm.transactionType} onChange={(e) => setTermForm({ ...termForm, transactionType: e.target.value })}>{TRANSACTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                                 <Input maxLength={100} placeholder="Title" value={termForm.title} onChange={(e) => setTermForm({ ...termForm, title: e.target.value })} />
                                 <textarea className="min-h-32 w-full rounded-md border p-3 text-sm" maxLength={2000} placeholder="Content" value={termForm.content} onChange={(e) => setTermForm({ ...termForm, content: e.target.value })} />
                                 <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={termForm.isDefault} onChange={(e) => setTermForm({ ...termForm, isDefault: e.target.checked })} /> Is Default</label>
                              </div>
                              <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setTermForm(null)}>Cancel</Button><Button onClick={saveTerm}>Save</Button></div>
                           </div>
                        </div>
                     )}

                     {additionalFieldsOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-lg bg-white shadow-xl">
                              <div className="flex items-center justify-between border-b px-6 py-4"><h3 className="text-xl font-bold">Additional Fields Setup</h3><Button variant="ghost" size="icon" onClick={() => setAdditionalFieldsOpen(false)}><X className="h-5 w-5" /></Button></div>
                              <div className="grid gap-6 p-6 lg:grid-cols-[0.8fr_1.2fr]">
                                 <div className="space-y-5">
                                    <select className="h-10 w-full rounded-md border bg-white px-3" disabled><option>{company?.name || legalName || 'Current firm'}</option></select>
                                    {[
                                      ['Firm additional fields', [['firmField1Enabled', 'firmField1Label', 'Additional Field 1'], ['firmField2Enabled', 'firmField2Label', 'Additional Field 2']]],
                                      ['Transaction additional fields', [['txnField1Enabled', 'txnField1Label', 'Additional Field 1'], ['txnField2Enabled', 'txnField2Label', 'Additional Field 2'], ['txnField3Enabled', 'txnField3Label', 'Additional Field 3'], ['txnDateFieldEnabled', 'txnDateFieldLabel', 'Date Field']]],
                                    ].map(([title, rows]: any) => (
                                       <div key={title} className="space-y-2">
                                          <h4 className="font-semibold">{title} <span className="text-slate-400">?</span></h4>
                                          {rows.map(([enabledKey, labelKey, fallback]: string[]) => (
                                             <div key={enabledKey} className="rounded-md border p-3">
                                                <label className="flex items-center justify-between text-sm"><span>{fallback}</span><Switch checked={Boolean(additionalFields[enabledKey])} onCheckedChange={(v) => setAdditionalFields((p) => ({ ...p, [enabledKey]: v }))} /></label>
                                                {additionalFields[enabledKey] && <Input className="mt-2" maxLength={50} value={additionalFields[labelKey] || ''} onChange={(e) => setAdditionalFields((p) => ({ ...p, [labelKey]: e.target.value }))} placeholder={fallback} />}
                                             </div>
                                          ))}
                                       </div>
                                    ))}
                                    <div className="space-y-2"><h4 className="font-semibold">Show fields on</h4>{[['showOnSales', 'Sales'], ['showOnPurchase', 'Purchase'], ['showOnExpense', 'Expense'], ['showOnPaymentIn', 'Payment In']].map(([k, l]) => <label key={k} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{l}</span><Switch checked={Boolean(additionalFields[k])} onCheckedChange={(v) => setAdditionalFields((p) => ({ ...p, [k]: v }))} /></label>)}</div>
                                 </div>
                                 <div className="space-y-4">
                                    <select className="h-10 w-full max-w-xs rounded-md border bg-white px-3" value={additionalFields.invoiceTheme || 'THEME_1'} onChange={(e) => setAdditionalFields((p) => ({ ...p, invoiceTheme: e.target.value }))}>
                                       {['THEME_1', 'THEME_2', 'THEME_3', 'THEME_4', 'GST_THEME_1', 'GST_THEME_2', 'GST_THEME_3', 'GST_THEME_4', 'GST_THEME_5'].map((theme) => <option key={theme} value={theme}>{theme.replace(/_/g, ' ')}</option>)}
                                    </select>
                                    <div className="rounded-lg border bg-white p-5 shadow-sm">
                                       <div className="flex justify-between border-b pb-3"><div><h4 className="text-lg font-bold">{legalName || company?.name || 'Firm Name'}</h4><p className="text-xs text-slate-500">{registeredAddress || 'Firm address'} · GSTIN {gstin || '24AAAAA0000A1Z5'}</p></div><div className="h-12 w-20 rounded bg-indigo-100" /></div>
                                       <div className="grid grid-cols-2 gap-4 py-4 text-sm"><div><b>Bill To</b><p>Sample Party</p><p>Surat, Gujarat</p></div><div className="text-right"><b>Invoice</b><p>INV-1</p><p>27/05/2026</p></div></div>
                                       <div className="overflow-hidden rounded border text-xs"><div className="grid grid-cols-5 bg-indigo-500 p-2 font-bold text-white"><span>Item</span><span>HSN/SAC</span><span>Qty</span><span>Price</span><span>Amount</span></div><div className="grid grid-cols-5 p-2"><span>Sample Item</span><span>9983</span><span>1</span><span>₹500</span><span>₹590</span></div></div>
                                       <div className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><b>Bank Details</b><p>{bankName || 'Bank name'}</p></div><div className="text-right"><p>Total ₹590</p><p>Received ₹0</p><b>Balance ₹590</b></div></div>
                                       <div className="mt-5 text-right text-sm">Authorized Signatory</div>
                                    </div>
                                 </div>
                              </div>
                              <div className="flex justify-end border-t bg-slate-50 px-6 py-4"><Button onClick={saveAdditionalFields}>Done</Button></div>
                           </div>
                        </div>
                     )}

                     {transportationOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
                              <div className="flex items-center justify-between bg-blue-100 px-6 py-4"><h3 className="text-xl font-bold">Transportation Details</h3><Button variant="ghost" size="icon" onClick={() => setTransportationOpen(false)}><X className="h-5 w-5" /></Button></div>
                              <div className="space-y-4 p-6">
                                 {Array.from({ length: 6 }, (_, i) => i + 1).map((n) => (
                                    <div key={n} className="rounded-md border p-4">
                                       <label className="text-sm font-medium">Field {n} <span className="text-red-500">*</span></label>
                                       <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_90px]">
                                          <Input maxLength={50} value={transportation[`field${n}Label`] || ''} onChange={(e) => setTransportation((p) => ({ ...p, [`field${n}Label`]: e.target.value }))} />
                                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(transportation[`field${n}Enabled`])} onChange={(e) => setTransportation((p) => ({ ...p, [`field${n}Enabled`]: e.target.checked }))} /> Enable</label>
                                       </div>
                                       <label className="mt-3 flex items-center gap-3 text-sm">Show in print <Switch checked={transportation[`field${n}ShowInPrint`] !== false} onCheckedChange={(v) => setTransportation((p) => ({ ...p, [`field${n}ShowInPrint`]: v }))} /></label>
                                    </div>
                                 ))}
                              </div>
                              <div className="flex justify-end border-t bg-slate-50 px-6 py-4"><Button onClick={saveTransportation}>Done</Button></div>
                           </div>
                        </div>
                     )}

                     {chargesOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl">
                              <div className="flex items-center justify-between border-b px-6 py-4"><h3 className="text-xl font-bold">Additional Charges <span className="text-slate-400">ⓘ</span></h3><Button variant="ghost" size="icon" onClick={() => setChargesOpen(false)}><X className="h-5 w-5" /></Button></div>
                              <div className="space-y-5 p-6">
                                 <label className="flex items-center justify-between rounded-md border p-3 font-medium">Enable Additional Charges <Switch checked={Boolean(additionalCharges.masterEnabled)} onCheckedChange={(v) => setAdditionalCharges((p) => ({ ...p, masterEnabled: v }))} /></label>
                                 <div className="border-t border-dashed" />
                                 {[1, 2, 3].map((n) => (
                                    <div key={n} className={`rounded-md border p-4 ${additionalCharges.masterEnabled ? 'bg-white' : 'bg-slate-100 opacity-60'}`}>
                                       <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
                                          <label className="text-sm font-medium">Additional Charge{n} <span className="text-red-500">*</span><div className="mt-1 flex gap-2"><input type="checkbox" disabled={!additionalCharges.masterEnabled} checked={Boolean(additionalCharges[`charge${n}Enabled`])} onChange={(e) => setAdditionalCharges((p) => ({ ...p, [`charge${n}Enabled`]: e.target.checked }))} /><Input disabled={!additionalCharges.masterEnabled} maxLength={50} value={additionalCharges[`charge${n}Label`] || ''} onChange={(e) => setAdditionalCharges((p) => ({ ...p, [`charge${n}Label`]: e.target.value }))} /></div></label>
                                          <label className="text-sm font-medium">Default SAC<Input disabled={!additionalCharges.masterEnabled} className="mt-1" maxLength={6} value={additionalCharges[`charge${n}SacCode`] || ''} onChange={(e) => setAdditionalCharges((p) => ({ ...p, [`charge${n}SacCode`]: e.target.value.replace(/\D/g, '') }))} placeholder="Search SAC" /></label>
                                          <label className="text-sm font-medium">Tax Rate<select disabled={!additionalCharges.masterEnabled} className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={additionalCharges[`charge${n}TaxRate`] ?? ''} onChange={(e) => setAdditionalCharges((p) => ({ ...p, [`charge${n}TaxRate`]: e.target.value }))}><option value="">NONE</option>{[0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
                                       </div>
                                       <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>Can be changed during transaction</span><label className="flex items-center gap-2">Enable tax for {additionalCharges[`charge${n}Label`]} <Switch disabled={!additionalCharges.masterEnabled} checked={Boolean(additionalCharges[`charge${n}TaxEnabled`])} onCheckedChange={(v) => setAdditionalCharges((p) => ({ ...p, [`charge${n}TaxEnabled`]: v }))} /></label></div>
                                    </div>
                                 ))}
                              </div>
                              <div className="border-t bg-slate-50 px-6 py-4"><Button className="w-full bg-rose-600 hover:bg-rose-700" onClick={saveAdditionalCharges}>Save Details</Button></div>
                           </div>
                        </div>
                     )}
                  </CardContent>
               )}

               {tab === 'taxes' && (
                  <CardContent className="p-6 space-y-6">
                     <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                           <h2 className="text-xl font-bold">Taxes & GST</h2>
                           <p className="mt-1 text-sm text-slate-500">Manage GST switches, tax rates and GST groups used in invoices and item creation.</p>
                        </div>
                        <Button onClick={saveTaxSettings} loading={updateCompany.isPending}>Save Taxes & GST</Button>
                     </div>

                     <div className="grid gap-6 xl:grid-cols-[0.9fr_2fr]">
                        <section className="space-y-4">
                           <h3 className="border-b pb-3 text-lg font-bold">GST Settings</h3>
                           {[
                             ['enable_gst', 'Enable GST'],
                             ['enable_hsn_sac', 'Enable HSN/SAC Code'],
                             ['additional_cess_on_item', 'Additional Cess On Item'],
                             ['reverse_charge', 'Reverse Charge'],
                             ['enable_place_of_supply', 'Enable Place of Supply'],
                             ['composite_scheme', 'Composite Scheme'],
                             ['enable_tcs', 'Enable TCS'],
                             ['enable_tds', 'Enable TDS'],
                           ].map(([key, label]) => (
                              <label key={key} className="flex items-center gap-3 rounded-md border bg-white px-3 py-3 text-sm font-medium text-slate-700">
                                 <Switch checked={Boolean(taxSettings[key as TaxSettingsFlagKey])} onCheckedChange={(v) => updateTaxFlag(key as TaxSettingsFlagKey, v)} />
                                 {label}
                              </label>
                           ))}
                           <div className="rounded-lg border bg-white p-4">
                              <h4 className="font-semibold">Standard GST Rates</h4>
                              <p className="mt-1 text-xs text-slate-500">Only selected slabs appear in invoice item GST dropdowns.</p>
                              <div className="mt-4 grid grid-cols-3 gap-2">
                                 {STANDARD_GST_SLABS.map((rate) => (
                                    <label key={rate} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                                       <input
                                          type="checkbox"
                                          className="h-4 w-4 rounded border-slate-300"
                                          checked={taxSettings.enabledSlabs.includes(rate)}
                                          onChange={(e) => toggleEnabledGstSlab(rate, e.target.checked)}
                                       />
                                       {rate}%
                                    </label>
                                 ))}
                              </div>
                           </div>
                           <Button type="button" variant="outline" onClick={() => setTaxListOpen(true)}>Tax List &gt;</Button>
                        </section>

                        <section className="space-y-4">
                           <div className="rounded-lg border bg-white p-4">
                              <div className="flex items-start justify-between gap-3 border-b pb-3">
                                 <div>
                                    <h3 className="font-bold">Custom Tax Rates</h3>
                                    <p className="mt-1 text-xs text-slate-500">Add non-standard active rates to the invoice GST dropdown.</p>
                                 </div>
                                 <Button type="button" size="sm" onClick={() => setEditingCustomTaxRate({ id: `custom_tax_${Date.now()}`, name: '', rate: 4, isActive: true })}>+ Add Custom Rate</Button>
                              </div>
                              <div className="mt-3 overflow-hidden rounded-md border">
                                 <div className="grid grid-cols-[1fr_90px_80px_80px] bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                                    <span>Name</span><span className="text-right">Rate %</span><span className="text-center">Active</span><span className="text-right">Actions</span>
                                 </div>
                                 {taxSettings.customRates.length === 0 ? (
                                    <div className="px-3 py-6 text-center text-sm text-slate-500">No custom tax rates yet.</div>
                                 ) : taxSettings.customRates.map((row) => (
                                    <div key={row.id} className="grid grid-cols-[1fr_90px_80px_80px] items-center border-t px-3 py-2 text-sm">
                                       <span className="font-medium">{row.name}</span>
                                       <span className="text-right tabular-nums">{row.rate}</span>
                                       <span className="text-center"><Switch checked={row.isActive} onCheckedChange={(checked) => setTaxSettings((prev) => ({ ...prev, customRates: prev.customRates.map((r) => r.id === row.id ? { ...r, isActive: checked } : r) }))} /></span>
                                       <span className="flex justify-end gap-2">
                                          <button type="button" className="text-slate-400 hover:text-blue-600" onClick={() => setEditingCustomTaxRate(row)}><Pencil className="h-4 w-4" /></button>
                                          <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setTaxSettings((prev) => ({ ...prev, customRates: prev.customRates.map((r) => r.id === row.id ? { ...r, isActive: false } : r) }))}><Trash2 className="h-4 w-4" /></button>
                                       </span>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        </section>
                     </div>

                     {taxListOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
                              <div className="mb-5 flex items-center justify-between">
                                 <h3 className="text-xl font-bold">Tax List</h3>
                                 <Button variant="ghost" size="icon" onClick={() => setTaxListOpen(false)}><X className="h-5 w-5" /></Button>
                              </div>
                              <div className="grid gap-8 md:grid-cols-2">
                                 <div className="min-h-[520px]">
                                    <div className="mb-3 flex items-center justify-between border-b pb-3">
                                       <h4 className="text-lg font-bold">Tax Rates</h4>
                                       <Button type="button" variant="ghost" size="icon" onClick={() => setEditingTaxRate({ id: `tax_rate_${Date.now()}`, label: 'IGST@0%', type: 'IGST', rate: 0, active: true })}>
                                          <Plus className="h-5 w-5" />
                                       </Button>
                                    </div>
                                    <div className="max-h-[60vh] overflow-auto pr-2">
                                       {taxSettings.rates.filter((row) => row.active !== false).map((row) => (
                                          <div key={row.id} className="grid grid-cols-[1fr_80px_36px_36px] items-center gap-2 border-b py-3 text-sm">
                                             <span className="font-medium">{row.label}</span>
                                             <span className="text-right tabular-nums">{row.rate}</span>
                                             <button type="button" className="text-slate-400 hover:text-blue-600" onClick={() => setEditingTaxRate(row)}><Pencil className="h-4 w-4" /></button>
                                             <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setTaxSettings((prev) => ({ ...prev, rates: prev.rates.map((r) => r.id === row.id ? { ...r, active: false } : r) }))}><Trash2 className="h-4 w-4" /></button>
                                          </div>
                                       ))}
                                    </div>
                                 </div>
                                 <div className="min-h-[520px]">
                                    <div className="mb-3 flex items-center justify-between border-b pb-3">
                                       <h4 className="text-lg font-bold">Tax Group</h4>
                                       <Button type="button" variant="ghost" size="icon" onClick={() => setEditingTaxGroup({ id: `tax_group_${Date.now()}`, label: 'GST@0%', rate: 0, components: [{ type: 'SGST', rate: 0 }, { type: 'CGST', rate: 0 }], active: true })}>
                                          <Plus className="h-5 w-5" />
                                       </Button>
                                    </div>
                                    <div className="max-h-[60vh] overflow-auto pr-2">
                                       {taxSettings.groups.filter((row) => row.active !== false).map((row) => (
                                          <div key={row.id} className="border-b py-4">
                                             <div className="grid grid-cols-[1fr_36px_36px] items-center gap-2 text-sm">
                                                <span className="font-medium">{row.label}</span>
                                                <button type="button" className="text-slate-400 hover:text-blue-600" onClick={() => setEditingTaxGroup(row)}><Pencil className="h-4 w-4" /></button>
                                                <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setTaxSettings((prev) => ({ ...prev, groups: prev.groups.map((g) => g.id === row.id ? { ...g, active: false } : g) }))}><Trash2 className="h-4 w-4" /></button>
                                             </div>
                                             <div className="mt-2 flex flex-wrap gap-5 text-xs font-medium text-blue-900">
                                                {row.components.map((part, idx) => <span key={`${part.type}-${idx}`}>{part.type}@{part.rate}%</span>)}
                                             </div>
                                          </div>
                                       ))}
                                    </div>
                                 </div>
                              </div>
                           </div>
                        </div>
                     )}

                     {editingCustomTaxRate && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                              <h3 className="mb-4 text-lg font-bold">Custom Tax Rate</h3>
                              <div className="space-y-3">
                                 <label className="block text-sm font-medium">Name
                                    <Input className="mt-1" value={editingCustomTaxRate.name} onChange={(e) => setEditingCustomTaxRate({ ...editingCustomTaxRate, name: e.target.value })} placeholder="Special Rate" />
                                 </label>
                                 <label className="block text-sm font-medium">Rate %
                                    <Input className="mt-1" type="number" min={0.01} max={100} step="0.01" value={editingCustomTaxRate.rate} onChange={(e) => setEditingCustomTaxRate({ ...editingCustomTaxRate, rate: Number(e.target.value) })} />
                                 </label>
                                 <label className="flex items-center gap-3 text-sm font-medium">
                                    <Switch checked={editingCustomTaxRate.isActive} onCheckedChange={(checked) => setEditingCustomTaxRate({ ...editingCustomTaxRate, isActive: checked })} />
                                    Active
                                 </label>
                              </div>
                              <div className="mt-5 flex justify-end gap-2">
                                 <Button variant="outline" onClick={() => setEditingCustomTaxRate(null)}>Cancel</Button>
                                 <Button onClick={saveCustomTaxRateRow}>Save</Button>
                              </div>
                           </div>
                        </div>
                     )}

                     {editingTaxRate && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                              <h3 className="mb-4 text-lg font-bold">Tax Rate</h3>
                              <div className="space-y-3">
                                 <Input value={editingTaxRate.label} onChange={(e) => setEditingTaxRate({ ...editingTaxRate, label: e.target.value })} placeholder="IGST@18%" />
                                 <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={editingTaxRate.type} onChange={(e) => setEditingTaxRate({ ...editingTaxRate, type: e.target.value as TaxRateRow['type'] })}>
                                    <option value="IGST">IGST</option><option value="CGST">CGST</option><option value="SGST">SGST</option><option value="CESS">CESS</option>
                                 </select>
                                 <Input type="number" step="0.001" value={editingTaxRate.rate} onChange={(e) => setEditingTaxRate({ ...editingTaxRate, rate: Number(e.target.value) })} />
                              </div>
                              <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditingTaxRate(null)}>Cancel</Button><Button onClick={saveTaxRateRow}>Save</Button></div>
                           </div>
                        </div>
                     )}

                     {editingTaxGroup && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                           <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                              <h3 className="mb-4 text-lg font-bold">Tax Group</h3>
                              <div className="space-y-3">
                                 <Input value={editingTaxGroup.label} onChange={(e) => setEditingTaxGroup({ ...editingTaxGroup, label: e.target.value })} placeholder="GST@18%" />
                                 <Input type="number" step="0.001" value={editingTaxGroup.rate} onChange={(e) => {
                                    const rate = Number(e.target.value) || 0;
                                    const half = Number((rate / 2).toFixed(3));
                                    setEditingTaxGroup({ ...editingTaxGroup, rate, components: [{ type: 'SGST', rate: half }, { type: 'CGST', rate: half }] });
                                 }} />
                                 <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                                    Components: {editingTaxGroup.components.map((part) => `${part.type}@${part.rate}%`).join(' + ')}
                                 </div>
                              </div>
                              <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditingTaxGroup(null)}>Cancel</Button><Button onClick={saveTaxGroupRow}>Save</Button></div>
                           </div>
                        </div>
                     )}
                  </CardContent>
               )}

               {tab === 'invoices' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Invoice Configuration</h2>
                     <div className="space-y-4">
                        <div>
                           <label className="text-sm font-medium text-slate-700">Invoice Prefix Sequence</label>
                          <Input value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} className="mt-1 max-w-xs font-mono" />
                           <p className="text-xs text-slate-500 mt-1">Example output: INV/MUM/25-26/0001</p>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Default Terms & Conditions</label>
                          <textarea className="w-full mt-1 border rounded-md p-3 h-32 text-sm" value={invoiceTerms} onChange={(e) => setInvoiceTerms(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 gap-4 max-w-2xl">
                           <div>
                              <label className="text-sm font-medium text-slate-700">Default invoice layout</label>
                              <div className="mt-1">
                                <PrintLayoutPicker
                                  value={normalizeInvoiceThemeId(invoiceTemplate)}
                                  onChange={(layoutId) => {
                                    setInvoiceTemplate(layoutId);
                                    setDocumentTheme(layoutId);
                                    setDocumentPrimaryColor(printSettings.layout_colors?.[layoutId] || DEFAULT_PRINT_LAYOUT_COLORS[layoutId] || documentPrimaryColor || '#4F46E5');
                                  }}
                                />
                              </div>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Brand color</label>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {PRINT_COLOR_PALETTE.map((color) => {
                                  const checked = documentPrimaryColor.toLowerCase() === color.value.toLowerCase();
                                  return (
                                    <button
                                      key={color.value}
                                      type="button"
                                      onClick={() => setDocumentPrimaryColor(color.value)}
                                      className={`flex h-8 items-center gap-2 rounded-md border px-2 text-xs font-medium ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                                      title={color.name}
                                    >
                                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: color.value }} />
                                      {color.name}
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="mt-1 flex gap-2">
                                 <input type="color" className="h-10 w-12 rounded border bg-white p-1" value={documentPrimaryColor} onChange={(e) => setDocumentPrimaryColor(e.target.value)} />
                                 <Input value={documentPrimaryColor} onChange={(e) => setDocumentPrimaryColor(e.target.value)} className="font-mono" />
                              </div>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-4">
                           <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                 <h3 className="font-semibold">Reference Invoice Template Fields</h3>
                                 <p className="mt-1 text-xs text-slate-500">
                                    These fields appear on sale invoices only when the Reference Tax + E-Way Theme is selected. Disabled fields stay out of the entry form and print blank in the fixed grid.
                                 </p>
                              </div>
                              <Button type="button" variant="outline" size="sm" onClick={() => setInvoiceTemplate('reference-tax-eway-theme')}>
                                 Select reference theme
                              </Button>
                           </div>
                           <div className="grid gap-3 lg:grid-cols-2">
                              {REFERENCE_INVOICE_FIELDS.map(([key, label]) => (
                                 <label key={key} className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                    <span className="min-w-0">{label}</span>
                                    <Switch checked={printSettings.reference_invoice.fields[key] !== false} onCheckedChange={(checked) => toggleReferenceInvoiceField(key, checked)} />
                                 </label>
                              ))}
                           </div>
                           <div className="grid gap-3 lg:grid-cols-2">
                              <label className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                 <span>
                                    Print item custom fields inside Description of Goods
                                    <span className="mt-0.5 block text-xs text-slate-500">Keeps the exact fixed columns while showing extra item values.</span>
                                 </span>
                                 <Switch checked={printSettings.reference_invoice.show_item_custom_fields} onCheckedChange={(checked) => updateReferenceInvoiceSetting('show_item_custom_fields', checked)} />
                              </label>
                              <label className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                 <span>
                                    Include e-Way Bill appendix
                                    <span className="mt-0.5 block text-xs text-slate-500">Prints the second page when e-Way Bill details are present.</span>
                                 </span>
                                 <Switch checked={printSettings.reference_invoice.include_eway_appendix} onCheckedChange={(checked) => updateReferenceInvoiceSetting('include_eway_appendix', checked)} />
                              </label>
                           </div>
                           <div className="grid gap-3 lg:grid-cols-2">
                              <label className="text-sm font-medium text-slate-700">Declaration
                                 <textarea
                                    className="mt-1 min-h-[88px] w-full rounded-md border bg-white p-3 text-sm"
                                    value={printSettings.reference_invoice.declaration}
                                    onChange={(e) => updateReferenceInvoiceSetting('declaration', e.target.value)}
                                    placeholder="Optional declaration printed above terms"
                                 />
                              </label>
                              <label className="text-sm font-medium text-slate-700">Reference Terms & Conditions
                                 <textarea
                                    className="mt-1 min-h-[88px] w-full rounded-md border bg-white p-3 text-sm"
                                    value={printSettings.reference_invoice.terms}
                                    onChange={(e) => updateReferenceInvoiceSetting('terms', e.target.value)}
                                 />
                              </label>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-2xl">
                           <div>
                              <h3 className="font-semibold">Currencies</h3>
                              <p className="text-xs text-slate-500">Enable the currencies users can select while entering prices. Existing records remain in their saved currency.</p>
                           </div>
                           <div className="grid gap-3 sm:grid-cols-2">
                              {SUPPORTED_CURRENCIES.map((currency) => (
                                 <div key={currency.code} className="rounded-lg border bg-slate-50 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                       <div>
                                          <p className="text-sm font-medium text-slate-800">{currency.label}</p>
                                          <p className="mt-1 text-xs text-slate-500">Symbol: {currency.symbol}</p>
                                       </div>
                                       <Switch
                                          checked={enabledCurrencies.includes(currency.code)}
                                          disabled={currency.code === 'INR'}
                                          onCheckedChange={(checked) => toggleCurrency(currency.code, checked)}
                                       />
                                    </div>
                                 </div>
                              ))}
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Default currency for new transactions</label>
                              <select
                                 className="mt-1 h-10 w-full max-w-xs rounded-md border bg-white px-3 text-sm"
                                 value={defaultCurrency}
                                 onChange={(e) => setDefaultCurrency(normalizeCurrencyCode(e.target.value))}
                              >
                                 {SUPPORTED_CURRENCIES.filter((c) => enabledCurrencies.includes(c.code)).map((currency) => (
                                    <option key={currency.code} value={currency.code}>{currency.label}</option>
                                 ))}
                              </select>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-md">
                           <h3 className="font-semibold">Delivery Challan</h3>
                           <div className="rounded-lg border bg-slate-50 p-4">
                              <div className="flex items-start justify-between gap-4">
                                 <div>
                                    <p className="text-sm font-medium text-slate-800">Show pricing details</p>
                                    <p className="mt-1 text-xs text-slate-500">When enabled, delivery challans include reference rate, discount and amount only. GST/tax is never shown on challans.</p>
                                 </div>
                                 <Switch checked={deliveryChallanShowPricing} onCheckedChange={setDeliveryChallanShowPricing} />
                              </div>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3">
                           <div className="flex items-center justify-between gap-3">
                              <div>
                                 <h3 className="font-semibold">Sales Invoice Custom Fields</h3>
                                 <p className="text-xs text-slate-500">Add item-row fields once here. They appear as columns on every sales invoice line and can be selected in Bulk Invoice columns.</p>
                              </div>
                              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addSalesCustomField}>
                                 <Plus className="w-4 h-4" /> Add field
                              </Button>
                           </div>
                           <div className="space-y-2">
                              {salesCustomFields.length === 0 && (
                                 <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                    No custom invoice fields yet.
                                 </div>
                              )}
                              {salesCustomFields.map((field, idx) => (
                                 <div key={idx} className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.4fr_1fr_90px_90px_44px]">
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Label</label>
                                       <Input className="mt-1" value={field.label} onChange={(e) => updateSalesCustomField(idx, { label: e.target.value })} />
                                    </div>
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Field key</label>
                                       <Input className="mt-1 font-mono text-xs" value={field.id} onChange={(e) => updateSalesCustomField(idx, { id: e.target.value })} />
                                    </div>
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Type</label>
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" value={field.type} onChange={(e) => updateSalesCustomField(idx, { type: e.target.value as SalesCustomFieldDef['type'] })}>
                                          <option value="text">Text</option>
                                          <option value="number">Number</option>
                                          <option value="date">Date</option>
                                       </select>
                                    </div>
                                    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs text-slate-600 lg:mt-5">
                                       Required
                                       <Switch checked={field.required} onCheckedChange={(v) => updateSalesCustomField(idx, { required: v })} />
                                    </label>
                                    <Button type="button" variant="ghost" size="icon" className="text-red-600 hover:text-red-700 lg:mt-5" onClick={() => removeSalesCustomField(idx)}>
                                       <Trash2 className="w-4 h-4" />
                                    </Button>
                                 </div>
                              ))}
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-md">
                           <h3 className="font-semibold">Printer</h3>
                           <label className="text-sm font-medium text-slate-700">Printer type</label>
                           <select
                              className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm"
                              value={printerType}
                              onChange={(e) => setPrinterType(e.target.value as typeof printerType)}
                           >
                              <option value="a4">A4 Laser</option>
                              <option value="thermal80">80mm Thermal</option>
                              <option value="thermal58">58mm Thermal</option>
                           </select>
                           <div className="flex gap-2">
                              <Button type="button" variant="outline" onClick={savePrinter}>Save printer preference</Button>
                              <Button type="button" variant="secondary" onClick={testPrint} loading={testPrintRunning}>Test print</Button>
                           </div>
                           <p className="text-xs text-slate-500">Saved in this browser (localStorage). POS uses it after checkout.</p>
                        </div>
                       <Button onClick={saveInvoicePreferences} loading={updateCompany.isPending}>Save Preferences</Button>
                     </div>
                  </CardContent>
               )}

               {tab === 'items' && (
                  <CardContent className="p-6 space-y-6">
                     <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                           <h2 className="text-xl font-bold">Item Settings</h2>
                           <p className="mt-1 text-sm text-slate-500">Configure item master fields without changing existing item records.</p>
                        </div>
                        <Button className="mt-1" onClick={applyItemSchema} loading={updateCompany.isPending}>Save Item Settings</Button>
                     </div>

                     <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr_1fr]">
                        <div className="space-y-4">
                           <h3 className="border-b pb-3 font-semibold">Item Settings</h3>
                           {[
                              ['enable_item', 'Enable Item'],
                              ['barcode_scan', 'Barcode Scan'],
                              ['stock_maintenance', 'Stock Maintenance'],
                              ['manufacturing', 'Manufacturing'],
                              ['show_low_stock_dialog', 'Show Low Stock Dialog'],
                              ['items_unit', 'Items Unit'],
                              ['default_unit', 'Default Unit'],
                              ['item_category', 'Item Category'],
                              ['party_wise_item_rate', 'Party Wise Item Rate'],
                              ['description', 'Description'],
                              ['item_wise_tax', 'Item wise Tax'],
                              ['item_wise_discount', 'Item wise Discount'],
                              ['update_sale_price_from_transaction', 'Update Sale Price from Transaction'],
                              ['wholesale_price', 'Wholesale Price'],
                           ].map(([key, label]) => (
                              <label key={key} className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                                 <span>{label}</span>
                                 <Switch checked={Boolean(itemSettings[key as keyof ItemSettingsState])} onCheckedChange={(v) => updateItemSetting(key as keyof ItemSettingsState, v as never)} />
                              </label>
                           ))}
                           <div className="grid gap-3 rounded-md border bg-white p-3 sm:grid-cols-2">
                              <div>
                                 <label className="text-xs font-medium text-slate-600">What do you sell?</label>
                                 <select className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" value={itemSettings.sell_type} onChange={(e) => updateItemSetting('sell_type', e.target.value as ItemSettingsState['sell_type'])}>
                                    <option value="both">Product/Service</option>
                                    <option value="product">Product</option>
                                    <option value="service">Service</option>
                                 </select>
                              </div>
                              <div>
                                 <label className="text-xs font-medium text-slate-600">Quantity decimal places</label>
                                 <Input type="number" min={0} max={4} className="mt-1" value={itemSettings.quantity_decimal_places} onChange={(e) => updateItemSetting('quantity_decimal_places', Math.max(0, Math.min(4, Number(e.target.value) || 0)))} />
                              </div>
                           </div>
                           <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div>
                                 <label className="text-sm font-medium text-slate-700">Default Item Name</label>
                                 <Input className="mt-1" value={itemTerminologySingular} onChange={(e) => setItemTerminologySingular(e.target.value)} placeholder="Item, Product, Service" />
                              </div>
                              <div>
                                 <label className="text-sm font-medium text-slate-700">Plural label</label>
                                 <Input className="mt-1" value={itemTerminologyPlural} onChange={(e) => setItemTerminologyPlural(e.target.value)} />
                              </div>
                           </div>
                        </div>

                        <div className="space-y-4">
                           <h3 className="border-b pb-3 font-semibold">Additional Item Fields</h3>
                           <div className="rounded-md border bg-white p-4">
                              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                                 <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                                    MRP / Price
                                    <Switch checked={itemSettings.mrp} onCheckedChange={(v) => updateItemSetting('mrp', v)} />
                                 </label>
                                 <Input disabled={!itemSettings.mrp} placeholder="MRP" />
                              </div>
                              <label className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                                 Calculate Tax based on MRP
                                 <Switch checked={itemSettings.calculate_tax_based_on_mrp} onCheckedChange={(v) => updateItemSetting('calculate_tax_based_on_mrp', v)} />
                              </label>
                           </div>
                           <div className="rounded-md border bg-white p-4">
                              <h4 className="mb-3 font-semibold text-slate-600">Serial No. Tracking</h4>
                              <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                                 Serial No. / IMEI No.
                                 <Switch checked={itemSettings.serial_tracking} onCheckedChange={(v) => updateItemSetting('serial_tracking', v)} />
                              </label>
                           </div>
                           <div className="rounded-md border bg-white p-4">
                              <h4 className="mb-3 font-semibold text-slate-600">Batch Tracking</h4>
                              {[
                                 ['batch_tracking', 'Batch No.'],
                                 ['exp_date', 'Exp Date'],
                                 ['mfg_date', 'Mfg Date'],
                                 ['model_no', 'Model No.'],
                                 ['size', 'Size'],
                              ].map(([key, label]) => (
                                 <label key={key} className="mb-2 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm last:mb-0">
                                    {label}
                                    <Switch checked={Boolean(itemSettings[key as keyof ItemSettingsState])} onCheckedChange={(v) => updateItemSetting(key as keyof ItemSettingsState, v as never)} />
                                 </label>
                              ))}
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Primary Default GST %</label>
                              <Input type="number" min={0} max={100} step={1} className="mt-1 max-w-xs" value={defaultGstRate} onChange={(e) => setDefaultGstRate(e.target.value)} placeholder="18" />
                           </div>
                        </div>

                        <div className="space-y-4">
                           <div className="flex items-center justify-between gap-3 border-b pb-3">
                              <h3 className="font-semibold">Item Custom Fields</h3>
                              <Button type="button" variant="outline" size="sm" onClick={() => setItemCustomModalOpen(true)}>
                                 Add Custom Fields
                              </Button>
                           </div>
                           <div className="space-y-2">
                              {itemCustomFields.length === 0 ? (
                                 <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                    No item custom fields configured yet.
                                 </div>
                              ) : itemCustomFields.map((field, idx) => (
                                 <div key={`${field.id}-${idx}`} className="rounded-lg border bg-white p-3">
                                    <div className="flex items-start justify-between gap-3">
                                       <div>
                                          <p className="font-medium">{field.label || 'Untitled field'}</p>
                                          <p className="text-xs text-slate-500">{field.id} · {field.type}</p>
                                       </div>
                                       <div className="flex items-center gap-2">
                                          <Switch checked={field.enabled} onCheckedChange={(v) => updateItemCustomField(idx, { enabled: v })} />
                                          <Button type="button" variant="ghost" size="icon" className="text-red-600 hover:text-red-700" onClick={() => removeItemCustomField(idx)}>
                                             <Trash2 className="h-4 w-4" />
                                          </Button>
                                       </div>
                                    </div>
                                    <label className="mt-3 flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                       Show in print / invoice item rows
                                       <Switch checked={field.show_in_print} onCheckedChange={(v) => updateItemCustomField(idx, { show_in_print: v })} />
                                    </label>
                                 </div>
                              ))}
                           </div>
                        </div>
                     </div>
                  </CardContent>
               )}

               {tab === 'data' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Data Management Flow</h2>
                     <input
                       ref={importFileRef}
                       type="file"
                       accept=".csv,.xlsx,.xls,.json"
                       className="hidden"
                       onChange={(e) => previewImportFile(e.target.files?.[0])}
                     />
                    <input
                      ref={tallyImportFileRef}
                      type="file"
                      accept=".json,.xml"
                      className="hidden"
                      onChange={(e) => importTally(e.target.files?.[0])}
                    />
                     <div className="grid md:grid-cols-2 gap-6">
                        <Card className="border-indigo-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-3"><Upload className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Import Legacy Data</h3>
                              <p className="text-sm text-slate-500 mb-4">Upload Item Masters or Customer ledgers via structured CSV.</p>
                              <div className="w-full space-y-2">
                                <Button variant="outline" className="w-full" onClick={downloadItemsTemplate} loading={templateDownloading}>Download item template</Button>
                                <Button variant="outline" className="w-full" onClick={() => importFileRef.current?.click()} disabled={importing}>
                                  {importing && !importPreview ? 'Reading file…' : 'Choose file to preview'}
                                </Button>
                              </div>
                              {importPreview?.preview && importPreview.preview.length > 0 && (
                                <div className="mt-4 text-left w-full rounded-lg border bg-white p-3 max-h-56 overflow-y-auto">
                                  <p className="text-xs font-semibold text-slate-700 mb-2">
                                    Preview: {importPreview.valid ?? importPreview.preview.length} valid row(s)
                                    {importPreview.invalid ? `, ${importPreview.invalid} invalid` : ''}
                                  </p>
                                  <ul className="text-xs text-slate-600 space-y-1">
                                    {importPreview.preview.slice(0, 12).map((p) => (
                                      <li key={p.row}>
                                        Row {p.row}: {(p.data as { name?: string })?.name || '—'}
                                      </li>
                                    ))}
                                  </ul>
                                  {importPreview.preview.length > 12 && (
                                    <p className="text-xs text-slate-400 mt-1">Showing first 12 rows…</p>
                                  )}
                                  <div className="flex gap-2 mt-3">
                                    <Button size="sm" onClick={confirmImportFile} loading={importing}>
                                      Import valid rows
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => { setImportPreview(null); pendingImportFile.current = null; }}>
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              )}
                           </CardContent>
                        </Card>
                        <Card className="border-emerald-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-3"><Database className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Export JSON / Tally DB</h3>
                              <p className="text-sm text-slate-500 mb-4">Push localized records to universal schemas.</p>
                              <Button variant="outline" className="w-full border-emerald-600 text-emerald-700" onClick={dumpData} loading={dataDumping}>Dump Data</Button>
                           </CardContent>
                        </Card>
                        <Card className="border-violet-100 shadow-sm">
                          <CardContent className="p-6 flex flex-col items-center text-center">
                            <div className="w-12 h-12 bg-violet-50 rounded-full flex items-center justify-center text-violet-600 mb-3"><FileText className="w-6 h-6"/></div>
                            <h3 className="font-bold text-slate-900 mb-1">Tally Data Bridge</h3>
                            <p className="text-sm text-slate-500 mb-4">Export entire company data for Tally and import Tally JSON/XML back.</p>
                            <div className="w-full space-y-2">
                              <Button variant="outline" className="w-full" onClick={() => exportTally('json')} loading={tallyExporting}>
                                <Download className="w-4 h-4 mr-2" /> Export Tally JSON
                              </Button>
                              <Button variant="outline" className="w-full" onClick={() => exportTally('xml')} loading={tallyExporting}>
                                <Download className="w-4 h-4 mr-2" /> Export Tally XML
                              </Button>
                              <Button variant="outline" className="w-full" onClick={() => tallyImportFileRef.current?.click()} disabled={tallyImporting}>
                                <Upload className="w-4 h-4 mr-2" /> {tallyImporting ? 'Importing...' : 'Import from Tally'}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                     </div>
                  </CardContent>
               )}

               {tab === 'danger' && (
                  <CardContent className="p-6 space-y-6">
                     <div className="flex items-center gap-2 text-red-600 mb-2">
                        <AlertCircle className="w-6 h-6"/>
                        <h2 className="text-xl font-bold">Danger Zone</h2>
                     </div>
                     <p className="text-slate-600 text-sm max-w-xl">
                        This marks the company as closed. Users will not be able to sign in to this workspace again. Operational data remains in the database for compliance backups — confirm with your IT policy before proceeding.
                     </p>
                     
                     <div className="bg-red-50 p-6 rounded-lg border border-red-200 mt-6 max-w-xl">
                        <h3 className="font-semibold text-red-900 mb-2">Are you fully sure?</h3>
                        <p className="text-sm text-red-700 mb-4">Type <strong>DELETE-MY-COMPANY</strong> exactly to confirm.</p>
                        <Input value={deleteConf} onChange={e => setDeleteConf(e.target.value)} className="border-red-300 focus-visible:ring-red-500 mb-4 bg-white" />
                        <Button
                           variant="destructive"
                           disabled={deleteConf !== 'DELETE-MY-COMPANY'}
                           loading={deleteWorkspace.isPending}
                           className="w-full gap-2"
                           onClick={() => deleteWorkspace.mutate()}
                        >
                           <Power className="w-4 h-4"/> Close workspace
                        </Button>
                     </div>
                  </CardContent>
               )}
            </Card>
         </div>
         {itemCustomModalOpen && (
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4">
               <div className="mt-8 max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b px-6 py-4">
                     <h2 className="text-2xl font-bold">Add Custom Fields</h2>
                     <Button type="button" variant="ghost" size="icon" onClick={() => setItemCustomModalOpen(false)}>
                        <X className="h-5 w-5" />
                     </Button>
                  </div>
                  <div className="max-h-[64vh] overflow-y-auto p-6">
                     <div className="grid gap-5 md:grid-cols-2">
                        {itemCustomFields.map((field, idx) => (
                           <div key={`${field.id}-${idx}`} className="grid grid-cols-[28px_1fr] gap-3 rounded-lg border p-4">
                              <div className="pt-8">
                                 <Switch checked={field.enabled} onCheckedChange={(v) => updateItemCustomField(idx, { enabled: v })} />
                              </div>
                              <div className="space-y-3">
                                 <div>
                                    <label className="text-sm font-medium text-slate-600">Custom Field {idx + 1}</label>
                                    <Input className="mt-1" placeholder={idx === 0 ? 'E.g. Colour' : idx === 1 ? 'E.g. Material' : 'E.g. Brand'} value={field.label} onChange={(e) => updateItemCustomField(idx, { label: e.target.value })} />
                                 </div>
                                 <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                                    <div>
                                       <label className="text-xs font-medium text-slate-500">Field key</label>
                                       <Input className="mt-1 font-mono text-xs" value={field.id} onChange={(e) => updateItemCustomField(idx, { id: e.target.value })} />
                                    </div>
                                    <div>
                                       <label className="text-xs font-medium text-slate-500">Type</label>
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" value={field.type} onChange={(e) => updateItemCustomField(idx, { type: e.target.value as ItemCustomFieldDef['type'] })}>
                                          <option value="text">Text</option>
                                          <option value="number">Number</option>
                                          <option value="date">Date</option>
                                       </select>
                                    </div>
                                 </div>
                                 <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                    Show in print
                                    <Switch checked={field.show_in_print} onCheckedChange={(v) => updateItemCustomField(idx, { show_in_print: v })} />
                                 </label>
                              </div>
                           </div>
                        ))}
                        {itemCustomFields.length === 0 && (
                           <div className="rounded-lg border border-dashed p-6 text-sm text-slate-500 md:col-span-2">
                              No custom fields yet. Add fields like Colour, Material, Mfg. Date, Exp. Date, Size, or Brand.
                           </div>
                        )}
                     </div>
                  </div>
                  <div className="flex justify-end gap-3 border-t bg-slate-50 px-6 py-4">
                     <Button type="button" variant="outline" onClick={addItemCustomField}>Add field</Button>
                     <Button type="button" variant="secondary" onClick={() => setItemCustomModalOpen(false)}>Cancel</Button>
                     <Button type="button" onClick={async () => { await applyItemSchema(); setItemCustomModalOpen(false); }} loading={updateCompany.isPending}>Save</Button>
                  </div>
               </div>
            </div>
         )}
      </div>
    </div>
  );
}
