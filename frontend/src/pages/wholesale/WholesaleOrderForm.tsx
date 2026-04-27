import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Plus, X, Truck } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

export default function WholesaleOrderForm() {
  const navigate = useNavigate(); const qc = useQueryClient();
  const [form, setForm] = useState<any>({ party_id: '', godown_id: '', order_date: new Date().toISOString().split('T')[0], expected_delivery: '', notes: '' });
  const [items, setItems] = useState<any[]>([]);

  const { data: partiesData } = useQuery({
    queryKey: ['parties-for-ws'],
    queryFn: () => api.get('/parties/search', { params: { party_type: 'customer' } }).then(r => r.data?.data ?? r.data),
  });
  const parties = partiesData ?? [];

  const { data: allItemsData } = useQuery({
    queryKey: ['items-for-ws'],
    queryFn: () => api.get('/items', { params: { page: 1, limit: 500, is_active: 'true' } }).then(r => r.data?.data ?? r.data),
  });
  const allItems = allItemsData?.data ?? [];

  const { data: godownsData } = useQuery({
    queryKey: ['godowns-for-ws'],
    queryFn: () => api.get('/godowns').then(r => r.data?.data ?? r.data),
  });
  const godowns = (godownsData as any) ?? [];

  const saveMutation = useMutation({
    mutationFn: (data: any) => api.post('/wholesale', data),
    onSuccess: (res) => { toast.success('Order created'); qc.invalidateQueries({ queryKey: ['wholesale-orders'] }); navigate(`/wholesale/${res.data?.data?.id || ''}`); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const addItem = () => setItems([...items, { item_id: '', item_name: '', hsn_code: '', quantity: 1, unit_price: 0, gst_rate: 18, unit: 'PCS' }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: value };
    if (field === 'item_id') {
      const item = allItems.find((rm: any) => rm.id === value);
      if (item) {
        updated[i].item_name = item.name;
        updated[i].hsn_code = item.hsn_code || '';
        updated[i].unit_price = item.selling_price || 0;
        updated[i].gst_rate = item.gst_rate || 18;
      }
    }
    // Auto-resolve tier pricing
    if ((field === 'item_id' || field === 'quantity') && updated[i].item_id && updated[i].quantity > 0) {
      api.get('/wholesale/price-tiers', { params: { item_id: updated[i].item_id } }).then(res => {
        const tiers = (res.data?.data ?? []).filter((t: any) => t.is_active && t.min_quantity <= updated[i].quantity).sort((a: any, b: any) => b.min_quantity - a.min_quantity);
        if (tiers.length > 0) {
          const newItems = [...items];
          newItems[i] = { ...newItems[i], unit_price: tiers[0].price, tier_applied: tiers[0].tier_name || `≥${tiers[0].min_quantity}` };
          setItems(newItems);
        }
      }).catch(() => {});
    }
    setItems(updated);
  };

  const lineTotal = (item: any) => { const base = (item.unit_price || 0) * (item.quantity || 0); const tax = base * (item.gst_rate || 0) / 100; return base + tax; };
  const subtotal = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 0), 0);
  const totalTax = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 0) * (i.gst_rate || 0) / 100, 0);
  const grandTotal = subtotal + totalTax;

  const fmtAmt = (v: number) => `₹${(v / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const handleSave = () => {
    if (!form.party_id) { toast.error('Select a party'); return; }
    if (!items.length || items.some(i => !i.item_id)) { toast.error('Add items'); return; }
    saveMutation.mutate({ ...form, items });
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <Button variant="ghost" className="mb-4 gap-2 text-slate-600" onClick={() => navigate('/wholesale')}><ArrowLeft className="w-4 h-4" /> Back</Button>
      <h1 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2"><Truck className="w-7 h-7 text-indigo-600" /> New Wholesale Order</h1>

      {/* Party & Details */}
      <Card className="mb-6"><CardContent className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2">
            <Label>Party / Dealer *</Label>
            <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.party_id} onChange={e => setForm({ ...form, party_id: e.target.value })}>
              <option value="">— Select party —</option>
              {parties.map((p: any) => <option key={p.id} value={p.id}>{p.name} {p.gstin ? `(${p.gstin})` : ''}</option>)}
            </select>
          </div>
          <div><Label>Order Date</Label><Input type="date" className="mt-1" value={form.order_date} onChange={e => setForm({ ...form, order_date: e.target.value })} /></div>
          <div><Label>Expected Delivery</Label><Input type="date" className="mt-1" value={form.expected_delivery} onChange={e => setForm({ ...form, expected_delivery: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Godown</Label>
            <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.godown_id} onChange={e => setForm({ ...form, godown_id: e.target.value })}>
              <option value="">— Select —</option>
              {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div><Label>Notes</Label><Input className="mt-1" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes" /></div>
        </div>
      </CardContent></Card>

      {/* Line Items */}
      <Card className="mb-6"><CardContent className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-900">Order Items</h2>
          <Button variant="outline" size="sm" className="gap-1" onClick={addItem}><Plus className="w-3 h-3" /> Add Item</Button>
        </div>
        {items.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Click "Add Item" to start adding products</p>}
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-lg">
              <div className="col-span-3">
                {i === 0 && <Label className="text-xs">Item</Label>}
                <select className="w-full h-9 rounded-md border bg-white px-2 text-sm mt-1" value={item.item_id} onChange={e => updateItem(i, 'item_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {allItems.map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">{i === 0 && <Label className="text-xs">Qty</Label>}<Input type="number" min={1} className="mt-1" value={item.quantity || ''} onChange={e => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} /></div>
              <div className="col-span-2">{i === 0 && <Label className="text-xs">Unit Price (paise)</Label>}<Input type="number" min={0} className="mt-1" value={item.unit_price || ''} onChange={e => updateItem(i, 'unit_price', parseInt(e.target.value) || 0)} /></div>
              <div className="col-span-1">{i === 0 && <Label className="text-xs">GST %</Label>}<Input type="number" min={0} className="mt-1" value={item.gst_rate || ''} onChange={e => updateItem(i, 'gst_rate', parseInt(e.target.value) || 0)} /></div>
              <div className="col-span-2">{i === 0 && <Label className="text-xs">Tier</Label>}<p className="text-xs text-indigo-600 mt-2 truncate">{item.tier_applied || '—'}</p></div>
              <div className="col-span-1">{i === 0 && <Label className="text-xs">Line Total</Label>}<p className="text-sm font-bold mt-2">{fmtAmt(lineTotal(item))}</p></div>
              <div className="col-span-1 flex justify-end"><Button variant="ghost" size="icon" className="text-red-400" onClick={() => removeItem(i)}><X className="w-4 h-4" /></Button></div>
            </div>
          ))}
        </div>
      </CardContent></Card>

      {/* Summary */}
      {items.length > 0 && (
        <Card className="mb-6 bg-gradient-to-r from-indigo-50 to-blue-50"><CardContent className="p-6">
          <div className="flex justify-end gap-8">
            <div className="text-right"><p className="text-sm text-slate-500">Subtotal</p><p className="font-bold">{fmtAmt(subtotal)}</p></div>
            <div className="text-right"><p className="text-sm text-slate-500">Tax</p><p className="font-bold">{fmtAmt(totalTax)}</p></div>
            <div className="text-right"><p className="text-sm text-slate-500">Grand Total</p><p className="font-bold text-2xl text-indigo-600">{fmtAmt(grandTotal)}</p></div>
          </div>
        </CardContent></Card>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => navigate('/wholesale')}>Cancel</Button>
        <Button loading={saveMutation.isPending} onClick={handleSave}>Create Order</Button>
      </div>
    </div>
  );
}
