import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useGodowns } from '@/hooks/useStock';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, RotateCcw, UserPlus, X, Wallet, Receipt } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import LineItemsEditor, { type LineItem } from '@/components/shared/LineItemsEditor';
import toast from 'react-hot-toast';

function ReturnStatusBadge({ totalAmount, refundReceived }: { totalAmount: number; refundReceived: number }) {
  if (refundReceived <= 0) return <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-[10px]">Credited to Account</Badge>;
  if (refundReceived >= totalAmount) return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-[10px]">Fully Refunded</Badge>;
  return <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-[10px]">Partially Refunded</Badge>;
}

export default function PurchaseReturnTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [refundTarget, setRefundTarget] = useState<any | null>(null);
  const [refundAmount, setRefundAmount] = useState('');

  // Filters
  const [filterPartyId, setFilterPartyId] = useState('');
  const [filterPartyName, setFilterPartyName] = useState('');
  const [filterPartySearch, setFilterPartySearch] = useState('');
  const [filterPartyOpen, setFilterPartyOpen] = useState(false);

  // Form state
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [debitNoteNo, setDebitNoteNo] = useState('');
  const [refBillId, setRefBillId] = useState('');
  const [godownId, setGodownId] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);

  const { data: godownData } = useGodowns();
  const godowns = godownData?.data || [];

  // Real Purchase Return / Debit Note transactions
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-returns', filterPartyId],
    queryFn: () => api.get('/purchases/returns', { params: { party_id: filterPartyId || undefined, limit: 100 } }).then(r => r.data),
  });
  const returns: any[] = (data as any)?.data?.data || [];
  const stats = (data as any)?.meta || {};

  // Outstanding bills for the selected supplier — for the "Reference Bill" link
  const { data: supplierBills } = useQuery({
    queryKey: ['purchase-return-supplier-bills', partyId],
    enabled: !!partyId,
    queryFn: () => api.get('/purchases/invoices', { params: { party_id: partyId, limit: 50 } }).then(r => r.data?.data?.data || []),
  });

  const { data: filterPartyResults } = useQuery({
    queryKey: ['purchase-return-filter-party', filterPartySearch],
    enabled: filterPartyOpen,
    queryFn: () => api.get('/parties/search', { params: { q: filterPartySearch } }).then((r) => r.data?.data ?? r.data),
  });

  const createReturn = useMutation({
    mutationFn: (payload: any) => api.post('/purchases/returns', payload),
    onSuccess: () => {
      toast.success('Debit note recorded — stock and supplier balance updated');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const recordRefund = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => api.post(`/purchases/returns/${id}/refund`, { amount }),
    onSuccess: () => {
      toast.success('Refund recorded');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      setRefundTarget(null); setRefundAmount('');
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
  const clearSupplier = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); setRefBillId(''); };
  const resetForm = () => {
    clearSupplier();
    setReturnDate(new Date().toISOString().split('T')[0]);
    setDebitNoteNo(''); setReason(''); setItems([]); setGodownId('');
  };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a supplier'); return; }
    if (items.length === 0) { toast.error('Add at least one returned item'); return; }
    createReturn.mutate({
      party_id: partyId,
      purchase_invoice_id: refBillId || undefined,
      godown_id: godownId || undefined,
      return_date: returnDate,
      debit_note_number: debitNoteNo || undefined,
      reason: reason || undefined,
      items: items.map((it) => ({
        item_id: it.item_id, item_name: it.name, hsn_code: it.hsn_code,
        unit: it.unit, quantity: it.quantity, unit_price: it.unit_price, gst_rate: it.gst_rate || 0,
      })),
    });
  };

  const totalDebitNotes = returns.reduce((s, r) => s + (parseInt(r.total_amount) || 0), 0);
  const totalRefunded = returns.reduce((s, r) => s + (parseInt(r.refund_received) || 0), 0);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0"><RotateCcw className="w-5 h-5 text-violet-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Debit Notes</p>
              <p className="text-xl font-bold tabular-nums">{formatMoney(totalDebitNotes)}</p>
              <p className="text-[11px] text-muted-foreground">{returns.length} note{returns.length !== 1 ? 's' : ''}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><Wallet className="w-5 h-5 text-emerald-600" /></div>
            <div>
              <p className="text-xs text-emerald-800">Cash/Bank Refunded</p>
              <p className="text-xl font-bold tabular-nums text-emerald-700">{formatMoney(totalRefunded)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Receipt className="w-5 h-5 text-blue-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Credited to Supplier Account</p>
              <p className="text-xl font-bold tabular-nums">{formatMoney(totalDebitNotes - totalRefunded)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative">
          <button type="button" onClick={() => setFilterPartyOpen((o) => !o)} className="h-9 px-3 rounded-md border bg-background text-sm flex items-center gap-2 hover:bg-muted/50 min-w-[160px]">
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
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Debit Note No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Supplier</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Reference Bill</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground hidden sm:table-cell">Items</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground hidden sm:table-cell">Refund Received</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Balance</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && returns.length === 0 && (
              <tr><td colSpan={10} className="p-10 text-center text-muted-foreground">
                <RotateCcw className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No purchase returns / debit notes yet.
              </td></tr>
            )}
            {returns.map((r: any) => {
              const total = parseInt(r.total_amount) || 0;
              const refunded = parseInt(r.refund_received) || 0;
              const balance = total - refunded;
              return (
                <tr key={r.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(r.return_date)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{r.debit_note_number}</td>
                  <td className="px-4 py-2.5 font-medium">{r.party_name || r.party_name_snapshot || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{r.purchase_bill_number || '—'}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-muted-foreground hidden sm:table-cell">{r.item_count} {parseFloat(r.total_quantity) ? `(${parseFloat(r.total_quantity)} qty)` : ''}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatMoney(total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 hidden sm:table-cell">{refunded > 0 ? formatMoney(refunded) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{balance > 0 ? formatMoney(balance) : '✓'}</td>
                  <td className="px-4 py-2.5 text-center"><ReturnStatusBadge totalAmount={total} refundReceived={refunded} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {balance > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setRefundTarget(r); setRefundAmount(''); }}>
                        Record Refund
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
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
              <div>
                <Label className="text-xs">Reference Bill (optional)</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={refBillId} onChange={(e) => setRefBillId(e.target.value)} disabled={!partyId}>
                  <option value="">{partyId ? 'No specific bill' : 'Select a supplier first'}</option>
                  {(supplierBills || []).map((b: any) => <option key={b.id} value={b.id}>{b.bill_number}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Godown (stock returns from)</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={godownId} onChange={(e) => setGodownId(e.target.value)}>
                  <option value="">Default godown</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Items Returned</Label>
              <LineItemsEditor
                items={items}
                onChange={setItems}
                isGst={true}
                searchMode="catalog"
                defaultRateFrom="purchase"
                showHsn={true}
                showUnit={true}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">Stock for these items will be reduced from the godown above. Quantities greater than what's in stock will be rejected.</p>
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

      {/* Record Refund dialog */}
      <Sheet open={!!refundTarget} onOpenChange={(v) => { if (!v) { setRefundTarget(null); setRefundAmount(''); } }}>
        <SheetContent side="right">
          <SheetHeader className="mb-5"><SheetTitle>Record Refund — {refundTarget?.debit_note_number}</SheetTitle></SheetHeader>
          {refundTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Outstanding balance: <span className="font-semibold text-foreground">{formatMoney((parseInt(refundTarget.total_amount) || 0) - (parseInt(refundTarget.refund_received) || 0))}</span>
              </p>
              <div>
                <Label className="text-xs">Refund amount received (₹)</Label>
                <Input type="number" min={0.01} step={0.01} className="mt-1 h-10 text-lg tabular-nums" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-3 pt-3 border-t">
                <Button variant="outline" className="flex-1" onClick={() => { setRefundTarget(null); setRefundAmount(''); }}>Cancel</Button>
                <Button
                  className="flex-1"
                  loading={recordRefund.isPending}
                  onClick={() => {
                    const amt = Math.round(parseFloat(refundAmount) * 100);
                    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
                    recordRefund.mutate({ id: refundTarget.id, amount: amt });
                  }}
                >
                  Save Refund
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
