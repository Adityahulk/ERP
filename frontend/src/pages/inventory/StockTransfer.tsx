import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGodowns, useCreateTransfer, useItemsForTransfer } from '@/hooks/useStock';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Loader2, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface TransferItem {
  item_id: string;
  name: string;
  sku?: string;
  available: number;
  quantity: number;
}

function availableFromRow(row: Record<string, unknown>): number {
  const gAvail = Number(row.godown_available);
  if (!Number.isNaN(gAvail)) return gAvail;
  const gQty = Number(row.godown_quantity);
  if (!Number.isNaN(gQty)) return gQty;
  return Number(row.quantity) || 0;
}

export default function StockTransfer() {
  const navigate = useNavigate();
  const { data: godownData } = useGodowns();
  const createTransfer = useCreateTransfer();
  const godowns = godownData?.data || [];

  const [fromGodown, setFromGodown] = useState('');
  const [toGodown, setToGodown] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<TransferItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 320);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const { data: searchRows = [], isFetching: searchLoading } = useItemsForTransfer(debouncedSearch, fromGodown || undefined);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const addItem = (row: Record<string, unknown>) => {
    const id = String(row.id);
    const avail = availableFromRow(row);
    if (avail <= 0) {
      toast.error('No available quantity in this godown');
      return;
    }
    if (items.find((i) => i.item_id === id)) {
      toast.error('Item already in list');
      return;
    }
    setItems([
      ...items,
      {
        item_id: id,
        name: String(row.name || ''),
        sku: row.sku ? String(row.sku) : undefined,
        available: avail,
        quantity: Math.min(1, avail),
      },
    ]);
    setSearchTerm('');
    setDebouncedSearch('');
    setPickerOpen(false);
  };

  const updateQty = (idx: number, qty: number) => {
    const updated = [...items];
    updated[idx].quantity = Math.max(0, Math.min(qty, updated[idx].available));
    setItems(updated);
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!fromGodown || !toGodown) {
      toast.error('Select both godowns');
      return;
    }
    if (fromGodown === toGodown) {
      toast.error('Source and destination must be different');
      return;
    }
    if (!items.length) {
      toast.error('Add at least one item');
      return;
    }
    if (items.some((i) => i.quantity <= 0)) {
      toast.error('All quantities must be positive');
      return;
    }

    try {
      await createTransfer.mutateAsync({
        from_godown_id: fromGodown,
        to_godown_id: toGodown,
        transfer_date: date,
        notes,
        items: items.map((i) => ({ item_id: i.item_id, quantity: i.quantity })),
      });
      toast.success('Stock transferred successfully');
      navigate('/inventory');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Transfer failed');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Stock transfer</h1>
          <p className="text-sm text-muted-foreground">
            Search by name or SKU, then move stock immediately between godowns.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-2 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">From (source)</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              className="w-full h-10 rounded-md border bg-transparent px-3 text-sm font-medium"
              value={fromGodown}
              onChange={(e) => {
                setFromGodown(e.target.value);
                setItems([]);
                setSearchTerm('');
                setDebouncedSearch('');
              }}
            >
              <option value="">Select source godown</option>
              {godowns.filter((g: { id: string }) => g.id !== toGodown).map((g: { id: string; name: string }) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        <div className="hidden md:flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <ArrowRight className="w-5 h-5 text-primary" />
          </div>
        </div>

        <Card className="border-2 border-dashed md:col-start-2 md:row-start-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">To (destination)</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              className="w-full h-10 rounded-md border bg-transparent px-3 text-sm font-medium"
              value={toGodown}
              onChange={(e) => setToGodown(e.target.value)}
            >
              <option value="">Select destination godown</option>
              {godowns.filter((g: { id: string }) => g.id !== fromGodown).map((g: { id: string; name: string }) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label>Transfer date</Label>
          <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label>Notes (optional)</Label>
          <Input className="mt-1" placeholder="Reason for transfer…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {fromGodown && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Items to transfer</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Type at least one character to search by product name, SKU, barcode, or HSN. Only items with stock in the
              source godown are listed.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative" ref={pickerRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search items (e.g. Rice, 8517…)"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPickerOpen(true);
                  }}
                  onFocus={() => setPickerOpen(true)}
                />
                {searchLoading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {pickerOpen && debouncedSearch.length >= 1 && (
                <div className="absolute z-20 w-full mt-1 bg-popover border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {!searchLoading && searchRows.length === 0 && (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No matching in-stock items.</p>
                  )}
                  {searchRows.map((row) => {
                    const avail = availableFromRow(row);
                    return (
                      <button
                        key={String(row.id)}
                        type="button"
                        className="w-full text-left px-4 py-2.5 hover:bg-muted text-sm flex justify-between gap-2 border-b last:border-0"
                        onClick={() => addItem(row)}
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{String(row.name)}</span>
                          {row.sku ? <span className="text-muted-foreground ml-1 font-mono text-xs">{String(row.sku)}</span> : null}
                        </span>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          {avail} avail
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {items.length === 0 && (
              <p className="text-center text-muted-foreground py-6 text-sm">Search above to add products to this transfer.</p>
            )}

            {items.map((item, idx) => (
              <div key={item.item_id} className="flex items-center gap-4 p-3 rounded-lg border">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.sku || '—'} · {item.available} available
                  </p>
                </div>
                <Input
                  type="number"
                  className="w-24 tabular-nums text-center"
                  min={0.01}
                  step="0.01"
                  max={item.available}
                  value={item.quantity || ''}
                  onChange={(e) => updateQty(idx, parseFloat(e.target.value) || 0)}
                />
                <Button variant="ghost" size="icon" type="button" onClick={() => removeItem(idx)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="outline" type="button" onClick={() => navigate('/inventory')}>
          Cancel
        </Button>
        <Button disabled={!items.length} loading={createTransfer.isPending} type="button" onClick={handleSubmit}>
          Transfer now ({items.length} {items.length === 1 ? 'item' : 'items'})
        </Button>
      </div>
    </div>
  );
}
