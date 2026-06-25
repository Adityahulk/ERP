import { useState } from 'react';
import { useStock, useGodowns } from '@/hooks/useStock';
import { useItemCategories } from '@/hooks/useItems';
import { formatMoney } from '@/lib/formatters';
import { Button } from '@/components/ui/button';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Warehouse, Package, AlertTriangle, XCircle, IndianRupee, ArrowRightLeft, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function StockList() {
  const navigate = useNavigate();
  const [godownId, setGodownId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [page, setPage] = useState(1);

  const filters: any = { page, limit: 25 };
  if (godownId) filters.godown_id = godownId;
  if (categoryId) filters.category_id = categoryId;
  if (stockFilter === 'low') filters.low_stock = 'true';
  if (stockFilter === 'out') filters.out_of_stock = 'true';

  const { data, isLoading } = useStock(filters);
  const { data: godownData } = useGodowns();
  const { data: catData } = useItemCategories();

  const items = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  const meta = data?.meta || {};
  const godowns = godownData?.data || [];
  const categories = catData?.data?.flat || [];

  const stats = [
    { label: 'Total Items', value: meta.total_items || pagination?.total || 0, icon: Package, color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' },
    { label: 'Total Value (Cost)', value: formatMoney(parseInt(meta.total_value) || 0), icon: IndianRupee, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
    { label: 'Low Stock', value: meta.low_stock_count || 0, icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
    { label: 'Out of Stock', value: meta.out_of_stock_count || 0, icon: XCircle, color: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Inventory</h1><p className="text-muted-foreground text-sm">Stock levels across all godowns</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/transfer')}><ArrowRightLeft className="w-4 h-4 mr-1" />Transfer</Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/adjust')}><Settings2 className="w-4 h-4 mr-1" />Adjust</Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}><CardContent className="p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold tabular-nums">{s.value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      {/* Godown Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setGodownId('')} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${!godownId ? 'bg-primary text-primary-foreground shadow' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All Godowns</button>
        {godowns.map((g: any) => (
          <button key={g.id} onClick={() => setGodownId(g.id)} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${godownId === g.id ? 'bg-primary text-primary-foreground shadow' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {g.name} {g.is_default && '★'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select className="h-9 rounded-md border bg-transparent px-3 text-sm" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {['','low','out'].map(s => (
          <button key={s} onClick={() => { setStockFilter(s); setPage(1); }} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${stockFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {s === '' ? 'All' : s === 'low' ? '⚠️ Low Stock' : '❌ Out of Stock'}
          </button>
        ))}
      </div>

      {/* Stock Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40">
            <th className="p-3 text-left font-medium">Item</th>
            <th className="p-3 text-left font-medium hidden md:table-cell">Godown</th>
            <th className="p-3 text-right font-medium">Quantity</th>
            <th className="p-3 text-left font-medium hidden lg:table-cell">Unit</th>
            <th className="p-3 text-right font-medium">Avg Cost</th>
            <th className="p-3 text-right font-medium">Total Value</th>
            <th className="p-3 text-center font-medium">Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">Loading...</td></tr>}
            {!isLoading && items.length === 0 && <tr><td colSpan={7} className="p-12 text-center text-muted-foreground"><Warehouse className="w-12 h-12 mx-auto mb-3 opacity-30" />No stock records</td></tr>}
            {items.map((s: any, i: number) => {
              const isLow = s.quantity > 0 && s.quantity <= (s.reorder_point || 0);
              const isOut = s.quantity === 0;
              return (
                <tr key={`${s.id}-${s.godown_id}-${i}`} className={`border-b hover:bg-muted/30 ${isOut ? 'border-l-4 border-l-red-400' : isLow ? 'border-l-4 border-l-amber-400' : ''}`}>
                  <td className="p-3"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.sku || ''}</div></td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{s.godown_name || '—'}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{s.quantity}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{s.unit_abbr || s.unit_name || ''}</td>
                  <td className="p-3 text-right tabular-nums">{formatMoney(s.avg_cost_price || 0)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{formatMoney((s.quantity || 0) * (s.avg_cost_price || 0))}</td>
                  <td className="p-3 text-center">{isOut ? <Badge variant="destructive">Out</Badge> : isLow ? <Badge variant="warning">Low</Badge> : <Badge variant="success">OK</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!pagination.hasPrev} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={!pagination.hasNext} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
