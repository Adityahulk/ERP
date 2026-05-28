/**
 * VyaparLineItems — reusable item entry table shared across Sales, Purchase, and Quotations.
 * Inspired by Vyapar's clean inline editing UX.
 *
 * Features:
 *  - Search catalog items (via a configurable API endpoint)
 *  - Add free-text items not in catalog
 *  - Inline editable rows: qty, rate, discount, GST
 *  - Live totals (subtotal / tax / grand total)
 */

import { Fragment, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { currencySymbol, formatMoney } from '@/lib/formatters';
import TaxRateDropdown from '@/components/invoice/TaxRateDropdown';
import { useTaxOptions, type TaxComponent } from '@/hooks/useTaxOptions';
import { Plus, Search, Trash2, ChevronDown, ChevronUp, PackagePlus } from 'lucide-react';
import api from '@/lib/api';
import { QuickAddItemSheet } from '@/components/items/QuickAddItemSheet';
import MoneyInput from '@/components/transactions/MoneyInput';

export interface VyaparLineItem {
  item_id?: string;
  name: string;
  description?: string;
  hsn_code?: string;
  item_type?: string;
  track_inventory?: boolean;
  unit?: string;
  quantity: number;
  unit_price: number;   // in paise
  discount_amount: number; // in paise
  gst_rate: number;    // percent
  tax_option_id?: string;
  tax_components?: TaxComponent[];
  cess_rate?: number;
  custom_fields?: Record<string, string>;
}

interface Props {
  items: VyaparLineItem[];
  onChange: (items: VyaparLineItem[]) => void;
  isGst?: boolean;
  isInterstate?: boolean;
  /** 'invoice' uses /invoices/search-items; 'catalog' uses /items */
  searchMode?: 'invoice' | 'catalog';
  /** When picking or quick-creating an item, prefer this price for the line rate */
  defaultRateFrom?: 'selling' | 'purchase';
  godownId?: string;
  showHsn?: boolean;
  showUnit?: boolean;
  showDescription?: boolean;
  showCess?: boolean;
  showPricing?: boolean;
  currencyCode?: string;
  customFields?: Array<{ id: string; label: string; type?: string; required?: boolean }>;
}

function calcLine(item: VyaparLineItem, isGst: boolean) {
  const gross = Math.round(item.quantity * item.unit_price);
  const taxable = Math.max(0, gross - item.discount_amount);
  const gst = isGst ? Math.round(taxable * item.gst_rate / 100) : 0;
  const cess = isGst ? Math.round(taxable * (item.cess_rate || 0) / 100) : 0;
  return { gross, taxable, gst, cess, total: taxable + gst + cess };
}

function gstMultiplier(item: VyaparLineItem, isGst: boolean) {
  return isGst ? 1 + (Number(item.gst_rate) || 0) / 100 : 1;
}

function priceWithGst(item: VyaparLineItem, isGst: boolean) {
  return Math.round((Number(item.unit_price) || 0) * gstMultiplier(item, isGst));
}

function discountedPriceWithGst(item: VyaparLineItem, isGst: boolean) {
  const qty = Math.max(Number(item.quantity) || 1, 1);
  const discountPerUnit = (Number(item.discount_amount) || 0) / qty;
  return Math.round(Math.max(0, (Number(item.unit_price) || 0) - discountPerUnit) * gstMultiplier(item, isGst));
}

function discountPercent(item: VyaparLineItem) {
  const gross = (Number(item.unit_price) || 0) * (Number(item.quantity) || 0);
  if (gross <= 0) return 0;
  return Math.max(0, Math.min(100, ((Number(item.discount_amount) || 0) / gross) * 100));
}

function priceExcludingGst(inclusivePaise: number, item: VyaparLineItem, isGst: boolean) {
  return Math.max(0, Math.round((Number(inclusivePaise) || 0) / gstMultiplier(item, isGst)));
}

function emptyLine(): VyaparLineItem {
  return { name: '', quantity: 1, unit_price: 0, discount_amount: 0, gst_rate: 18 };
}

export default function VyaparLineItems({
  items,
  onChange,
  isGst = true,
  isInterstate = false,
  searchMode = 'invoice',
  defaultRateFrom = 'selling',
  godownId,
  showHsn = true,
  showUnit = false,
  showDescription = false,
  showCess = false,
  showPricing = true,
  currencyCode = 'INR',
  customFields = [],
}: Props) {
  const { options: taxOptions, usingFallback: usingDefaultTaxOptions } = useTaxOptions();
  const moneySymbol = currencySymbol(currencyCode);
  const customColumnFields = customFields.filter((field) => field.id && field.label);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');
  const [rowSearch, setRowSearch] = useState<{ index: number; query: string; results: any[]; searching: boolean } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lineUnitPriceFromItem = (item: any) => {
    const sp = Number(item.selling_price ?? 0);
    const pp = Number(item.purchase_price ?? 0);
    const up = Number(item.unit_price ?? 0);
    if (defaultRateFrom === 'purchase') {
      return pp || sp || up;
    }
    return up || sp || pp;
  };

  const runSearch = (q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        if (searchMode === 'invoice') {
          const { data: res } = await api.post('/invoices/search-items', { q, godown_id: godownId || undefined });
          setResults(res.data || []);
        } else {
          const { data: res } = await api.get('/items', { params: { search: q, limit: 20 } });
          setResults(res.data?.data || res.data || []);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  };

  const catalogToLine = (item: any): VyaparLineItem => ({
    item_id: item.id,
    name: item.name,
    description: item.description || '',
    hsn_code: item.hsn_code || '',
    item_type: item.item_type,
    track_inventory: item.track_inventory,
    unit: item.unit || item.unit_name || 'PCS',
    quantity: 1,
    unit_price: lineUnitPriceFromItem(item),
    discount_amount: 0,
    gst_rate: Number(item.gst_rate ?? 18),
    tax_option_id: undefined,
    tax_components: undefined,
    cess_rate: Number(item.cess_rate ?? 0),
    custom_fields: item.custom_fields && typeof item.custom_fields === 'object' ? item.custom_fields : {},
  });

  const addFromCatalog = (item: any) => {
    if (items.find((i) => i.item_id === item.id)) return;
    onChange([...items, catalogToLine(item)]);
    setQuery('');
    setResults([]);
  };

  const replaceRowFromCatalog = (idx: number, item: any) => {
    const next = [...items];
    const existingQty = Number(next[idx]?.quantity) || 1;
    next[idx] = { ...catalogToLine(item), quantity: existingQty };
    onChange(next);
    setRowSearch(null);
  };

  const runRowSearch = (idx: number, q: string) => {
    update(idx, { name: q, item_id: undefined });
    if (rowSearchTimer.current) clearTimeout(rowSearchTimer.current);
    setRowSearch({ index: idx, query: q, results: [], searching: q.trim().length >= 2 });
    if (q.trim().length < 2) return;
    rowSearchTimer.current = setTimeout(async () => {
      try {
        if (searchMode === 'invoice') {
          const { data: res } = await api.post('/invoices/search-items', { q, godown_id: godownId || undefined });
          setRowSearch({ index: idx, query: q, results: res.data || [], searching: false });
        } else {
          const { data: res } = await api.get('/items', { params: { search: q, limit: 20 } });
          setRowSearch({ index: idx, query: q, results: res.data?.data || res.data || [], searching: false });
        }
      } catch {
        setRowSearch({ index: idx, query: q, results: [], searching: false });
      }
    }, 180);
  };

  const openQuickAddItem = () => {
    setQuickAddDefaultName(query.trim());
    setQuickAddOpen(true);
  };

  const onQuickItemCreated = (row: Record<string, unknown>) => {
    const item = {
      id: row.id,
      name: row.name,
      sku: row.sku,
      hsn_code: row.hsn_code,
      item_type: row.item_type,
      track_inventory: row.track_inventory,
      selling_price: row.selling_price,
      purchase_price: row.purchase_price,
      gst_rate: row.gst_rate,
      cess_rate: row.cess_rate ?? 0,
      unit_price: row.selling_price,
      unit_name: row.unit_name,
    };
    addFromCatalog(item);
  };

  const addManualLine = () => {
    const name = query.trim();
    onChange([...items, { ...emptyLine(), name: name || '' }]);
    setRowSearch({ index: items.length, query: name || '', results: [], searching: false });
    setQuery('');
    setResults([]);
  };

  const update = (idx: number, patch: Partial<VyaparLineItem>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const updateCustomField = (idx: number, key: string, value: string) => {
    const current = items[idx]?.custom_fields || {};
    update(idx, { custom_fields: { ...current, [key]: value } });
  };

  const updateSellingPriceWithGst = (idx: number, priceInclGst: number) => {
    const current = items[idx];
    const oldPct = discountPercent(current);
    const unitPrice = priceExcludingGst(priceInclGst, current, isGst);
    const quantity = Number(current.quantity) || 0;
    update(idx, {
      unit_price: unitPrice,
      discount_amount: Math.round((unitPrice * quantity * oldPct) / 100),
    });
  };

  const updateDiscountedPriceWithGst = (idx: number, priceInclGst: number) => {
    const current = items[idx];
    const qty = Math.max(Number(current.quantity) || 1, 1);
    const discountedBase = priceExcludingGst(priceInclGst, current, isGst);
    update(idx, {
      discount_amount: Math.max(0, Math.round(((Number(current.unit_price) || 0) - discountedBase) * qty)),
    });
  };

  const updateDiscountPercent = (idx: number, pct: number) => {
    const current = items[idx];
    const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
    update(idx, {
      discount_amount: Math.round(((Number(current.unit_price) || 0) * (Number(current.quantity) || 0) * safePct) / 100),
    });
  };

  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  const toggleExpand = (idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // Totals
  const totals = items.reduce(
    (acc, item) => {
      const c = calcLine(item, isGst);
      acc.subtotal += c.taxable;
      acc.tax += c.gst;
      acc.cess += c.cess;
      acc.total += c.total;
      return acc;
    },
    { subtotal: 0, tax: 0, cess: 0, total: 0 },
  );
  return (
    <div className="max-w-full space-y-3">
      {/* Search / Add Row */}
      <div className="relative">
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              className="h-9 pl-9"
              placeholder="Search items or type name to add manually…"
              value={query}
              onChange={(e) => runSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !query.trim()) return;
                e.preventDefault();
                if (results[0]) addFromCatalog(results[0]);
                else addManualLine();
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 shrink-0"
            onClick={openQuickAddItem}
          >
            <PackagePlus className="w-4 h-4" />
            Add item
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 shrink-0"
            onClick={addManualLine}
          >
            <Plus className="w-4 h-4" />
            Add Line
          </Button>
        </div>

        {/* Dropdown */}
        {(results.length > 0 || (searching && query.length >= 2)) && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-card border rounded-xl shadow-lg max-h-52 overflow-y-auto">
            {searching && results.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
            )}
            {results.map((it: any) => (
              <button
                key={it.id}
                type="button"
                className="w-full text-left px-4 py-2.5 hover:bg-muted text-sm flex items-center justify-between gap-3 border-b last:border-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addFromCatalog(it);
                }}
              >
                <div className="min-w-0">
                  <span className="font-medium">{it.name}</span>
                  {it.sku && <span className="text-muted-foreground ml-2 text-xs">{it.sku}</span>}
                </div>
                <div className="text-right flex-shrink-0 text-muted-foreground text-xs">
                  {formatMoney(Number(it.unit_price ?? it.selling_price ?? 0), currencyCode)}
                  {it.item_type !== 'service' && typeof it.available_stock === 'number' && (
                    <span className="ml-2">· {it.available_stock} in stock</span>
                  )}
                </div>
              </button>
            ))}
            {!searching && results.length === 0 && query.length >= 2 && (
              <button
                type="button"
                className="w-full text-left px-4 py-3 text-sm text-primary hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addManualLine();
                }}
              >
                + Add "{query}" as new line
              </button>
            )}
          </div>
        )}
      </div>

      <QuickAddItemSheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        defaultName={quickAddDefaultName}
        onCreated={onQuickItemCreated}
      />

      {isGst && usingDefaultTaxOptions && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Using default tax rates. Configure them in Settings &gt; Taxes &amp; GST.
        </p>
      )}

      {/* Items Table */}
      {items.length > 0 && (
        <div className="max-w-full overflow-x-auto rounded-lg border">
          <table
            className="w-full table-fixed text-sm"
            style={{
              minWidth: `${(showPricing ? 820 : 520) + (showHsn ? 90 : 0) + (showUnit && showPricing ? 84 : 0) + (isGst && showPricing ? 86 : 0) + customColumnFields.length * 140}px`,
            }}
          >
            <colgroup>
              <col className="w-[54px]" />
              <col className={showPricing ? 'w-[220px]' : 'w-[320px]'} />
              {showHsn && <col className="w-[92px]" />}
              <col className="w-[74px]" />
              {showUnit && <col className="w-[86px]" />}
              {showPricing && <col className="w-[112px]" />}
              {showPricing && <col className="w-[78px]" />}
              {showPricing && isGst && <col className="w-[96px]" />}
              {customColumnFields.map((field) => <col key={field.id} className="w-[140px]" />)}
              {showPricing && <col className="w-[116px]" />}
              <col className="w-[48px]" />
            </colgroup>
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">#</th>
                <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">Item</th>
                {showHsn && <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">HSN/SAC</th>}
                <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Qty</th>
                {showUnit && <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">Unit</th>}
                {showPricing && <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Rate ({moneySymbol})</th>}
                {showPricing && <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Disc%</th>}
                {showPricing && isGst && (
                  <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">GST%</th>
                )}
                {customColumnFields.map((field) => (
                  <th key={field.id} className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">
                    {field.label}{field.required ? ' *' : ''}
                  </th>
                ))}
                {showPricing && <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Total</th>}
                <th className="sticky right-0 z-10 w-12 bg-muted/40"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const c = calcLine(item, isGst);
                const expanded = expandedRows.has(idx);
                return (
                  <Fragment key={idx}>
                    <tr className="h-10 border-b hover:bg-muted/10">
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <span className="w-4 text-right text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => toggleExpand(idx)}
                            title={expanded ? 'Collapse' : 'More options'}
                          >
                            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="min-w-0">
                          <Input
                            className="h-8 min-w-0 text-sm font-medium"
                            value={item.name}
                            onFocus={() => setRowSearch({ index: idx, query: item.name || '', results: [], searching: false })}
                            onChange={(e) => runRowSearch(idx, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              if (rowSearch?.index === idx && rowSearch.results[0]) {
                                e.preventDefault();
                                replaceRowFromCatalog(idx, rowSearch.results[0]);
                              }
                            }}
                            placeholder="Search item or enter name"
                          />
                          {rowSearch?.index === idx && (rowSearch.searching || rowSearch.results.length > 0) && (
                            <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border bg-card shadow-xl">
                              {rowSearch.searching && rowSearch.results.length === 0 && (
                                <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                              )}
                              {rowSearch.results.map((it: any) => (
                                <button
                                  key={it.id}
                                  type="button"
                                  className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-muted"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    replaceRowFromCatalog(idx, it);
                                  }}
                                >
                                  <span className="min-w-0 truncate font-medium">{it.name}</span>
                                  <span className="shrink-0 text-muted-foreground">{formatMoney(Number(it.unit_price ?? it.selling_price ?? 0), currencyCode)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      {showHsn && (
                        <td className="px-2 py-1.5">
                          <Input
                            className="h-8 w-full text-xs font-mono"
                            value={item.hsn_code || ''}
                            onChange={(e) => update(idx, { hsn_code: e.target.value })}
                            placeholder={item.item_type === 'service' ? 'SAC' : 'HSN'}
                          />
                        </td>
                      )}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          className="h-8 w-full text-right tabular-nums"
                          min={0}
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) => update(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      {showUnit && (
                        <td className="px-2 py-1.5">
                          <Input
                            className="h-8 w-full text-sm"
                            value={item.unit || ''}
                            onChange={(e) => update(idx, { unit: e.target.value })}
                            placeholder="PCS"
                          />
                        </td>
                      )}
                      {showPricing && <td className="px-2 py-1.5">
                        <MoneyInput
                          className="h-8 w-full text-right tabular-nums"
                          placeholder="0"
                          value={item.unit_price}
                          onChange={(unit_price) => update(idx, { unit_price })}
                        />
                      </td>}
                      {showPricing && <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          className="h-8 w-full text-right tabular-nums"
                          min={0}
                          max={100}
                          step="0.01"
                          value={Number(discountPercent(item).toFixed(2))}
                          onChange={(e) => updateDiscountPercent(idx, parseFloat(e.target.value))}
                        />
                      </td>}
                      {showPricing && isGst && (
                        <td className="px-2 py-1.5">
                          <TaxRateDropdown
                            className="h-8 w-full rounded-md border bg-transparent px-2 text-right text-sm tabular-nums"
                            value={item.gst_rate}
                            optionId={item.tax_option_id}
                            options={taxOptions}
                            onChange={(next) => update(idx, { gst_rate: next.rate, tax_option_id: next.optionId, tax_components: next.components })}
                          />
                        </td>
                      )}
                      {customColumnFields.map((field) => (
                        <td key={field.id} className="px-2 py-1.5">
                          <Input
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            className="h-8 w-full text-sm"
                            value={String(item.custom_fields?.[field.id] || '')}
                            onChange={(e) => updateCustomField(idx, field.id, e.target.value)}
                            placeholder={field.label}
                          />
                        </td>
                      ))}
                      {showPricing && <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">
                        {formatMoney(c.total, currencyCode)}
                      </td>}
                      <td className="sticky right-0 z-10 bg-card px-1.5 py-1.5 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.5)]">
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Delete line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded row for extra fields */}
                    {expanded && (
                      <tr className="bg-muted/20 border-b">
                        <td colSpan={99} className="px-4 py-3">
                          {showPricing && isGst && (
                            <div className="mb-3 grid min-w-0 grid-cols-1 gap-3 rounded-md border bg-background/70 p-3 text-xs sm:grid-cols-3">
                              <div className="min-w-0">
                                <span className="mb-1 block text-muted-foreground">Selling price with GST</span>
                                <MoneyInput
                                  className="h-8 w-full text-xs"
                                  placeholder="0"
                                  value={priceWithGst(item, isGst)}
                                  onChange={(value) => updateSellingPriceWithGst(idx, value)}
                                />
                              </div>
                              <div className="min-w-0">
                                <span className="mb-1 block text-muted-foreground">Discounted price with GST</span>
                                <MoneyInput
                                  className="h-8 w-full text-xs"
                                  placeholder="0"
                                  value={discountedPriceWithGst(item, isGst)}
                                  onChange={(value) => updateDiscountedPriceWithGst(idx, value)}
                                />
                              </div>
                              <div className="min-w-0">
                                <span className="mb-1 block text-muted-foreground">Discount %</span>
                                <Input
                                  type="number"
                                  className="h-8 w-full text-xs"
                                  min={0}
                                  max={100}
                                  step="0.01"
                                  value={Number(discountPercent(item).toFixed(2))}
                                  onChange={(e) => updateDiscountPercent(idx, parseFloat(e.target.value))}
                                />
                              </div>
                              <p className="text-[10px] text-muted-foreground sm:col-span-3">
                                Enter any two values. The remaining price or discount is recalculated for this line.
                              </p>
                            </div>
                          )}
                          <div className="grid min-w-0 grid-cols-1 gap-3 text-xs sm:grid-cols-[1fr_90px_140px]">
                            {showHsn && !showPricing && (
                              <div className="min-w-0">
                                <span className="mb-1 block text-muted-foreground">{item.item_type === 'service' ? 'SAC Code' : 'HSN Code'}</span>
                                <Input
                                  className="h-8 w-full text-xs font-mono"
                                  value={item.hsn_code || ''}
                                  onChange={(e) => update(idx, { hsn_code: e.target.value })}
                                  placeholder={item.item_type === 'service' ? 'SAC' : 'HSN'}
                                />
                              </div>
                            )}
                            {showDescription && (
                              <div className="min-w-0 sm:col-span-1">
                                <span className="mb-1 block text-muted-foreground">Description</span>
                                <textarea
                                  className="min-h-[38px] w-full resize-y rounded-md border bg-background px-3 py-2 text-xs leading-5 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                  value={item.description || ''}
                                  onChange={(e) => update(idx, { description: e.target.value })}
                                  placeholder="Optional description"
                                />
                              </div>
                            )}
                            {isGst && showCess && (
                              <div className="min-w-0">
                                <span className="mb-1 block text-muted-foreground">Cess %</span>
                                <Input
                                  type="number"
                                  className="h-8 w-full text-xs"
                                  min={0}
                                  value={item.cess_rate || 0}
                                  onChange={(e) => update(idx, { cess_rate: parseFloat(e.target.value) || 0 })}
                                />
                              </div>
                            )}
                            {showPricing && <div className="min-w-0">
                              <span className="mb-1 block text-muted-foreground">Discount ({moneySymbol})</span>
                              <MoneyInput
                                className="h-8 w-full text-xs"
                                placeholder="0"
                                value={item.discount_amount}
                                onChange={(discount_amount) => update(idx, { discount_amount })}
                              />
                            </div>}
                          </div>
                          {showPricing && isGst && (
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              Taxable: {formatMoney(c.taxable, currencyCode)} · GST: {formatMoney(c.gst, currencyCode)}
                              {isInterstate ? ' (IGST)' : ' (CGST + SGST)'}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length === 0 && (
        <div className="border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground text-sm">
          Search for items above, use <strong>Add item</strong> to save to your catalog, or <strong>Add Line</strong> for a one-off row
        </div>
      )}

      {/* Totals */}
      {items.length > 0 && showPricing && (
        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm bg-muted/30 rounded-xl px-4 py-3 border">
            <div className="flex justify-between text-muted-foreground">
              <span>{isGst ? 'Subtotal (taxable)' : 'Subtotal'}</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(totals.subtotal, currencyCode)}</span>
            </div>
            {isGst && (
              <>
                {isInterstate ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>IGST</span>
                    <span className="tabular-nums">{formatMoney(totals.tax, currencyCode)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>CGST</span>
                      <span className="tabular-nums">{formatMoney(Math.round(totals.tax / 2), currencyCode)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>SGST</span>
                      <span className="tabular-nums">{formatMoney(Math.round(totals.tax / 2), currencyCode)}</span>
                    </div>
                  </>
                )}
                {totals.cess > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Cess</span>
                    <span className="tabular-nums">{formatMoney(totals.cess, currencyCode)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between border-t pt-2 font-bold text-base">
              <span>Grand Total</span>
              <span className="tabular-nums">{formatMoney(totals.total, currencyCode)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compute overall totals from a list of line items */
export function computeTotals(items: VyaparLineItem[], isGst: boolean, roundOffEnabled = false) {
  const base = items.reduce(
    (acc, item) => {
      const gross = item.quantity * item.unit_price;
      const roundedGross = Math.round(gross);
      const taxable = Math.max(0, roundedGross - item.discount_amount);
      const gst = isGst ? Math.round(taxable * item.gst_rate / 100) : 0;
      const cess = isGst ? Math.round(taxable * (item.cess_rate || 0) / 100) : 0;
      acc.subtotal += roundedGross;
      acc.discount += item.discount_amount;
      acc.taxable += taxable;
      acc.tax += gst;
      acc.cess += cess;
      acc.total += taxable + gst + cess;
      return acc;
    },
    { subtotal: 0, discount: 0, taxable: 0, tax: 0, cess: 0, total: 0, roundOff: 0 },
  );
  const roundedTotal = roundOffEnabled ? Math.round(base.total / 100) * 100 : base.total;
  return { ...base, roundOff: roundOffEnabled ? roundedTotal - base.total : 0, total: roundedTotal };
}
