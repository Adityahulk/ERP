import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ArrowDownLeft, UserPlus, Trash2 } from 'lucide-react';
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

  // Payment-Out is a first-class payment record, not an expense or a derived bill total.
  const { data, isLoading } = useQuery({
    queryKey: ['payment-out'],
    queryFn: async () => {
      const res = await api.get('/payments', { params: { payment_type: 'outgoing', limit: 50 } });
      return res.data;
    },
  });

  const payments = (data as any)?.data?.data || [];
  const totalPaid = payments.reduce((sum: number, payment: any) => sum + (Number(payment.amount) || 0), 0);

  const createPaymentOut = useMutation({
    mutationFn: async (payload: any) => {
      return api.post('/payments', {
        payment_type: 'outgoing',
        party_id: payload.party_id,
        amount: payload.amount,
        payment_date: payload.pay_date,
        payment_mode: payload.pay_mode,
        reference_number: payload.ref_number || undefined,
        description: payload.notes || `Payment to ${payload.party_name}`,
        notes: payload.notes || `Payment to ${payload.party_name}`,
      });
    },
    onSuccess: () => {
      toast.success('Payment-Out recorded');
      qc.invalidateQueries({ queryKey: ['payment-out'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const deletePaymentOut = useMutation({
    mutationFn: async (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      toast.success('Payment-Out deleted and balances reversed');
      qc.invalidateQueries({ queryKey: ['payment-out'] });
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete payment'),
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
  const resetForm = () => { clearSupplier(); setAmount(''); setPayDate(new Date().toISOString().split('T')[0]); setPayMode('cash'); setRefNumber(''); setNotes(''); };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a saved party'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter a valid amount'); return; }
    createPaymentOut.mutate({ party_id: partyId, party_name: partyName || partySearch, amount: Math.round(parseFloat(amount) * 100), pay_date: payDate, pay_mode: payMode, ref_number: refNumber, notes });
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <ArrowDownLeft className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total paid (to parties)</p>
            <p className="text-xl font-bold tabular-nums">{formatMoney(totalPaid)}</p>
            <p className="text-xs text-muted-foreground">{payments.length} payment{payments.length !== 1 ? 's' : ''} recorded</p>
          </div>
          <div className="ml-auto">
            <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4" /> Add Payment-Out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payments Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Ref No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party Name</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Payment Type</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && payments.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">
                <ArrowDownLeft className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No payments out recorded yet.
              </td></tr>
            )}
            {payments.map((payment: any) => (
              <tr key={payment.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(payment.payment_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{payment.reference_number || payment.payment_number || '—'}</td>
                <td className="px-4 py-2.5 font-medium">{payment.party_name || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-600">{formatMoney(Number(payment.amount) || 0)}</td>
                <td className="px-4 py-2.5 capitalize text-xs text-muted-foreground hidden sm:table-cell">{String(payment.payment_mode || 'cash').replace('_', ' ')}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    title="Delete and reverse payment"
                    disabled={deletePaymentOut.isPending}
                    onClick={() => {
                      if (window.confirm('Delete this payment and reverse its bill, party, and accounting effects?')) {
                        deletePaymentOut.mutate(payment.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
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
              <Label className="text-xs">Party *</Label>
              {partyId ? (
                <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={clearSupplier}>Change</button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Input placeholder="Search or type party name…" value={partySearch} onChange={e => searchSuppliers(e.target.value)} className="h-9" />
                    {partyResults.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {partyResults.map((p: any) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectSupplier(p)}>
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
              <Button className="flex-1" loading={createPaymentOut.isPending} onClick={handleCreate}>
                Record Payment
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
