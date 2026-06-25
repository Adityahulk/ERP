import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useCompany } from '@/hooks/useBusiness';
import { printPdfFromUrl } from '@/lib/printPdf';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Copy, ArrowRightCircle, MessageCircle, Printer, Download, UserPlus } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import LineItemsEditor, { type LineItem } from '@/components/shared/LineItemsEditor';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  converted: 'bg-indigo-100 text-indigo-700',
};

export default function ProformaInvoiceList() {
  const qc = useQueryClient();
  const { data: companyData } = useCompany();
  const gstEnabledDefault = (companyData as any)?.tax_settings?.enable_gst !== false;
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);

  const { data: proformas = [], isLoading } = useQuery({
    queryKey: ['proforma', statusFilter],
    queryFn: () => api.get('/proforma', { params: { status: statusFilter || undefined } }).then((r) => r.data?.data ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/invoices', payload),
    onSuccess: () => {
      toast.success('Proforma invoice created');
      qc.invalidateQueries({ queryKey: ['proforma'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create proforma'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/proforma/${id}/status`, { status }),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['proforma'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/proforma/${id}/duplicate`),
    onSuccess: () => { toast.success('Duplicated'); qc.invalidateQueries({ queryKey: ['proforma'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => api.post(`/proforma/${id}/convert`),
    onSuccess: (res: any) => {
      toast.success(`Converted to Sale Invoice ${res.data?.data?.newInvoiceNumber}`);
      qc.invalidateQueries({ queryKey: ['proforma'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); return; }
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
  };

  const selectParty = (p: any) => { setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]); };
  const resetForm = () => {
    setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]);
    setInvoiceDate(new Date().toISOString().split('T')[0]); setNotes(''); setItems([]);
  };

  const handleCreate = () => {
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createMutation.mutate({
      invoice_type: 'proforma',
      invoice_date: invoiceDate,
      party_id: partyId || undefined,
      party_name: !partyId ? (partyName || 'Walk-in Customer') : undefined,
      notes: notes || undefined,
      items: items.map((it) => ({
        item_id: it.item_id, item_name: it.name, hsn_code: it.hsn_code, unit: it.unit,
        quantity: it.quantity, unit_price: it.unit_price, discount_amount: it.discount_amount,
        gst_rate: gstEnabledDefault ? (it.gst_rate || 0) : 0,
      })),
    });
  };

  const shareWhatsApp = () => {
    toast('Download the PDF below, then share it via WhatsApp — direct in-app WhatsApp send for Proforma works the same way Sale Invoice does today.', { duration: 5000 });
  };

  const downloadPdf = async (id: string, invoiceNumber: string) => {
    try {
      const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `${invoiceNumber}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download PDF');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Proforma Invoices</h1>
          <p className="text-sm text-muted-foreground">Quotation-style invoices that can be converted to a real Sale Invoice once accepted.</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-1.5"><Plus className="w-4 h-4" /> New Proforma</Button>
      </div>

      <div className="flex gap-2">
        {['', 'draft', 'sent', 'accepted', 'rejected', 'converted'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="border rounded-xl overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Number</th>
              <th className="px-4 py-2.5">Party</th>
              <th className="px-4 py-2.5 text-center">Items</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
              <th className="px-4 py-2.5 text-center">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && proformas.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">No proforma invoices yet.</td></tr>}
            {proformas.map((p: any) => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(p.invoice_date)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.invoice_number}</td>
                <td className="px-4 py-2.5 font-medium">{p.party_name}</td>
                <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">{p.item_count}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(p.total_amount)}</td>
                <td className="px-4 py-2.5 text-center">
                  {p.proforma_status === 'converted' ? (
                    <Badge variant="secondary" className={STATUS_COLORS.converted}>→ {p.converted_invoice_number}</Badge>
                  ) : (
                    <select
                      value={p.proforma_status}
                      onChange={(e) => statusMutation.mutate({ id: p.id, status: e.target.value })}
                      className={`text-[11px] font-medium rounded-full px-2 py-1 border-0 capitalize ${STATUS_COLORS[p.proforma_status] || ''}`}
                    >
                      {['draft', 'sent', 'accepted', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download PDF" onClick={() => downloadPdf(p.id, p.invoice_number)}><Download className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Print" onClick={() => printPdfFromUrl(`/invoices/${p.id}/pdf`, undefined, `proforma ${p.invoice_number}`)}><Printer className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Share via WhatsApp" onClick={shareWhatsApp}><MessageCircle className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Duplicate" onClick={() => duplicateMutation.mutate(p.id)}><Copy className="w-3.5 h-3.5" /></Button>
                  {p.proforma_status !== 'converted' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" title="Convert to Sale Invoice" onClick={() => { if (window.confirm('Convert this proforma into a real Sale Invoice? This cannot be undone.')) convertMutation.mutate(p.id); }}>
                      <ArrowRightCircle className="w-3.5 h-3.5" /> Convert
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>New Proforma Invoice</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Customer (optional — leave blank for Walk-in)</Label>
              {partyId ? (
                <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setPartyId(''); setPartyName(''); }}>Change</button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Input placeholder="Search customer…" value={partySearch} onChange={(e) => searchParties(e.target.value)} className="h-9" />
                    {partyResults.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {partyResults.map((p: any) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectParty(p)}>{p.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setQuickAddOpen(true)}><UserPlus className="w-4 h-4" /></Button>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="mt-1 h-9" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>

            <div>
              <Label className="text-xs mb-2 block">Items</Label>
              <LineItemsEditor items={items} onChange={setItems} isGst={gstEnabledDefault} searchMode="catalog" defaultRateFrom="selling" showHsn={gstEnabledDefault} showUnit={true} />
            </div>

            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending} onClick={handleCreate} disabled={items.length === 0}>Save Proforma</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row: any) => selectParty(row)} />
    </div>
  );
}
