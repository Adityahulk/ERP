import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateInvoice, useCompany } from '@/hooks/useBusiness';
import { useGodowns } from '@/hooks/useStock';
import { formatMoney } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Trash2, Search, Eye, UserPlus } from 'lucide-react';
import { InvoicePreviewWorkspace, readSkipInvoicePreview } from '@/components/invoices/InvoicePreviewWorkspace';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface LineItem {
  item_id?: string; name: string; hsn_code?: string;
  quantity: number; unit_price: number; gst_rate: number;
  discount_percent: number; cess_rate: number;
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const createMutation = useCreateInvoice();
  const { data: company } = useCompany();
  const { data: godownData } = useGodowns();
  const godowns = godownData?.data || [];

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [godownId, setGodownId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [isInterstate, setIsInterstate] = useState(false);
  const [notes, setNotes] = useState('');
  const [amountPaid, setAmountPaid] = useState(0);
  const [items, setItems] = useState<LineItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [draftPreviewOpen, setDraftPreviewOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');
  const [partySearchLoading, setPartySearchLoading] = useState(false);

  const clearPartySelection = () => {
    setPartyId('');
    setPartyName('');
    setPartyPhone('');
    setPartySearch('');
    setPartyResults([]);
  };

  // Search parties
  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) {
      setPartyResults([]);
      setPartySearchLoading(false);
      return;
    }
    setPartySearchLoading(true);
    try {
      const { data: res } = await api.get('/parties/search', { params: { q, party_type: 'customer' } });
      setPartyResults(res.data || []);
    } catch {
      setPartyResults([]);
    } finally {
      setPartySearchLoading(false);
    }
  };

  const selectParty = (p: any) => {
    setPartyId(p.id);
    setPartyName(p.name);
    setPartyPhone(p.phone || '');
    setPartySearch('');
    setPartyResults([]);
    const companyStateCode = String((company as any)?.state_code || '').trim();
    const partyStateCode = String(p.billing_state_code || p.state_code || '').trim();
    if (companyStateCode && partyStateCode) {
      setIsInterstate(companyStateCode !== partyStateCode);
    }
  };

  const openQuickAdd = (prefillName?: string) => {
    setQuickAddDefaultName(prefillName ?? '');
    setQuickAddOpen(true);
  };

  // Search items
  const searchItems = async (q: string) => {
    setItemSearch(q);
    if (q.length < 2) { setItemResults([]); return; }
    try {
      const { data: res } = await api.post('/invoices/search-items', { q, godown_id: godownId || undefined });
      setItemResults(res.data || []);
    } catch { setItemResults([]); }
  };

  const addItem = (item: any) => {
    if (items.find(i => i.item_id === item.id)) return;
    setItems([...items, {
      item_id: item.id, name: item.name, hsn_code: item.hsn_code || '',
      quantity: 1, unit_price: item.unit_price ?? item.selling_price,
      gst_rate: item.gst_rate || 18, discount_percent: 0, cess_rate: 0,
    }]);
    setItemSearch(''); setItemResults([]);
  };

  const updateLine = (idx: number, f: string, v: any) => {
    const updated = [...items];
    (updated[idx] as any)[f] = v;
    setItems(updated);
  };

  const removeLine = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  // Calculations
  const calcLine = (item: LineItem) => {
    const lineTotal = item.quantity * item.unit_price;
    const discount = lineTotal * item.discount_percent / 100;
    const taxable = lineTotal - discount;
    const gst = Math.round(taxable * item.gst_rate / 100);
    const cess = Math.round(taxable * item.cess_rate / 100);
    return { lineTotal, discount, taxable, gst, cess, total: taxable + gst + cess };
  };

  const subtotal = items.reduce((s, i) => s + calcLine(i).taxable, 0);
  const totalTax = items.reduce((s, i) => s + calcLine(i).gst, 0);
  const totalCess = items.reduce((s, i) => s + calcLine(i).cess, 0);
  const grandTotal = subtotal + totalTax + totalCess;
  const balanceDue = grandTotal - amountPaid;

  const draftPreviewPayload = useMemo(
    () => ({
      invoice_type: 'sale',
      party_id: partyId || undefined,
      party_name: partyName || undefined,
      godown_id: godownId || undefined,
      invoice_date: invoiceDate,
      due_date: dueDate || undefined,
      is_interstate: isInterstate,
      notes: notes || undefined,
      amount_paid: amountPaid,
      items: items.map((i) => ({
        item_id: i.item_id,
        description: i.name,
        hsn_code: i.hsn_code,
        quantity: i.quantity,
        unit_price: i.unit_price,
        gst_rate: i.gst_rate,
        discount_percent: i.discount_percent,
        cess_rate: i.cess_rate,
      })),
    }),
    [partyId, partyName, godownId, invoiceDate, dueDate, isInterstate, notes, amountPaid, items],
  );

  const handleSubmit = async () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    if (amountPaid > grandTotal) { toast.error('Amount paid cannot exceed invoice total'); return; }

    try {
      const res = await createMutation.mutateAsync({
        invoice_type: 'sale', party_id: partyId, godown_id: godownId || undefined,
        invoice_date: invoiceDate, due_date: dueDate || undefined,
        is_interstate: isInterstate, notes,
        amount_paid: amountPaid,
        items: items.map(i => ({
          item_id: i.item_id, description: i.name, hsn_code: i.hsn_code,
          quantity: i.quantity, unit_price: i.unit_price,
          gst_rate: i.gst_rate, discount_percent: i.discount_percent, cess_rate: i.cess_rate,
        })),
      });
      const inv = (res as any)?.data ?? res;
      toast.success(`Invoice created: ${inv?.invoice_number || ''}`);
      const newId = inv?.id;
      const skipPreview = readSkipInvoicePreview();
      if (newId) navigate(skipPreview ? `/sales/${newId}` : `/sales/${newId}?preview=1`);
      else navigate('/sales');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to create invoice'); }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/sales')}><ArrowLeft className="w-5 h-5" /></Button>
        <div><h1 className="text-2xl font-bold">New Sale Invoice</h1></div>
      </div>

      {/* Party & Details */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Party Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Label>Select Customer *</Label>
              {partyId ? (
                <div className="flex items-center justify-between mt-1 p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => clearPartySelection()}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="relative min-w-0 flex-1">
                      <Input
                        className="w-full"
                        placeholder="Search by name, phone, GSTIN..."
                        value={partySearch}
                        onChange={(e) => searchParties(e.target.value)}
                      />
                      {partyResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {partyResults.map((p) => (
                            <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectParty(p)}>
                              <span className="font-medium">{p.name}</span>
                              {p.phone && <span className="text-muted-foreground ml-2">{p.phone}</span>}
                              {p.gstin && <span className="text-muted-foreground ml-2 font-mono text-xs">{p.gstin}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1 sm:mt-0" onClick={() => openQuickAdd()}>
                      <UserPlus className="h-4 w-4" />
                      New customer
                    </Button>
                  </div>
                  {partySearch.length >= 2 && !partySearchLoading && partyResults.length === 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      No matches.{' '}
                      <button type="button" className="text-primary font-medium hover:underline" onClick={() => openQuickAdd(partySearch)}>
                        Add “{partySearch.trim()}” as customer
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Invoice Info</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Invoice Date</Label><Input type="date" className="mt-1" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
              <div><Label>Due Date</Label><Input type="date" className="mt-1" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Godown</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                  <option value="">Default</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={isInterstate} onChange={e => setIsInterstate(e.target.checked)} className="rounded border-input" />
                  Interstate (IGST)
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search products to add..." value={itemSearch} onChange={e => searchItems(e.target.value)} />
            {itemResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {itemResults.map((it: any) => (
                  <button key={it.id} className="w-full text-left px-4 py-2 hover:bg-muted text-sm flex justify-between" onClick={() => addItem(it)}>
                    <span>{it.name} <span className="text-muted-foreground">{it.sku}</span></span>
                    <span className="tabular-nums">
                      {formatMoney(Number(it.unit_price || 0))}
                      {typeof it.available_stock === 'number' ? ` • Stock ${it.available_stock}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/40 border-b">
                  <th className="p-2 text-left font-medium">Item</th>
                  <th className="p-2 text-left font-medium w-16">HSN</th>
                  <th className="p-2 text-right font-medium w-16">Qty</th>
                  <th className="p-2 text-right font-medium w-28">Price (₹)</th>
                  <th className="p-2 text-right font-medium w-16">Disc%</th>
                  <th className="p-2 text-right font-medium w-16">GST%</th>
                  <th className="p-2 text-right font-medium w-24">Total</th>
                  <th className="w-10"></th>
                </tr></thead>
                <tbody>
                  {items.map((item, idx) => {
                    const c = calcLine(item);
                    return (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-medium">{item.name}</td>
                        <td className="p-2"><Input className="w-16 text-xs h-7" value={item.hsn_code || ''} onChange={e => updateLine(idx, 'hsn_code', e.target.value)} /></td>
                        <td className="p-2"><Input type="number" className="w-16 text-center h-7 tabular-nums" min={1} value={item.quantity} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                        <td className="p-2"><Input type="number" className="w-28 text-right h-7 tabular-nums" min={0} value={(item.unit_price / 100).toFixed(2)} onChange={e => updateLine(idx, 'unit_price', Math.round((parseFloat(e.target.value) || 0) * 100))} /></td>
                        <td className="p-2"><Input type="number" className="w-16 text-center h-7 tabular-nums" min={0} max={100} value={item.discount_percent} onChange={e => updateLine(idx, 'discount_percent', parseFloat(e.target.value) || 0)} /></td>
                        <td className="p-2">
                          <select className="w-16 h-7 rounded border bg-transparent text-xs" value={item.gst_rate} onChange={e => updateLine(idx, 'gst_rate', parseInt(e.target.value))}>
                            <option value={0}>0%</option><option value={5}>5%</option><option value={12}>12%</option><option value={18}>18%</option><option value={28}>28%</option>
                          </select>
                        </td>
                        <td className="p-2 text-right tabular-nums font-medium">{formatMoney(c.total)}</td>
                        <td className="p-2"><button onClick={() => removeLine(idx)} className="p-1 rounded hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {items.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">Search and add items above</p>}
        </CardContent>
      </Card>

      {/* Totals */}
      {items.length > 0 && (
        <div className="flex justify-end">
          <div className="w-full max-w-sm space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums font-medium">{formatMoney(subtotal)}</span></div>
            {isInterstate ? (
              <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatMoney(totalTax)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatMoney(Math.round(totalTax / 2))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatMoney(Math.round(totalTax / 2))}</span></div>
              </>
            )}
            {totalCess > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cess</span><span className="tabular-nums">{formatMoney(totalCess)}</span></div>}
            <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(grandTotal)}</span></div>
            <div className="pt-2">
              <Label>Amount Paid (₹)</Label>
              <Input type="number" className="mt-1 tabular-nums" min={0} value={(amountPaid / 100).toFixed(2)} onChange={e => setAmountPaid(Math.round((parseFloat(e.target.value) || 0) * 100))} />
            </div>
            {balanceDue > 0 && <div className="flex justify-between text-red-500 font-semibold"><span>Balance Due</span><span className="tabular-nums">{formatMoney(balanceDue)}</span></div>}

            <div><Label>Notes</Label><textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end pb-8 flex-wrap">
        <Button variant="outline" onClick={() => navigate('/sales')}>Cancel</Button>
        <Button
          variant="outline"
          disabled={!partyId || items.length === 0}
          onClick={() => setDraftPreviewOpen(true)}
          className="gap-2"
        >
          <Eye className="w-4 h-4" /> Live preview
        </Button>
        <Button disabled={items.length === 0} loading={createMutation.isPending} onClick={handleSubmit}>
          Create Invoice
        </Button>
      </div>

      <InvoicePreviewWorkspace
        open={draftPreviewOpen}
        onClose={() => setDraftPreviewOpen(false)}
        mode="draft"
        draftPayload={draftPreviewPayload}
        shareContext={{
          invoiceNumber: 'PREVIEW',
          invoiceDate: invoiceDate,
          totalAmountPaise: grandTotal,
          partyName: partyName || 'Customer',
        }}
        partyPhone={partyPhone}
        companyName={company?.name}
      />

      <QuickAddPartySheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        partyType="customer"
        defaultName={quickAddDefaultName}
        onCreated={(row) => selectParty(row)}
      />
    </div>
  );
}
