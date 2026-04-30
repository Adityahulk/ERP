import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ClipboardList, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function SaleOrdersTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [soDate, setSoDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0];
  });
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['sale-orders'],
    queryFn: () => api.get('/sales/orders', { params: { limit: 50 } }).then(r => r.data),
  });
  const orders = (data as any)?.data?.data || [];

  const createMut = useMutation({
    mutationFn: (payload: any) => api.post('/sales/orders', payload),
    onSuccess: () => {
      toast.success('Sale order created');
      qc.invalidateQueries({ queryKey: ['sale-orders'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/sales/orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['sale-orders'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const searchCustomers = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); return; }
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
  };

  const selectCustomer = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); };
  const clearCustomer = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); };
  const resetForm = () => {
    clearCustomer(); setNotes(''); setPaymentTerms(''); setItems([]);
    setSoDate(new Date().toISOString().split('T')[0]);
    const d = new Date(); d.setDate(d.getDate() + 7);
    setExpectedDate(d.toISOString().split('T')[0]);
  };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a customer'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createMut.mutate({
      party_id: partyId,
      so_date: soDate,
      expected_delivery_date: expectedDate,
      payment_terms: paymentTerms.trim() || undefined,
      notes: notes.trim() || undefined,
      status: 'confirmed',
      items: items.map(it => ({
        item_id: it.item_id, item_name: it.name, hsn_code: it.hsn_code,
        unit: it.unit, quantity: it.quantity, unit_price: it.unit_price,
        gst_rate: it.gst_rate, discount_amount: it.discount_amount || 0,
      })),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage confirmed customer orders before dispatch.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Sale Order
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Customer</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">SO No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Exp. Delivery</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Total</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground w-36">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && orders.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />No sale orders yet.
              </td></tr>
            )}
            {orders.map((o: any) => (
              <tr key={o.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">{o.party_name_snapshot || o.party_name || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{o.so_number}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{formatDate(o.so_date)}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden lg:table-cell">{o.expected_delivery_date ? formatDate(o.expected_delivery_date) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(o.total_amount)||0)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-500'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {o.status === 'confirmed' || o.status === 'partial' ? (
                    <Button size="sm" variant="default" className="h-7 text-xs px-3 bg-indigo-600 hover:bg-indigo-700"
                      onClick={() => statusMut.mutate({ id: o.id, status: 'fulfilled' })}>
                      Mark Fulfilled
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>New Sale Order</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Customer *</Label>
              {partyId ? (
                <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={clearCustomer}>Change</button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Input placeholder="Search customer…" value={partySearch} onChange={e => searchCustomers(e.target.value)} className="h-9" />
                    {partyResults.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {partyResults.map((p: any) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectCustomer(p)}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setQuickAddOpen(true)}>
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Order Date</Label>
                <Input type="date" className="mt-1 h-9" value={soDate} onChange={e => setSoDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Expected Delivery</Label>
                <Input type="date" className="mt-1 h-9" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Payment Terms (optional)</Label>
                <Input className="mt-1 h-9" placeholder="e.g. Net 30, 50% advance" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Items</Label>
              <VyaparLineItems items={items} onChange={setItems} isGst={true} searchMode="catalog" showHsn showUnit />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createMut.isPending} onClick={handleCreate} disabled={!partyId || items.length === 0}>
                Save Order
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} partyType="customer" defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}
