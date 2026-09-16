import { useEffect, useState } from 'react';
import * as qz from 'qz-tray';
import { Printer, RefreshCw, Save, TestTube2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DEFAULT_PRINTER_SETTINGS,
  readPrinterSettings,
  resolveConfiguredPrinter,
  savePrinterSettings,
  type WorkstationPrinterSettings,
} from '@/lib/printerSettings';

const PRINTER_FIELDS = [
  ['defaultPrinter', 'Default printer', 'Used whenever a document-specific printer is not selected.'],
  ['invoicePrinter', 'Sales invoice printer', 'A4/A5 sales invoices and invoice previews.'],
  ['purchasePrinter', 'Purchase bill printer', 'Supplier bills and purchase PDFs.'],
  ['posPrinter', 'POS / thermal printer', 'Receipts created from POS billing.'],
  ['barcodePrinter', 'Barcode label printer', 'Labels printed from Generate Barcode.'],
] as const;

export function DirectPrinterSettings() {
  const [settings, setSettings] = useState<WorkstationPrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [printers, setPrinters] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => setSettings(readPrinterSettings()), []);

  const update = <K extends keyof WorkstationPrinterSettings>(key: K, value: WorkstationPrinterSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const connect = async () => {
    try {
      setConnecting(true);
      if (!qz.websocket.isActive()) await qz.websocket.connect();
      const found = await qz.printers.find();
      const systemDefault = await qz.printers.getDefault().catch(() => '');
      setPrinters(found);
      setSettings((current) => ({
        ...current,
        defaultPrinter: current.defaultPrinter || systemDefault || found[0] || '',
      }));
      if (!found.length) toast.error('QZ Tray connected, but no installed printers were found');
      else toast.success(`${found.length} printer${found.length === 1 ? '' : 's'} loaded`);
    } catch {
      toast.error('Could not connect to QZ Tray. Install and start QZ Tray first.');
    } finally {
      setConnecting(false);
    }
  };

  const save = () => {
    if (settings.directPrinting && !settings.defaultPrinter && !settings.posPrinter) {
      toast.error('Connect QZ Tray and select at least a default or POS printer');
      return;
    }
    savePrinterSettings(settings);
    toast.success('Printer settings saved for this computer');
  };

  const testPrint = async () => {
    const printer = resolveConfiguredPrinter(settings, 'default');
    if (!printer) {
      toast.error('Select a default printer first');
      return;
    }
    try {
      setTesting(true);
      if (!qz.websocket.isActive()) await qz.websocket.connect();
      await qz.print(qz.configs.create(printer, { copies: 1 }), [{
        type: 'pixel', format: 'html', flavor: 'plain',
        data: '<div style="font:16px Arial;padding:24px"><strong>Microtechnique Accounts</strong><p>Printer test successful</p></div>',
      }]);
      toast.success(`Test page sent to ${printer}`);
    } catch (error: any) {
      toast.error(error?.message || 'Test print failed. Check QZ Tray and the selected printer.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-md border bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Printer className="h-4 w-4" /> Printer Settings</div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Printer names are saved on this computer because installed printers differ between workstations. QZ Tray enables direct printing; browser print remains available as a fallback.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">Direct print</span>
          <Switch checked={settings.directPrinting} onCheckedChange={(value) => update('directPrinting', value)} aria-label="Enable direct printing" />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {PRINTER_FIELDS.map(([key, label, help]) => (
          <label key={key} className="min-w-0 space-y-1">
            <span className="text-xs font-medium text-slate-700">{label}</span>
            <select value={settings[key]} onChange={(event) => update(key, event.target.value)} disabled={!settings.directPrinting} className="h-10 w-full min-w-0 rounded-md border bg-white px-3 text-sm disabled:opacity-50">
              <option value="">Use system/default printer</option>
              {settings[key] && !printers.includes(settings[key]) && <option value={settings[key]}>{settings[key]} (saved)</option>}
              {printers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <span className="block text-[11px] leading-4 text-slate-500">{help}</span>
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-700">Paper size</span>
          <select value={settings.paperSize} onChange={(event) => update('paperSize', event.target.value as WorkstationPrinterSettings['paperSize'])} className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="A4">A4</option><option value="A5">A5</option><option value="80mm">80mm thermal</option><option value="58mm">58mm thermal</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-700">Number of copies</span>
          <input type="number" min={1} max={10} value={settings.copies} onChange={(event) => update('copies', Math.max(1, Math.min(10, Number(event.target.value) || 1)))} className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-medium text-slate-700">Auto print POS bill</span>
          <div className="flex h-10 items-center justify-between rounded-md border bg-white px-3">
            <span className="text-xs text-slate-500">Print after checkout</span>
            <Switch checked={settings.autoPrint} onCheckedChange={(value) => update('autoPrint', value)} aria-label="Auto print POS bills" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <a href="https://qz.io/download/" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Download QZ Tray</a>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={connect} loading={connecting}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Load printers</Button>
          <Button type="button" size="sm" variant="outline" onClick={testPrint} loading={testing}><TestTube2 className="mr-1.5 h-3.5 w-3.5" />Test print</Button>
          <Button type="button" size="sm" onClick={save}><Save className="mr-1.5 h-3.5 w-3.5" />Save Printer Settings</Button>
        </div>
      </div>
    </section>
  );
}
