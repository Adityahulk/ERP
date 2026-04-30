import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, RotateCcw, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import toast from 'react-hot-toast';

export default function PurchaseReturnTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [debitNoteNo, setDebitNoteNo] = useState('');
  const [refBillNo, setRefBillNo] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  // We store debit notes as negative-value expenses with category "Purchase Return" for now
  // In a production system this would be its own table
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-returns'],
    queryFn: () => api.get('/expenses', { params: { search: 'Purchase Return', limit: 50 } }).then(r => r.data),
  });
  const returns = (data as any)?.data?.data?.filter((e: any) => e.category === 'Purchase Return') || [];

  const createReturn = useMutation({
    mutationFn: async (payload: any) => {
      const totalPaise = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
      return api.post('/expenses', {
        category: 'Purchase Return',
        amount: totalPaise,
        expense_date: payload.return_date,
        payment_mode: 'other',
        vendor_name: payload.party_name,
        reference_number: payload.debit_note_no || undefined,
        description: `Return to ${payload.party_name}${payload.ref_bill_no ? ` (Bill: ${payload.ref_bill_no})` : ''}${payload.reason ? ` — ${payload.reason}` : ''}`,
        amount_includes_gst: false,
        gst_rate: 0,
      });
    },
    onSuccess: () => {
      toast.success('Purchase return / debit note recorded');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const searchSuppliers = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); return; }

    try {
      const { data: res } = await api.get('/parties/search', { params: { q, party_type: 'supplier' } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
  };

  const selectSupplier = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); };
  const clearSupplier = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); };
  const resetForm = () => { clearSupplier(); setReturnDate(new Date().toISOString().split('T')[0]); setDebitNoteNo(''); setRefBillNo(''); setReason(''); setItems([]); };

  const handleCreate = () => {
    if (!partyId && !partySearch) { toast.error('Select a supplier'); return; }
    if (items.length === 0) { toast.error('Add at least one returned item'); return; }
    createReturn.mutate({ party_id: partyId, party_name: partyName || partySearch, return_date: returnDate, debit_note_no: debitNoteNo, ref_bill_no: refBillNo, reason });
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Record goods returned to suppliers and issue debit notes to adjust payables.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Debit Note
        </Button>
      </div>

      {/* Returns Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Ref No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party Name</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Description</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && returns.length === 0 && (
              <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">
                <RotateCcw className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No purchase returns / debit notes yet.
              </td></tr>
            )}
            {returns.map((r: any) => (
              <tr key={r.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(r.expense_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{r.reference_number || '—'}</td>
                <td className="px-4 py-2.5 font-medium">{r.vendor_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[200px]">{r.description || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{formatMoney(parseInt(r.total_amount)||0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Debit Note Sheet */}
      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>Purchase Return / Debit Note</SheetTitle></SheetHeader>
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Return Date</Label>
                <Input type="date" className="mt-1 h-9" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Debit Note No. (optional)</Label>
                <Input className="mt-1 h-9 font-mono text-xs" placeholder="Auto-generated" value={debitNoteNo} onChange={e => setDebitNoteNo(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Against Bill No. (optional)</Label>
                <Input className="mt-1 h-9 font-mono text-xs" placeholder="Original purchase bill number" value={refBillNo} onChange={e => setRefBillNo(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Items Returned</Label>
              <VyaparLineItems items={items} onChange={setItems} isGst={true} searchMode="catalog" showHsn={true} showUnit={true} />
            </div>

            <div>
              <Label className="text-xs">Reason for Return (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged goods, wrong item received" />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createReturn.isPending} onClick={handleCreate} disabled={items.length === 0}>
                Save Debit Note
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} partyType="supplier" defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
