import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  useCreateItemCategory,
  useCreateItemUnit,
  useDeleteItem,
  useItem,
  useItemCategories,
  useItems,
  useItemUnits,
} from '@/hooks/useItems';
import { useGodowns } from '@/hooks/useStock';
import { useAuthStore } from '@/store/authStore';
import { formatDate, formatMoney } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowRight,
  Download,
  Edit2,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
  Warehouse,
} from 'lucide-react';
import type { Item } from '@/types';
import ItemForm from './ItemForm';
import { BarcodeGeneratorPanel } from '@/components/items/BarcodeGeneratorPanel';
import toast from 'react-hot-toast';

type ItemWorkspaceTab = 'products' | 'services' | 'categories' | 'units' | 'barcodes';

function qtyText(value: unknown) {
  const num = Number(value || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function activityBadge(activityType: string) {
  if (activityType === 'sale' || activityType === 'transfer_out') return 'destructive' as const;
  if (activityType === 'purchase' || activityType === 'opening_stock' || activityType === 'transfer_in') return 'success' as const;
  return 'warning' as const;
}

export default function ItemList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { company } = useAuthStore();
  const termSingle = company?.itemTerminology || 'Item';

  const [activeTab, setActiveTab] = useState<ItemWorkspaceTab>('products');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [categoryName, setCategoryName] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitAbbreviation, setUnitAbbreviation] = useState('');
  const [importing, setImporting] = useState(false);

  const isServiceTab = activeTab === 'services';
  const itemFilters = useMemo(() => {
    const filters: Record<string, unknown> = {
      page: 1,
      limit: 200,
      search: search || undefined,
    };
    if (activeTab === 'products' || activeTab === 'services') {
      filters.item_type = isServiceTab ? 'service' : undefined;
      if (!isServiceTab && stockFilter === 'low') filters.low_stock = 'true';
      if (!isServiceTab && stockFilter === 'out') filters.out_of_stock = 'true';
    }
    return filters;
  }, [activeTab, isServiceTab, search, stockFilter]);

  const { data: itemsRes, isLoading } = useItems(itemFilters);
  const { data: categoriesRes } = useItemCategories();
  const { data: unitsRes } = useItemUnits();
  const { data: godownsRes } = useGodowns();
  const deleteMutation = useDeleteItem();
  const createCategory = useCreateItemCategory();
  const createUnit = useCreateItemUnit();

  const items: Item[] = itemsRes?.data?.data || [];
  const itemDetailQuery = useItem(selectedItemId);
  const selectedItem: any = itemDetailQuery.data?.data;
  const categories = categoriesRes?.data?.flat || [];
  const units = unitsRes?.data || [];
  const godowns = godownsRes?.data || [];

  const visibleItems = useMemo(() => {
    if (activeTab === 'services') return items.filter((item) => item.item_type === 'service');
    if (activeTab === 'products') return items.filter((item) => item.item_type !== 'service');
    return items;
  }, [activeTab, items]);

  const categoryItems = useMemo(
    () => items.filter((item) => (selectedCategoryId ? item.category_id === selectedCategoryId : !item.category_id)),
    [items, selectedCategoryId]
  );

  const unitItems = useMemo(
    () => items.filter((item) => (selectedUnitId ? item.unit_id === selectedUnitId : true)),
    [items, selectedUnitId]
  );

  useEffect(() => {
    if ((activeTab === 'products' || activeTab === 'services') && visibleItems.length > 0) {
      const exists = visibleItems.some((item) => item.id === selectedItemId);
      if (!exists) setSelectedItemId(visibleItems[0].id);
    }
    if ((activeTab === 'products' || activeTab === 'services') && visibleItems.length === 0) {
      setSelectedItemId('');
    }
  }, [activeTab, selectedItemId, visibleItems]);

  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      const uncategorized = categories.find((c: any) => !c.parent_id);
      setSelectedCategoryId(uncategorized?.id || categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!selectedUnitId && units.length > 0) setSelectedUnitId(units[0].id);
  }, [selectedUnitId, units]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(id);
      if (selectedItemId === id) setSelectedItemId('');
      toast.success('Item deleted');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete');
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const downloadTemplate = async () => {
    try {
      const res = await api.get('/items/import-template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bizflow_item_import_template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download template. Please try again.');
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    setImporting(true);
    try {
      const response = await api.post('/items/bulk-import?action=confirm', formData);
      const inserted = Number(response.data?.data?.inserted || 0);
      const errors = Number(response.data?.data?.errors || 0);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['items'] }),
        qc.invalidateQueries({ queryKey: ['stock'] }),
      ]);
      toast.success(`Imported ${inserted} ${inserted === 1 ? 'item' : 'items'}${errors ? `, ${errors} rejected` : ''}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const saveCategory = async () => {
    if (!categoryName.trim()) return toast.error('Category name is required');
    try {
      await createCategory.mutateAsync({ name: categoryName.trim() });
      setCategoryName('');
      toast.success('Category added');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to add category');
    }
  };

  const saveUnit = async () => {
    if (!unitName.trim()) return toast.error('Unit name is required');
    try {
      await createUnit.mutateAsync({ name: unitName.trim(), abbreviation: unitAbbreviation.trim() || undefined });
      setUnitName('');
      setUnitAbbreviation('');
      toast.success('Unit added');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to add unit');
    }
  };

  const totalStock = Number(selectedItem?.total_stock || 0);
  const activity = (selectedItem?.activity_timeline || []) as any[];
  const activitySummary = (selectedItem?.activity_summary || {}) as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv,.json" onChange={handleImportFile} />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Item Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add {termSingle.toLowerCase()}s, track stock, audit every purchase and sale, and manage units and categories from one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-1" />
            Template
          </Button>
          <Button variant="outline" size="sm" loading={importing} onClick={handleImportClick}>
            <Upload className="w-4 h-4 mr-1" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/adjust')}>
            <Warehouse className="w-4 h-4 mr-1" />
            Adjust Stock
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/purchases/new')}>
            <Plus className="w-4 h-4 mr-1" />
            Add Purchase
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/sales/new')}>
            <Plus className="w-4 h-4 mr-1" />
            Add Sale
          </Button>
          <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1" />
            Add {termSingle}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ItemWorkspaceTab)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 lg:w-[680px]">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="barcodes">Barcodes</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Products</h2>
                    <p className="text-xs text-muted-foreground">{visibleItems.length} visible</p>
                  </div>
                  <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search by name, SKU, barcode..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>

                <div className="flex gap-2">
                  {(['all', 'low', 'out'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setStockFilter(filter)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${stockFilter === filter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                    >
                      {filter === 'all' ? 'All' : filter === 'low' ? 'Low stock' : 'Out of stock'}
                    </button>
                  ))}
                </div>

                <div className="max-h-[70vh] overflow-y-auto rounded-lg border">
                  {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Loading items...</div>}
                  {!isLoading && visibleItems.length === 0 && (
                    <div className="p-8 text-center text-sm text-muted-foreground">No products found for these filters.</div>
                  )}
                  {visibleItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full border-b p-4 text-left transition hover:bg-muted/40 ${selectedItemId === item.id ? 'bg-primary/5' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">{item.sku || 'No SKU'}{item.category_name ? ` • ${item.category_name}` : ''}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums">{qtyText(item.total_stock || 0)}</div>
                          <div className="text-xs text-muted-foreground">{formatMoney(item.selling_price || 0)}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 md:p-6">
                {!selectedItemId || !selectedItem ? (
                  <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                    <Package className="w-12 h-12 text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground">Select a product to view stock, pricing, and full audit.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-2xl font-bold">{selectedItem.name}</h2>
                          {selectedItem.sku ? <Badge variant="outline">{selectedItem.sku}</Badge> : null}
                          <Badge variant={selectedItem.is_active ? 'success' : 'destructive'}>
                            {selectedItem.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                          {selectedItem.category_name || 'Uncategorised'} • {selectedItem.unit_name || 'No unit'} • GST {selectedItem.gst_rate || 0}%
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => navigate(`/items/${selectedItem.id}`)}>
                          Open Detail
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => { setEditItem(selectedItem); setShowForm(true); }}>
                          <Edit2 className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button variant="destructive" size="sm" loading={deleteMutation.isPending && deleteMutation.variables === selectedItem.id} onClick={() => handleDelete(selectedItem.id, selectedItem.name)}>
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Stock on hand</p><p className="mt-1 text-xl font-bold tabular-nums">{qtyText(totalStock)}</p></CardContent></Card>
                      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Stock value</p><p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(Number(selectedItem.total_stock_value || 0))}</p></CardContent></Card>
                      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Purchased qty</p><p className="mt-1 text-xl font-bold tabular-nums">{qtyText(activitySummary.purchased_quantity)}</p></CardContent></Card>
                      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sold qty</p><p className="mt-1 text-xl font-bold tabular-nums">{qtyText(activitySummary.sold_quantity)}</p></CardContent></Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
                      <div className="space-y-4">
                        <div className="rounded-xl border p-4">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold">Stock by godown</h3>
                            <Badge variant="secondary">{godowns.length} godowns</Badge>
                          </div>
                          <div className="mt-3 space-y-3">
                            {(selectedItem.stock || []).length === 0 && <p className="text-sm text-muted-foreground">No stock records yet.</p>}
                            {(selectedItem.stock || []).map((row: any) => (
                              <div key={row.godown_id} className="rounded-lg border p-3">
                                <div className="flex items-center justify-between">
                                  <div className="font-medium">{row.godown_name}</div>
                                  <div className="text-sm font-semibold tabular-nums">{qtyText(row.quantity)}</div>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>Available {qtyText(row.available_quantity)}</span>
                                  <span>Avg cost {formatMoney(Number(row.avg_cost_price || 0))}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border p-4">
                          <h3 className="font-semibold">Commercial snapshot</h3>
                          <div className="mt-3 space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Purchase price</span><span className="tabular-nums">{formatMoney(Number(selectedItem.purchase_price || 0))}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Selling price</span><span className="tabular-nums">{formatMoney(Number(selectedItem.selling_price || 0))}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Reorder point</span><span className="tabular-nums">{qtyText(selectedItem.reorder_point || 0)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Last purchase</span><span>{activitySummary.last_purchase_date ? formatDate(String(activitySummary.last_purchase_date)) : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Last sale</span><span>{activitySummary.last_sale_date ? formatDate(String(activitySummary.last_sale_date)) : '—'}</span></div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold">Full audit trail</h3>
                            <p className="text-xs text-muted-foreground mt-1">Purchases, sales, opening stock, transfers, and adjustments for this item.</p>
                          </div>
                          <Badge variant="info">{activity.length} events</Badge>
                        </div>
                        <div className="mt-4 max-h-[620px] overflow-y-auto space-y-3 pr-1">
                          {activity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet for this item.</p>}
                          {activity.map((row: any, index: number) => (
                            <div key={`${row.activity_type}-${row.reference_id}-${index}`} className="rounded-lg border p-3">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={activityBadge(String(row.activity_type))}>{String(row.activity_type).replace(/_/g, ' ')}</Badge>
                                    <span className="font-medium">{row.reference_number || 'Reference'}</span>
                                  </div>
                                  <div className="mt-1 text-sm text-muted-foreground">
                                    {row.counterparty_name || '—'}{row.godown_name ? ` • ${row.godown_name}` : ''}
                                  </div>
                                </div>
                                <div className="text-left sm:text-right">
                                  <div className={`font-semibold tabular-nums ${Number(row.quantity) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {Number(row.quantity) > 0 ? '+' : ''}{qtyText(row.quantity)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{row.activity_at ? formatDate(String(row.activity_at)) : '—'}</div>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                                <div><span className="text-muted-foreground">Unit price</span><div className="tabular-nums">{formatMoney(Number(row.unit_price || 0))}</div></div>
                                <div><span className="text-muted-foreground">Taxable</span><div className="tabular-nums">{formatMoney(Number(row.taxable_amount || 0))}</div></div>
                                <div><span className="text-muted-foreground">Tax</span><div className="tabular-nums">{formatMoney(Number(row.tax_amount || 0))}</div></div>
                                <div><span className="text-muted-foreground">Total</span><div className="tabular-nums">{formatMoney(Number(row.gross_amount || 0))}</div></div>
                              </div>
                              {row.notes ? <p className="mt-2 text-xs text-muted-foreground">{row.notes}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Services</h2>
                    <p className="text-xs text-muted-foreground">Keep service masters alongside stock items so sales entry stays consistent.</p>
                  </div>
                <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Service
                </Button>
              </div>
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search services..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleItems.length === 0 && <p className="text-sm text-muted-foreground">No services found.</p>}
                {visibleItems.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">{item.sku || 'No SKU'}</div>
                      </div>
                      <Badge variant="secondary">Service</Badge>
                    </div>
                    <div className="mt-4 space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Sale price</span><span className="tabular-nums">{formatMoney(item.selling_price || 0)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>{item.gst_rate || 0}%</span></div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditItem(item); setShowForm(true); }}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/items/${item.id}`)}>Audit</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardContent className="p-4 space-y-4">
                <h2 className="font-semibold">Category master</h2>
                <div className="space-y-2">
                  <Label>Add category</Label>
                  <div className="flex gap-2">
                    <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Grocery" />
                    <Button loading={createCategory.isPending} onClick={saveCategory}>Save</Button>
                  </div>
                </div>
                <div className="rounded-lg border max-h-[65vh] overflow-y-auto">
                  {categories.map((category: any) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(category.id)}
                      className={`flex w-full items-center justify-between border-b px-4 py-3 text-left ${selectedCategoryId === category.id ? 'bg-primary/5' : ''}`}
                    >
                      <div>
                        <div className="font-medium">{category.name}</div>
                        <div className="text-xs text-muted-foreground">{category.item_count || 0} items</div>
                      </div>
                      <Badge variant="outline">{category.item_count || 0}</Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">
                      {categories.find((category: any) => category.id === selectedCategoryId)?.name || 'Category items'}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">Items currently mapped to this category.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Item
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {categoryItems.length === 0 && <p className="text-sm text-muted-foreground">No items in this category yet.</p>}
                  {categoryItems.map((item) => (
                    <div key={item.id} className="rounded-xl border p-4">
                      <div className="font-medium">{item.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.sku || 'No SKU'} • {item.item_type}</div>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Stock</span>
                        <span className="tabular-nums">{qtyText(item.total_stock || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="units" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardContent className="p-4 space-y-4">
                <h2 className="font-semibold">Unit master</h2>
                <div className="space-y-2">
                  <Label>Add unit</Label>
                  <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. Litres" />
                  <Input value={unitAbbreviation} onChange={(e) => setUnitAbbreviation(e.target.value)} placeholder="Abbreviation (e.g. Ltr)" />
                  <Button className="w-full" loading={createUnit.isPending} onClick={saveUnit}>Save Unit</Button>
                </div>
                <div className="rounded-lg border max-h-[65vh] overflow-y-auto">
                  {units.map((unit: any) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => setSelectedUnitId(unit.id)}
                      className={`flex w-full items-center justify-between border-b px-4 py-3 text-left ${selectedUnitId === unit.id ? 'bg-primary/5' : ''}`}
                    >
                      <div>
                        <div className="font-medium">{unit.name}</div>
                        <div className="text-xs text-muted-foreground">{unit.abbreviation || '—'}</div>
                      </div>
                      {unit.is_default ? <Badge variant="info">Default</Badge> : <Badge variant="outline">Unit</Badge>}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">{units.find((unit: any) => unit.id === selectedUnitId)?.name || 'Unit usage'}</h2>
                    <p className="text-xs text-muted-foreground mt-1">Items using this unit today.</p>
                  </div>
                  <Badge variant="secondary">
                    {unitItems.filter((item) => item.unit_id === selectedUnitId).length} linked
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {unitItems.filter((item) => item.unit_id === selectedUnitId).length === 0 && (
                    <p className="text-sm text-muted-foreground">No items are using this unit yet.</p>
                  )}
                  {unitItems.filter((item) => item.unit_id === selectedUnitId).map((item) => (
                    <div key={item.id} className="rounded-xl border p-4">
                      <div className="font-medium">{item.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.category_name || 'No category'}</div>
                      <div className="mt-3 flex justify-between text-sm">
                        <span className="text-muted-foreground">Stock</span>
                        <span className="tabular-nums">{qtyText(item.total_stock || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="barcodes" className="space-y-4">
          <BarcodeGeneratorPanel />
        </TabsContent>
      </Tabs>

      <ItemForm open={showForm} onOpenChange={setShowForm} item={editItem} />
    </div>
  );
}
