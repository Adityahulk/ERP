import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ArrowDownLeft, UserPlus, Wallet, CalendarClock, X } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import toast from 'react-hot-toast';

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
];

export default function PaymentOutTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // List filters — all three map to real params listPayments already supports
  const [filterPartyId, setFilterPartyId] = useState('');
  const [filterPartyName, setFilterPartyName] = useState('');
  const [filterPartySearch, setFilterPartySearch] = useState('');
  const [filterPartyOpen, setFilterPartyOpen] = useState(false);
  const [filterMode, setFilterMode] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Form state
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payMode, setPayMode] = useState('cash');
  const [refNumber, setRefNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [applyToBillId, setApplyToBillId] = useState('');

  // Real Payment-Out transactions — GET /payments?payment_type=outgoing
  const { data, isLoading } = useQuery({
    queryKey: ['payment-out', filterPartyId, filterMode, filterFrom, filterTo],
    queryFn: async () => {
      const res = await api.get('/payments', {
        params: {
          payment_type: 'outgoing',
          party_id: filterPartyId || undefined,
          payment_mode: filterMode || undefined,
          from_date: filterFrom || undefined,
          to_date: filterTo || undefined,
          limit: 100,
        },
      });
      return res.data;
    },
  });
  const payments: any[] = (data as any)?.data?.data || [];

  // Outstanding Payables summary card — real, company-wide, from the existing report endpoint
  const { data: payablesData } = useQuery({
    queryKey: ['payment-out-outstanding-payables'],
    queryFn: () => api.get('/reports/outstanding-payables').then((r) => r.data?.data ?? []),
  });
  const outstandingPayables = (payablesData || []).reduce((s: number, r: any) => s + (parseInt(r.balance_due) || 0), 0);

  const totalPaid = payments.reduce((s, p) => s + (parseInt(p.amount) || 0), 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const paidThisMonth = payments.filter((p) => p.payment_date >= monthStart).reduce((s, p) => s + (parseInt(p.amount) || 0), 0);

  // Filter party search dropdown
  const { data: filterPartyResults } = useQuery({
    queryKey: ['payment-out-filter-party', filterPartySearch],
    enabled: filterPartyOpen,
    queryFn: () => api.get('/parties/search', { params: { q: filterPartySearch } }).then((r) => r.data?.data ?? r.data),
  });

  // Outstanding bills for the selected supplier, for optional invoice linking
  const { data: outstandingBillsForParty } = useQuery({
    queryKey: ['payment-out-party-bills', partyId],
    enabled: !!partyId,
    queryFn: () => api.get('/purchases/invoices', { params: { party_id: partyId, limit: 50 } }).then((r) => (r.data?.data?.data || []).filter((b: any) => (parseInt(b.total_amount) || 0) - (parseInt(b.paid_amount) || 0) > 0)),
  });

  const createPaymentOut = useMutation({
    mutationFn: async (payload: any) => {
      const body: any = {
        payment_type: 'outgoing',
        party_id: payload.party_id || undefined,
        amount: payload.amount,
        payment_date: payload.pay_date,
        payment_mode: payload.pay_mode,
        reference_number: payload.ref_number || undefined,
        notes: payload.notes || undefined,
      };
      if (payload.apply_to_bill_id) {
        body.allocations = [{ invoice_id: payload.apply_to_bill_id, amount: payload.amount }];
      }
      return api.post('/payments', body);
    },
    onSuccess: () => {
      toast.success('Payment-Out recorded');
      qc.invalidateQueries({ queryKey: ['payment-out'] });
      qc.invalidateQueries({ queryKey: ['payment-out-outstanding-payables'] });
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      resetForm();
      setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
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
  const clearSupplier = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); setApplyToBillId(''); };
  const resetForm = () => { clearSupplier(); setAmount(''); setPayDate(new Date().toISOString().split('T')[0]); setPayMode('cash'); setRefNumber(''); setNotes(''); };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a supplier'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter a valid amount'); return; }
    createPaymentOut.mutate({
      party_id: partyId,
      amount: Math.round(parseFloat(amount) * 100),
      pay_date: payDate,
      pay_mode: payMode,
      ref_number: refNumber,
      notes,
      apply_to_bill_id: applyToBillId || undefined,
    });
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0"><ArrowDownLeft className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Payments</p>
              <p className="text-xl font-bold tabular-nums">{formatMoney(totalPaid)}</p>
              <p className="text-[11px] text-muted-foreground">{payments.length} payment{payments.length !== 1 ? 's' : ''} shown</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0"><Wallet className="w-5 h-5 text-amber-600" /></div>
            <div>
              <p className="text-xs text-amber-800">Outstanding Payables</p>
              <p className="text-xl font-bold tabular-nums text-amber-700">{formatMoney(outstandingPayables)}</p>
              <p className="text-[11px] text-amber-700/70">Across all suppliers</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0"><CalendarClock className="w-5 h-5 text-emerald-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Paid This Month</p>
              <p className="text-xl font-bold tabular-nums">{formatMoney(paidThisMonth)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar / filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Supplier filter — real party_id param */}
        <div className="relative">
          <button type="button" onClick={() => setFilterPartyOpen((o) => !o)} className="h-9 px-3 rounded-md border bg-background text-sm flex items-center gap-2 hover:bg-muted/50 min-w-[150px]">
            <span className="truncate flex-1 text-left">{filterPartyName || 'All suppliers'}</span>
            {filterPartyId && <span onClick={(e) => { e.stopPropagation(); setFilterPartyId(''); setFilterPartyName(''); }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></span>}
          </button>
          {filterPartyOpen && (
            <div className="absolute z-20 mt-1 w-64 rounded-md border bg-background shadow-lg p-2">
              <Input autoFocus placeholder="Search supplier…" value={filterPartySearch} onChange={(e) => setFilterPartySearch(e.target.value)} className="mb-2 h-8" />
              <div className="max-h-48 overflow-y-auto">
                {(filterPartyResults || []).map((p: any) => (
                  <button key={p.id} type="button" className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted" onClick={() => { setFilterPartyId(p.id); setFilterPartyName(p.name); setFilterPartyOpen(false); }}>{p.name}</button>
                ))}
                {filterPartySearch && (filterPartyResults || []).length === 0 && <p className="text-xs text-muted-foreground px-2 py-2">No matches</p>}
              </div>
            </div>
          )}
        </div>

        {/* Payment mode filter — real payment_mode param */}
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={filterMode} onChange={(e) => setFilterMode(e.target.value)}>
          <option value="">All modes</option>
          {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>

        {/* Date range filter — real from_date/to_date params */}
        <div className="flex items-center gap-1.5">
          <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9 w-[130px] text-xs" title="From date" />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9 w-[130px] text-xs" title="To date" />
        </div>

        <div className="ml-auto">
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> Add Payment-Out
          </Button>
        </div>
      </div>

      {/* Payments Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Receipt No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Supplier</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Reference</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Mode</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && payments.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                <ArrowDownLeft className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No payments out recorded yet.
              </td></tr>
            )}
            {payments.map((p: any) => (
              <tr key={p.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(p.payment_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{p.payment_number || '—'}</td>
                <td className="px-4 py-2.5 font-medium">{p.party_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{p.reference_number || '—'}</td>
                <td className="px-4 py-2.5 capitalize text-xs text-muted-foreground hidden sm:table-cell">{(p.payment_mode || 'cash').replace('_', ' ')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-600">{formatMoney(parseInt(p.amount) || 0)}</td>
                <td className="px-4 py-2.5 text-center"><Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Posted</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Payment-Out Sheet */}
      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>Add Payment-Out</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Supplier *</Label>
              {partyId ? (
                <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={clearSupplier}>Change</button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Input placeholder="Search supplier…" value={partySearch} onChange={e => searchSuppliers(e.target.value)} className="h-9" />
                    {partyResults.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {partyResults.map((p: any) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectSupplier(p)}>{p.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setQuickAddOpen(true)}><UserPlus className="w-4 h-4" /></Button>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">Amount (₹) *</Label>
              <Input type="number" className="mt-1 tabular-nums text-lg h-11" min={0.01} step={0.01} value={amount} onChange={e => setAmount(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" className="mt-1 h-9" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Payment Mode</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={payMode} onChange={e => setPayMode(e.target.value)}>
                  {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Reference No. (optional)</Label>
              <Input className="mt-1 h-9" placeholder="Cheque no., UTR, etc." value={refNumber} onChange={e => setRefNumber(e.target.value)} />
            </div>

            {/* Invoice Linking — optional, applies this payment against a specific outstanding bill */}
            {partyId && (outstandingBillsForParty || []).length > 0 && (
              <div>
                <Label className="text-xs">Apply to a purchase bill (optional)</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={applyToBillId} onChange={(e) => setApplyToBillId(e.target.value)}>
                  <option value="">Not linked — advance / general payment</option>
                  {(outstandingBillsForParty || []).map((b: any) => {
                    const due = (parseInt(b.total_amount) || 0) - (parseInt(b.paid_amount) || 0);
                    return <option key={b.id} value={b.id}>{b.bill_number || 'Bill'} — due {formatMoney(due)}</option>;
                  })}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Linking marks that specific bill as paid by this amount and tracks its outstanding balance.</p>
              </div>
            )}

            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createPaymentOut.isPending} onClick={handleCreate}>Record Payment</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
