import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import {
  Download, Eye, EyeOff, RefreshCw, Printer,
  Tag, AlignCenter, Barcode, Settings2, ChevronDown,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useItems } from '@/hooks/useItems';
import { useAuthStore } from '@/store/authStore';
import type { Item } from '@/types';
import {
  defaultLabelConfig,
  printModeToApiParams,
  PRINT_MODE_LABELS,
  type LabelConfig,
} from '@/types/labelConfig';
import { TEMPLATES } from '@/templates/labelTemplates';
import { LabelRenderer } from './LabelRenderer';
import * as qz from 'qz-tray';

import type { LabelField } from '@/types/label';

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-700 leading-tight">{title}</p>
        {subtitle && <p className="text-[10px] text-slate-400 leading-tight">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Field Row ─────────────────────────────────────────────────────────────────
interface FieldRowProps {
  label: string;
  field: LabelField;
  onChange: (partial: Partial<LabelField>) => void;
  onToggleVisibility?: () => void;
  placeholder?: string;
  bold?: boolean;
  hint?: string;
  disabled?: boolean;
}

function FieldRow({ label, field, onChange, onToggleVisibility, placeholder, bold, hint, disabled }: FieldRowProps) {
  const format = field.format || { bold: false, italic: false, underline: false };
  const isHidden = field.style === 'empty';

  return (
    <div className={`rounded-md border transition-colors ${isHidden ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-200'} p-2`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-semibold uppercase tracking-wider w-14 shrink-0 ${bold ? 'text-indigo-600' : 'text-slate-400'}`}>
          {label}
        </span>
        <Input
          value={field.value}
          onChange={(e) => !disabled && onChange({ value: e.target.value })}
          placeholder={placeholder || ''}
          disabled={disabled || isHidden}
          className={`flex-1 h-7 text-sm border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-indigo-400 rounded-none px-0 ${
            bold ? 'font-semibold' : ''
          } ${isHidden ? 'opacity-30' : ''}`}
        />
        {onToggleVisibility && (
          <button
            type="button"
            onClick={onToggleVisibility}
            title={isHidden ? 'Show line' : 'Hide line'}
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors shrink-0 ${
              isHidden
                ? 'text-slate-300 hover:text-slate-500'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {!isHidden && (
        <div className="flex items-center gap-1.5 pl-16">
          {/* Type */}
          <select
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as 'plain' | 'currency' })}
            disabled={disabled}
            className="h-6 rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label={`${label} type`}
          >
            <option value="plain">Plain</option>
            <option value="currency">Currency</option>
          </select>
          {/* Style */}
          <select
            value={field.style}
            onChange={(e) => onChange({ style: e.target.value as 'normal' | 'cross' | 'empty' })}
            disabled={disabled}
            className="h-6 rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label={`${label} style`}
          >
            <option value="normal">Normal</option>
            <option value="cross">Strikethrough</option>
            <option value="empty">Hidden</option>
          </select>
          {/* Align */}
          <select
            value={field.align || 'center'}
            onChange={(e) => onChange({ align: e.target.value as 'left' | 'center' | 'right' })}
            disabled={disabled}
            className="h-6 rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label={`${label} alignment`}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          {/* Format B/I/U */}
          <div className="flex items-center gap-0.5 ml-1">
            {(['bold', 'italic', 'underline'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => {
                  if (disabled) return;
                  onChange({ format: { ...format, [fmt]: !format[fmt] } });
                }}
                disabled={disabled}
                className={`w-6 h-6 rounded text-[11px] border transition-colors font-medium ${
                  format[fmt]
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                } ${fmt === 'italic' ? 'italic' : ''} ${fmt === 'underline' ? 'underline' : ''}`}
                title={fmt.charAt(0).toUpperCase() + fmt.slice(1)}
              >
                {fmt === 'bold' ? 'B' : fmt === 'italic' ? 'I' : 'U'}
              </button>
            ))}
          </div>
        </div>
      )}

      {hint && <p className="text-[10px] text-slate-400 mt-1 pl-16">{hint}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LabelEditorPanel() {
  const { company } = useAuthStore();
  const { data: itemsRes, isLoading: itemsLoading } = useItems({ page: 1, limit: 500 });
  const items: Item[] = itemsRes?.data?.data || [];

  const [config, setConfig] = useState<LabelConfig>(() =>
    defaultLabelConfig(company?.name || '')
  );
  const [copiesRaw, setCopiesRaw] = useState<string>(String(defaultLabelConfig().copies));
  const selectedTemplate = TEMPLATES[0];
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [priceIncludesGst, setPriceIncludesGst] = useState(true);
  const [search, setSearch] = useState('');
  const [printers, setPrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [qzConnected, setQzConnected] = useState<boolean>(false);
  const [qzLoading, setQzLoading] = useState<boolean>(false);
  const [directPrinting, setDirectPrinting] = useState<boolean>(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /** Set all text-field alignments to center when vertical layout is chosen */
  const handleOrientationChange = (orientation: 'horizontal' | 'vertical') => {
    if (orientation === 'vertical') {
      setConfig((prev) => ({
        ...prev,
        barcodeOrientation: 'vertical',
        line1: { ...prev.line1, align: 'center' },
        line2: { ...prev.line2, align: 'center' },
        line3: { ...prev.line3, align: 'center' },
        line4: { ...prev.line4, align: 'center' },
        line5: { ...prev.line5, align: 'center' },
        line6: { ...prev.line6, align: 'center' },
        price: { ...prev.price, align: 'center' },
      }));
    } else {
      setConfig((prev) => ({ ...prev, barcodeOrientation: 'horizontal' }));
    }
  };

  const updateField = (
    lineKey: 'line1' | 'line2' | 'line3' | 'line4' | 'line5' | 'line6' | 'price',
    partialUpdate: Partial<LabelField>
  ) => {
    setConfig((prev) => ({
      ...prev,
      [lineKey]: { ...prev[lineKey], ...partialUpdate },
    }));
  };

  const handlePriceGstToggle = (includesGst: boolean, currentItem = selectedItem) => {
    setPriceIncludesGst(includesGst);
    if (!currentItem) return;
    const basePrice = currentItem.selling_price;
    const gstRate = Number(currentItem.gst_rate ?? 18);
    const calculatedPrice = includesGst
      ? Math.round(basePrice * (1 + gstRate / 100))
      : basePrice;
    updateField('price', { value: (calculatedPrice / 100).toFixed(2) });
  };

  const handleConnectQz = async () => {
    try {
      setQzLoading(true);
      if (!qz.websocket.isActive()) await qz.websocket.connect();
      setQzConnected(true);
      const list = await qz.printers.find();
      setPrinters(list);
      if (list.length > 0) setSelectedPrinter((prev) => prev || list[0]);
      toast.success('Connected to QZ Tray!');
    } catch (err: any) {
      toast.error('Failed to connect to QZ Tray. Is it installed and running?');
      setQzConnected(false);
    } finally {
      setQzLoading(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.substring(result.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const handleDirectPrint = async () => {
    if (!selectedPrinter) { toast.error('Select a printer first.'); return; }
    try {
      setDirectPrinting(true);
      if (!qz.websocket.isActive()) { await qz.websocket.connect(); setQzConnected(true); }
      const res = await api.post('/labels/bulk', buildPayload(), { responseType: 'blob' });
      const base64Pdf = await blobToBase64(res.data);
      await qz.print(qz.configs.create(selectedPrinter), [{ type: 'pixel', format: 'pdf', flavor: 'base64', data: base64Pdf }]);
      toast.success(`Sent to ${selectedPrinter}!`);
    } catch (err: any) {
      toast.error('Direct print failed: ' + (err.message || err));
    } finally {
      setDirectPrinting(false);
    }
  };

  const handleItemSelect = async (item: Item) => {
    setSelectedItemId(item.id);
    setSearch(item.name);
    setDropdownOpen(false);

    let barcodeVal = item.barcode || '';
    if (!barcodeVal) {
      try {
        const res = await api.post(`/items/${item.id}/barcode`);
        if (res.data?.success && res.data?.data?.barcode) {
          barcodeVal = res.data.data.barcode;
          item.barcode = barcodeVal;
        }
      } catch { toast.error('Failed to auto-generate barcode'); }
    }

    let savedProfile: any = null;
    try {
      const profileRes = await api.get(`/labels/profile/${item.id}`);
      savedProfile = profileRes.data?.data?.config || null;
    } catch {
      // A missing profile is expected the first time an item is selected.
    }

    const isVertical = config.barcodeOrientation === 'vertical';
    const defaultAlign = isVertical ? 'center' : 'left';

    const createField = (
      val = '',
      type: 'plain' | 'currency' = 'plain',
      style: 'normal' | 'cross' | 'empty' = 'normal',
      formatOpts?: { bold?: boolean; italic?: boolean; underline?: boolean },
      placeholder = '',
      align: 'left' | 'center' | 'right' = defaultAlign
    ): LabelField => ({
      value: val, type, style,
      format: { bold: formatOpts?.bold ?? false, italic: formatOpts?.italic ?? false, underline: formatOpts?.underline ?? false },
      align, placeholder,
    });

    const defaultCurrency = (item.price_currency_code as any) === 'USD' ? 'USD' : 'INR';
    setSelectedItem(item);
    const spFlag = (item as any).selling_price_includes_tax === true;
    setPriceIncludesGst(spFlag);
    const basePrice = item.selling_price;
    const gstRate = Number(item.gst_rate ?? 18);
    const initialPriceVal = spFlag ? Math.round(basePrice * (1 + gstRate / 100)) : basePrice;

    setConfig((prev) => {
      const generated: LabelConfig = {
      ...prev,
      line1: createField(item.name, 'plain', 'normal', {}, 'Line 1'),
      line2: createField('', 'plain', 'normal', {}, 'Line 2'),
      line3: createField('', 'plain', 'normal', {}, 'Line 3'),
      line4: createField('', 'plain', 'normal', {}, 'Line 4'),
      line5: createField('', 'plain', 'normal', {}, 'Line 5'),
      line6: createField('', 'plain', 'normal', {}, 'Line 6', 'center'),
      price: createField((initialPriceVal / 100).toFixed(2), 'currency', 'normal', { bold: true }, 'Price', 'center'),
      barcodeValue: barcodeVal,
      currency: defaultCurrency,
      showBarcode: true,
      showBarcodeText: true,
      barcodeSource: 'system',
      customBarcodeValue: '',
      };
      if (!savedProfile) return generated;
      const restored = {
        ...generated,
        ...savedProfile,
        line1: { ...generated.line1, ...(savedProfile.line1 || {}) },
        line2: { ...generated.line2, ...(savedProfile.line2 || {}) },
        line3: { ...generated.line3, ...(savedProfile.line3 || {}) },
        line4: { ...generated.line4, ...(savedProfile.line4 || {}) },
        line5: { ...generated.line5, ...(savedProfile.line5 || {}) },
        line6: { ...generated.line6, ...(savedProfile.line6 || {}) },
        price: { ...generated.price, ...(savedProfile.price || {}) },
        barcodeValue: barcodeVal,
      } as LabelConfig;
      setCopiesRaw(String(restored.copies || 1));
      setPriceIncludesGst(savedProfile.priceIncludesGst !== false);
      toast.success('Previous label details restored');
      return restored;
    });
  };

  const buildPayload = () => {
    const { size, apiMode, labelsPerPage } = printModeToApiParams(config.printMode);
    const finalBarcodeValue = config.barcodeSource === 'custom' ? config.customBarcodeValue : config.barcodeValue;
    return {
      mode: apiMode, size, labels_per_page: labelsPerPage,
      templateId: selectedTemplate.id,
      orientation: config.barcodeOrientation,
      customCompanyName: config.brandName,
      items: [{
        item_id: selectedItemId || undefined,
        sku: finalBarcodeValue || 'LABEL',
        quantity: config.copies,
        label_brand: config.brandName || undefined,
        label_line1: config.line1, label_line2: config.line2,
        label_line3: config.line3, label_line4: config.line4,
        label_line5: config.line5, label_line6: config.line6,
        price: config.price, currency: config.currency,
        showBarcode: config.showBarcode, showBarcodeText: config.showBarcodeText,
        barcodeSource: config.barcodeSource, customBarcodeValue: config.customBarcodeValue,
        barcodeOrientation: config.barcodeOrientation,
        labelConfig: { ...config, priceIncludesGst },
      }],
    };
  };

  const handlePreview = async () => {
    try {
      setPreviewLoading(true);
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
      const res = await api.post(`/labels/bulk?orientation=${config.barcodeOrientation}`, buildPayload(), { responseType: 'blob' });
      setPreviewUrl(window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
      toast.success('Preview ready');
    } catch (e: any) {
      const data = e?.response?.data;
      let msg = 'Failed to generate preview.';
      if (data instanceof Blob) { try { msg = JSON.parse(await data.text())?.error || msg; } catch { /* noop */ } }
      else if (data?.error) { msg = data.error; }
      toast.error(msg);
    } finally { setPreviewLoading(false); }
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      const url = previewUrl || await (async () => {
        const res = await api.post('/labels/bulk', buildPayload(), { responseType: 'blob' });
        return window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      })();
      const a = document.createElement('a');
      a.href = url; a.download = `label-${Date.now()}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success('Label PDF downloaded');
    } catch (e: any) {
      const data = e?.response?.data;
      let msg = 'Failed to download label.';
      if (data instanceof Blob) { try { msg = JSON.parse(await data.text())?.error || msg; } catch { /* noop */ } }
      else if (data?.error) { msg = data.error; }
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const handleReset = () => {
    const defaults = defaultLabelConfig(company?.name || '');
    setConfig(defaults);
    setCopiesRaw(String(defaults.copies));
    setSelectedItemId(''); setSelectedItem(null);
    setPriceIncludesGst(true); setSearch('');
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const filteredItems = search
    ? items.filter((i) =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.sku || '').toLowerCase().includes(search.toLowerCase()) ||
        (i.barcode || '').toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 to-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm">
            <Tag className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-900 leading-tight">Label Generator</h2>
            <p className="text-[11px] text-slate-400">Design and print barcode labels for your products</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Reset
          </button>
          <button
            onClick={handlePreview}
            disabled={previewLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-60"
          >
            {previewLoading
              ? <span className="animate-pulse">Generating…</span>
              : <><Eye className="w-3 h-3" /> PDF Preview</>}
          </button>
          <button
            onClick={handleDownload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60"
          >
            {loading
              ? <span className="animate-pulse">Downloading…</span>
              : <><Download className="w-3 h-3" /> Download PDF</>}
          </button>

          {qzConnected ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <select
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                className="h-6 bg-transparent border-0 text-xs text-emerald-800 font-medium focus:outline-none min-w-[120px]"
                aria-label="Select printer"
              >
                {printers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button
                onClick={handleDirectPrint}
                disabled={directPrinting}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                <Printer className="w-3 h-3" />
                {directPrinting ? '…' : 'Print'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleConnectQz}
                disabled={qzLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                <Printer className="w-3 h-3" />
                {qzLoading ? 'Connecting…' : 'Connect Printer'}
              </button>
              <a
                href="https://qz.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-indigo-500 hover:text-indigo-700 underline underline-offset-2 leading-tight"
                title="QZ Tray is a free local service needed for direct USB/network thermal &amp; barcode printing"
              >
                🖨 Download QZ Tray driver (required for direct print)
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-[1fr_300px] divide-x divide-slate-100">

        {/* ── Left panel ─────────────────────────────────────────── */}
        <div className="p-4 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 150px)' }}>

          {/* Section 1: Item picker */}
          <section>
            <SectionHeader icon={<Tag className="w-3.5 h-3.5" />} title="Select Item" subtitle="Auto-fills all label fields" />
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  placeholder={itemsLoading ? 'Loading items…' : 'Search by name, SKU or barcode…'}
                  className="h-9 text-sm pr-8"
                />
                <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              {dropdownOpen && filteredItems.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                  {filteredItems.slice(0, 30).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 flex items-center justify-between gap-3 transition-colors border-b border-slate-50 last:border-0"
                      onClick={() => handleItemSelect(item)}
                    >
                      <span className="text-sm font-medium text-slate-800 truncate">{item.name}</span>
                      <span className="text-[11px] text-slate-400 font-mono shrink-0">{item.barcode || item.sku || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Section 2: Label content */}
          <section>
            <SectionHeader icon={<AlignCenter className="w-3.5 h-3.5" />} title="Label Content" subtitle="Brand name, text lines and price" />

            {/* Brand */}
            <div className="rounded-lg border border-slate-200 bg-white p-2 mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-14 shrink-0">Brand</span>
                <Input
                  value={config.brandName}
                  onChange={(e) => setConfig((prev) => ({ ...prev, brandName: e.target.value }))}
                  placeholder="Company / brand name"
                  className="flex-1 h-7 text-sm border-0 bg-transparent shadow-none focus-visible:ring-0 px-0"
                />
              </div>
            </div>

            {/* Lines */}
            <div className="space-y-1">
              {(
                [
                  { key: 'line1', label: 'Line 1', placeholder: 'Product name (auto-filled)' },
                  { key: 'line2', label: 'Line 2', placeholder: 'e.g. Variant, Flavour, Size…' },
                  { key: 'line3', label: 'Line 3', placeholder: 'e.g. Net Wt: 500g' },
                  { key: 'line4', label: 'Line 4', placeholder: 'e.g. Mfg: Jan 2025' },
                  { key: 'line5', label: 'Line 5', placeholder: 'e.g. Batch: B-204' },
                  { key: 'line6', label: 'Line 6', placeholder: 'Extra info…' },
                ] as const
              ).map(({ key, label, placeholder }) => (
                <FieldRow
                  key={key}
                  label={label}
                  field={config[key]}
                  onChange={(p) => updateField(key, p)}
                  onToggleVisibility={() => updateField(key, { style: config[key].style === 'empty' ? 'normal' : 'empty' })}
                  placeholder={placeholder}
                />
              ))}

              <FieldRow
                label="Price ★"
                field={config.price}
                onChange={(p) => updateField('price', p)}
                onToggleVisibility={() => updateField('price', { style: config.price.style === 'empty' ? 'normal' : 'empty' })}
                placeholder="Price"
                bold
                hint="Displayed as the highlighted price line"
              />
            </div>

            {/* GST toggle */}
            {selectedItem && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-16">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">GST:</span>
                {[
                  { label: `With GST — ₹${((selectedItem.selling_price * (1 + (selectedItem.gst_rate ?? 18) / 100)) / 100).toFixed(2)}`, value: true },
                  { label: `Without GST — ₹${(selectedItem.selling_price / 100).toFixed(2)}`, value: false },
                ].map(({ label, value }) => (
                  <label key={String(value)} className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-slate-600">
                    <input
                      type="radio"
                      name="price_gst_mode"
                      checked={priceIncludesGst === value}
                      onChange={() => handlePriceGstToggle(value)}
                      className="h-3 w-3 accent-indigo-600 cursor-pointer"
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* Section 3: Barcode */}
          <section>
            <SectionHeader icon={<Barcode className="w-3.5 h-3.5" />} title="Barcode" subtitle="System-assigned or custom code" />
            <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
              {/* Source toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-24 shrink-0">Source</span>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                  {(['system', 'custom'] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setConfig((p) => ({ ...p, barcodeSource: src }))}
                      className={`px-3 py-1.5 transition-colors ${
                        config.barcodeSource === src
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {src === 'system' ? 'System' : 'Custom'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Value */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-24 shrink-0">
                  {config.barcodeSource === 'custom' ? 'Custom Code' : 'Code'}
                </span>
                <Input
                  value={config.barcodeSource === 'custom' ? config.customBarcodeValue : config.barcodeValue}
                  onChange={config.barcodeSource === 'custom'
                    ? (e) => setConfig((p) => ({ ...p, customBarcodeValue: e.target.value }))
                    : undefined}
                  readOnly={config.barcodeSource === 'system'}
                  placeholder={config.barcodeSource === 'system' ? 'Auto-filled from item' : 'Enter IMEI / Serial / SKU'}
                  className={`flex-1 h-8 text-sm font-mono ${config.barcodeSource === 'system' ? 'text-slate-400' : ''}`}
                />
              </div>

              {/* Show toggles */}
              <div className="flex items-center gap-4 pl-[6.5rem]">
                {[
                  { label: 'Show barcode image', key: 'showBarcode' as const },
                  { label: 'Show barcode text', key: 'showBarcodeText' as const },
                ].map(({ label, key }) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={config[key]}
                      onChange={(e) => setConfig((p) => ({ ...p, [key]: e.target.checked }))}
                      className="h-3.5 w-3.5 rounded accent-indigo-600 cursor-pointer"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </section>

          {/* Section 4: Print settings */}
          <section>
            <SectionHeader icon={<Settings2 className="w-3.5 h-3.5" />} title="Print Settings" subtitle="Format, layout, copies and currency" />
            <div className="rounded-lg border border-slate-200 bg-white p-2.5 grid grid-cols-2 gap-x-4 gap-y-2">

              {/* Format */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Format</label>
                <select
                  className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={config.printMode}
                  onChange={(e) => {
                    const mode = e.target.value as LabelConfig['printMode'];
                    const isMini = mode === 'thermal_50x25';
                    const wasMini = config.printMode === 'thermal_50x25';
                    setConfig((p) => ({
                      ...p,
                      printMode: mode,
                      // Auto-hide lines 2-6 when switching TO mini 50×25 (too small for multiple lines)
                      // Restore them when switching AWAY from mini
                      ...(isMini && !wasMini ? {
                        line2: { ...p.line2, style: 'empty' as const },
                        line3: { ...p.line3, style: 'empty' as const },
                        line4: { ...p.line4, style: 'empty' as const },
                        line5: { ...p.line5, style: 'empty' as const },
                        line6: { ...p.line6, style: 'empty' as const },
                      } : !isMini && wasMini ? {
                        line2: { ...p.line2, style: 'normal' as const },
                        line3: { ...p.line3, style: 'normal' as const },
                        line4: { ...p.line4, style: 'normal' as const },
                        line5: { ...p.line5, style: 'normal' as const },
                        line6: { ...p.line6, style: 'normal' as const },
                      } : {}),
                    }));
                  }}
                >
                  {(Object.keys(PRINT_MODE_LABELS) as Array<LabelConfig['printMode']>).map((k) => (
                    <option key={k} value={k}>{PRINT_MODE_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              {/* Layout */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Layout</label>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium h-8">
                  {(['vertical', 'horizontal'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => handleOrientationChange(o)}
                      className={`flex-1 transition-colors ${
                        config.barcodeOrientation === o
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {o === 'vertical' ? '↕ Vertical' : '↔ Horizontal'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Copies */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Copies</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={copiesRaw}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCopiesRaw(raw);
                    const parsed = parseInt(raw, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) setConfig((p) => ({ ...p, copies: parsed }));
                  }}
                  onBlur={() => {
                    const clamped = Math.max(1, Math.min(100, parseInt(copiesRaw, 10) || 1));
                    setCopiesRaw(String(clamped));
                    setConfig((p) => ({ ...p, copies: clamped }));
                  }}
                  className="h-8 w-full text-center tabular-nums text-sm"
                />
              </div>

              {/* Currency */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Currency</label>
                <select
                  className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={config.currency}
                  onChange={(e) => setConfig((p) => ({ ...p, currency: e.target.value as any }))}
                >
                  <option value="INR">INR — Indian Rupee (₹)</option>
                  <option value="USD">USD — US Dollar ($)</option>
                  <option value="EUR">EUR — Euro (€)</option>
                </select>
              </div>

            </div>
          </section>

        </div>

        {/* ── Right panel: live preview ───────────────────────────── */}
        <div className="p-4 flex flex-col gap-3 bg-slate-50/40">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
              Live Preview
            </p>
            <div
              className="w-full rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center"
              style={{ minHeight: '170px', overflow: 'hidden', padding: '12px' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transformOrigin: 'center center',
                  transform: 'scale(0.82)',
                  maxWidth: '100%',
                  maxHeight: '240px',
                }}
              >
                <LabelRenderer
                  template={selectedTemplate}
                  data={config as unknown as import('@/types').LabelData}
                />
              </div>
            </div>
            <p className="text-[10px] text-center text-slate-400 mt-2">
              {config.barcodeOrientation === 'vertical' ? '↕ Vertical layout' : '↔ Horizontal layout'} · {PRINT_MODE_LABELS[config.printMode]}
            </p>
          </div>

          {previewUrl && (
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">PDF Preview</p>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-600 font-medium hover:text-indigo-800"
                >
                  <Download className="w-3 h-3" /> Download
                </button>
              </div>
              <iframe title="Label PDF preview" src={previewUrl} className="w-full bg-white" style={{ height: '300px' }} />
            </div>
          )}

          {/* Quick tips */}
          <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-2.5 text-xs text-amber-800 space-y-1">
            <p className="font-semibold text-amber-900">💡 Tips</p>
            <p>• <strong>Vertical</strong> stacks lines in one column — best for thermal rolls.</p>
            <p>• Eye icon hides a line from the printed label.</p>
            <p>• Use <strong>PDF Preview</strong> to proof before printing.</p>
          </div>
        </div>

      </div>
    </div>
  );
}
