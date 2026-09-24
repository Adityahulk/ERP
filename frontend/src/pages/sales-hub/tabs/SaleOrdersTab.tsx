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
import SalesDocumentActionMenu from '@/components/transactions/SalesDocumentActionMenu';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [soNumber, setSoNumber] = useState('');

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
    mutationFn: (payload: any) => editingId ? api.put(`/sales/orders/${editingId}`, payload) : api.post('/sales/orders', payload),
    onSuccess: () => {
      toast.success(editingId ? 'Sale order updated' : 'Sale order created');
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
    setEditingId(null); setSoNumber('');
    clearCustomer(); setNotes(''); setPaymentTerms(''); setItems([]);
    setSoDate(new Date().toISOString().split('T')[0]);
    const d = new Date(); d.setDate(d.getDate() + 7);
    setExpectedDate(d.toISOString().split('T')[0]);
  };

  const openOrderForm = async (row: any, duplicate = false) => {
    const loadingToast = toast.loading(duplicate ? 'Preparing duplicate…' : 'Loading sale order…');
    try {
      const response = await api.get(`/sales/orders/${row.id}`);
      const order = response.data?.data;
      setEditingId(duplicate ? null : order.id);
      setSoNumber(duplicate ? '' : order.so_number || '');
      setPartyId(order.party_id || '');
      setPartyName(order.party_name_snapshot || order.party_name || '');
      setSoDate(duplicate ? new Date().toISOString().split('T')[0] : String(order.so_date || '').slice(0, 10));
      setExpectedDate(String(order.expected_delivery_date || '').slice(0, 10));
      setPaymentTerms(order.payment_terms || '');
      setNotes(order.notes || '');
      setItems((order.items || []).map((item: any) => ({
        item_id: item.item_id || '', name: item.item_name || 'Item', hsn_code: item.hsn_code || '',
        unit: item.unit || '', quantity: Number(item.quantity_ordered) || 0,
        unit_price: Number(item.unit_price) || 0, gst_rate: Number(item.gst_rate) || 0,
        discount_amount: Number(item.discount_amount) || 0,
      })));
      setShowForm(true);
      toast.success(duplicate ? 'Review the duplicate and save it as a new order.' : 'Sale order ready to edit', { id: loadingToast });
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to load sale order', { id: loadingToast });
    }
  };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createMut.mutate({
      ...(editingId ? { so_number: soNumber } : {}),
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
        <p className="text-sm text-muted-foreground">Manage confirmed orders before dispatch.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Sale Order
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
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
                  <div className="flex items-center justify-end gap-1">
                  {o.status === 'confirmed' || o.status === 'partial' ? (
                    <Button size="sm" variant="default" className="h-7 text-xs px-3 bg-indigo-600 hover:bg-indigo-700"
                      onClick={() => statusMut.mutate({ id: o.id, status: 'fulfilled' })}>
                      Mark Fulfilled
                    </Button>
                  ) : null}
                  <SalesDocumentActionMenu
                    basePath={`/sales/orders/${o.id}`}
                    documentNumber={o.so_number}
                    documentTitle="Sale Order"
                    phone={o.party_phone}
                    email={o.party_email}
                    canModify={o.status !== 'fulfilled' && o.status !== 'cancelled'}
                    canCancel={o.status !== 'cancelled' && o.status !== 'fulfilled'}
                    onEdit={() => void openOrderForm(o)}
                    onDuplicate={() => void openOrderForm(o, true)}
                    onCancel={async () => {
                      if (!window.confirm(`Cancel sale order ${o.so_number}?`)) return;
                      await api.patch(`/sales/orders/${o.id}/status`, { status: 'cancelled' });
                      toast.success('Sale order cancelled');
                      await qc.invalidateQueries({ queryKey: ['sale-orders'] });
                    }}
                    onDelete={async () => {
                      if (!window.confirm(`Delete sale order ${o.so_number}? This cannot be undone.`)) return;
                      await api.delete(`/sales/orders/${o.id}`);
                      toast.success('Sale order deleted');
                      await qc.invalidateQueries({ queryKey: ['sale-orders'] });
                    }}
                  />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>{editingId ? 'Edit Sale Order' : 'New Sale Order'}</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Party *</Label>
              {partyId ? (
                <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={clearCustomer}>Change</button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Input placeholder="Search party…" value={partySearch} onChange={e => searchCustomers(e.target.value)} className="h-9" />
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
              {editingId && (
                <div className="col-span-2">
                  <Label className="text-xs">Sale Order No.</Label>
                  <Input className="mt-1 h-9 font-mono" value={soNumber} onChange={e => setSoNumber(e.target.value)} />
                </div>
              )}
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
                {editingId ? 'Update Order' : 'Save Order'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}
