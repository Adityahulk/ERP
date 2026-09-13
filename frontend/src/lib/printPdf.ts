import * as qz from 'qz-tray';
import {
  LEGACY_STORAGE_KEYS,
  readStorageWithLegacy,
  STORAGE_KEYS,
} from '@/lib/storageKeys';

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
  } = {},
): Promise<'direct' | 'browser'> {
  const directSetting = readStorageWithLegacy(
    STORAGE_KEYS.directThermalPrint,
    LEGACY_STORAGE_KEYS.directThermalPrint,
  ) === 'true';
  const printerName = options.printerName || readStorageWithLegacy(
    STORAGE_KEYS.directPrinterName,
    LEGACY_STORAGE_KEYS.directPrinterName,
  ) || '';

  if ((options.direct ?? directSetting) && printerName) {
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
    await qz.print(
      qz.configs.create(printerName, { copies: Math.max(1, Math.min(10, Number(options.copies) || 1)) }),
      printData,
    );
    return 'direct';
  }

  browserPrintPdf(blob);
  return 'browser';
}
