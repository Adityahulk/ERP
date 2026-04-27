import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Plus, Trash2, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';

type PoLine = {
  item_id: string;
  item_name: string;
  hsn_code: string;
  quantity: number;
  unit_price: number;
  gst_rate: number;
};

export default function PurchaseOrderForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  const { data: partyRes, isLoading: partiesLoading } = useQuery({
    queryKey: ['parties', 'suppliers'],
    queryFn: () => api.get('/parties', { params: { party_type: 'supplier', limit: 100 } }).then((r) => r.data?.data ?? r.data),
  });
  const suppliers = (partyRes as any)?.data ?? [];

  const { data: itemRes, isLoading: itemsLoading } = useQuery({
    queryKey: ['items', 'po-form'],
    queryFn: () => api.get('/items', { params: { limit: 100 } }).then((r) => r.data?.data ?? r.data),
  });
  const catalogItems = (itemRes as any)?.data ?? [];

  const [partyId, setPartyId] = useState('');
  const [godownId, setGodownId] = useState('');
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [lines, setLines] = useState<PoLine[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');

  const defaultGodown = useMemo(() => {
    const def = godowns.find((g: any) => g.is_default);
    return def?.id ?? godowns[0]?.id ?? '';
  }, [godowns]);

  useEffect(() => {
    if (!godownId && defaultGodown) setGodownId(defaultGodown);
  }, [godownId, defaultGodown]);

  const addLineFromItemId = (itemId: string) => {
    const it = catalogItems.find((x: any) => x.id === itemId);
    if (!it || it.item_type === 'service' || !it.track_inventory) return;
    if (lines.some((l) => l.item_id === it.id)) {
      toast.error('Item already on this PO');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        item_id: it.id,
        item_name: it.name,
        hsn_code: it.hsn_code || '',
        quantity: 1,
        unit_price: it.purchase_price ?? 0,
        gst_rate: it.gst_rate ?? 0,
      },
    ]);
  };

  const updateLine = (idx: number, patch: Partial<PoLine>) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const createPO = useMutation({
    mutationFn: async () => {
      return api.post('/purchases/orders', {
        party_id: partyId,
        godown_id: godownId,
        po_date: new Date().toISOString().split('T')[0],
        expected_date: expectedDate,
        items: lines.map((l) => ({
          item_id: l.item_id,
          item_name: l.item_name,
          hsn_code: l.hsn_code,
          quantity: l.quantity,
          unit_price: l.unit_price,
          gst_rate: l.gst_rate,
        })),
      });
    },
    onSuccess: () => {
      toast.success('Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      navigate('/purchases');
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error || e.message || 'Failed to create PO');
    },
  });

  const loadingMeta = partiesLoading || itemsLoading;

  const onSupplierCreated = (row: Record<string, unknown>) => {
    const id = String(row.id);
    setPartyId(id);
    qc.setQueryData(['parties', 'suppliers'], (old: unknown) => {
      const o = old as { data?: unknown[]; pagination?: Record<string, unknown> } | undefined;
      if (!o || !Array.isArray(o.data)) return o;
      if (o.data.some((s) => String((s as { id?: string }).id) === id)) return o;
      return { ...o, data: [...o.data, row] };
    });
    void qc.invalidateQueries({ queryKey: ['parties', 'suppliers'] });
  };

  const openQuickAddSupplier = (prefillName?: string) => {
    setQuickAddDefaultName(prefillName ?? '');
    setQuickAddOpen(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/purchases')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New purchase order</h1>
          <p className="text-sm text-muted-foreground">Choose supplier, godown, and stock lines (same as after seed).</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">
          {loadingMeta ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Supplier</Label>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      className="h-10 w-full min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                      value={partyId}
                      onChange={(e) => setPartyId(e.target.value)}
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.gstin ? ` — ${s.gstin}` : ''}
                        </option>
                      ))}
                    </select>
                    <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => openQuickAddSupplier()}>
                      <UserPlus className="h-4 w-4" />
                      New supplier
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Receive into godown</Label>
                  <select
                    className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm"
                    value={godownId}
                    onChange={(e) => setGodownId(e.target.value)}
                  >
                    {godowns.map((g: any) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {g.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label>Expected date</Label>
                  <Input type="date" className="mt-1 max-w-xs" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Add item</Label>
                <select
                  className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) addLineFromItemId(v);
                    e.target.value = '';
                  }}
                >
                  <option value="">Select product to add…</option>
                  {catalogItems
                    .filter((it: any) => it.track_inventory && it.item_type !== 'service')
                    .map((it: any) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                </select>
              </div>

              {lines.length > 0 && (
                <div className="space-y-4">
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2">Item</th>
                          <th className="p-2 w-24">Qty</th>
                          <th className="p-2 w-32">Unit price (₹)</th>
                          <th className="p-2 w-20">GST %</th>
                          <th className="p-2 w-24 text-right">Total (₹)</th>
                          <th className="p-2 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, idx) => {
                          const base = (line.unit_price || 0) * (line.quantity || 0);
                          const tax = (base * (line.gst_rate || 0)) / 100;
                          const total = base + tax;
                          return (
                            <tr key={line.item_id} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{line.item_name}</div>
                                <div className="text-xs text-muted-foreground">HSN {line.hsn_code || '—'}</div>
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min={1}
                                  className="h-9"
                                  value={line.quantity}
                                  onChange={(e) => updateLine(idx, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  className="h-9 tabular-nums"
                                  value={(line.unit_price / 100).toFixed(2)}
                                  onChange={(e) => updateLine(idx, { unit_price: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-9"
                                  value={line.gst_rate}
                                  onChange={(e) => updateLine(idx, { gst_rate: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                />
                              </td>
                              <td className="p-2 text-right tabular-nums font-medium">
                                {((total) / 100).toFixed(2)}
                              </td>
                              <td className="p-2 text-right">
                                <Button type="button" variant="ghost" size="icon" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Section */}
                  <div className="flex justify-end pt-4 border-t">
                    <div className="w-full max-w-sm space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal (Excl. Tax)</span>
                        <span className="tabular-nums font-medium">
                          ₹{(lines.reduce((s, l) => s + (l.unit_price * l.quantity), 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total GST (Tax Amount)</span>
                        <span className="tabular-nums text-indigo-600">
                          ₹{(lines.reduce((s, l) => s + (l.unit_price * l.quantity * l.gst_rate / 100), 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between border-t pt-2 text-lg font-bold">
                        <span>Grand Total</span>
                        <span className="tabular-nums">
                          ₹{(lines.reduce((s, l) => s + (l.unit_price * l.quantity * (1 + l.gst_rate / 100)), 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground text-right italic">
                        * Calculations are in Paise for maximum precision, shown here in Rupees.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => createPO.mutate()}
                  disabled={!partyId || !godownId || lines.length === 0}
                  loading={createPO.isPending}
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Save purchase order
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/purchases')}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <QuickAddPartySheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        partyType="supplier"
        defaultName={quickAddDefaultName}
        onCreated={onSupplierCreated}
      />
    </div>
  );
}
