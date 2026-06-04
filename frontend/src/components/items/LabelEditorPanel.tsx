import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Eye, RefreshCw } from 'lucide-react';
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

// ── Text field row ─────────────────────────────────────────────

import type { LabelField } from '@/types/label';

interface FieldRowProps {
  label: string;
  field: LabelField;
  onChange: (partial: Partial<LabelField>) => void;
  placeholder?: string;
  bold?: boolean;
  hint?: string;
  disabled?: boolean;
}

function FieldRow({ label, field, onChange, placeholder, bold, hint, disabled }: FieldRowProps) {
  const format = field.format || { bold: false, italic: false, underline: false };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0">
      <div className="w-20 shrink-0 sm:text-right text-left">
        <label className={`text-xs ${bold ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
          {label}
        </label>
      </div>
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Text Input */}
          <Input
            value={field.value}
            onChange={(e) => !disabled && onChange({ value: e.target.value })}
            placeholder={placeholder || ''}
            disabled={disabled || field.style === 'empty'}
            className={`flex-1 h-8 text-sm ${bold ? 'font-semibold border-indigo-400 focus-visible:ring-indigo-500' : ''}`}
          />

          {/* Type Dropdown */}
          <select
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as 'plain' | 'currency' })}
            disabled={disabled || field.style === 'empty'}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={`${label} type`}
          >
            <option value="plain">Plain</option>
            <option value="currency">Currency</option>
          </select>

          {/* Style Dropdown */}
          <select
            value={field.style}
            onChange={(e) => onChange({ style: e.target.value as 'normal' | 'cross' | 'empty' })}
            disabled={disabled}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={`${label} style`}
          >
            <option value="normal">Normal</option>
            <option value="cross">Cross</option>
            <option value="empty">Empty</option>
          </select>

          {/* Align Dropdown */}
          <select
            value={field.align || 'left'}
            onChange={(e) => onChange({ align: e.target.value as 'left' | 'center' | 'right' })}
            disabled={disabled || field.style === 'empty'}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={`${label} alignment`}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>

          {/* Toggle buttons for format: Bold, Italic, Underline */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (disabled || field.style === 'empty') return;
                onChange({ format: { ...format, bold: !format.bold } });
              }}
              disabled={disabled || field.style === 'empty'}
              className={`w-8 h-8 rounded-md border text-xs font-bold transition-colors ${
                format.bold
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50'
              }`}
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => {
                if (disabled || field.style === 'empty') return;
                onChange({ format: { ...format, italic: !format.italic } });
              }}
              disabled={disabled || field.style === 'empty'}
              className={`w-8 h-8 rounded-md border text-xs italic transition-colors ${
                format.italic
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50'
              }`}
              title="Italic"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => {
                if (disabled || field.style === 'empty') return;
                onChange({ format: { ...format, underline: !format.underline } });
              }}
              disabled={disabled || field.style === 'empty'}
              className={`w-8 h-8 rounded-md border text-xs underline transition-colors ${
                format.underline
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50'
              }`}
              title="Underline"
            >
              U
            </button>
          </div>
        </div>
        {hint && <p className="text-[10px] text-muted-foreground leading-tight pl-1">{hint}</p>}
      </div>
    </div>
  );
}


// ── Main component ─────────────────────────────────────────────

export function LabelEditorPanel() {
  const { company } = useAuthStore();
  const { data: itemsRes, isLoading: itemsLoading } = useItems({ page: 1, limit: 500 });
  const items: Item[] = itemsRes?.data?.data || [];

  const [config, setConfig] = useState<LabelConfig>(() =>
    defaultLabelConfig(company?.name || '')
  );
  // Raw string for copies input so the user can type freely (e.g. "24")
  const [copiesRaw, setCopiesRaw] = useState<string>(String(defaultLabelConfig().copies));
  // Template is always Price Highlight — fixed, not user-selectable
  const selectedTemplate = TEMPLATES[0];
  const [selectedItemId, setSelectedItemId] = useState('');
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updateField = (
    lineKey: 'line1' | 'line2' | 'line3' | 'line4' | 'line5' | 'line6' | 'price',
    partialUpdate: Partial<LabelField>
  ) => {
    setConfig((prev) => ({
      ...prev,
      [lineKey]: {
        ...prev[lineKey],
        ...partialUpdate,
      },
    }));
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
          // Update the local item's barcode cache
          item.barcode = barcodeVal;
        }
      } catch (err: any) {
        console.error('Failed to auto-generate barcode', err);
        toast.error('Failed to auto-generate barcode');
      }
    }

    const createField = (
      val = '',
      type: 'plain' | 'currency' = 'plain',
      style: 'normal' | 'cross' | 'empty' = 'normal',
      formatOpts?: { bold?: boolean; italic?: boolean; underline?: boolean },
      placeholder = '',
      align: 'left' | 'center' | 'right' = 'left'
    ): LabelField => ({
      value: val,
      type,
      style,
      format: {
        bold: formatOpts?.bold ?? false,
        italic: formatOpts?.italic ?? false,
        underline: formatOpts?.underline ?? false,
      },
      align,
      placeholder,
    });

    const defaultCurrency = (item.price_currency_code as any) === 'USD' ? 'USD' : 'INR';

    setConfig((prev) => ({
      ...prev,
      line1: createField(item.name, 'plain', 'normal', {}, 'Line 1', 'left'),
      line2: createField('', 'plain', 'normal', {}, 'Line 2', 'left'),
      line3: createField('', 'plain', 'normal', {}, 'Line 3', 'left'),
      line4: createField('', 'plain', 'normal', {}, 'Line 4', 'left'),
      line5: createField('', 'plain', 'normal', {}, 'Line 5', 'left'),
      line6: createField('', 'plain', 'normal', {}, 'Line 6', 'center'),
      price: createField((item.selling_price / 100).toFixed(2), 'currency', 'normal', { bold: true }, 'Price', 'center'),
      barcodeValue: barcodeVal,
      currency: defaultCurrency,
      showBarcode: true,
      showBarcodeText: true,
      barcodeSource: 'system',
      customBarcodeValue: '',
    }));
  };

  const buildPayload = () => {
    const { size, apiMode, labelsPerPage } = printModeToApiParams(config.printMode);
    const finalBarcodeValue = config.barcodeSource === 'custom' ? config.customBarcodeValue : config.barcodeValue;
    return {
      mode: apiMode,
      size,
      labels_per_page: labelsPerPage,
      templateId: selectedTemplate.id,
      items: [{
        item_id: selectedItemId || undefined,
        sku: finalBarcodeValue || 'LABEL',
        quantity: config.copies,
        label_brand: config.brandName || undefined,
        label_line1: config.line1,
        label_line2: config.line2,
        label_line3: config.line3,
        label_line4: config.line4,
        label_line5: config.line5,
        label_line6: config.line6,
        price: config.price,
        currency: config.currency,
        showBarcode: config.showBarcode,
        showBarcodeText: config.showBarcodeText,
        barcodeSource: config.barcodeSource,
        customBarcodeValue: config.customBarcodeValue,
      }],
    };
  };

  const handlePreview = async () => {
    try {
      setPreviewLoading(true);
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
      const res = await api.post('/labels/bulk', buildPayload(), { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPreviewUrl(url);
      toast.success('Preview ready');
    } catch (e: any) {
      const data = e?.response?.data;
      let msg = 'Failed to generate preview.';
      if (data instanceof Blob) {
        try { const j = JSON.parse(await data.text()); msg = j?.error || msg; } catch { /* noop */ }
      } else if (data?.error) { msg = data.error; }
      toast.error(msg);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      const url = previewUrl || await (async () => {
        const res = await api.post('/labels/bulk', buildPayload(), { responseType: 'blob' });
        return window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      })();
      const a = document.createElement('a');
      a.href = url;
      a.download = `label-${Date.now()}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success('Label PDF downloaded');
    } catch (e: any) {
      const data = e?.response?.data;
      let msg = 'Failed to download label.';
      if (data instanceof Blob) {
        try { const j = JSON.parse(await data.text()); msg = j?.error || msg; } catch { /* noop */ }
      } else if (data?.error) { msg = data.error; }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    const defaults = defaultLabelConfig(company?.name || '');
    setConfig(defaults);
    setCopiesRaw(String(defaults.copies));
    // Template is always Price Highlight — no reset needed
    setSelectedItemId('');
    setSearch('');
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
    <Card>
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div>
            <h2 className="font-semibold text-lg">Label Editor</h2>
            <p className="text-xs text-muted-foreground">Customize text and generate physical barcode labels (Price Highlight layout).</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewLoading}>
              {previewLoading ? <span className="animate-pulse text-xs">Generating…</span> : <><Eye className="w-3.5 h-3.5 mr-1" />Preview</>}
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {loading ? <span className="animate-pulse text-xs">Downloading…</span> : <><Download className="w-3.5 h-3.5 mr-1" />Download PDF</>}
            </Button>
          </div>
        </div>



        <div className="grid gap-6 lg:grid-cols-[1fr_320px] border-t pt-5">
          {/* ── Left: inputs ─────────────────────────── */}
          <div className="space-y-3">
            {/* Item picker */}
            <div className="flex items-center gap-2" ref={dropdownRef}>
              <label className="w-20 text-right text-xs text-slate-500 shrink-0">Item</label>
              <div className="flex-1 relative">
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  placeholder={itemsLoading ? 'Loading items…' : 'Search and pick an item to auto-fill…'}
                  className="h-8 text-sm"
                />
                {dropdownOpen && filteredItems.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-md border bg-white shadow-lg">
                    {filteredItems.slice(0, 30).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex flex-col gap-0"
                        onClick={() => handleItemSelect(item)}
                      >
                        <span className="text-sm font-medium truncate">{item.name}</span>
                        <span className="text-xs text-muted-foreground">{item.barcode || item.sku || 'No barcode'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-3 space-y-3">
              {/* Brand Row */}
              <div className="flex items-center gap-2 pb-2.5 border-b border-slate-100">
                <label className="w-20 text-right text-xs text-slate-500 shrink-0">Brand</label>
                <Input
                  value={config.brandName}
                  onChange={(e) => setConfig((prev) => ({ ...prev, brandName: e.target.value }))}
                  placeholder="Your company / brand name"
                  className="flex-1 h-8 text-sm"
                />
              </div>

              {/* Line rows */}
              <FieldRow
                label="Line 1"
                field={config.line1}
                onChange={(p) => updateField('line1', p)}
                placeholder="Product name (auto-filled from item)"
              />
              <FieldRow
                label="Line 2"
                field={config.line2}
                onChange={(p) => updateField('line2', p)}
                placeholder="e.g. Variant, Flavour, Size…"
              />
              <FieldRow
                label="Line 3"
                field={config.line3}
                onChange={(p) => updateField('line3', p)}
                placeholder="e.g. Net Wt: 500g"
              />
              <FieldRow
                label="Line 4"
                field={config.line4}
                onChange={(p) => updateField('line4', p)}
                placeholder="e.g. Mfg: Jan 2025"
              />
              <FieldRow
                label="Line 5"
                field={config.line5}
                onChange={(p) => updateField('line5', p)}
                placeholder="e.g. Batch: B-204"
              />
              <FieldRow
                label="Line 6"
                field={config.line6}
                onChange={(p) => updateField('line6', p)}
                placeholder="Line 6 (allow wrapping)"
              />
              <FieldRow
                label="Price ★"
                field={config.price}
                onChange={(p) => updateField('price', p)}
                placeholder="Price"
                bold
                hint="Centered 7th line below grid"
              />
            </div>

            <div className="border-t pt-3 space-y-3">
              {/* Barcode Source Selection */}
              <div className="flex items-center gap-2">
                <label className="w-20 text-right text-xs text-slate-500 shrink-0">Barcode Src</label>
                <div className="flex-1 flex gap-2">
                  <Button
                    type="button"
                    variant={config.barcodeSource === 'system' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    onClick={() => setConfig((p) => ({ ...p, barcodeSource: 'system' }))}
                  >
                    System Barcode
                  </Button>
                  <Button
                    type="button"
                    variant={config.barcodeSource === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    onClick={() => setConfig((p) => ({ ...p, barcodeSource: 'custom' }))}
                  >
                    Custom Code
                  </Button>
                </div>
              </div>

              {/* Barcode Value Input */}
              {config.barcodeSource === 'custom' ? (
                <div className="flex items-center gap-2">
                  <label className="w-20 text-right text-xs text-slate-500 shrink-0">Custom Code</label>
                  <Input
                    value={config.customBarcodeValue}
                    onChange={(e) => setConfig((p) => ({ ...p, customBarcodeValue: e.target.value }))}
                    placeholder="Enter IMEI / Serial / SKU"
                    className="flex-1 h-8 text-sm border-indigo-400 focus-visible:ring-indigo-500"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <label className="w-20 text-right text-xs text-slate-500 shrink-0">System Barcode</label>
                  <Input
                    value={config.barcodeValue}
                    placeholder="Auto-filled from item barcode / SKU"
                    disabled
                    className="flex-1 h-8 text-sm"
                  />
                </div>
              )}
            </div>

            {/* Print settings row */}
            <div className="border-t pt-3 flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">Format</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={config.printMode}
                  onChange={(e) => setConfig((p) => ({ ...p, printMode: e.target.value as LabelConfig['printMode'] }))}
                >
                  {(Object.keys(PRINT_MODE_LABELS) as Array<LabelConfig['printMode']>).map((k) => (
                    <option key={k} value={k}>{PRINT_MODE_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">Copies</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={copiesRaw}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCopiesRaw(raw);
                    const parsed = parseInt(raw, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                      setConfig((p) => ({ ...p, copies: parsed }));
                    }
                  }}
                  onBlur={() => {
                    const clamped = Math.max(1, Math.min(100, parseInt(copiesRaw, 10) || 1));
                    setCopiesRaw(String(clamped));
                    setConfig((p) => ({ ...p, copies: clamped }));
                  }}
                  className="h-8 w-20 text-center tabular-nums"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">Currency</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={config.currency}
                  onChange={(e) => setConfig((p) => ({ ...p, currency: e.target.value as any }))}
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">Show Barcode</label>
                <input
                  type="checkbox"
                  checked={config.showBarcode}
                  onChange={(e) => setConfig((p) => ({ ...p, showBarcode: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">Show Barcode Text</label>
                <input
                  type="checkbox"
                  checked={config.showBarcodeText}
                  onChange={(e) => setConfig((p) => ({ ...p, showBarcodeText: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* ── Right: live preview ───────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Live Preview
              </p>
              <div className="w-full max-w-xs border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 p-6 flex items-center justify-center min-h-[220px]">
                <div style={{ transform: 'scale(1.1)', transformOrigin: 'center' }}>
                  {/* Pass full config (incl. printMode) so preview shows actual print format */}
                  <LabelRenderer
                    template={selectedTemplate}
                    data={config as unknown as import('@/types').LabelData}
                  />
                </div>
              </div>
            </div>
            {previewUrl && (
              <div className="border rounded-lg overflow-hidden bg-slate-100">
                <p className="text-xs text-center text-muted-foreground py-1 border-b">PDF Preview</p>
                <iframe title="Label PDF preview" src={previewUrl} className="w-full h-[280px] bg-white" />
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
