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
import { formatMoney } from '@/lib/formatters';
import { GST_RATE_OPTIONS } from '@/lib/gstRates';
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
  cess_rate?: number;
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
}

const GST_OPTIONS = GST_RATE_OPTIONS;

function calcLine(item: VyaparLineItem, isGst: boolean) {
  const gross = item.quantity * item.unit_price;
  const taxable = Math.max(0, gross - item.discount_amount);
  const gst = isGst ? Math.round(taxable * item.gst_rate / 100) : 0;
  const cess = isGst ? Math.round(taxable * (item.cess_rate || 0) / 100) : 0;
  return { gross, taxable, gst, cess, total: taxable + gst + cess };
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
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const addFromCatalog = (item: any) => {
    if (items.find((i) => i.item_id === item.id)) return;
    onChange([
      ...items,
      {
        item_id: item.id,
        name: item.name,
        hsn_code: item.hsn_code || '',
        item_type: item.item_type,
        track_inventory: item.track_inventory,
        unit: item.unit || item.unit_name || 'PCS',
        quantity: 1,
        unit_price: lineUnitPriceFromItem(item),
        discount_amount: 0,
        gst_rate: Number(item.gst_rate ?? 18),
        cess_rate: Number(item.cess_rate ?? 0),
      },
    ]);
    setQuery('');
    setResults([]);
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
    setQuery('');
    setResults([]);
  };

  const update = (idx: number, patch: Partial<VyaparLineItem>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
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
    <div className="space-y-3">
      {/* Search / Add Row */}
      <div className="relative">
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 h-10"
              placeholder="Search items or type name to add manually…"
              value={query}
              onChange={(e) => runSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && query.trim() && addManualLine()}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 gap-1.5 shrink-0"
            onClick={openQuickAddItem}
          >
            <PackagePlus className="w-4 h-4" />
            Add item
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 gap-1.5 shrink-0"
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
                onClick={() => addFromCatalog(it)}
              >
                <div className="min-w-0">
                  <span className="font-medium">{it.name}</span>
                  {it.sku && <span className="text-muted-foreground ml-2 text-xs">{it.sku}</span>}
                </div>
                <div className="text-right flex-shrink-0 text-muted-foreground text-xs">
                  {formatMoney(Number(it.unit_price ?? it.selling_price ?? 0))}
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
                onClick={addManualLine}
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

      {/* Items Table */}
      {items.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Item</th>
                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground w-20">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground w-28">Rate (₹)</th>
                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground w-24 hidden sm:table-cell">Disc (₹)</th>
                {isGst && (
                  <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground w-20 hidden sm:table-cell">GST %</th>
                )}
                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground w-24">Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const c = calcLine(item, isGst);
                const expanded = expandedRows.has(idx);
                return (
                  <Fragment key={idx}>
                    <tr className="border-b hover:bg-muted/10">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-8 text-sm font-medium min-w-[120px]"
                            value={item.name}
                            onChange={(e) => update(idx, { name: e.target.value })}
                            placeholder="Item name"
                          />
                          <button
                            type="button"
                            className="p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleExpand(idx)}
                            title={expanded ? 'Collapse' : 'More options'}
                          >
                            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          className="h-8 text-right w-20 tabular-nums"
                          min={0}
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) => update(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput
                          className="h-8 text-right w-28 tabular-nums"
                          placeholder="0"
                          value={item.unit_price}
                          onChange={(unit_price) => update(idx, { unit_price })}
                        />
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <MoneyInput
                          className="h-8 text-right w-24 tabular-nums"
                          placeholder="0"
                          value={item.discount_amount}
                          onChange={(discount_amount) => update(idx, { discount_amount })}
                        />
                      </td>
                      {isGst && (
                        <td className="px-3 py-2 hidden sm:table-cell">
                          <select
                            className="h-8 w-20 rounded-md border bg-transparent text-sm text-right px-2 tabular-nums"
                            value={item.gst_rate}
                            onChange={(e) => update(idx, { gst_rate: parseInt(e.target.value) })}
                          >
                            {GST_OPTIONS.map((g) => (
                              <option key={g} value={g}>{g}%</option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {formatMoney(c.total)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded row for extra fields */}
                    {expanded && (
                      <tr className="bg-muted/20 border-b">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex flex-wrap gap-3 text-xs">
                            {showHsn && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground w-16">{item.item_type === 'service' ? 'SAC Code' : 'HSN Code'}</span>
                                <Input
                                  className="h-7 w-28 text-xs font-mono"
                                  value={item.hsn_code || ''}
                                  onChange={(e) => update(idx, { hsn_code: e.target.value })}
                                  placeholder={item.item_type === 'service' ? 'SAC' : 'HSN'}
                                />
                              </div>
                            )}
                            {showUnit && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground w-8">Unit</span>
                                <Input
                                  className="h-7 w-20 text-xs"
                                  value={item.unit || ''}
                                  onChange={(e) => update(idx, { unit: e.target.value })}
                                  placeholder="PCS"
                                />
                              </div>
                            )}
                            {showDescription && (
                              <div className="flex items-center gap-2 flex-1">
                                <span className="text-muted-foreground w-16">Description</span>
                                <Input
                                  className="h-7 flex-1 text-xs"
                                  value={item.description || ''}
                                  onChange={(e) => update(idx, { description: e.target.value })}
                                  placeholder="Optional description"
                                />
                              </div>
                            )}
                            {isGst && showCess && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground w-12">Cess %</span>
                                <Input
                                  type="number"
                                  className="h-7 w-16 text-xs"
                                  min={0}
                                  value={item.cess_rate || 0}
                                  onChange={(e) => update(idx, { cess_rate: parseFloat(e.target.value) || 0 })}
                                />
                              </div>
                            )}
                            {/* Mobile: disc & gst in expanded row */}
                            <div className="flex items-center gap-2 sm:hidden">
                              <span className="text-muted-foreground w-16">Disc (₹)</span>
                              <MoneyInput
                                className="h-7 w-24 text-xs"
                                placeholder="0"
                                value={item.discount_amount}
                                onChange={(discount_amount) => update(idx, { discount_amount })}
                              />
                            </div>
                            {isGst && (
                              <div className="flex items-center gap-2 sm:hidden">
                                <span className="text-muted-foreground w-12">GST %</span>
                                <select
                                  className="h-7 w-20 rounded border bg-transparent text-xs px-2"
                                  value={item.gst_rate}
                                  onChange={(e) => update(idx, { gst_rate: parseInt(e.target.value) })}
                                >
                                  {GST_OPTIONS.map((g) => <option key={g} value={g}>{g}%</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                          {isGst && (
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              Taxable: {formatMoney(c.taxable)} · GST: {formatMoney(c.gst)}
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
      {items.length > 0 && (
        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm bg-muted/30 rounded-xl px-4 py-3 border">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal (taxable)</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(totals.subtotal)}</span>
            </div>
            {isGst && (
              <>
                {isInterstate ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>IGST</span>
                    <span className="tabular-nums">{formatMoney(totals.tax)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>CGST</span>
                      <span className="tabular-nums">{formatMoney(Math.round(totals.tax / 2))}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>SGST</span>
                      <span className="tabular-nums">{formatMoney(Math.round(totals.tax / 2))}</span>
                    </div>
                  </>
                )}
                {totals.cess > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Cess</span>
                    <span className="tabular-nums">{formatMoney(totals.cess)}</span>
                  </div>
                )}
              </>
            )}
            {!isGst && (
              <div className="flex justify-between text-muted-foreground text-xs italic">
                <span>GST</span><span>Non-GST mode</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 font-bold text-base">
              <span>Grand Total</span>
              <span className="tabular-nums">{formatMoney(totals.total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compute overall totals from a list of line items */
export function computeTotals(items: VyaparLineItem[], isGst: boolean) {
  return items.reduce(
    (acc, item) => {
      const gross = item.quantity * item.unit_price;
      const taxable = Math.max(0, gross - item.discount_amount);
      const gst = isGst ? Math.round(taxable * item.gst_rate / 100) : 0;
      const cess = isGst ? Math.round(taxable * (item.cess_rate || 0) / 100) : 0;
      acc.subtotal += gross;
      acc.discount += item.discount_amount;
      acc.taxable += taxable;
      acc.tax += gst;
      acc.cess += cess;
      acc.total += taxable + gst + cess;
      return acc;
    },
    { subtotal: 0, discount: 0, taxable: 0, tax: 0, cess: 0, total: 0 },
  );
}
