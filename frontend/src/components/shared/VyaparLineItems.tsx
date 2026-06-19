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
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { currencySymbol, formatMoney } from '@/lib/formatters';
import TaxRateDropdown from '@/components/invoice/TaxRateDropdown';
import { useTaxOptions, type TaxComponent } from '@/hooks/useTaxOptions';
import { Plus, Search, Trash2, ChevronDown, ChevronUp, PackagePlus, Check } from 'lucide-react';
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
  selling_price_includes_tax?: boolean;
  purchase_price_includes_tax?: boolean;
  price_includes_tax?: boolean;
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
  pricingMode?: 'inclusive' | 'exclusive';
}

function calcLine(item: VyaparLineItem, isGst: boolean) {
  const gstRate = isGst ? Number(item.gst_rate) || 0 : 0;
  const cessRate = isGst ? Number(item.cess_rate) || 0 : 0;
  const totalRate = gstRate + cessRate;
  const qty = Number(item.quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const discountAmount = Number(item.discount_amount) || 0;

  const isInclusive = item.price_includes_tax === true;

  let gross = 0;
  let taxable = 0;
  let total = 0;
  let totalTax = 0;

  if (isInclusive) {
    const subtotal_row = unitPrice * qty;
    total = Math.max(0, subtotal_row - discountAmount);
    taxable = total / (1 + totalRate / 100);
    totalTax = total - taxable;
    gross = subtotal_row / (1 + totalRate / 100);
  } else {
    const subtotal_row = unitPrice * qty;
    gross = subtotal_row;
    taxable = Math.max(0, subtotal_row - discountAmount);
    totalTax = (taxable * totalRate) / 100;
    total = taxable + totalTax;
  }

  const adjustedCess = totalTax * (cessRate / (totalRate || 1));
  const adjustedGst = totalTax - adjustedCess;

  return {
    gross: Math.round(gross),
    taxable: Math.round(taxable),
    gst: Math.round(adjustedGst),
    cess: Math.round(adjustedCess),
    total: Math.round(total)
  };
}

function priceWithGst(item: VyaparLineItem, isGst: boolean) {
  const gstRate = isGst ? Number(item.gst_rate) || 0 : 0;
  const cessRate = isGst ? Number(item.cess_rate) || 0 : 0;
  const rate = (gstRate + cessRate) / 100;
  const price = Number(item.unit_price) || 0;
  const val = item.price_includes_tax === true ? price : price * (1 + rate);
  return Math.round(val / 100) * 100;
}

function discountedPriceWithGst(item: VyaparLineItem, isGst: boolean) {
  const gstRate = isGst ? Number(item.gst_rate) || 0 : 0;
  const cessRate = isGst ? Number(item.cess_rate) || 0 : 0;
  const rate = (gstRate + cessRate) / 100;
  const price = Number(item.unit_price) || 0;
  const discount = Number(item.discount_amount) || 0;
  const qty = Math.max(1, Number(item.quantity) || 1);
  const discountPerUnit = discount / qty;

  const priceIncl = item.price_includes_tax === true ? price : price * (1 + rate);
  const discountPerUnitIncl = item.price_includes_tax === true ? discountPerUnit : discountPerUnit * (1 + rate);
  const val = Math.max(0, priceIncl - discountPerUnitIncl);
  return Math.round(val / 100) * 100;
}

function discountPercent(item: VyaparLineItem) {
  const price = Number(item.unit_price) || 0;
  const qty = Number(item.quantity) || 0;
  const subtotal_row = price * qty;
  if (subtotal_row <= 0) return 0;
  const discount = Number(item.discount_amount) || 0;
  return Math.max(0, Math.min(100, (discount / subtotal_row) * 100));
}

function emptyLine(): VyaparLineItem {
  return { name: '', quantity: 1, unit_price: 0, discount_amount: 0, gst_rate: 18, price_includes_tax: false };
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
  pricingMode: _pricingMode = 'exclusive',
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

  const displayPriceFromItem = (item: any) => {
    const basePrice = lineUnitPriceFromItem(item);
    const gstRate = Number(item.gst_rate ?? 18);
    const cessRate = Number(item.cess_rate ?? 0);
    const itemIncludesTax = defaultRateFrom === 'purchase'
      ? item.purchase_price_includes_tax === true
      : item.selling_price_includes_tax === true;
    return itemIncludesTax ? Math.round(basePrice * (1 + (gstRate + cessRate) / 100)) : basePrice;
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

  const catalogToLine = (item: any): VyaparLineItem => {
    const basePrice = lineUnitPriceFromItem(item);
    const gstRate = Number(item.gst_rate ?? 18);
    const cessRate = Number(item.cess_rate ?? 0);
    const itemIncludesTax = defaultRateFrom === 'purchase'
      ? item.purchase_price_includes_tax === true
      : item.selling_price_includes_tax === true;
    const finalUnitPrice = itemIncludesTax
      ? Math.round(basePrice * (1 + (gstRate + cessRate) / 100))
      : basePrice;

    return {
      item_id: item.id,
      name: item.name,
      description: item.description || '',
      hsn_code: item.hsn_code || '',
      item_type: item.item_type,
      track_inventory: item.track_inventory,
      unit: item.unit || item.unit_name || 'PCS',
      quantity: 1,
      unit_price: finalUnitPrice,
      discount_amount: 0,
      gst_rate: gstRate,
      tax_option_id: undefined,
      tax_components: undefined,
      cess_rate: cessRate,
      custom_fields: item.custom_fields && typeof item.custom_fields === 'object' ? item.custom_fields : {},
      selling_price_includes_tax: item.selling_price_includes_tax,
      purchase_price_includes_tax: item.purchase_price_includes_tax,
      price_includes_tax: itemIncludesTax,
    };
  };

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
      selling_price_includes_tax: row.selling_price_includes_tax,
      purchase_price_includes_tax: row.purchase_price_includes_tax,
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
    const gstRate = isGst ? Number(current.gst_rate) || 0 : 0;
    const cessRate = isGst ? Number(current.cess_rate) || 0 : 0;
    const rate = (gstRate + cessRate) / 100;
    const unitPrice = current.price_includes_tax === true ? priceInclGst : priceInclGst / (1 + rate);
    const quantity = Number(current.quantity) || 0;
    update(idx, {
      unit_price: Math.round(unitPrice),
      discount_amount: Math.round((unitPrice * quantity * oldPct) / 100),
    });
  };

  const updateDiscountedPriceWithGst = (idx: number, priceInclGst: number) => {
    const current = items[idx];
    const qty = Math.max(Number(current.quantity) || 1, 1);
    const gstRate = isGst ? Number(current.gst_rate) || 0 : 0;
    const cessRate = isGst ? Number(current.cess_rate) || 0 : 0;
    const rate = (gstRate + cessRate) / 100;
    const priceIncl = current.price_includes_tax === true ? current.unit_price : current.unit_price * (1 + rate);
    const discountPerUnitIncl = Math.max(0, priceIncl - priceInclGst);
    const discountPerUnit = current.price_includes_tax === true ? discountPerUnitIncl : discountPerUnitIncl / (1 + rate);
    update(idx, {
      discount_amount: Math.round(discountPerUnit * qty),
    });
  };

  const updateDiscountPercent = (idx: number, pct: number) => {
    const current = items[idx];
    const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
    const qty = Number(current.quantity) || 0;
    const unitPrice = Number(current.unit_price) || 0;
    const subtotal_row = unitPrice * qty;
    const discountAmount = (subtotal_row * safePct) / 100;
    update(idx, {
      discount_amount: Math.round(discountAmount),
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
                  {formatMoney(displayPriceFromItem(it), currencyCode)}
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
        <div className="max-w-full overflow-x-auto rounded-xl border">
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
              <tr className="bg-muted/50 border-b">
                <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">#</th>
                <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">Item</th>
                {showHsn && <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">HSN/SAC</th>}
                <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Qty</th>
                {showUnit && <th className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">Unit</th>}
                {showPricing && <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Rate ({moneySymbol})</th>}
                {showPricing && <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Disc%</th>}
                {showPricing && isGst && (
                  <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Tax%</th>
                )}
                {customColumnFields.map((field) => (
                  <th key={field.id} className="px-2 py-2 text-left font-medium text-xs text-muted-foreground">
                    {field.label}{field.required ? ' *' : ''}
                  </th>
                ))}
                {showPricing && <th className="px-2 py-2 text-right font-medium text-xs text-muted-foreground">Total</th>}
                <th className="sticky right-0 z-10 w-12 bg-muted/50"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const c = calcLine(item, isGst);
                const expanded = expandedRows.has(idx);
                const gstRate = isGst ? Number(item.gst_rate) || 0 : 0;
                const cessRate = isGst ? Number(item.cess_rate) || 0 : 0;
                const totalRate = gstRate + cessRate;
                const exclPrice = item.price_includes_tax === true ? item.unit_price / (1 + totalRate / 100) : item.unit_price;
                const inclPrice = item.price_includes_tax === true ? item.unit_price : item.unit_price * (1 + totalRate / 100);
                return (
                  <Fragment key={idx}>
                    <tr className={`h-11 border-b group transition-colors ${idx % 2 === 1 ? 'bg-muted/[0.03]' : ''} hover:bg-primary/[0.03]`}>
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
                                  <span className="shrink-0 text-muted-foreground">{formatMoney(displayPriceFromItem(it), currencyCode)}</span>
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
                        <div className="flex items-center gap-1">
                          <MoneyInput
                            className="h-7 flex-1 min-w-0 text-right text-xs tabular-nums"
                            placeholder="0"
                            value={item.unit_price}
                            onChange={(value) => update(idx, { unit_price: value })}
                          />
                          {isGst && (
                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  type="button"
                                  className="h-6 shrink-0 rounded border bg-muted/30 px-1.5 text-[10px] font-medium text-muted-foreground flex items-center gap-0.5 hover:bg-muted/60 hover:text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <span>{item.price_includes_tax === true ? 'Incl.' : 'Excl.'}</span>
                                  <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  align="end"
                                  sideOffset={4}
                                  className="z-[9999] min-w-[170px] overflow-hidden rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-80"
                                >
                                  <DropdownMenu.Item
                                    className="relative flex cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-2 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                    onClick={() => {
                                      update(idx, {
                                        price_includes_tax: false,
                                        unit_price: Math.round(exclPrice),
                                      });
                                    }}
                                  >
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-medium text-foreground">Without Tax (Excl.)</span>
                                      <span className="text-[10px] text-muted-foreground font-mono">{formatMoney(exclPrice, currencyCode)}</span>
                                    </div>
                                    {item.price_includes_tax !== true && (
                                      <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                                    )}
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    className="relative flex cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-2 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                    onClick={() => {
                                      update(idx, {
                                        price_includes_tax: true,
                                        unit_price: Math.round(inclPrice),
                                      });
                                    }}
                                  >
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-medium text-foreground">With Tax (Incl.)</span>
                                      <span className="text-[10px] text-muted-foreground font-mono">{formatMoney(inclPrice, currencyCode)}</span>
                                    </div>
                                    {item.price_includes_tax === true && (
                                      <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                                    )}
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          )}
                        </div>
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
                      <td className="sticky right-0 z-10 bg-card px-1.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
                          title="Delete line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded row for extra fields */}
                    {expanded && (
                      <tr className="bg-muted/10 border-b">
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
                              Taxable: {formatMoney(c.taxable, currencyCode)} · Tax: {formatMoney(c.gst, currencyCode)}
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
        <div className="border-2 border-dashed rounded-xl p-10 text-center text-muted-foreground text-sm">
          <p className="text-base font-medium text-foreground/60 mb-1">No items added yet</p>
          <p>Search for items above, use <strong>Add item</strong> to save to your catalog, or <strong>Add Line</strong> for a one-off row</p>
        </div>
      )}

      {/* Totals */}
      {items.length > 0 && showPricing && (
        <div className="flex justify-end">
          <div className="w-full max-w-sm space-y-1.5 text-sm bg-muted/30 rounded-xl px-5 py-4 border">
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
            <div className="flex justify-between border-t pt-2.5 font-bold text-lg">
              <span>Grand Total</span>
              <span className="tabular-nums">{formatMoney(totals.total, currencyCode)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compute overall totals from a list of line items.
 * Supports both line-level discounts (per item) and invoice-level discounts
 * (flat ₹ amount or % off the whole bill).
 * Delegates per-item base calculation to calcLine() so that each item's
 * price_includes_tax flag and the invoice pricingMode are handled correctly.
 */
export function computeTotals(
  items: VyaparLineItem[],
  isGst: boolean,
  roundOffEnabled = false,
  _pricingMode: 'inclusive' | 'exclusive' = 'exclusive', // kept for backwards compatibility in args, but ignored
  invoiceDiscountType: 'percent' | 'flat' | 'none' = 'none',
  invoiceDiscountValue: number = 0,
) {
  let subtotal = 0;
  let lineDiscount = 0;
  let baseTax = 0;
  let baseCess = 0;

  for (const item of items) {
    const gstRate = isGst ? Number(item.gst_rate) || 0 : 0;
    const cessRate = isGst ? Number(item.cess_rate) || 0 : 0;
    const totalRate = gstRate + cessRate;
    const qty = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const discountAmount = Number(item.discount_amount) || 0;

    const isInclusive = item.price_includes_tax === true;

    const gross_exclusive = isInclusive ? (unitPrice * qty) / (1 + totalRate / 100) : (unitPrice * qty);
    const discount_exclusive = isInclusive ? discountAmount / (1 + totalRate / 100) : discountAmount;

    subtotal += gross_exclusive;
    lineDiscount += discount_exclusive;

    const baseTax_row = gross_exclusive * (totalRate / 100);
    const cess_share = totalRate > 0 ? cessRate / totalRate : 0;
    baseCess += baseTax_row * cess_share;
    baseTax += baseTax_row * (1 - cess_share);
  }

  const taxableBeforeInvoiceDiscount = Math.max(0, subtotal - lineDiscount);
  let invoiceDiscountAmt = 0;
  if (invoiceDiscountType === 'percent' && invoiceDiscountValue > 0) {
    invoiceDiscountAmt = (taxableBeforeInvoiceDiscount * invoiceDiscountValue) / 100;
  } else if (invoiceDiscountType === 'flat' && invoiceDiscountValue > 0) {
    invoiceDiscountAmt = Math.min(invoiceDiscountValue, taxableBeforeInvoiceDiscount);
  }
  invoiceDiscountAmt = Math.max(0, Math.min(invoiceDiscountAmt, taxableBeforeInvoiceDiscount));

  const taxableAfterDiscount = taxableBeforeInvoiceDiscount - invoiceDiscountAmt;
  const scale = subtotal > 0 ? taxableAfterDiscount / subtotal : 1;
  const adjTax = baseTax * scale;
  const adjCess = baseCess * scale;

  const finalTaxable = taxableAfterDiscount;
  const finalTotal = taxableAfterDiscount + adjTax + adjCess;

  const roundedTotal = roundOffEnabled ? Math.round(finalTotal / 100) * 100 : Math.round(finalTotal);
  const roundOff = roundOffEnabled ? roundedTotal - Math.round(finalTotal) : 0;

  const safeVal = (v: number) => (Number.isFinite(v) && !Number.isNaN(v) ? Math.round(v) : 0);

  return {
    subtotal: safeVal(subtotal),
    lineDiscount: safeVal(lineDiscount),
    invoiceDiscount: safeVal(invoiceDiscountAmt),
    discount: safeVal(lineDiscount + invoiceDiscountAmt),
    taxable: safeVal(finalTaxable),
    tax: safeVal(adjTax),
    cess: safeVal(adjCess),
    roundOff: safeVal(roundOff),
    total: safeVal(roundedTotal),
  };
}
