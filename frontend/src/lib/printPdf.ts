import * as qz from 'qz-tray';
import {
  LEGACY_STORAGE_KEYS,
  readStorageWithLegacy,
  STORAGE_KEYS,
} from '@/lib/storageKeys';
import {
  readPrinterSettings,
  resolveConfiguredPrinter,
  type PrinterDocumentType,
  type PrinterPaperSize,
} from '@/lib/printerSettings';

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = String(reader.result || '');
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function browserPrintPdf(blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.title = 'Print document';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.src = url;
  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }, 250);
  };
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    iframe.remove();
    window.URL.revokeObjectURL(url);
  }, 60_000);
}

export async function printPdfBlob(
  blob: Blob,
  options: {
    direct?: boolean;
    printerName?: string;
    copies?: number;
    autoCut?: boolean;
    openCashDrawer?: boolean;
    documentType?: PrinterDocumentType;
    paperSize?: PrinterPaperSize;
  } = {},
): Promise<'direct' | 'browser'> {
  const workstation = readPrinterSettings();
  const directSetting = readStorageWithLegacy(
    STORAGE_KEYS.directThermalPrint,
    LEGACY_STORAGE_KEYS.directThermalPrint,
  ) === 'true';
  const legacyPrinterName = readStorageWithLegacy(
    STORAGE_KEYS.directPrinterName,
    LEGACY_STORAGE_KEYS.directPrinterName,
  ) || '';
  const printerName = options.printerName
    || resolveConfiguredPrinter(workstation, options.documentType || 'default')
    || legacyPrinterName;
  const direct = options.direct ?? workstation.directPrinting ?? directSetting;
  const copies = options.copies ?? workstation.copies;
  const paperSize = options.paperSize || workstation.paperSize;

  if (direct && printerName) {
    if (!qz.websocket.isActive()) await qz.websocket.connect();
    const data = await blobToBase64(blob);
    const printData: any[] = [];
    if (options.openCashDrawer) {
      printData.push({ type: 'raw', format: 'command', flavor: 'plain', data: '\x1B\x70\x00\x19\xFA' });
    }
    printData.push({ type: 'pixel', format: 'pdf', flavor: 'base64', data });
    if (options.autoCut) {
      printData.push({ type: 'raw', format: 'command', flavor: 'plain', data: '\x1D\x56\x00' });
    }
    const size = paperSize === '80mm'
      ? { width: 80, height: 297 }
      : paperSize === '58mm'
        ? { width: 58, height: 297 }
        : paperSize;
    await qz.print(
      qz.configs.create(printerName, {
        copies: Math.max(1, Math.min(10, Number(copies) || 1)),
        size,
        units: paperSize.endsWith('mm') ? 'mm' : undefined,
      }),
      printData,
    );
    return 'direct';
  }

  browserPrintPdf(blob);
  return 'browser';
}

export async function printPdfBlobs(
  blobs: Blob[],
  options: Parameters<typeof printPdfBlob>[1] = {},
): Promise<'direct' | 'browser'> {
  if (!blobs.length) throw new Error('Select at least one bill to print');
  const workstation = readPrinterSettings();
  const printerName = options.printerName
    || resolveConfiguredPrinter(workstation, options.documentType || 'default');
  const direct = options.direct ?? workstation.directPrinting;
  if (direct && printerName) {
    if (!qz.websocket.isActive()) await qz.websocket.connect();
    const data = await Promise.all(blobs.map(blobToBase64));
    await qz.print(
      qz.configs.create(printerName, {
        copies: Math.max(1, Math.min(10, Number(options.copies ?? workstation.copies) || 1)),
      }),
      data.map((pdf) => ({ type: 'pixel', format: 'pdf', flavor: 'base64', data: pdf })),
    );
    return 'direct';
  }
  // Browser security requires one dialog per PDF. Open them in order as the safe fallback.
  blobs.forEach((blob, index) => window.setTimeout(() => browserPrintPdf(blob), index * 350));
  return 'browser';
}
