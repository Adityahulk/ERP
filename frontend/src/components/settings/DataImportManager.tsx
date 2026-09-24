import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';

type ImportKind = 'items' | 'parties' | 'purchases' | 'expenses' | 'stock' | 'cash';

type PreviewRow = {
  row: number;
  key?: string;
  data: Record<string, unknown>;
  warnings?: string[];
};

type ErrorRow = PreviewRow & { errors: string[] };

type ImportPreview = {
  type?: string;
  total: number;
  valid: number;
  invalid: number;
  preview: PreviewRow[];
  errors: ErrorRow[];
  note?: string;
};

const importKinds: Array<{
  id: ImportKind;
  name: string;
  description: string;
  prerequisite?: string;
}> = [
  { id: 'items', name: 'Item Masters', description: 'Products, services, prices, GST, barcodes and opening item stock.' },
  { id: 'parties', name: 'Parties', description: 'Customers and suppliers with addresses, GSTIN and opening balances.' },
  { id: 'purchases', name: 'Purchase Bills', description: 'Supplier bills with multiple line items, GST and inventory updates.', prerequisite: 'Import parties and item masters first.' },
  { id: 'expenses', name: 'Expenses', description: 'Expense vouchers with GST, vendor, payment mode and accounting entries.' },
  { id: 'stock', name: 'Stock / Godowns', description: 'Absolute opening stock by item and godown. Missing godowns are created.', prerequisite: 'Import item masters first.' },
  { id: 'cash', name: 'Cash / Bank Balances', description: 'Opening cash and bank balances with accounting entries.' },
];

const invalidationKeys: Record<ImportKind, string[][]> = {
  items: [['items'], ['stock']],
  parties: [['parties'], ['accounting']],
  purchases: [['purchase-invoices'], ['stock'], ['parties'], ['accounting']],
  expenses: [['expenses'], ['accounting'], ['cash-bank']],
  stock: [['stock'], ['godowns'], ['items']],
  cash: [['cash-bank'], ['accounting']],
};

function responseData(response: any) {
  return response?.data?.data ?? response?.data ?? response;
}

function fileNameFromHeader(header: unknown, fallback: string) {
  const match = String(header || '').match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
  return match ? decodeURIComponent(match[1]) : fallback;
}

function csvCell(value: unknown) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function previewSummary(row: PreviewRow) {
  if (row.key) return row.key;
  const data = row.data || {};
  const first = Object.values(data).find((value) => typeof value === 'string' && value.trim());
  return String(first || `Row ${row.row}`);
}

export function DataImportManager() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<ImportKind>('items');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [godownId, setGodownId] = useState('');

  const { data: godowns = [] } = useQuery({
    queryKey: ['godowns', 'data-import'],
    queryFn: async () => (await api.get('/godowns')).data?.data || [],
  });

  useEffect(() => {
    if (!godownId && godowns.length) {
      const preferred = godowns.find((entry: any) => entry.is_default) || godowns[0];
      setGodownId(preferred?.id || '');
    }
  }, [godownId, godowns]);

  const selected = importKinds.find((entry) => entry.id === kind)!;

  const resetFile = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const switchKind = (next: ImportKind) => {
    setKind(next);
    resetFile();
  };

  const endpoint = (action?: 'confirm') => {
    const base = kind === 'items' ? '/items/bulk-import' : `/data-import/${kind}`;
    return action ? `${base}?action=confirm` : base;
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const url = kind === 'items' ? '/items/import-template' : `/data-import/template/${kind}`;
      const response = await api.get(url, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileNameFromHeader(
        response.headers?.['content-disposition'],
        `microtechnique_${kind}_import_template.xlsx`,
      );
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      toast.success(`${selected.name} template downloaded`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Template download failed');
    } finally {
      setDownloading(false);
    }
  };

  const readFile = async (nextFile?: File) => {
    if (!nextFile) return;
    setFile(nextFile);
    setPreview(null);
    setReading(true);
    try {
      const form = new FormData();
      form.append('file', nextFile);
      const response = await api.post(endpoint(), form);
      const data = responseData(response);
      setPreview({
        total: Number(data.total || 0),
        valid: Number(data.valid ?? data.preview?.length ?? 0),
        invalid: Number(data.invalid ?? data.errors?.length ?? 0),
        preview: data.preview || [],
        errors: data.errors || [],
        note: data.note,
        type: data.type,
      });
      if ((data.errors?.length || 0) > 0) {
        toast(`${data.errors.length} row(s) need attention. Exact reasons are shown below.`);
      } else {
        toast.success(`${data.preview?.length || 0} valid row(s) ready to import`);
      }
    } catch (err: any) {
      setPreview(null);
      toast.error(err.response?.data?.error || 'Could not read this file');
    } finally {
      setReading(false);
    }
  };

  const confirmImport = async () => {
    if (!file || !preview?.valid) return;
    if (kind === 'items' && !godownId) {
      toast.error('Select a godown for item opening stock');
      return;
    }
    setConfirming(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (kind === 'items' && godownId) form.append('godown_id', godownId);
      const response = await api.post(endpoint('confirm'), form);
      const data = responseData(response);
      toast.success(`Import complete: ${Number(data.inserted || 0)} record(s) saved${data.skipped ? `, ${data.skipped} skipped` : ''}`);
      for (const queryKey of invalidationKeys[kind]) {
        queryClient.invalidateQueries({ queryKey });
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      resetFile();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setConfirming(false);
    }
  };

  const downloadErrors = () => {
    if (!preview?.errors.length) return;
    const csv = [
      ['Row', 'Record', 'Validation reasons', 'Original / normalized data'].map(csvCell).join(','),
      ...preview.errors.map((entry) => [
        entry.row,
        entry.key || '',
        entry.errors.join('; '),
        JSON.stringify(entry.data || {}),
      ].map(csvCell).join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${kind}-import-errors.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Structured Data Import</h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose the data type first. Every dataset has its own template and validation rules.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {importKinds.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => switchKind(entry.id)}
            className={`min-h-[88px] rounded-md border p-3 text-left transition-colors ${kind === entry.id ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-2">
              <FileSpreadsheet className={`h-4 w-4 ${kind === entry.id ? 'text-indigo-600' : 'text-slate-500'}`} />
              <span className="font-semibold text-slate-900">{entry.name}</span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">{entry.description}</p>
          </button>
        ))}
      </div>

      <div className="rounded-md border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">Import {selected.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{selected.description}</p>
            {selected.prerequisite && <p className="mt-1 text-xs font-medium text-amber-700">{selected.prerequisite}</p>}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} loading={downloading}>
            <Download className="mr-2 h-4 w-4" /> Download template
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.json"
          className="hidden"
          onChange={(event) => readFile(event.target.files?.[0])}
        />
        {kind === 'items' && (
          <label className="mt-4 block max-w-md text-sm font-medium text-slate-700">
            Opening-stock godown
            <select
              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              value={godownId}
              onChange={(event) => setGodownId(event.target.value)}
            >
              <option value="">Select godown</option>
              {godowns.map((entry: any) => (
                <option key={entry.id} value={entry.id}>{entry.name}{entry.code ? ` (${entry.code})` : ''}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500">Used only for rows containing Opening Stock.</span>
          </label>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={reading || confirming}
          className="mt-4 flex min-h-[104px] w-full items-center justify-center gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-sm text-slate-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload className="h-5 w-5 text-indigo-600" />
          <span>{reading ? 'Reading and validating file...' : file ? `Selected: ${file.name}` : 'Choose XLSX, XLS, CSV or JSON file'}</span>
        </button>

        {preview && (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-slate-50 p-3"><p className="text-xs text-slate-500">Total records</p><p className="mt-1 text-xl font-bold">{preview.total}</p></div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Valid</p><p className="mt-1 text-xl font-bold text-emerald-800">{preview.valid}</p></div>
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3"><p className="text-xs text-rose-700">Invalid</p><p className="mt-1 text-xl font-bold text-rose-800">{preview.invalid}</p></div>
            </div>

            {preview.note && (
              <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" /> {preview.note}
              </div>
            )}

            {preview.preview.length > 0 && (
              <div className="rounded-md border">
                <div className="flex items-center gap-2 border-b bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> Ready to import
                </div>
                <div className="max-h-48 overflow-y-auto divide-y">
                  {preview.preview.slice(0, 100).map((entry) => (
                    <div key={`${entry.row}-${entry.key}`} className="px-3 py-2 text-xs">
                      <div className="flex gap-3"><span className="w-14 shrink-0 text-slate-400">Row {entry.row}</span><span className="font-medium text-slate-700">{previewSummary(entry)}</span></div>
                      {entry.warnings?.map((warning) => <p key={warning} className="ml-[68px] mt-1 text-amber-700">{warning}</p>)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.errors.length > 0 && (
              <div className="rounded-md border border-rose-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-800"><AlertCircle className="h-4 w-4" /> Rows requiring correction</div>
                  <Button type="button" variant="outline" size="sm" onClick={downloadErrors}><Download className="mr-2 h-3.5 w-3.5" /> Download errors</Button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-rose-100">
                  {preview.errors.map((entry) => (
                    <div key={`${entry.row}-${entry.key}`} className="px-3 py-2.5 text-xs">
                      <p className="font-semibold text-slate-800">Row {entry.row}: {previewSummary(entry)}</p>
                      <ul className="mt-1 space-y-0.5 text-rose-700">
                        {entry.errors.map((reason) => <li key={reason}>- {reason}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={resetFile}>Cancel</Button>
              <Button type="button" onClick={confirmImport} disabled={!preview.valid} loading={confirming}>
                Import {preview.valid} valid record{preview.valid === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-900">Projects data</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Job Work tracks material challans and production work, not generic projects. Projects should not be imported into Job Work until a dedicated project schema is approved.</p>
        </div>
        <div className="rounded-md border bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-900">Partner profit</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">There is no Partner / Commission ledger module yet. Import is intentionally unavailable to prevent financial data from entering the wrong accounts.</p>
        </div>
        <div className="rounded-md border bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-900">Dashboard</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">No dashboard file is needed. Dashboard values refresh automatically from imported masters, purchases, expenses, stock and balances.</p>
        </div>
      </div>
    </section>
  );
}
