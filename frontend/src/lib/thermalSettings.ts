export type ThermalPageSize = '2_inch' | '3_inch' | '4_inch' | 'custom';

export type ThermalPrintSettings = {
  make_default: boolean;
  page_size: ThermalPageSize;
  custom_page_size: number;
  printing_type: 'text' | 'image';
  text_styling_bold: boolean;
  auto_cut_paper: boolean;
  open_cash_drawer: boolean;
  extra_bottom_lines: number;
  number_of_copies: number;
  show_seller_name: boolean;
  seller_name: string;
  show_seller_phone: boolean;
  seller_phone: string;
  show_seller_address: boolean;
  seller_address: string;
  show_date_time: boolean;
  show_bill_no: boolean;
  show_logo: boolean;
  show_party: boolean;
  show_item_amount: boolean;
  show_item_rate: boolean;
  show_subtotal: boolean;
  show_discount: boolean;
  show_tax_columns: boolean;
  show_round_off: boolean;
  show_payment_details: boolean;
  barcode_or_qr: 'none' | 'barcode' | 'qr';
  return_policy: string;
  show_footer_thank_you: boolean;
  cashier_show_rate: boolean;
  cashier_show_discount: boolean;
  cashier_show_tax: boolean;
  cashier_show_stock: boolean;
  cashier_show_line_total: boolean;
  cashier_show_bill_breakdown: boolean;
};

export const DEFAULT_THERMAL_SETTINGS: ThermalPrintSettings = {
  make_default: false,
  page_size: '3_inch',
  custom_page_size: 48,
  printing_type: 'text',
  text_styling_bold: true,
  auto_cut_paper: false,
  open_cash_drawer: false,
  extra_bottom_lines: 0,
  number_of_copies: 1,
  show_seller_name: true,
  seller_name: '',
  show_seller_phone: true,
  seller_phone: '',
  show_seller_address: true,
  seller_address: '',
  show_date_time: true,
  show_bill_no: true,
  show_logo: true,
  show_party: true,
  show_item_amount: true,
  show_item_rate: false,
  show_subtotal: true,
  show_discount: true,
  show_tax_columns: false,
  show_round_off: true,
  show_payment_details: true,
  barcode_or_qr: 'barcode',
  return_policy: 'Items can be returned within 7 days in original condition.',
  show_footer_thank_you: true,
  cashier_show_rate: true,
  cashier_show_discount: true,
  cashier_show_tax: true,
  cashier_show_stock: true,
  cashier_show_line_total: true,
  cashier_show_bill_breakdown: true,
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeThermalSettings(value: unknown): ThermalPrintSettings {
  const raw = asObject(value);
  const pageSize = String(raw.page_size || '');
  const printingType = String(raw.printing_type || '');
  const codeMode = String(raw.barcode_or_qr || '');
  return {
    make_default: raw.make_default === true,
    page_size: ['2_inch', '3_inch', '4_inch', 'custom'].includes(pageSize) ? pageSize as ThermalPageSize : '3_inch',
    custom_page_size: Math.max(40, Math.min(100, Number(raw.custom_page_size ?? 48) || 48)),
    printing_type: printingType === 'image' ? 'image' : 'text',
    text_styling_bold: raw.text_styling_bold !== false,
    auto_cut_paper: raw.auto_cut_paper === true,
    open_cash_drawer: raw.open_cash_drawer === true,
    extra_bottom_lines: Math.max(0, Math.min(20, Number(raw.extra_bottom_lines ?? 0) || 0)),
    number_of_copies: Math.max(1, Math.min(10, Number(raw.number_of_copies ?? 1) || 1)),
    show_seller_name: raw.show_seller_name !== false,
    seller_name: String(raw.seller_name ?? ''),
    show_seller_phone: raw.show_seller_phone !== false,
    seller_phone: String(raw.seller_phone ?? ''),
    show_seller_address: raw.show_seller_address !== false,
    seller_address: String(raw.seller_address ?? ''),
    show_date_time: raw.show_date_time !== false,
    show_bill_no: raw.show_bill_no !== false,
    show_logo: raw.show_logo !== false,
    show_party: raw.show_party !== false,
    show_item_amount: raw.show_item_amount !== false,
    show_item_rate: raw.show_item_rate === true,
    show_subtotal: raw.show_subtotal !== false,
    show_discount: raw.show_discount !== false,
    show_tax_columns: raw.show_tax_columns === true,
    show_round_off: raw.show_round_off !== false,
    show_payment_details: raw.show_payment_details !== false,
    barcode_or_qr: ['none', 'barcode', 'qr'].includes(codeMode) ? codeMode as ThermalPrintSettings['barcode_or_qr'] : 'barcode',
    return_policy: String(raw.return_policy ?? DEFAULT_THERMAL_SETTINGS.return_policy),
    show_footer_thank_you: raw.show_footer_thank_you !== false,
    cashier_show_rate: raw.cashier_show_rate !== false,
    cashier_show_discount: raw.cashier_show_discount !== false,
    cashier_show_tax: raw.cashier_show_tax !== false,
    cashier_show_stock: raw.cashier_show_stock !== false,
    cashier_show_line_total: raw.cashier_show_line_total !== false,
    cashier_show_bill_breakdown: raw.cashier_show_bill_breakdown !== false,
  };
}

export function thermalWidthMm(value: unknown): number {
  const settings = normalizeThermalSettings(value);
  if (settings.page_size === '2_inch') return 58;
  if (settings.page_size === '4_inch') return 100;
  if (settings.page_size === 'custom') return settings.custom_page_size;
  return 80;
}

export function legacyPrinterTypeForThermal(value: unknown): 'thermal58' | 'thermal80' {
  return thermalWidthMm(value) <= 58 ? 'thermal58' : 'thermal80';
}
