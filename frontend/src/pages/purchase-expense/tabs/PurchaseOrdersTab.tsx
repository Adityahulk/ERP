import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ClipboardList } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import LineItemsEditor, { type LineItem } from '@/components/shared/LineItemsEditor';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-700',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
};
const BILL_NUMBER_PATTERN = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const BILL_NUMBER_HELP = 'Use 1-16 characters: A-Z, 0-9, / or -. First character cannot be 0.';

export default function PurchaseOrdersTab() {
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  const [showForm, setShowForm] = useState(false);
  const [generateBillFor, setGenerateBillFor] = useState<any>(null);

  // PO form state
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [godownId, setGodownId] = useState('');
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);

  // Bill generation form
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [receivals, setReceivals] = useState<Record<string, number>>({});
  const [receiveBankAccountId, setReceiveBankAccountId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => api.get('/purchases/orders', { params: { limit: 50 } }).then(r => r.data),
  });
  const orders = (data as any)?.data?.data || [];

  const createPO = useMutation({
    mutationFn: (payload: any) => api.post('/purchases/orders', payload),
    onSuccess: () => {
      toast.success('Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const generateBillMutation = useMutation({
    mutationFn: ({ poId, payload }: { poId: string; payload: any }) =>
      api.post(`/purchases/orders/${poId}/receive`, payload),
    onSuccess: () => {
      toast.success('Purchase bill generated from order');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      setGenerateBillFor(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to generate bill'),
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
    clearSupplier(); setGodownId(''); setNotes(''); setItems([]);
    setExpectedDate(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; });
  };

  const openGenerateBill = async (po: any) => {
    // Load PO details with items
    try {
      const res = await api.get(`/purchases/orders/${po.id}`);
      const poDetail = res.data?.data;
      const init: Record<string, number> = {};
      (poDetail?.items || []).forEach((it: any) => { init[it.id] = it.quantity_ordered; });
      setReceivals(init);
      setGenerateBillFor(poDetail || po);
      setBillDate(new Date().toISOString().split('T')[0]);
      setBillNumber('');
      setReceiveBankAccountId('');
    } catch {
      setGenerateBillFor(po);
    }
  };

  const handleGenerateBill = () => {
    if (!generateBillFor) return;
    const normalizedBillNumber = billNumber.trim();
    if (normalizedBillNumber && !BILL_NUMBER_PATTERN.test(normalizedBillNumber)) {
      toast.error(BILL_NUMBER_HELP);
      return;
    }
    const itemPayload = (generateBillFor.items || [])
      .filter((it: any) => (receivals[it.id] || 0) > 0)
      .map((it: any) => ({
        po_item_id: it.id,
        quantity_received: receivals[it.id] || 0,
        unit_price: it.unit_price,
        gst_rate: it.gst_rate,
      }));
    if (itemPayload.length === 0) { toast.error('Enter quantities for at least one item'); return; }
    generateBillMutation.mutate({
      poId: generateBillFor.id,
      payload: {
        bill_number: normalizedBillNumber || undefined,
        bill_date: billDate,
        company_bank_account_id: receiveBankAccountId || undefined,
        items: itemPayload,
      },
    });
  };

  const handleCreatePO = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createPO.mutate({
      party_id: partyId,
      godown_id: godownId || undefined,
      expected_date: expectedDate,
      notes: notes.trim() || undefined,
      items: items.map(it => ({
        item_id: it.item_id,
        item_name: it.name,
        hsn_code: it.hsn_code,
        quantity: it.quantity,
        unit_price: it.unit_price,
        gst_rate: it.gst_rate,
      })),
    });
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Create and manage purchase orders. Convert confirmed orders to purchase bills.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Purchase Order
        </Button>
      </div>

      {/* Orders Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">PO No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Date</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground hidden lg:table-cell">Items</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Total</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground w-36">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && orders.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No purchase orders yet.
              </td></tr>
            )}
            {orders.map((po: any) => (
              <tr key={po.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">{po.party_name_snapshot || po.party_name || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{po.po_number}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{formatDate(po.po_date)}</td>
                <td className="px-4 py-2.5 text-center text-xs text-muted-foreground hidden lg:table-cell">
                  {po.item_count ?? 0}{parseFloat(po.total_quantity) ? <span className="text-muted-foreground/70"> ({parseFloat(po.total_quantity)} qty)</span> : null}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(po.total_amount)||0)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${STATUS_COLORS[po.status] || 'bg-slate-100 text-slate-500'}`}>
                    {po.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {po.status !== 'received' && po.status !== 'cancelled' && (
                    <Button size="sm" variant="default" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => openGenerateBill(po)}>
                      Generate Bill
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New PO Sheet */}
      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>New Purchase Order</SheetTitle></SheetHeader>
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
                    <Input placeholder="Search party…" value={partySearch} onChange={e => searchSuppliers(e.target.value)} className="h-9" />
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
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setQuickAddOpen(true)}>Add party</Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Expected Date</Label>
                <Input type="date" className="mt-1 h-9" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Godown</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                  <option value="">Select godown</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Items to Order</Label>
              <LineItemsEditor
                items={items}
                onChange={setItems}
                isGst={true}
                searchMode="catalog"
                defaultRateFrom="purchase"
                godownId={godownId}
                showHsn={true}
                showUnit={true}
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createPO.isPending} onClick={handleCreatePO} disabled={!partyId || items.length === 0}>
                Save Order
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Generate Bill Dialog */}
      {generateBillFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="font-bold text-lg">Generate Purchase Bill</h3>
              <p className="text-sm text-muted-foreground">From PO: {generateBillFor.po_number} · {generateBillFor.party_name_snapshot}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Vendor bill date</Label>
                <Input type="date" className="mt-1 h-9" value={billDate} onChange={e => setBillDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Vendor bill no. (optional)</Label>
                <Input
                  className="mt-1 h-9 font-mono text-xs"
                  placeholder="Auto-generated"
                  value={billNumber}
                  maxLength={16}
                  onChange={e => setBillNumber(e.target.value.trim().toUpperCase())}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">{BILL_NUMBER_HELP}</p>
              </div>
            </div>
            <BankAccountPicker
              remountKey={generateBillFor?.id ?? 0}
              value={receiveBankAccountId}
              onChange={setReceiveBankAccountId}
            />
            <div>
              <Label className="text-xs">Quantities Received</Label>
              <div className="mt-2 space-y-2 border rounded-lg p-3">
                {(generateBillFor.items || []).map((it: any) => (
                  <div key={it.id} className="flex items-center gap-3">
                    <div className="flex-1 text-sm">
                      <span className="font-medium">{it.item_name}</span>
                      <span className="text-muted-foreground text-xs ml-2">Ordered: {it.quantity_ordered}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-muted-foreground">Receiving:</Label>
                      <Input
                        type="number" className="w-20 h-8 text-center" min={0} max={it.quantity_ordered}
                        value={receivals[it.id] ?? it.quantity_ordered}
                        onChange={e => setReceivals(p => ({ ...p, [it.id]: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setGenerateBillFor(null)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" loading={generateBillMutation.isPending} onClick={handleGenerateBill}>
                Confirm & Generate Bill
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
