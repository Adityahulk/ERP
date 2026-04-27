import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag, Plus, X, Save } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

export default function WholesalePriceTiers() {
  const qc = useQueryClient();
  const [selectedItem, setSelectedItem] = useState('');
  const [tiers, setTiers] = useState<any[]>([]);

  const { data: allItemsData } = useQuery({
    queryKey: ['items-for-tiers'],
    queryFn: () => api.get('/items', { params: { page: 1, limit: 500, is_active: 'true' } }).then(r => r.data?.data ?? r.data),
  });
  const allItems = allItemsData?.data ?? [];

  const { data: existingTiers, isLoading } = useQuery({
    queryKey: ['price-tiers', selectedItem], enabled: !!selectedItem,
    queryFn: () => api.get('/wholesale/price-tiers', { params: { item_id: selectedItem } }).then(r => r.data?.data ?? []),
  });

  const saveMut = useMutation({
    mutationFn: (data: any) => api.post('/wholesale/price-tiers', data),
    onSuccess: () => { toast.success('Tiers saved'); qc.invalidateQueries({ queryKey: ['price-tiers', selectedItem] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleItemSelect = (itemId: string) => {
    setSelectedItem(itemId);
    setTiers([]);
  };

  // Populate tiers when data loads
  if (existingTiers && existingTiers.length > 0 && tiers.length === 0 && selectedItem) {
    setTiers(existingTiers.map((t: any) => ({ min_quantity: t.min_quantity, price: t.price, tier_name: t.tier_name || '' })));
  }

  const addTier = () => setTiers([...tiers, { min_quantity: 10, price: 0, tier_name: '' }]);
  const removeTier = (i: number) => setTiers(tiers.filter((_, idx) => idx !== i));
  const updateTier = (i: number, field: string, value: any) => { const u = [...tiers]; u[i] = { ...u[i], [field]: value }; setTiers(u); };

  const selectedItemInfo = allItems.find((i: any) => i.id === selectedItem);
  const fmtAmt = (v: number) => `₹${((v || 0) / 100).toFixed(2)}`;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2 mb-2"><Tag className="w-7 h-7 text-indigo-600" /> Wholesale Pricing Tiers</h1>
      <p className="text-slate-500 text-sm mb-6">Define quantity-based pricing brackets for wholesale orders</p>

      {/* Item Selector */}
      <Card className="mb-6"><CardContent className="p-6">
        <Label>Select Item to Configure Pricing</Label>
        <select className="mt-2 w-full h-10 rounded-md border bg-transparent px-3 text-sm" value={selectedItem} onChange={e => handleItemSelect(e.target.value)}>
          <option value="">— Choose an item —</option>
          {allItems.map((item: any) => <option key={item.id} value={item.id}>{item.name} {item.sku ? `(${item.sku})` : ''} — Base: {fmtAmt(item.selling_price)}</option>)}
        </select>
      </CardContent></Card>

      {selectedItem && (
        <>
          {/* Base Price Info */}
          {selectedItemInfo && (
            <Card className="mb-4 bg-gradient-to-r from-indigo-50 to-blue-50"><CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-bold text-slate-900">{selectedItemInfo.name}</p>
                  <p className="text-xs text-slate-500">{selectedItemInfo.sku || '—'} • HSN: {selectedItemInfo.hsn_code || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Base Selling Price</p>
                  <p className="text-lg font-bold text-indigo-600">{fmtAmt(selectedItemInfo.selling_price)}</p>
                </div>
              </div>
            </CardContent></Card>
          )}

          {/* Tiers */}
          <Card className="mb-6"><CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900">Price Tiers</h2>
              <Button variant="outline" size="sm" className="gap-1" onClick={addTier}><Plus className="w-3 h-3" /> Add Tier</Button>
            </div>

            {isLoading && <p className="text-sm text-slate-400">Loading tiers...</p>}

            {tiers.length === 0 && !isLoading && <p className="text-sm text-slate-400 text-center py-6">No tiers defined. Add a tier to set quantity-based pricing.</p>}

            <div className="space-y-3">
              {tiers.map((tier, i) => (
                <div key={i} className="grid grid-cols-12 gap-3 items-end p-3 bg-slate-50 rounded-lg">
                  <div className="col-span-3">
                    {i === 0 && <Label className="text-xs">Tier Name</Label>}
                    <Input className="mt-1" placeholder="e.g. Bulk Discount" value={tier.tier_name} onChange={e => updateTier(i, 'tier_name', e.target.value)} />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <Label className="text-xs">Min Quantity ≥</Label>}
                    <Input type="number" min={1} className="mt-1" value={tier.min_quantity || ''} onChange={e => updateTier(i, 'min_quantity', parseInt(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <Label className="text-xs">Price (paise per unit)</Label>}
                    <Input type="number" min={0} className="mt-1" value={tier.price || ''} onChange={e => updateTier(i, 'price', parseInt(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <Label className="text-xs">Display</Label>}
                    <p className="text-sm font-medium text-emerald-600 mt-2">{fmtAmt(tier.price)}/unit</p>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button variant="ghost" size="icon" className="text-red-400" onClick={() => removeTier(i)}><X className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </div>

            {tiers.length > 0 && (
              <div className="mt-4 flex justify-end">
                <Button className="gap-2" loading={saveMut.isPending} onClick={() => saveMut.mutate({ item_id: selectedItem, tiers })}>
                  <Save className="w-4 h-4" /> Save Tiers
                </Button>
              </div>
            )}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
