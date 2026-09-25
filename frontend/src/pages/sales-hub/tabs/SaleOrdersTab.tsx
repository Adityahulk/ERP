import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ClipboardList, UserPlus, Eye } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import VyaparLineItems, { type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import toast from 'react-hot-toast';
import SalesDocumentActionMenu from '@/components/transactions/SalesDocumentActionMenu';
import SaleOrderDocument from '@/components/sales/SaleOrderDocument';
import { useCompany } from '@/hooks/useBusiness';
import { useGodowns } from '@/hooks/useStock';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function SaleOrdersTab() {
  const qc = useQueryClient();
  const { data: company = {} as any } = useCompany();
  const { data: godownResponse } = useGodowns();
  const godowns = (godownResponse as any)?.data || [];
  const defaultGodownId = useMemo(() => godowns.find((godown: any) => godown.is_default)?.id || godowns[0]?.id || '', [godowns]);
  const deliveryManuallyChanged = useRef(false);
  const termsInitialized = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [soNumber, setSoNumber] = useState('');

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [godownId, setGodownId] = useState('');
  const [soDate, setSoDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0];
  });
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [notes, setNotes] = useState('');
  const [isInterstate, setIsInterstate] = useState(false);
  const [billing, setBilling] = useState({ recipient: '', address: '', city: '', state: '', stateCode: '', pincode: '', country: 'India' });
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [shipping, setShipping] = useState({ recipient: '', address: '', city: '', state: '', stateCode: '', pincode: '', country: 'India' });
  const [partySnapshot, setPartySnapshot] = useState({ phone: '', email: '', gstin: '' });
  const [showPreview, setShowPreview] = useState(false);
  const [items, setItems] = useState<VyaparLineItem[]>([]);

  useEffect(() => { if (!godownId && defaultGodownId) setGodownId(defaultGodownId); }, [defaultGodownId, godownId]);
  useEffect(() => {
    if (!showForm || editingId || deliveryManuallyChanged.current) return;
    const date = new Date(`${soDate}T00:00:00`);
    date.setDate(date.getDate() + Math.max(1, Math.min(365, Number((company as any).sale_order_delivery_days) || 14)));
    setExpectedDate(date.toISOString().slice(0, 10));
  }, [company, editingId, showForm, soDate]);
  useEffect(() => {
    if (!showForm || editingId || termsInitialized.current || termsAndConditions) return;
    setTermsAndConditions(String((company as any).sale_order_terms_template || (company as any).terms_and_conditions || ''));
    termsInitialized.current = true;
  }, [company, editingId, showForm, termsAndConditions]);

  const { data, isLoading } = useQuery({
    queryKey: ['sale-orders'],
    queryFn: () => api.get('/sales/orders', { params: { limit: 50 } }).then(r => r.data),
  });
  const orders = (data as any)?.data?.data || [];

  const createMut = useMutation({
    mutationFn: (payload: any) => editingId ? api.put(`/sales/orders/${editingId}`, payload) : api.post('/sales/orders', payload),
    onSuccess: () => {
      toast.success(editingId ? 'Sale order updated' : 'Sale order created');
      qc.invalidateQueries({ queryKey: ['sale-orders'] });
      resetForm(); setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/sales/orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['sale-orders'] });
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

  const selectCustomer = (p: any) => {
    setPartyId(p.id); setPartyName(p.name); setPartySearch(''); setPartyResults([]);
    setPartySnapshot({ phone: p.phone || '', email: p.email || '', gstin: p.gstin || '' });
    const nextBilling = { recipient: p.name || '', address: p.billing_address || '', city: p.billing_city || p.city || '', state: p.billing_state || p.state || '', stateCode: p.billing_state_code || p.state_code || String(p.gstin || '').slice(0, 2), pincode: p.billing_pincode || '', country: 'India' };
    const nextShipping = { recipient: p.name || '', address: p.shipping_address || p.billing_address || '', city: p.shipping_city || p.billing_city || p.city || '', state: p.shipping_state || p.billing_state || p.state || '', stateCode: p.billing_state_code || p.state_code || String(p.gstin || '').slice(0, 2), pincode: p.shipping_pincode || p.billing_pincode || '', country: 'India' };
    setBilling(nextBilling); setShipping(nextShipping); setSameAsBilling(!p.shipping_address || p.shipping_address === p.billing_address);
    const sellerCode = String((company as any).state_code || (company as any).gstin || '').slice(0, 2);
    if (sellerCode && nextBilling.stateCode) setIsInterstate(sellerCode !== String(nextBilling.stateCode).slice(0, 2));
  };
  const clearCustomer = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); setPartySnapshot({ phone: '', email: '', gstin: '' }); };
  const resetForm = () => {
    setEditingId(null); setSoNumber('');
    clearCustomer(); setNotes(''); setPaymentTerms(''); setDeliveryTerms(''); setCustomerNotes(''); setTermsAndConditions(''); setItems([]);
    setBilling({ recipient: '', address: '', city: '', state: '', stateCode: '', pincode: '', country: 'India' });
    setShipping({ recipient: '', address: '', city: '', state: '', stateCode: '', pincode: '', country: 'India' });
    setSameAsBilling(true); setIsInterstate(false); setShowPreview(false); setGodownId(defaultGodownId); deliveryManuallyChanged.current = false;
    termsInitialized.current = false;
    setSoDate(new Date().toISOString().split('T')[0]);
    const d = new Date(); d.setDate(d.getDate() + 7);
    setExpectedDate(d.toISOString().split('T')[0]);
  };

  const openOrderForm = async (row: any, duplicate = false) => {
    const loadingToast = toast.loading(duplicate ? 'Preparing duplicate…' : 'Loading sale order…');
    try {
      const response = await api.get(`/sales/orders/${row.id}`);
      const order = response.data?.data;
      setEditingId(duplicate ? null : order.id);
      setSoNumber(duplicate ? '' : order.so_number || '');
      setPartyId(order.party_id || '');
      setPartyName(order.party_name_snapshot || order.party_name || '');
      setPartySnapshot({ phone: order.party_phone_snapshot || order.party_phone || '', email: order.party_email_snapshot || order.party_email || '', gstin: order.party_gstin_snapshot || order.party_gstin || '' });
      setGodownId(order.godown_id || defaultGodownId);
      setSoDate(duplicate ? new Date().toISOString().split('T')[0] : String(order.so_date || '').slice(0, 10));
      setExpectedDate(String(order.expected_delivery_date || '').slice(0, 10));
      deliveryManuallyChanged.current = !duplicate;
      setPaymentTerms(order.payment_terms || '');
      setDeliveryTerms(order.delivery_terms || '');
      setCustomerNotes(order.customer_notes || '');
      setTermsAndConditions(order.terms_and_conditions || (company as any).sale_order_terms_template || '');
      termsInitialized.current = true;
      setNotes(order.notes || '');
      setIsInterstate(Boolean(order.is_interstate));
      setBilling({ recipient: order.billing_recipient_name || order.party_name_snapshot || '', address: order.billing_address || order.party_address_snapshot || '', city: order.billing_city || '', state: order.billing_state || order.party_state_snapshot || '', stateCode: order.billing_state_code || order.party_state_code_snapshot || '', pincode: order.billing_pincode || '', country: order.billing_country || 'India' });
      setSameAsBilling(order.shipping_same_as_billing !== false);
      setShipping({ recipient: order.shipping_recipient_name || order.party_name_snapshot || '', address: order.shipping_address || order.billing_address || '', city: order.shipping_city || order.billing_city || '', state: order.shipping_state || order.billing_state || '', stateCode: order.shipping_state_code || order.billing_state_code || '', pincode: order.shipping_pincode || order.billing_pincode || '', country: order.shipping_country || 'India' });
      setItems((order.items || []).map((item: any) => ({
        item_id: item.item_id || '', name: item.item_name || 'Item', hsn_code: item.hsn_code || '',
        unit: item.unit || '', quantity: Number(item.quantity_ordered) || 0,
        unit_price: Number(item.unit_price) || 0, gst_rate: Number(item.gst_rate) || 0,
        discount_amount: Number(item.discount_amount) || 0,
      })));
      setShowForm(true);
      toast.success(duplicate ? 'Review the duplicate and save it as a new order.' : 'Sale order ready to edit', { id: loadingToast });
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to load sale order', { id: loadingToast });
    }
  };

  const handleCreate = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    createMut.mutate({
      ...(editingId ? { so_number: soNumber } : {}),
      party_id: partyId,
      party_name: partyName,
      godown_id: godownId || undefined,
      so_date: soDate,
      expected_delivery_date: expectedDate,
      payment_terms: paymentTerms.trim() || undefined,
      delivery_terms: deliveryTerms.trim() || undefined,
      customer_notes: customerNotes.trim() || undefined,
      terms_and_conditions: termsAndConditions.trim() || undefined,
      notes: notes.trim() || undefined,
      is_interstate: isInterstate,
      billing_recipient_name: billing.recipient, billing_address: billing.address, billing_city: billing.city,
      billing_state: billing.state, billing_state_code: billing.stateCode, billing_pincode: billing.pincode, billing_country: billing.country,
      shipping_same_as_billing: sameAsBilling,
      shipping_recipient_name: sameAsBilling ? billing.recipient : shipping.recipient,
      shipping_address: sameAsBilling ? billing.address : shipping.address,
      shipping_city: sameAsBilling ? billing.city : shipping.city,
      shipping_state: sameAsBilling ? billing.state : shipping.state,
      shipping_state_code: sameAsBilling ? billing.stateCode : shipping.stateCode,
      shipping_pincode: sameAsBilling ? billing.pincode : shipping.pincode,
      shipping_country: sameAsBilling ? billing.country : shipping.country,
      status: 'confirmed',
      items: items.map(it => ({
        item_id: it.item_id, item_name: it.name, item_description: it.description, hsn_code: it.hsn_code,
        unit: it.unit, quantity: it.quantity, unit_price: it.unit_price,
        gst_rate: it.gst_rate, discount_amount: it.discount_amount || 0,
      })),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage confirmed orders before dispatch.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Sale Order
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">SO No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden lg:table-cell">Exp. Delivery</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Total</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground w-36">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && orders.length === 0 && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />No sale orders yet.
              </td></tr>
            )}
            {orders.map((o: any) => (
              <tr key={o.id} className="border-b hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">{o.party_name_snapshot || o.party_name || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs hidden md:table-cell">{o.so_number}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{formatDate(o.so_date)}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden lg:table-cell">{o.expected_delivery_date ? formatDate(o.expected_delivery_date) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(o.total_amount)||0)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-500'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                  {o.status === 'confirmed' || o.status === 'partial' ? (
                    <Button size="sm" variant="default" className="h-7 text-xs px-3 bg-indigo-600 hover:bg-indigo-700"
                      onClick={() => statusMut.mutate({ id: o.id, status: 'fulfilled' })}>
                      Mark Fulfilled
                    </Button>
                  ) : null}
                  <SalesDocumentActionMenu
                    basePath={`/sales/orders/${o.id}`}
                    documentNumber={o.so_number}
                    documentTitle="Sale Order"
                    phone={o.party_phone}
                    email={o.party_email}
                    canModify={o.status !== 'fulfilled' && o.status !== 'cancelled'}
                    canCancel={o.status !== 'cancelled' && o.status !== 'fulfilled'}
                    onEdit={() => void openOrderForm(o)}
                    onDuplicate={() => void openOrderForm(o, true)}
                    onCancel={async () => {
                      if (!window.confirm(`Cancel sale order ${o.so_number}?`)) return;
                      await api.patch(`/sales/orders/${o.id}/status`, { status: 'cancelled' });
                      toast.success('Sale order cancelled');
                      await qc.invalidateQueries({ queryKey: ['sale-orders'] });
                    }}
                    onDelete={async () => {
                      if (!window.confirm(`Delete sale order ${o.so_number}? This cannot be undone.`)) return;
                      await api.delete(`/sales/orders/${o.id}`);
                      toast.success('Sale order deleted');
                      await qc.invalidateQueries({ queryKey: ['sale-orders'] });
                    }}
                  />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={showForm} onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}>
        <SheetContent side="right" className="w-full max-w-5xl overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>{editingId ? 'Edit Sale Order' : 'New Sale Order'}</SheetTitle></SheetHeader>
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
                <div className="col-span-2">
                  <Label className="text-xs">Sale Order No.</Label>
                  <Input className="mt-1 h-9 font-mono" value={soNumber} onChange={e => setSoNumber(e.target.value)} />
                </div>
              )}
              <div>
                <Label className="text-xs">Order Date</Label>
                <Input type="date" className="mt-1 h-9" value={soDate} onChange={e => setSoDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Expected Delivery</Label>
                <Input type="date" min={soDate} className="mt-1 h-9" value={expectedDate} onChange={e => { deliveryManuallyChanged.current = true; setExpectedDate(e.target.value); }} />
              </div>
              <div>
                <Label className="text-xs">Godown / Branch</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={godownId} onChange={(e) => setGodownId(e.target.value)}><option value="">Head Office</option>{godowns.map((godown: any) => <option key={godown.id} value={godown.id}>{godown.name}{godown.is_default ? ' (default)' : ''}</option>)}</select>
              </div>
              <label className="flex h-9 items-center gap-2 self-end rounded-md border px-3 text-sm"><input type="checkbox" checked={isInterstate} onChange={(e) => setIsInterstate(e.target.checked)} />Interstate (IGST)</label>
              <div className="col-span-2">
                <Label className="text-xs">Payment Terms (optional)</Label>
                <Input className="mt-1 h-9" placeholder="e.g. Net 30, 50% advance" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
              </div>
            </div>
            {partyId && <div className="space-y-3 rounded-lg border bg-slate-50 p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Billing and Shipping Addresses</p><p className="text-xs text-muted-foreground">Saved as a snapshot on this order, so later party edits do not alter it.</p></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sameAsBilling} onChange={(e) => setSameAsBilling(e.target.checked)} />Shipping same as billing</label></div><div className="grid gap-4 lg:grid-cols-2"><AddressEditor title="Billing Address" value={billing} onChange={setBilling} />{!sameAsBilling && <AddressEditor title="Shipping Address" value={shipping} onChange={setShipping} />}{sameAsBilling && <div className="rounded-md border border-dashed bg-white p-4 text-sm text-muted-foreground"><b className="text-slate-800">Shipping Address</b><p className="mt-2">{[billing.recipient, billing.address, billing.city, billing.state, billing.pincode, billing.country].filter(Boolean).join(', ') || 'Enter billing address details.'}</p></div>}</div></div>}
            <div>
              <Label className="text-xs mb-2 block">Items</Label>
              <VyaparLineItems items={items} onChange={setItems} isGst={true} isInterstate={isInterstate} searchMode="catalog" showHsn showUnit showDescription />
            </div>
            <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Delivery Terms<textarea className="mt-1 min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-normal" value={deliveryTerms} onChange={e=>setDeliveryTerms(e.target.value)} /></label><label className="text-xs font-medium">Customer Notes<textarea className="mt-1 min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-normal" value={customerNotes} onChange={e=>setCustomerNotes(e.target.value)} /></label></div>
            <label className="block text-xs font-medium">Terms &amp; Conditions<textarea className="mt-1 min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-normal" value={termsAndConditions} onChange={e=>setTermsAndConditions(e.target.value)} /><span className="mt-1 block font-normal text-muted-foreground">One clause per line; printed as a numbered list.</span></label>
            <label className="block text-xs font-medium">Internal Notes<textarea className="mt-1 min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-normal" value={notes} onChange={e=>setNotes(e.target.value)} /></label>
            <Button type="button" variant="outline" className="gap-2" onClick={() => setShowPreview((value) => !value)}><Eye className="h-4 w-4" />{showPreview ? 'Hide' : 'Show'} live order preview</Button>
            {showPreview && <SaleOrderDocument company={company as any} items={items.map((item) => ({ ...item, item_name: item.name, item_description: item.description, quantity_ordered: item.quantity }))} order={{ so_number: soNumber || 'Auto-generated', so_date: soDate, expected_delivery_date: expectedDate, party_name_snapshot: partyName, party_phone_snapshot: partySnapshot.phone, party_email_snapshot: partySnapshot.email, party_gstin_snapshot: partySnapshot.gstin, party_address_snapshot: billing.address, party_state_snapshot: billing.state, party_state_code_snapshot: billing.stateCode, billing_recipient_name: billing.recipient, billing_address: billing.address, billing_city: billing.city, billing_state: billing.state, billing_pincode: billing.pincode, billing_country: billing.country, shipping_recipient_name: sameAsBilling ? billing.recipient : shipping.recipient, shipping_address: sameAsBilling ? billing.address : shipping.address, shipping_city: sameAsBilling ? billing.city : shipping.city, shipping_state: sameAsBilling ? billing.state : shipping.state, shipping_pincode: sameAsBilling ? billing.pincode : shipping.pincode, shipping_country: sameAsBilling ? billing.country : shipping.country, is_interstate: isInterstate, payment_terms: paymentTerms, delivery_terms: deliveryTerms, customer_notes: customerNotes, terms_and_conditions: termsAndConditions }} />}
            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button className="flex-1" loading={createMut.isPending} onClick={handleCreate} disabled={!partyId || items.length === 0}>
                {editingId ? 'Update Order' : 'Save Order'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectCustomer(row)} />
    </div>
  );
}

type AddressValue = { recipient: string; address: string; city: string; state: string; stateCode: string; pincode: string; country: string };
function AddressEditor({ title, value, onChange }: { title: string; value: AddressValue; onChange: (value: AddressValue) => void }) {
  const field = (key: keyof AddressValue, next: string) => onChange({ ...value, [key]: next });
  return <div className="space-y-2 rounded-md border bg-white p-3"><p className="text-xs font-semibold uppercase text-slate-500">{title}</p><Input className="h-9" placeholder="Recipient name" value={value.recipient} onChange={(e)=>field('recipient',e.target.value)} /><textarea className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm" placeholder="Address" value={value.address} onChange={(e)=>field('address',e.target.value)} /><div className="grid grid-cols-2 gap-2"><Input className="h-9" placeholder="City" value={value.city} onChange={(e)=>field('city',e.target.value)} /><Input className="h-9" placeholder="State" value={value.state} onChange={(e)=>field('state',e.target.value)} /><Input className="h-9" placeholder="State code" maxLength={5} value={value.stateCode} onChange={(e)=>field('stateCode',e.target.value)} /><Input className="h-9" placeholder="Pincode" maxLength={10} value={value.pincode} onChange={(e)=>field('pincode',e.target.value)} /></div></div>;
}
