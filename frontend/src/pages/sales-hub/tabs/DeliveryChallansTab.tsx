import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Truck, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-slate-100 text-slate-600',
  dispatched: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  converted: 'bg-violet-100 text-violet-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function DeliveryChallansTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [convertDialog, setConvertDialog] = useState<any>(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [challanDate, setChallanDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [transportName, setTransportName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-challans'],
    queryFn: () => api.get('/sales/challans', { params: { limit: 50 } }).then(r => r.data),
  });
  const challans = (data as any)?.data?.data || [];

  const createMut = useMutation({
    mutationFn: (payload: any) => api.post('/sales/challans', payload),
    onSuccess: () => {
      toast.success('Delivery challan created');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const convertMut = useMutation({
    mutationFn: ({ id, ...payload }: any) => api.post(`/sales/challans/${id}/convert`, payload),
    onSuccess: (res) => {
      toast.success('Converted to invoice');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
      qc.invalidateQueries({ queryKey: ['salesInvoices'] });
      const invoiceId = res.data?.data?.invoice_id;
      if (invoiceId) navigate(`/sales/${invoiceId}`);
      setConvertDialog(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Conversion failed'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/sales/challans/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
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
    clearCustomer(); setNotes(''); setTransportName(''); setVehicleNumber(''); setLrNumber(''); setDueDate(''); setItems([]);
    setChallanDate(new Date().toISOString().split('T')[0]);
  };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a customer'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createMut.mutate({
      party_id: partyId,
      challan_date: challanDate,
      due_date: dueDate || undefined,
      transport_name: transportName.trim() || undefined,
      vehicle_number: vehicleNumber.trim() || undefined,
      lr_number: lrNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      status: 'open',
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
        <p className="text-sm text-muted-foreground">Track goods dispatched to customers. Convert to invoice when payment is due.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Delivery Challan
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Challan No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Due Date</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground w-40">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && challans.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />No delivery challans yet.
              </td></tr>
            )}
            {challans.map((c: any) => (
              <tr key={c.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(c.challan_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{c.challan_number}</td>
                <td className="px-4 py-2.5 font-medium">{c.party_name_snapshot || c.party_name || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden lg:table-cell">
                  {c.due_date ? (
                    <span className={new Date(c.due_date) < new Date() && c.status !== 'converted' ? 'text-red-500 font-medium' : ''}>
                      {formatDate(c.due_date)}{new Date(c.due_date) < new Date() && c.status !== 'converted' ? ' · Overdue' : ''}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(c.total_amount)||0)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-500'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right flex justify-end gap-1.5">
                  {c.status === 'open' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                      onClick={() => statusMut.mutate({ id: c.id, status: 'dispatched' })}>
                      Dispatch
                    </Button>
                  )}
                  {(c.status === 'open' || c.status === 'dispatched' || c.status === 'delivered') && (
                    <Button size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => { setConvertDialog(c); setInvoiceDate(new Date().toISOString().split('T')[0]); setInvoiceNumber(''); }}>
                      Convert to Sale
                    </Button>
                  )}
                  {c.status === 'converted' && c.invoice_id && (
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                      onClick={() => navigate(`/sales/${c.invoice_id}`)}>
                      View Invoice
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Challan Sheet */}
      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>New Delivery Challan</SheetTitle></SheetHeader>
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
                <Label className="text-xs">Challan Date</Label>
                <Input type="date" className="mt-1 h-9" value={challanDate} onChange={e => setChallanDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Due Date (optional)</Label>
                <Input type="date" className="mt-1 h-9" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Transport / Courier</Label>
                <Input className="mt-1 h-9" placeholder="e.g. DTDC, own vehicle" value={transportName} onChange={e => setTransportName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Vehicle No.</Label>
                <Input className="mt-1 h-9 uppercase font-mono" placeholder="MH12AB1234" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value.toUpperCase())} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">LR / Docket No.</Label>
                <Input className="mt-1 h-9 font-mono" placeholder="Lorry receipt number" value={lrNumber} onChange={e => setLrNumber(e.target.value)} />
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
                Save Challan
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Convert to Invoice dialog */}
      {convertDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">Convert to Sale Invoice</h3>
            <p className="text-sm text-muted-foreground">
              Challan <span className="font-mono font-medium">{convertDialog.challan_number}</span> · {convertDialog.party_name_snapshot}
            </p>
            <div>
              <Label className="text-xs">Invoice Date</Label>
              <Input type="date" className="mt-1 h-9" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Invoice No. (optional)</Label>
              <Input className="mt-1 h-9 font-mono text-xs" placeholder="Auto-generated" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex gap-3 pt-2 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setConvertDialog(null)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" loading={convertMut.isPending}
                onClick={() => convertMut.mutate({ id: convertDialog.id, invoice_date: invoiceDate, invoice_number: invoiceNumber || undefined })}>
                Confirm & Create Invoice
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} partyType="customer" defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}
