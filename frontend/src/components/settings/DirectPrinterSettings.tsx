import { useEffect, useState } from 'react';
import * as qz from 'qz-tray';
import { Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  LEGACY_STORAGE_KEYS,
  readStorageWithLegacy,
  STORAGE_KEYS,
  writeStorageWithLegacyCleanup,
} from '@/lib/storageKeys';

export function DirectPrinterSettings() {
  const [enabled, setEnabled] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setEnabled(readStorageWithLegacy(
      STORAGE_KEYS.directThermalPrint,
      LEGACY_STORAGE_KEYS.directThermalPrint,
    ) === 'true');
    setPrinterName(readStorageWithLegacy(
      STORAGE_KEYS.directPrinterName,
      LEGACY_STORAGE_KEYS.directPrinterName,
    ) || '');
  }, []);

  const connect = async () => {
    try {
      setConnecting(true);
      if (!qz.websocket.isActive()) await qz.websocket.connect();
      const found = await qz.printers.find();
      setPrinters(found);
      setPrinterName((current) => current || found[0] || '');
      if (!found.length) toast.error('QZ Tray connected, but no printers were found');
      else toast.success('Printers loaded from QZ Tray');
    } catch {
      toast.error('Could not connect to QZ Tray. Install and start QZ Tray first.');
    } finally {
      setConnecting(false);
    }
  };

  const save = () => {
    if (enabled && !printerName) {
      toast.error('Connect QZ Tray and select a printer first');
      return;
    }
    writeStorageWithLegacyCleanup(
      STORAGE_KEYS.directThermalPrint,
      String(enabled),
      LEGACY_STORAGE_KEYS.directThermalPrint,
    );
    writeStorageWithLegacyCleanup(
      STORAGE_KEYS.directPrinterName,
      printerName,
      LEGACY_STORAGE_KEYS.directPrinterName,
    );
    toast.success('Direct thermal printing preference saved');
  };

  return (
    <div className="space-y-3 rounded-md border bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Printer className="h-4 w-4" />
            Direct POS printing
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Sends the receipt to the selected system printer after checkout. QZ Tray must be installed and running on this billing computer.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable direct POS printing" />
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <select
          value={printerName}
          onChange={(event) => setPrinterName(event.target.value)}
          disabled={!enabled}
          className="h-10 min-w-0 rounded-md border bg-white px-3 text-sm disabled:opacity-50"
        >
          <option value={printerName}>{printerName || 'Select a system printer'}</option>
          {printers.filter((name) => name !== printerName).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={connect} loading={connecting}>
          Connect QZ Tray
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href="https://qz.io/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Download QZ Tray
        </a>
        <Button type="button" size="sm" onClick={save}>Save direct printer</Button>
      </div>
    </div>
  );
}
