export const INVOICE_PRINT_THEMES = [
  'business-theme-1',
  'business-theme-2',
  'business-theme-3',
  'business-theme-4',
  'landscape-theme-1',
  'landscape-theme-2',
  'gst-theme-1',
  'gst-theme-2',
  'gst-theme-3',
  'gst-theme-4',
  'gst-theme-5',
  'tally-theme-1',
] as const;

export type InvoicePrintTheme = (typeof INVOICE_PRINT_THEMES)[number];

export const BUSINESS_PRINT_THEMES = [
  'business-theme-1',
  'business-theme-2',
  'business-theme-3',
  'business-theme-4',
] as const;

export const LEGACY_PRINT_THEME_MAP: Record<string, InvoicePrintTheme> = {
  standard: 'business-theme-1',
  'detailed-tax-invoice': 'business-theme-1',
  simple: 'business-theme-2',
  'professional-header': 'business-theme-2',
  performa: 'business-theme-3',
  'centered-proforma': 'business-theme-3',
  monochrome: 'business-theme-4',
  'black-white-standard': 'business-theme-4',
  classic: 'business-theme-1',
  modern: 'business-theme-1',
  compact: 'business-theme-1',
  executive: 'business-theme-1',
  sunrise: 'business-theme-1',
  forest: 'business-theme-1',
  midnight: 'business-theme-1',
  royal: 'business-theme-1',
  slate: 'business-theme-1',
  retail: 'business-theme-1',
  minimal: 'business-theme-1',
  micro_theme_1: 'gst-theme-1',
  micro_theme_2: 'gst-theme-2',
  micro_theme_3: 'gst-theme-3',
  micro_theme_4: 'gst-theme-4',
  micro_theme_5: 'gst-theme-5',
  landscape_theme_1: 'landscape-theme-1',
  landscape_theme_2: 'landscape-theme-2',
  gst_theme_1: 'gst-theme-1',
  gst_theme_2: 'gst-theme-2',
  gst_theme_3: 'gst-theme-3',
  gst_theme_4: 'gst-theme-4',
  gst_theme_5: 'gst-theme-5',
  gst_theme_6: 'gst-theme-5',
  gst_theme_7: 'gst-theme-5',
  gst_theme_8: 'gst-theme-5',
  gst_theme_9: 'gst-theme-5',
  gst_theme_10: 'tally-theme-1',
  delivery_theme: 'tally-theme-1',
  double_divine: 'tally-theme-1',
};

export const PRINT_THEME_TO_TEMPLATE_KIND: Record<InvoicePrintTheme, 'standard' | 'simple' | 'performa' | 'monochrome'> = {
  'business-theme-1': 'standard',
  'business-theme-2': 'simple',
  'business-theme-3': 'performa',
  'business-theme-4': 'monochrome',
  'landscape-theme-1': 'standard',
  'landscape-theme-2': 'standard',
  'gst-theme-1': 'standard',
  'gst-theme-2': 'standard',
  'gst-theme-3': 'performa',
  'gst-theme-4': 'monochrome',
  'gst-theme-5': 'standard',
  'tally-theme-1': 'monochrome',
};

export const PRINT_THEME_TO_PALETTE: Record<InvoicePrintTheme, string> = {
  'business-theme-1': 'classic',
  'business-theme-2': 'modern',
  'business-theme-3': 'compact',
  'business-theme-4': 'minimal',
  'landscape-theme-1': 'modern',
  'landscape-theme-2': 'retail',
  'gst-theme-1': 'royal',
  'gst-theme-2': 'modern',
  'gst-theme-3': 'executive',
  'gst-theme-4': 'slate',
  'gst-theme-5': 'forest',
  'tally-theme-1': 'minimal',
};

export function isInvoicePrintTheme(value: unknown): value is InvoicePrintTheme {
  return INVOICE_PRINT_THEMES.includes(String(value || '') as InvoicePrintTheme);
}

export function normalizeInvoicePrintTheme(value: unknown, fallback: InvoicePrintTheme = 'business-theme-1'): InvoicePrintTheme {
  const raw = String(value || '').trim();
  if (isInvoicePrintTheme(raw)) return raw;
  return LEGACY_PRINT_THEME_MAP[raw] || fallback;
}

export function isRemovedDocumentTheme(value: unknown): boolean {
  return [
    'classic', 'modern', 'compact', 'executive', 'sunrise',
    'forest', 'midnight', 'royal', 'slate', 'retail', 'minimal',
  ].includes(String(value || '').trim());
}
