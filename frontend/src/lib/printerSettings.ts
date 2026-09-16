import {
  LEGACY_STORAGE_KEYS,
  readStorageWithLegacy,
  STORAGE_KEYS,
  writeStorageWithLegacyCleanup,
} from '@/lib/storageKeys';

export type PrinterDocumentType = 'default' | 'invoice' | 'purchase' | 'pos' | 'barcode';
export type PrinterPaperSize = 'A4' | 'A5' | '80mm' | '58mm';

export interface WorkstationPrinterSettings {
  directPrinting: boolean;
  defaultPrinter: string;
  invoicePrinter: string;
  purchasePrinter: string;
  posPrinter: string;
  barcodePrinter: string;
  paperSize: PrinterPaperSize;
  copies: number;
  autoPrint: boolean;
}

export const DEFAULT_PRINTER_SETTINGS: WorkstationPrinterSettings = {
  directPrinting: false,
  defaultPrinter: '',
  invoicePrinter: '',
  purchasePrinter: '',
  posPrinter: '',
  barcodePrinter: '',
  paperSize: 'A4',
  copies: 1,
  autoPrint: false,
};

function normalize(value: Partial<WorkstationPrinterSettings>): WorkstationPrinterSettings {
  const paperSize = ['A4', 'A5', '80mm', '58mm'].includes(String(value.paperSize))
    ? value.paperSize as PrinterPaperSize
    : 'A4';
  return {
    ...DEFAULT_PRINTER_SETTINGS,
    ...value,
    directPrinting: value.directPrinting === true,
    autoPrint: value.autoPrint === true,
    copies: Math.max(1, Math.min(10, Number(value.copies) || 1)),
    paperSize,
  };
}

export function readPrinterSettings(): WorkstationPrinterSettings {
  const raw = readStorageWithLegacy(STORAGE_KEYS.printerSettings, LEGACY_STORAGE_KEYS.printerSettings);
  if (raw) {
    try {
      return normalize(JSON.parse(raw));
    } catch {
      // Fall through to legacy values.
    }
  }
  const legacyPrinter = readStorageWithLegacy(
    STORAGE_KEYS.directPrinterName,
    LEGACY_STORAGE_KEYS.directPrinterName,
  ) || '';
  const legacyDirect = readStorageWithLegacy(
    STORAGE_KEYS.directThermalPrint,
    LEGACY_STORAGE_KEYS.directThermalPrint,
  ) === 'true';
  return normalize({
    directPrinting: legacyDirect,
    autoPrint: legacyDirect,
    defaultPrinter: legacyPrinter,
    posPrinter: legacyPrinter,
    barcodePrinter: legacyPrinter,
    paperSize: '80mm',
  });
}

export function savePrinterSettings(settings: WorkstationPrinterSettings) {
  const normalized = normalize(settings);
  writeStorageWithLegacyCleanup(
    STORAGE_KEYS.printerSettings,
    JSON.stringify(normalized),
    LEGACY_STORAGE_KEYS.printerSettings,
  );
  // Keep legacy consumers working while all print surfaces move to the shared settings.
  writeStorageWithLegacyCleanup(
    STORAGE_KEYS.directPrinterName,
    normalized.posPrinter || normalized.defaultPrinter,
    LEGACY_STORAGE_KEYS.directPrinterName,
  );
  writeStorageWithLegacyCleanup(
    STORAGE_KEYS.directThermalPrint,
    String(normalized.directPrinting),
    LEGACY_STORAGE_KEYS.directThermalPrint,
  );
}

export function resolveConfiguredPrinter(
  settings: WorkstationPrinterSettings,
  documentType: PrinterDocumentType,
) {
  if (documentType === 'invoice') return settings.invoicePrinter || settings.defaultPrinter;
  if (documentType === 'purchase') return settings.purchasePrinter || settings.defaultPrinter;
  if (documentType === 'pos') return settings.posPrinter || settings.defaultPrinter;
  if (documentType === 'barcode') return settings.barcodePrinter || settings.defaultPrinter;
  return settings.defaultPrinter;
}
