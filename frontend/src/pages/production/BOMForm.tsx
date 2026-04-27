import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Plus, X, Factory, Play } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

export default function BOMForm() {
  const { id } = useParams(); const isEdit = !!id;
  const navigate = useNavigate(); const qc = useQueryClient();

  const [form, setForm] = useState<any>({ bom_name: '', finished_item_id: '', labour_cost: 0, overhead_cost: 0, notes: '' });
  const [items, setItems] = useState<any[]>([]);
  const [produceQty, setProduceQty] = useState(1);
  const [produceGodown, setProduceGodown] = useState('');
  const [showProduce, setShowProduce] = useState(false);

  const { data: bomData } = useQuery({
    queryKey: ['bom-detail', id], enabled: !!id,
    queryFn: () => api.get(`/bom/${id}`).then(r => r.data?.data ?? r.data),
  });

  const { data: allItemsData } = useQuery({
    queryKey: ['items-for-bom'],
    queryFn: () => api.get('/items', { params: { page: 1, limit: 500, is_active: 'true' } }).then(r => r.data?.data ?? r.data),
  });
  const allItems = allItemsData?.data ?? [];
  const finishedGoods = allItems.filter((i: any) => ['finished_good', 'product'].includes(i.item_type));
  const rawMaterials = allItems.filter((i: any) => ['raw_material', 'consumable', 'product'].includes(i.item_type));

  const { data: godownsData } = useQuery({
    queryKey: ['godowns-for-bom'],
    queryFn: () => api.get('/godowns').then(r => r.data?.data ?? r.data),
  });
  const godowns = (godownsData as any) ?? [];

  useEffect(() => {
    if (bomData) {
      setForm({ bom_name: bomData.bom_name || '', finished_item_id: bomData.finished_item_id, labour_cost: (bomData.labour_cost || 0) / 100, overhead_cost: (bomData.overhead_cost || 0) / 100, notes: bomData.notes || '' });
      setItems((bomData.items || []).map((bi: any) => ({ item_id: bi.item_id, item_name: bi.item_name, quantity: Number(bi.quantity), wastage_percent: Number(bi.wastage_percent), unit: bi.unit || 'PCS', unit_cost: (bi.unit_cost || 0) / 100 })));
    }
  }, [bomData]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => isEdit ? api.patch(`/bom/${id}`, data) : api.post('/bom', data),
    onSuccess: () => { toast.success(isEdit ? 'BOM updated' : 'BOM created'); qc.invalidateQueries({ queryKey: ['bom-list'] }); navigate('/production'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const produceMutation = useMutation({
    mutationFn: (data: any) => api.post(`/bom/${id}/produce`, data),
    onSuccess: () => { toast.success('Production completed!'); qc.invalidateQueries({ queryKey: ['bom-detail', id] }); setShowProduce(false); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Production failed'),
  });

  const addItem = () => setItems([...items, { item_id: '', item_name: '', quantity: 1, wastage_percent: 0, unit: 'PCS', unit_cost: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: value };
    if (field === 'item_id') {
      const item = rawMaterials.find((rm: any) => rm.id === value);
      if (item) { updated[i].item_name = item.name; updated[i].unit_cost = (item.purchase_price || 0) / 100; }
    }
    setItems(updated);
  };

  const totalMaterialCost = items.reduce((sum, i) => sum + (i.unit_cost || 0) * (i.quantity || 0) * (1 + (i.wastage_percent || 0) / 100), 0);
  const totalCost = totalMaterialCost + (form.labour_cost || 0) + (form.overhead_cost || 0);

  const handleSave = () => {
    if (!form.finished_item_id) { toast.error('Select a finished good'); return; }
    if (!items.length || items.some(i => !i.item_id)) { toast.error('Add at least one raw material'); return; }
    saveMutation.mutate({
      ...form, labour_cost: Math.round((form.labour_cost || 0) * 100), overhead_cost: Math.round((form.overhead_cost || 0) * 100),
      items: items.map(i => ({ item_id: i.item_id, item_name: i.item_name, quantity: i.quantity, wastage_percent: i.wastage_percent, unit: i.unit })),
    });
  };

  const fmtCost = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <Button variant="ghost" className="mb-4 gap-2 text-slate-600" onClick={() => navigate('/production')}>
        <ArrowLeft className="w-4 h-4" /> Back to BOM List
      </Button>

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{isEdit ? 'Edit BOM' : 'Create New BOM'}</h1>
        {isEdit && <Button variant="outline" className="gap-2" onClick={() => setShowProduce(!showProduce)}><Play className="w-4 h-4" /> Produce</Button>}
      </div>

      {/* Produce Panel */}
      {showProduce && isEdit && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50">
          <CardContent className="p-4">
            <h3 className="font-bold text-emerald-800 mb-3 flex items-center gap-2"><Factory className="w-4 h-4" /> Produce Finished Goods</h3>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Quantity to Produce</Label><Input type="number" min={1} value={produceQty} onChange={e => setProduceQty(parseInt(e.target.value) || 1)} className="mt-1" /></div>
              <div><Label>Godown</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-white px-3 text-sm" value={produceGodown} onChange={e => setProduceGodown(e.target.value)}>
                  <option value="">— Select —</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700" loading={produceMutation.isPending}
                  onClick={() => produceMutation.mutate({ quantity: produceQty, godown_id: produceGodown })}>
                  <Play className="w-4 h-4" /> Execute Production
                </Button>
              </div>
            </div>
            <p className="text-xs text-emerald-700 mt-2">This will consume {produceQty}× raw materials and add {produceQty} finished goods to stock. Est. cost: {fmtCost(totalCost * produceQty)}</p>
          </CardContent>
        </Card>
      )}

      {/* BOM Details */}
      <Card className="mb-6">
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Finished Good *</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.finished_item_id || ''} onChange={e => setForm({ ...form, finished_item_id: e.target.value })} disabled={isEdit}>
                <option value="">— Select finished good —</option>
                {finishedGoods.map((item: any) => <option key={item.id} value={item.id}>{item.name} {item.sku ? `(${item.sku})` : ''}</option>)}
              </select>
            </div>
            <div><Label>BOM Name</Label><Input className="mt-1" value={form.bom_name} onChange={e => setForm({ ...form, bom_name: e.target.value })} placeholder="e.g. Widget Assembly v1" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Labour Cost (₹ per unit)</Label><Input type="number" min={0} step={0.01} className="mt-1" value={form.labour_cost || ''} onChange={e => setForm({ ...form, labour_cost: parseFloat(e.target.value) || 0 })} /></div>
            <div><Label>Overhead Cost (₹ per unit)</Label><Input type="number" min={0} step={0.01} className="mt-1" value={form.overhead_cost || ''} onChange={e => setForm({ ...form, overhead_cost: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div><Label>Notes</Label><textarea className="mt-1 w-full border rounded-md p-3 text-sm h-20 resize-none" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </CardContent>
      </Card>

      {/* Raw Materials */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-slate-900">Raw Materials</h2>
            <Button variant="outline" size="sm" className="gap-1" onClick={addItem}><Plus className="w-3 h-3" /> Add Material</Button>
          </div>
          {items.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Add raw materials that make up this finished good</p>}
          <div className="space-y-3">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-lg">
                <div className="col-span-4">
                  {i === 0 && <Label className="text-xs">Material</Label>}
                  <select className="w-full h-9 rounded-md border bg-white px-2 text-sm mt-1" value={item.item_id} onChange={e => updateItem(i, 'item_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {rawMaterials.map((rm: any) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">{i === 0 && <Label className="text-xs">Qty</Label>}<Input type="number" min={0.01} step={0.01} className="mt-1" value={item.quantity || ''} onChange={e => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} /></div>
                <div className="col-span-2">{i === 0 && <Label className="text-xs">Wastage %</Label>}<Input type="number" min={0} step={0.1} className="mt-1" value={item.wastage_percent || ''} onChange={e => updateItem(i, 'wastage_percent', parseFloat(e.target.value) || 0)} /></div>
                <div className="col-span-2">{i === 0 && <Label className="text-xs">Unit Cost</Label>}<p className="text-sm font-medium text-slate-600 mt-2">{fmtCost(item.unit_cost || 0)}</p></div>
                <div className="col-span-1">{i === 0 && <Label className="text-xs">Line Total</Label>}<p className="text-sm font-bold text-slate-900 mt-2">{fmtCost((item.unit_cost || 0) * (item.quantity || 0) * (1 + (item.wastage_percent || 0) / 100))}</p></div>
                <div className="col-span-1 flex justify-end"><Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600" onClick={() => removeItem(i)}><X className="w-4 h-4" /></Button></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cost Summary */}
      <Card className="mb-6 bg-gradient-to-r from-indigo-50 to-blue-50">
        <CardContent className="p-6">
          <h3 className="font-bold text-slate-900 mb-3">Cost per Unit</h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><p className="text-slate-500">Material Cost</p><p className="font-bold text-lg">{fmtCost(totalMaterialCost)}</p></div>
            <div><p className="text-slate-500">Labour Cost</p><p className="font-bold text-lg">{fmtCost(form.labour_cost || 0)}</p></div>
            <div><p className="text-slate-500">Overhead Cost</p><p className="font-bold text-lg">{fmtCost(form.overhead_cost || 0)}</p></div>
            <div><p className="text-slate-500">Total Cost</p><p className="font-bold text-2xl text-indigo-600">{fmtCost(totalCost)}</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => navigate('/production')}>Cancel</Button>
        <Button loading={saveMutation.isPending} onClick={handleSave}>{isEdit ? 'Update BOM' : 'Create BOM'}</Button>
      </div>

      {/* Production History */}
      {isEdit && bomData?.production_logs?.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Production History</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b"><tr>
                <th className="px-4 py-3 font-semibold text-slate-600">Prod #</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Date</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-right">Qty</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-right">Cost</th>
                <th className="px-4 py-3 font-semibold text-slate-600">By</th>
              </tr></thead>
              <tbody className="divide-y">
                {bomData.production_logs.map((l: any) => (
                  <tr key={l.id}><td className="px-4 py-3 font-mono text-xs">{l.production_number}</td>
                    <td className="px-4 py-3">{new Date(l.production_date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.quantity_produced}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtCost((l.total_cost || 0) / 100)}</td>
                    <td className="px-4 py-3 text-slate-500">{l.created_by_name || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
