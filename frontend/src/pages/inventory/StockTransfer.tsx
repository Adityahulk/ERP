import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGodowns, useCreateTransfer, useStock } from '@/hooks/useStock';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface TransferItem { item_id: string; name: string; sku?: string; available: number; quantity: number; }

export default function StockTransfer() {
  const navigate = useNavigate();
  const { data: godownData } = useGodowns();
  const createTransfer = useCreateTransfer();
  const godowns = godownData?.data || [];

  const [fromGodown, setFromGodown] = useState('');
  const [toGodown, setToGodown] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<TransferItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch stock for the source godown
  const { data: stockData } = useStock(fromGodown ? { godown_id: fromGodown, limit: 200 } : { limit: 0 });
  const stockItems = (stockData?.data?.data || []).filter((s: any) => s.quantity > 0);

  const addItem = (stockItem: any) => {
    if (items.find(i => i.item_id === stockItem.id)) return;
    setItems([...items, { item_id: stockItem.id, name: stockItem.name, sku: stockItem.sku, available: stockItem.quantity, quantity: 1 }]);
    setSearchTerm('');
  };

  const updateQty = (idx: number, qty: number) => {
    const updated = [...items];
    updated[idx].quantity = Math.min(qty, updated[idx].available);
    setItems(updated);
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!fromGodown || !toGodown) { toast.error('Select both godowns'); return; }
    if (fromGodown === toGodown) { toast.error('Source and destination must be different'); return; }
    if (!items.length) { toast.error('Add at least one item'); return; }
    if (items.some(i => i.quantity <= 0)) { toast.error('All quantities must be positive'); return; }

    try {
      await createTransfer.mutateAsync({
        from_godown_id: fromGodown, to_godown_id: toGodown, transfer_date: date, notes,
        items: items.map(i => ({ item_id: i.item_id, quantity: i.quantity })),
      });
      toast.success('Stock transfer created!');
      navigate('/inventory');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Transfer failed'); }
  };

  const filteredStock = searchTerm
    ? stockItems.filter((s: any) => s.name.toLowerCase().includes(searchTerm.toLowerCase()) || (s.sku || '').toLowerCase().includes(searchTerm.toLowerCase()))
    : stockItems;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}><ArrowLeft className="w-5 h-5" /></Button>
        <div><h1 className="text-2xl font-bold">Stock Transfer</h1><p className="text-sm text-muted-foreground">Move stock between godowns</p></div>
      </div>

      {/* Godown Selection */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-2 border-dashed">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">From (Source)</CardTitle></CardHeader>
          <CardContent>
            <select className="w-full h-10 rounded-md border bg-transparent px-3 text-sm font-medium" value={fromGodown} onChange={e => { setFromGodown(e.target.value); setItems([]); }}>
              <option value="">Select source godown</option>
              {godowns.filter((g: any) => g.id !== toGodown).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </CardContent>
        </Card>

        <div className="hidden md:flex items-center justify-center"><div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><ArrowRight className="w-5 h-5 text-primary" /></div></div>

        <Card className="border-2 border-dashed md:col-start-2 md:row-start-1">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">To (Destination)</CardTitle></CardHeader>
          <CardContent>
            <select className="w-full h-10 rounded-md border bg-transparent px-3 text-sm font-medium" value={toGodown} onChange={e => setToGodown(e.target.value)}>
              <option value="">Select destination godown</option>
              {godowns.filter((g: any) => g.id !== fromGodown).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div><Label>Transfer Date</Label><Input type="date" className="mt-1" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><Label>Notes (Optional)</Label><Input className="mt-1" placeholder="Reason for transfer..." value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      {/* Item Selection */}
      {fromGodown && (
        <Card>
          <CardHeader><CardTitle className="text-base">Items to Transfer</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Input placeholder="Search items in source godown..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              {searchTerm && filteredStock.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredStock.slice(0, 10).map((s: any) => (
                    <button key={s.id} className="w-full text-left px-4 py-2 hover:bg-muted text-sm flex justify-between" onClick={() => addItem(s)}>
                      <span>{s.name} <span className="text-muted-foreground">{s.sku}</span></span>
                      <Badge variant="secondary">{s.quantity} available</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 && <p className="text-center text-muted-foreground py-6 text-sm">Search and add items above</p>}

            {items.map((item, idx) => (
              <div key={item.item_id} className="flex items-center gap-4 p-3 rounded-lg border">
                <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku || ''} · {item.available} available</p></div>
                <Input type="number" className="w-24 tabular-nums text-center" min={1} max={item.available} value={item.quantity} onChange={e => updateQty(idx, parseInt(e.target.value) || 0)} />
                <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Submit */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => navigate('/inventory')}>Cancel</Button>
        <Button disabled={!items.length} loading={createTransfer.isPending} onClick={handleSubmit}>
          Create Transfer ({items.length} items)
        </Button>
      </div>
    </div>
  );
}
