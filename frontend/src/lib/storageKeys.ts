const LEGACY_PREFIX = 'bizflow';
const APP_PREFIX = 'microtechnique';

export const STORAGE_KEYS = {
  accessToken: `${APP_PREFIX}_access_token`,
  refreshToken: `${APP_PREFIX}_refresh_token`,
  registrantToken: `${APP_PREFIX}_registrant_token`,
  authStore: `${APP_PREFIX}-auth`,
  registrantStore: `${APP_PREFIX}-registrant`,
  printerType: `${APP_PREFIX}_printer_type`,
  directPrinterName: `${APP_PREFIX}_direct_printer_name`,
  directThermalPrint: `${APP_PREFIX}_direct_thermal_print`,
  customUpiQr: `${APP_PREFIX}_custom_upi_qr`,
  skipInvoicePreview: `${APP_PREFIX}_skip_invoice_preview_after_save`,
  drafts: {
    salesInvoice: `${APP_PREFIX}:draft:sales-invoice`,
    purchaseBill: `${APP_PREFIX}:draft:purchase-bill`,
    purchaseOrder: `${APP_PREFIX}:draft:purchase-order`,
    quotation: `${APP_PREFIX}:draft:quotation`,
    expense: `${APP_PREFIX}:draft:expense`,
    jobWorkChallan: `${APP_PREFIX}:draft:job-work-challan`,
  },
} as const;

export const LEGACY_STORAGE_KEYS = {
  accessToken: `${LEGACY_PREFIX}_access_token`,
  refreshToken: `${LEGACY_PREFIX}_refresh_token`,
  registrantToken: `${LEGACY_PREFIX}_registrant_token`,
  authStore: `${LEGACY_PREFIX}-auth`,
  registrantStore: `${LEGACY_PREFIX}-registrant`,
  printerType: `${LEGACY_PREFIX}_printer_type`,
  directPrinterName: `${LEGACY_PREFIX}_direct_printer_name`,
  directThermalPrint: `${LEGACY_PREFIX}_direct_thermal_print`,
  customUpiQr: `${LEGACY_PREFIX}_custom_upi_qr`,
  skipInvoicePreview: `${LEGACY_PREFIX}_skip_invoice_preview_after_save`,
  drafts: {
    salesInvoice: `${LEGACY_PREFIX}:draft:sales-invoice`,
    purchaseBill: `${LEGACY_PREFIX}:draft:purchase-bill`,
    purchaseOrder: `${LEGACY_PREFIX}:draft:purchase-order`,
    quotation: `${LEGACY_PREFIX}:draft:quotation`,
    expense: `${LEGACY_PREFIX}:draft:expense`,
    jobWorkChallan: `${LEGACY_PREFIX}:draft:job-work-challan`,
  },
} as const;

export function readStorageWithLegacy(key: string, legacyKey?: string): string | null {
  const current = localStorage.getItem(key);
  if (current != null || !legacyKey) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy != null) localStorage.setItem(key, legacy);
  return legacy;
}

export function migrateStorageKey(key: string, legacyKey?: string) {
  if (!legacyKey || localStorage.getItem(key) != null) return;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy != null) localStorage.setItem(key, legacy);
}

export function writeStorageWithLegacyCleanup(key: string, value: string, legacyKey?: string) {
  localStorage.setItem(key, value);
  if (legacyKey) localStorage.removeItem(legacyKey);
}

export function removeStorageWithLegacy(key: string, legacyKey?: string) {
  localStorage.removeItem(key);
  if (legacyKey) localStorage.removeItem(legacyKey);
}
