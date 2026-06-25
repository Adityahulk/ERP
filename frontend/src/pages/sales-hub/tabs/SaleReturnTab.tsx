import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Edit2, Plus, RotateCcw, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import LineItemsEditor, { type LineItem } from '@/components/shared/LineItemsEditor';
import toast from 'react-hot-toast';

export default function SaleReturnTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creditNoteNumber, setCreditNoteNumber] = useState('');

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [refInvoiceNo, setRefInvoiceNo] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['sale-returns'],
    queryFn: () => api.get('/sales/returns', { params: { limit: 50 } }).then(r => r.data),
  });
  const returns = (data as any)?.data?.data || [];

  // Lookup invoice by number to get its id
  const [invoiceId, setInvoiceId] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link from POS → Bill Actions → Return/Exchange. Loads the
  // real invoice and its line items (capped at what hasn't already
  // been returned) so the user adjusts quantities rather than
  // re-typing the whole bill from scratch.
  useEffect(() => {
    const deepLinkInvoiceId = searchParams.get('invoice_id');
    if (!deepLinkInvoiceId) return;
    (async () => {
      try {
        const res = await api.get(`/pos/invoices/${deepLinkInvoiceId}/full`);
        const inv = res.data?.data;
        if (!inv) return;
        setInvoiceId(inv.id);
        setRefInvoiceNo(inv.invoice_number);
        if (inv.party_id) { setPartyId(inv.party_id); setPartyName(inv.party_name); }
        setItems(
          (inv.items || [])
            .filter((it: any) => Number(it.quantity) - Number(it.already_returned_qty || 0) > 0)
            .map((it: any) => ({
              item_id: it.item_id, name: it.item_name, hsn_code: it.hsn_code, unit: it.unit,
              quantity: Number(it.quantity) - Number(it.already_returned_qty || 0),
              unit_price: it.unit_price, discount_amount: it.discount_amount || 0, gst_rate: it.gst_rate || 0,
            })),
        );
        setShowForm(true);
      } catch {
        // Invoice lookup failed — leave the form closed rather than
        // open it half-populated.
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete('invoice_id');
        next.delete('exchange');
        setSearchParams(next, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lookupInvoice = async (num: string) => {
    setRefInvoiceNo(num);
    if (!num.trim()) { setInvoiceId(''); return; }
    try {
      const res = await api.get('/invoices', { params: { search: num, limit: 5 } });
      const found = res.data?.data?.data?.find((inv: any) => inv.invoice_number === num.trim());
      setInvoiceId(found?.id || '');
    } catch { setInvoiceId(''); }
  };

  const createMut = useMutation({
    mutationFn: (payload: any) => editingId ? api.put(`/sales/returns/${editingId}`, payload) : api.post('/sales/returns', payload),
    onSuccess: () => {
      toast.success(editingId ? 'Credit note updated' : 'Sale return / credit note recorded');
      qc.invalidateQueries({ queryKey: ['sale-returns'] });
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

  const selectCustomer = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); };
  const clearCustomer = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); };
  const resetForm = () => { setEditingId(null); setCreditNoteNumber(''); clearCustomer(); setReturnDate(new Date().toISOString().split('T')[0]); setRefInvoiceNo(''); setInvoiceId(''); setReason(''); setItems([]); };

  const openEdit = (row: any) => {
    setEditingId(row.id);
    setCreditNoteNumber(row.credit_note_number || '');
    setPartyId(row.party_id || '');
    setPartyName(row.party_name_snapshot || row.party_name || '');
    setReturnDate(String(row.return_date || new Date().toISOString().split('T')[0]).slice(0, 10));
    setReason(row.reason || '');
    setInvoiceId(row.invoice_id || '');
    setRefInvoiceNo('');
    setItems((row.items || []).map((it: any) => ({
      item_id: it.item_id || '',
      name: it.item_name || it.name || 'Item',
      hsn_code: it.hsn_code || '',
      unit: it.unit || '',
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
      discount_amount: 0,
      gst_rate: Number(it.gst_rate) || 0,
    })));
    setShowForm(true);
  };

  const handleCreate = () => {
    if (!partyId && !partyName) { toast.error('Select or enter a party'); return; }
    if (items.length === 0) { toast.error('Add at least one returned item'); return; }
    createMut.mutate({
      party_id: partyId || undefined,
      party_name: partyName,
      invoice_id: invoiceId || undefined,
      return_date: returnDate,
      reason: reason.trim() || undefined,
      credit_note_number: creditNoteNumber.trim() || undefined,
      items: items.map(it => ({
        item_id: it.item_id, item_name: it.name, hsn_code: it.hsn_code,
        unit: it.unit, quantity: it.quantity, unit_price: it.unit_price, gst_rate: it.gst_rate,
      })),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Record returns and issue credit notes to adjust receivables.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Credit Note
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Credit Note No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Reason</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Total</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && returns.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">
                <RotateCcw className="w-10 h-10 mx-auto mb-2 opacity-30" />No sale returns / credit notes yet.
              </td></tr>
            )}
            {returns.map((r: any) => (
              <tr key={r.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(r.return_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{r.credit_note_number}</td>
                <td className="px-4 py-2.5 font-medium">{r.party_name_snapshot || r.party_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[200px]">{r.reason || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-500">{formatMoney(parseInt(r.total_amount)||0)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button type="button" variant="ghost" size="icon" title="Edit credit note" onClick={() => openEdit(r)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>{editingId ? 'Edit Credit Note' : 'Sale Return / Credit Note'}</SheetTitle></SheetHeader>
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
                <div>
                  <Label className="text-xs">Credit Note No.</Label>
                  <Input className="mt-1 h-9 font-mono text-xs" value={creditNoteNumber} onChange={e => setCreditNoteNumber(e.target.value)} />
                </div>
              )}
              <div>
                <Label className="text-xs">Return Date</Label>
                <Input type="date" className="mt-1 h-9" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
              </div>
              <div className={editingId ? 'col-span-2' : ''}>
                <Label className="text-xs">Against Invoice No. (optional)</Label>
                <Input className="mt-1 h-9 font-mono text-xs" placeholder="Original invoice number" value={refInvoiceNo} onChange={e => lookupInvoice(e.target.value)} />
                {refInvoiceNo && (
                  <p className="text-[10px] mt-0.5 text-muted-foreground">{invoiceId ? '✓ Invoice found' : 'Invoice not found (will record without link)'}</p>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Items Returned</Label>
              <LineItemsEditor items={items} onChange={setItems} isGst={true} searchMode="catalog" showHsn showUnit />
            </div>

            <div>
              <Label className="text-xs">Reason for Return (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged goods, wrong item received" />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createMut.isPending} onClick={handleCreate} disabled={items.length === 0}>
                {editingId ? 'Update Credit Note' : 'Save Credit Note'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}
