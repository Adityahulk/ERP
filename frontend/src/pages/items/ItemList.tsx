import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useItems, useItemCategories, useDeleteItem } from '@/hooks/useItems';
import { useGodowns } from '@/hooks/useStock';
import { useAuthStore } from '@/store/authStore';
import { formatMoney } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Search, Upload, Download, Barcode, Trash2, Edit2, Package } from 'lucide-react';
import type { Item, ItemFilters } from '@/types';
import ItemForm from './ItemForm';
import toast from 'react-hot-toast';

export default function ItemList() {
  const navigate = useNavigate();
  const { company } = useAuthStore();
  const term = company?.itemTerminologyPlural || 'Products';

  const [filters, setFilters] = useState<ItemFilters>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stockFilter, setStockFilter] = useState('all');

  const activeFilters = useMemo(() => {
    const f: ItemFilters = { ...filters, search: search || undefined };
    if (stockFilter === 'low') f.low_stock = 'true';
    if (stockFilter === 'out') f.out_of_stock = 'true';
    return f;
  }, [filters, search, stockFilter]);

  const { data, isLoading } = useItems(activeFilters);
  const { data: catData } = useItemCategories();
  useGodowns();
  const deleteMutation = useDeleteItem();

  const items: Item[] = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  const categories = catData?.data?.flat || [];

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try { await deleteMutation.mutateAsync(id); toast.success('Item deleted'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to delete'); }
  };

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  };

  const getStockBadge = (item: Item) => {
    if (!item.track_inventory) return <Badge variant="secondary">Service</Badge>;
    const stock = item.total_stock || 0;
    if (stock === 0) return <Badge variant="destructive">Out of Stock</Badge>;
    if (stock <= (item.reorder_point || 0)) return <Badge variant="warning">Low Stock</Badge>;
    return <Badge variant="success">In Stock</Badge>;
  };

  const getRowBorder = (item: Item) => {
    if (!item.track_inventory) return '';
    const stock = item.total_stock || 0;
    if (stock === 0) return 'border-l-4 border-l-red-400';
    if (stock <= (item.reorder_point || 0)) return 'border-l-4 border-l-amber-400';
    return '';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{term}</h1>
          <p className="text-muted-foreground text-sm mt-1">{pagination?.total || 0} items total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><Upload className="w-4 h-4 mr-1" />Import</Button>
          <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}><Plus className="w-4 h-4 mr-1" />Add {company?.itemTerminology || 'Product'}</Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by name, SKU, barcode..." className="pl-9"
                value={search} onChange={e => { setSearch(e.target.value); setFilters(f => ({ ...f, page: 1 })); }} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select className="h-9 rounded-md border bg-transparent px-3 text-sm" value={filters.category_id || ''} onChange={e => setFilters(f => ({ ...f, category_id: e.target.value || undefined, page: 1 }))}>
                <option value="">All Categories</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="h-9 rounded-md border bg-transparent px-3 text-sm" value={filters.item_type || ''} onChange={e => setFilters(f => ({ ...f, item_type: e.target.value || undefined, page: 1 }))}>
                <option value="">All Types</option>
                <option value="product">Product</option><option value="service">Service</option>
                <option value="raw_material">Raw Material</option><option value="consumable">Consumable</option>
              </select>
              {['all','low','out'].map(s => (
                <button key={s} onClick={() => setStockFilter(s)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${stockFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                  {s === 'all' ? 'All Stock' : s === 'low' ? '⚠️ Low' : '❌ Out'}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg p-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline"><Barcode className="w-3 h-3 mr-1" />Print Barcodes</Button>
          <Button size="sm" variant="outline"><Download className="w-3 h-3 mr-1" />Export</Button>
          <Button size="sm" variant="destructive"><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-10 p-3"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="rounded border-input" /></th>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Category</th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">Stock</th>
                <th className="text-right p-3 font-medium tabular-nums">Purchase ₹</th>
                <th className="text-right p-3 font-medium tabular-nums">Selling ₹</th>
                <th className="text-center p-3 font-medium hidden lg:table-cell">GST</th>
                <th className="text-center p-3 font-medium">Status</th>
                <th className="w-16 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">Loading...</td></tr>}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={9} className="p-12 text-center">
                  <Package className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground">No items found</p>
                  <Button size="sm" className="mt-3" onClick={() => setShowForm(true)}>Add First Item</Button>
                </td></tr>
              )}
              {items.map(item => (
                <tr key={item.id} className={`border-b hover:bg-muted/30 transition-colors cursor-pointer ${getRowBorder(item)}`} onClick={() => navigate(`/items/${item.id}`)}>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded border-input" />
                  </td>
                  <td className="p-3"><div className="font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{item.sku || '—'}</div></td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{item.category_name || '—'}</td>
                  <td className="p-3 text-right hidden lg:table-cell tabular-nums font-medium">{item.track_inventory ? (item.total_stock || 0) : '—'}</td>
                  <td className="p-3 text-right tabular-nums">{formatMoney(item.purchase_price)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{formatMoney(item.selling_price)}</td>
                  <td className="p-3 text-center hidden lg:table-cell"><span className="tabular-nums">{item.gst_rate}%</span></td>
                  <td className="p-3 text-center">{getStockBadge(item)}</td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditItem(item); setShowForm(true); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        title="Delete item"
                        loading={deleteMutation.isPending && deleteMutation.variables === item.id}
                        onClick={() => handleDelete(item.id, item.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!pagination.hasPrev} onClick={() => setFilters(f => ({ ...f, page: (f.page || 1) - 1 }))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={!pagination.hasNext} onClick={() => setFilters(f => ({ ...f, page: (f.page || 1) + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Item Form Sheet */}
      <ItemForm open={showForm} onOpenChange={setShowForm} item={editItem} />
    </div>
  );
}
