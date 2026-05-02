import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ArrowUpRight, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import toast from 'react-hot-toast';

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
];

export default function PaymentInTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

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

  // Unpaid invoices for the selected party
  const { data: partyInvoices } = useQuery({
    queryKey: ['party-unpaid-invoices', partyId],
    queryFn: () => api.get('/invoices', { params: { party_id: partyId, payment_status: 'unpaid', limit: 20 } }).then(r => r.data?.data?.data || []),
    enabled: !!partyId,
  });
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');

  // Fetch payment-in list
  const { data, isLoading } = useQuery({
    queryKey: ['payments-in'],
    queryFn: () => api.get('/payments', { params: { payment_type: 'incoming', limit: 50 } }).then(r => r.data),
  });
  const payments = (data as any)?.data?.data || [];
  const totalReceived = payments.reduce((s: number, p: any) => s + (parseInt(p.amount) || 0), 0);

  const createMut = useMutation({
    mutationFn: (payload: any) => api.post('/payments', payload),
    onSuccess: () => {
      toast.success('Payment-In recorded');
      qc.invalidateQueries({ queryKey: ['payments-in'] });
      qc.invalidateQueries({ queryKey: ['salesInvoices'] });
      resetForm(); setShowForm(false);
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

  const selectCustomer = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); setSelectedInvoiceId(''); };
  const clearCustomer = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); setSelectedInvoiceId(''); };
  const resetForm = () => { clearCustomer(); setAmount(''); setPayDate(new Date().toISOString().split('T')[0]); setPayMode('cash'); setRefNumber(''); setNotes(''); };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter a valid amount'); return; }
    const payload: any = {
      party_id: partyId,
      payment_type: 'incoming',
      amount: Math.round(parseFloat(amount) * 100),
      payment_date: payDate,
      payment_mode: payMode,
      reference_number: refNumber || undefined,
      notes: notes || `Payment from ${partyName}`,
    };
    if (selectedInvoiceId) {
      payload.allocations = [{ invoice_id: selectedInvoiceId, amount: Math.round(parseFloat(amount) * 100) }];
    }
    createMut.mutate(payload);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ArrowUpRight className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total received (from parties)</p>
            <p className="text-xl font-bold tabular-nums">{formatMoney(totalReceived)}</p>
            <p className="text-xs text-muted-foreground">{payments.length} payment{payments.length !== 1 ? 's' : ''} recorded</p>
          </div>
          <div className="ml-auto">
            <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4" /> Add Payment-In
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Ref No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party Name</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Mode</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && payments.length === 0 && (
              <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">
                <ArrowUpRight className="w-10 h-10 mx-auto mb-2 opacity-30" />No payments received yet.
              </td></tr>
            )}
            {payments.map((p: any) => (
              <tr key={p.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(p.payment_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{p.reference_number || '—'}</td>
                <td className="px-4 py-2.5 font-medium">{p.party_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs capitalize text-muted-foreground hidden sm:table-cell">{p.payment_mode?.replace('_', ' ')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{formatMoney(parseInt(p.amount)||0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>Record Payment-In</SheetTitle></SheetHeader>
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

            {/* Link to outstanding invoice */}
            {partyId && (partyInvoices as any[])?.length > 0 && (
              <div>
                <Label className="text-xs">Apply to Invoice (optional)</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={selectedInvoiceId} onChange={e => setSelectedInvoiceId(e.target.value)}>
                  <option value="">— Unallocated payment —</option>
                  {(partyInvoices as any[]).map((inv: any) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} · {formatMoney(parseInt(inv.balance_due)||0)} due
                    </option>
                  ))}
                </select>
              </div>
            )}

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
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createMut.isPending} onClick={handleCreate}>
                Record Payment
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}
