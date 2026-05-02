import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Search, IndianRupee, CheckCircle2, AlertCircle, FileText, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'credit'];

function PaymentBadge({ status }: { status: string }) {
  if (status === 'paid') return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">Paid</span>;
  if (status === 'partial') return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700">Partial</span>;
  return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">Unpaid</span>;
}

export default function PurchaseBillsTab() {
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState<{ id: string; billNo: string; balance: number } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('cash');

  // Form state
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [billNumber, setBillNumber] = useState('');
  const [godownId, setGodownId] = useState('');
  const [isGst, setIsGst] = useState(true);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-bills', search, statusFilter],
    queryFn: () =>
      api.get('/purchases/invoices', {
        params: { search: search || undefined, payment_status: statusFilter || undefined, limit: 50 },
      }).then(r => r.data),
  });

  const bills = (data as any)?.data?.data || [];
  const meta = (data as any)?.meta || {};
  const stats = [
    { label: 'Paid', value: formatMoney(parseInt(meta.total_paid) || 0), icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Unpaid', value: formatMoney(parseInt(meta.total_unpaid) || 0), icon: AlertCircle, color: 'text-red-500 bg-red-50' },
    { label: 'Total', value: formatMoney(parseInt(meta.total_amount) || 0), icon: IndianRupee, color: 'text-blue-600 bg-blue-50' },
  ];

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/purchases/invoices', payload),
    onSuccess: () => {
      toast.success('Purchase bill created');
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      resetForm();
      setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create bill'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amount, mode }: { id: string; amount: number; mode: string }) =>
      api.post(`/purchases/invoices/${id}/payment`, { amount, payment_mode: mode }),
    onSuccess: () => {
      toast.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      setShowPayDialog(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Payment failed'),
  });

  const searchSuppliers = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); return; }
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
  };

  const selectSupplier = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); };
  const clearSupplier = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); };

  const resetForm = () => {
    setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]);
    setBillDate(new Date().toISOString().split('T')[0]); setBillNumber('');
    setGodownId(''); setNotes(''); setItems([]);
  };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createMutation.mutate({
      party_id: partyId,
      bill_date: billDate,
      bill_number: billNumber.trim() || undefined,
      godown_id: godownId || undefined,
      is_gst_invoice: isGst,
      notes: notes.trim() || undefined,
      items: items.map(it => ({
        item_id: it.item_id,
        item_name: it.name,
        hsn_code: it.hsn_code,
        unit: it.unit,
        quantity: it.quantity,
        unit_price: it.unit_price,
        gst_rate: it.gst_rate,
      })),
    });
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.color}`}>
                <s.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search bills…" className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['', 'unpaid', 'partial', 'paid'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="ml-auto">
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> Add Purchase
          </Button>
        </div>
      </div>

      {/* Bills Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Bill No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground hidden sm:table-cell">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground hidden md:table-cell">Balance</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && bills.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No purchase bills. Click <strong>Add Purchase</strong> to create one.
              </td></tr>
            )}
            {bills.map((b: any) => {
              const balance = (parseInt(b.total_amount)||0) - (parseInt(b.paid_amount)||0);
              return (
                <tr key={b.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(b.bill_date)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">{b.bill_number || '—'}</td>
                  <td className="px-4 py-2.5 font-medium">{b.party_name || '—'}</td>
                  <td className="px-4 py-2.5 text-center hidden sm:table-cell">
                    <PaymentBadge status={b.payment_status || 'unpaid'} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(b.total_amount)||0)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold hidden md:table-cell ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    {balance > 0 ? formatMoney(balance) : '✓ Paid'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {balance > 0 && (
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                          onClick={() => { setShowPayDialog({ id: b.id, billNo: b.bill_number, balance }); setPayAmount((balance / 100).toFixed(2)); }}>
                          Pay
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Bill Sheet */}
      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>Add Purchase Bill</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            {/* Party */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Party *</Label>
                {partyId ? (
                  <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                    <span className="font-medium text-sm">{partyName}</span>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={clearSupplier}>Change</button>
                  </div>
                ) : (
                  <div className="mt-1 flex gap-2">
                    <div className="relative flex-1">
                      <Input placeholder="Search party…" value={partySearch} onChange={e => searchSuppliers(e.target.value)} className="h-9" />
                      {partyResults.length > 0 && (
                        <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {partyResults.map((p: any) => (
                            <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectSupplier(p)}>
                              <span className="font-medium">{p.name}</span>
                              {p.gstin && <span className="text-muted-foreground ml-2 text-xs font-mono">{p.gstin}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={() => { setQuickAddOpen(true); }}>
                      <UserPlus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Bill Date</Label>
                <Input type="date" className="mt-1 h-9" value={billDate} onChange={e => setBillDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Vendor bill no. (optional)</Label>
                <Input className="mt-1 h-9 font-mono text-xs" placeholder="Auto-generated" value={billNumber} onChange={e => setBillNumber(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Godown (optional)</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                  <option value="">None</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 h-9">
                  <input type="checkbox" checked={isGst} onChange={e => setIsGst(e.target.checked)} />
                  GST Invoice
                </label>
              </div>
            </div>

            {/* Items */}
            <div>
              <Label className="text-xs mb-2 block">Items</Label>
              <VyaparLineItems
                items={items}
                onChange={setItems}
                isGst={isGst}
                searchMode="catalog"
                defaultRateFrom="purchase"
                godownId={godownId}
                showHsn={true}
                showUnit={true}
              />
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending} onClick={handleCreate} disabled={!partyId || items.length === 0}>
                Save Bill
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Payment Dialog */}
      {showPayDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">Record Payment</h3>
            <p className="text-sm text-muted-foreground">Bill: {showPayDialog.billNo} · Balance: {formatMoney(showPayDialog.balance)}</p>
            <div>
              <Label className="text-xs">Amount (₹) *</Label>
              <Input type="number" className="mt-1 tabular-nums" min={0.01} step={0.01}
                value={payAmount} onChange={e => setPayAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Payment Mode</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={payMode} onChange={e => setPayMode(e.target.value)}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowPayDialog(null)}>Cancel</Button>
              <Button className="flex-1" loading={payMutation.isPending}
                onClick={() => payMutation.mutate({ id: showPayDialog.id, amount: Math.round(parseFloat(payAmount || '0') * 100), mode: payMode })}>
                Record Payment
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
