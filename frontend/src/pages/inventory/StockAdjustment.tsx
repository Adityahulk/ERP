import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGodowns, useStock, useCreateAdjustment } from '@/hooks/useStock';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Search } from 'lucide-react';
import toast from 'react-hot-toast';

interface AdjItem { item_id: string; name: string; current_quantity: number; adjusted_quantity: number; reason: string; }

export default function StockAdjustment() {
  const navigate = useNavigate();
  const { data: godownData } = useGodowns();
  const createAdj = useCreateAdjustment();
  const godowns = godownData?.data || [];

  const [godownId, setGodownId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<AdjItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const { data: stockData } = useStock(godownId ? { godown_id: godownId, limit: 200 } : { limit: 0 });
  const stockItems = stockData?.data?.data || [];

  const addItem = (stockItem: any) => {
    if (items.find(i => i.item_id === stockItem.id)) return;
    setItems([...items, { item_id: stockItem.id, name: stockItem.name, current_quantity: stockItem.quantity, adjusted_quantity: stockItem.quantity, reason: '' }]);
    setSearchTerm('');
  };

  const updateAdjusted = (idx: number, qty: number) => {
    const updated = [...items];
    updated[idx].adjusted_quantity = Math.max(0, qty);
    setItems(updated);
  };

  const updateReason = (idx: number, r: string) => {
    const updated = [...items];
    updated[idx].reason = r;
    setItems(updated);
  };

  const handleSubmit = async () => {
    if (!godownId) { toast.error('Select a godown'); return; }
    if (!reason) { toast.error('Reason is required'); return; }
    if (!items.length) { toast.error('Add at least one item'); return; }

    const changedItems = items.filter(i => i.adjusted_quantity !== i.current_quantity);
    if (!changedItems.length) { toast.error('No quantities changed'); return; }

    try {
      await createAdj.mutateAsync({
        godown_id: godownId, adjustment_date: date, reason, notes,
        items: changedItems.map(i => ({
          item_id: i.item_id, current_quantity: i.current_quantity,
          adjusted_quantity: i.adjusted_quantity, reason: i.reason,
        })),
      });
      toast.success('Stock adjustment submitted');
      navigate('/inventory');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Adjustment failed'); }
  };

  const filteredStock = searchTerm
    ? stockItems.filter((s: any) => s.name?.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}><ArrowLeft className="w-5 h-5" /></Button>
        <div><h1 className="text-2xl font-bold">Stock Adjustment</h1><p className="text-sm text-muted-foreground">Adjust physical stock counts</p></div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label>Godown *</Label>
          <select className="mt-1 w-full h-10 rounded-md border bg-transparent px-3 text-sm" value={godownId} onChange={e => { setGodownId(e.target.value); setItems([]); }}>
            <option value="">Select godown</option>
            {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div><Label>Adjustment Date</Label><Input type="date" className="mt-1" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><Label>Reason *</Label>
          <select className="mt-1 w-full h-10 rounded-md border bg-transparent px-3 text-sm" value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select reason</option>
            <option value="Physical Count">Physical Count</option>
            <option value="Damage">Damage/Breakage</option>
            <option value="Expired">Expired Stock</option>
            <option value="Theft/Loss">Theft/Loss</option>
            <option value="Return">Return/Refund</option>
            <option value="Opening Balance">Opening Balance Correction</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div><Label>Notes</Label><Input className="mt-1" placeholder="Additional notes..." value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      {/* Items */}
      {godownId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Adjust Items</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search items in this godown..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              {searchTerm && filteredStock.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredStock.slice(0, 10).map((s: any) => (
                    <button key={s.id} className="w-full text-left px-4 py-2 hover:bg-muted text-sm flex justify-between" onClick={() => addItem(s)}>
                      <span>{s.name}</span><Badge variant="secondary">Qty: {s.quantity}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/40 border-b">
                    <th className="p-3 text-left font-medium">Item</th>
                    <th className="p-3 text-right font-medium w-24">Current</th>
                    <th className="p-3 text-right font-medium w-28">Adjusted</th>
                    <th className="p-3 text-right font-medium w-24">Diff</th>
                    <th className="p-3 text-left font-medium w-40">Reason</th>
                  </tr></thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const diff = item.adjusted_quantity - item.current_quantity;
                      return (
                        <tr key={item.item_id} className="border-b">
                          <td className="p-3 font-medium">{item.name}</td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">{item.current_quantity}</td>
                          <td className="p-3 text-right"><Input type="number" className="w-24 tabular-nums text-center ml-auto" min={0} value={item.adjusted_quantity} onChange={e => updateAdjusted(idx, parseInt(e.target.value) || 0)} /></td>
                          <td className={`p-3 text-right tabular-nums font-semibold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                            {diff > 0 ? '+' : ''}{diff}
                          </td>
                          <td className="p-3"><Input className="text-xs" placeholder="Reason..." value={item.reason} onChange={e => updateReason(idx, e.target.value)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {items.length === 0 && <p className="text-center text-muted-foreground py-6 text-sm">Search and add items to adjust</p>}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => navigate('/inventory')}>Cancel</Button>
        <Button disabled={!items.length} loading={createAdj.isPending} onClick={handleSubmit}>
          Submit Adjustment
        </Button>
      </div>
    </div>
  );
}
