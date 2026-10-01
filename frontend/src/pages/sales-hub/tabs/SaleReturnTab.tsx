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
import SalesDocumentActionMenu from '@/components/transactions/SalesDocumentActionMenu';
import { Link } from 'react-router-dom';

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
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['sale-returns'],
    queryFn: () => api.get('/sales/returns', { params: { limit: 50 } }).then(r => r.data),
  });
  const returns = (data as any)?.data?.data || [];

  // Lookup invoice by number to get its id
  const [invoiceId, setInvoiceId] = useState('');
  const [invoiceResults, setInvoiceResults] = useState<any[]>([]);
  const lookupInvoice = async (num: string) => {
    setRefInvoiceNo(num);
    setInvoiceId('');
    if (num.trim().length < 2) { setInvoiceResults([]); return; }
    try {
      const res = await api.get('/invoices', { params: { search: num.trim(), limit: 10 } });
      setInvoiceResults((res.data?.data?.data || []).filter((inv: any) => inv.status !== 'cancelled'));
    } catch { setInvoiceResults([]); }
  };

  const selectInvoice = async (invoice: any) => {
    try {
      const response = await api.get(`/invoices/${invoice.id}`);
      const inv = response.data?.data ?? response.data;
      setInvoiceId(String(inv.id));
      setRefInvoiceNo(String(inv.invoice_number || invoice.invoice_number));
      setInvoiceResults([]);
      setPartyId(String(inv.party_id || ''));
      setPartyName(String(inv.party_display_name || inv.party_name_snapshot || inv.party_name || ''));
      setPartySearch('');
      setPartyResults([]);
      if (Array.isArray(inv.items) && inv.items.length) {
        setItems(inv.items.map((item: any) => ({
          item_id: item.item_id || '',
          name: item.item_name || item.name || 'Item',
          hsn_code: item.hsn_code || '',
          unit: item.unit_abbr || item.unit || '',
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: Number(item.discount_amount) || 0,
          gst_rate: Number(item.gst_rate) || 0,
        })));
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not load the selected invoice');
    }
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
      const { data: res } = await api.get('/parties/search', { params: { q, party_type: 'customer' } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
  };

  const selectCustomer = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); };
  const useCustomerForReturn = () => {
    const name = partySearch.trim();
    if (!name) return;
    setPartyId(''); setPartyName(name); setPartySearch(''); setPartyResults([]);
  };
  const clearCustomer = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); };
  const resetForm = () => { setEditingId(null); setCreditNoteNumber(''); clearCustomer(); setReturnDate(new Date().toISOString().split('T')[0]); setRefInvoiceNo(''); setInvoiceId(''); setReason(''); setItems([]); };

  const openEdit = (row: any, duplicate = false) => {
    setEditingId(duplicate ? null : row.id);
    setCreditNoteNumber(duplicate ? '' : row.credit_note_number || '');
    setPartyId(row.party_id || '');
    setPartyName(row.party_name_snapshot || row.party_name || '');
    setReturnDate(String(row.return_date || new Date().toISOString().split('T')[0]).slice(0, 10));
    setReason(row.reason || '');
    setInvoiceId(row.invoice_id || '');
    setRefInvoiceNo(row.invoice_number || '');
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
    if (duplicate) toast.success('Review the duplicate and save it as a new credit note.');
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
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Original Invoice</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Reason</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Total</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && returns.length === 0 && (
              <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">
                <RotateCcw className="w-10 h-10 mx-auto mb-2 opacity-30" />No sale returns / credit notes yet.
              </td></tr>
            )}
            {returns.map((r: any) => (
              <tr key={r.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(r.return_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{r.credit_note_number}</td>
                <td className="px-4 py-2.5 text-xs hidden lg:table-cell">
                  {r.invoice_id ? <Link className="font-medium text-primary hover:underline" to={`/sales/${r.invoice_id}`}>{r.invoice_number || 'View invoice'}</Link> : <span className="text-muted-foreground">Not linked</span>}
                </td>
                <td className="px-4 py-2.5 font-medium">{r.party_name_snapshot || r.party_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[200px]">{r.reason || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-500">{formatMoney(parseInt(r.total_amount)||0)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize ${r.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.status || 'active'}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <SalesDocumentActionMenu
                    basePath={`/sales/returns/${r.id}`}
                    documentNumber={r.credit_note_number}
                    documentTitle="Credit Note"
                    phone={r.party_phone}
                    email={r.party_email}
                    canModify={r.status !== 'cancelled'}
                    canCancel={r.status !== 'cancelled'}
                    canDelete={r.status === 'draft'}
                    onEdit={() => openEdit(r)}
                    onDuplicate={() => openEdit(r, true)}
                    onCancel={async () => {
                      if (!window.confirm(`Cancel credit note ${r.credit_note_number}? Its party balance effect will be reversed.`)) return;
                      await api.patch(`/sales/returns/${r.id}/cancel`);
                      toast.success('Credit note cancelled');
                      await qc.invalidateQueries({ queryKey: ['sale-returns'] });
                    }}
                    onDelete={async () => {
                      if (!window.confirm(`Delete credit note ${r.credit_note_number}? Its party balance effect will be reversed.`)) return;
                      await api.delete(`/sales/returns/${r.id}`);
                      toast.success('Credit note deleted');
                      await qc.invalidateQueries({ queryKey: ['sale-returns'] });
                    }}
                  />
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
              {partyName && !partySearch ? (
                <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}{!partyId && <span className="ml-2 text-xs font-normal text-muted-foreground">Invoice customer / no Party master</span>}</span>
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
                    {!partyId && partySearch.trim().length > 1 && !partyResults.some((p: any) => String(p.name).toLowerCase() === partySearch.trim().toLowerCase()) && (
                      <button type="button" className="absolute z-20 top-full mt-1 w-full rounded-md border bg-card px-3 py-2 text-left text-sm text-primary shadow-lg hover:bg-muted" onClick={useCustomerForReturn}>
                        Use “{partySearch.trim()}” for this return only
                      </button>
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
                <Label className="text-xs">Original Sales Invoice (optional)</Label>
                {invoiceId ? (
                  <div className="mt-1 flex items-center justify-between rounded-md border bg-muted/30 px-3 h-9">
                    <span className="font-mono text-xs">{refInvoiceNo}</span>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setInvoiceId(''); setRefInvoiceNo(''); }}>Change</button>
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Input className="h-9 font-mono text-xs" placeholder="Search invoice number or customer" value={refInvoiceNo} onChange={e => lookupInvoice(e.target.value)} />
                    {invoiceResults.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-card shadow-lg">
                        {invoiceResults.map((inv: any) => (
                          <button key={inv.id} type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => selectInvoice(inv)}>
                            <span><span className="font-mono font-medium">{inv.invoice_number}</span><span className="ml-2 text-muted-foreground">{inv.party_name || 'Walk-in customer'}</span></span>
                            <span className="text-xs text-muted-foreground">{formatDate(inv.invoice_date)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">Select the original invoice to link this return and prefill its customer and items.</p>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Items Returned</Label>
              <VyaparLineItems items={items} onChange={setItems} isGst={true} searchMode="catalog" showHsn showUnit />
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
