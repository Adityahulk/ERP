import { useState, useEffect } from 'react';
import { useCreateItem, useUpdateItem, useItemCategories, useItemUnits } from '@/hooks/useItems';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';


import { Plus, X, Sparkles } from 'lucide-react';
import type { Item } from '@/types';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Item | null;
}

const GST_RATES = [0, 5, 12, 18, 28];
const ITEM_TYPES = [
  { value: 'finished_good', label: 'Finished Good' },
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'product', label: 'Product' },
  { value: 'service', label: 'Service' },
];

export default function ItemForm({ open, onOpenChange, item }: Props) {
  const isEdit = !!item;
  const createMutation = useCreateItem();
  const updateMutation = useUpdateItem();
  const { data: catData } = useItemCategories();
  const { data: unitData } = useItemUnits();
  const categories = catData?.data?.flat || [];
  const units = unitData?.data || [];

  const [form, setForm] = useState<any>({});
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name, description: item.description, sku: item.sku,
        hsn_code: item.hsn_code, category_id: item.category_id, brand: item.brand,
        unit_id: item.unit_id, item_type: item.item_type,
        track_inventory: item.track_inventory, is_serialized: item.is_serialized,
        purchase_price: (item.purchase_price || 0) / 100, selling_price: (item.selling_price || 0) / 100,
        gst_rate: item.gst_rate, tax_preference: item.tax_preference,
        opening_stock: item.opening_stock || 0, reorder_point: item.reorder_point || 0,
      });
      const cf = item.custom_fields ? Object.entries(item.custom_fields).map(([k, v]) => ({ key: k, value: String(v) })) : [];
      setCustomFields(cf);
    } else {
      setForm({ name: '', item_type: 'product', gst_rate: 18, tax_preference: 'taxable', track_inventory: true, is_serialized: false, purchase_price: 0, selling_price: 0, opening_stock: 0, reorder_point: 0 });
      setCustomFields([]);
    }
  }, [item, open]);

  const update = (field: string, value: any) => setForm((f: any) => ({ ...f, [field]: value }));

  const margin = (form.selling_price || 0) - (form.purchase_price || 0);
  const marginPct = form.purchase_price > 0 ? ((margin / form.purchase_price) * 100).toFixed(1) : '—';

  const handleSubmit = async () => {
    if (!form.name?.trim()) { toast.error('Product name is required'); return; }

    const data: any = {
      ...form,
      purchase_price: Math.round((form.purchase_price || 0) * 100),
      selling_price: Math.round((form.selling_price || 0) * 100),
    };

    if (customFields.length) {
      data.custom_fields = {};
      customFields.forEach(f => { if (f.key) data.custom_fields[f.key] = f.value; });
    }

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: item!.id, data });
        toast.success('Item updated');
      } else {
        await createMutation.mutateAsync(data);
        toast.success('Item created');
      }
      onOpenChange(false);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to save'); }
  };

  const addCustomField = () => {
    if (!newFieldKey.trim()) return;
    setCustomFields([...customFields, { key: newFieldKey, value: newFieldValue }]);
    setNewFieldKey(''); setNewFieldValue('');
  };

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{isEdit ? 'Edit' : 'New'} {form.item_type === 'service' ? 'Service' : 'Product'}</SheetTitle>
          <SheetDescription>{isEdit ? 'Update item details' : 'Add a new item to your inventory'}</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="basic" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="pricing">Pricing & Tax</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>

          {/* BASIC INFO */}
          <TabsContent value="basic" className="space-y-4">
            <div>
              <Label htmlFor="name">Product Name *</Label>
              <Input id="name" className="mt-1 text-base font-medium" placeholder="e.g. Basmati Rice 5kg" value={form.name || ''} onChange={e => update('name', e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>SKU / Item Code</Label>
                <div className="flex gap-1 mt-1">
                  <Input placeholder="RICE-5KG" value={form.sku || ''} onChange={e => update('sku', e.target.value)} />
                  <Button variant="outline" size="icon" title="Auto-generate" onClick={() => update('sku', `SKU-${Date.now().toString(36).toUpperCase()}`)}><Sparkles className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div><Label>Brand</Label><Input className="mt-1" value={form.brand || ''} onChange={e => update('brand', e.target.value)} /></div>
            </div>
            <div><Label>Description</Label><textarea rows={3} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none focus:ring-1 focus:ring-ring" value={form.description || ''} onChange={e => update('description', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.category_id || ''} onChange={e => update('category_id', e.target.value || null)}>
                  <option value="">— Select —</option>
                  {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Unit</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.unit_id || ''} onChange={e => update('unit_id', e.target.value || null)}>
                  <option value="">— Select —</option>
                  {units.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label>Item Type</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {ITEM_TYPES.map(t => (
                  <button key={t.value} onClick={() => update('item_type', t.value)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${form.item_type === t.value ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{t.label}</button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* PRICING & TAX */}
          <TabsContent value="pricing" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Purchase Price (₹)</Label><Input type="number" className="mt-1 tabular-nums" min={0} step={0.01} value={form.purchase_price || ''} onChange={e => update('purchase_price', parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Selling Price (₹)</Label><Input type="number" className="mt-1 tabular-nums font-medium" min={0} step={0.01} value={form.selling_price || ''} onChange={e => update('selling_price', parseFloat(e.target.value) || 0)} /></div>
            </div>
            {form.selling_price > 0 && (
              <div className={`p-3 rounded-lg text-sm font-medium ${margin >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
                ₹{margin.toFixed(2)} profit ({marginPct}% margin)
              </div>
            )}
            <div>
              <Label>HSN Code</Label>
              <Input className="mt-1" placeholder="e.g. 1006" value={form.hsn_code || ''} onChange={e => update('hsn_code', e.target.value)} />
              <a href="https://cbic-gst.gov.in/gst-goods-services-rates.html" target="_blank" className="text-xs text-primary mt-1 inline-block hover:underline">Look up HSN code →</a>
            </div>
            <div>
              <Label>GST Rate</Label>
              <div className="flex gap-2 mt-2">
                {GST_RATES.map(rate => (
                  <button key={rate} onClick={() => update('gst_rate', rate)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${form.gst_rate === rate ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>{rate}%</button>
                ))}
              </div>
            </div>
            <div>
              <Label>Tax Preference</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.tax_preference || 'taxable'} onChange={e => update('tax_preference', e.target.value)}>
                <option value="taxable">Taxable</option><option value="exempt">Exempt</option>
                <option value="nil_rated">Nil Rated</option><option value="non_gst">Non-GST</option>
              </select>
            </div>
          </TabsContent>

          {/* STOCK */}
          <TabsContent value="stock" className="space-y-4">
            {form.item_type === 'service' ? (
              <div className="text-center py-8 text-muted-foreground"><p>Stock tracking is not applicable for services.</p></div>
            ) : (
              <>
                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div><p className="font-medium text-sm">Track Inventory</p><p className="text-xs text-muted-foreground">Maintain stock levels for this item</p></div>
                  <Switch checked={form.track_inventory} onCheckedChange={v => update('track_inventory', v)} />
                </div>
                {form.track_inventory && (
                  <>
                    <div className="flex items-center justify-between p-4 rounded-lg border">
                      <div><p className="font-medium text-sm">Serialized Tracking</p><p className="text-xs text-muted-foreground">Track individual serial numbers (e.g. electronics)</p></div>
                      <Switch checked={form.is_serialized} onCheckedChange={v => update('is_serialized', v)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><Label>Opening Stock</Label><Input type="number" className="mt-1 tabular-nums" min={0} value={form.opening_stock || ''} onChange={e => update('opening_stock', parseInt(e.target.value) || 0)} /></div>
                      <div><Label>Reorder Alert Point</Label><Input type="number" className="mt-1 tabular-nums" min={0} value={form.reorder_point || ''} onChange={e => update('reorder_point', parseInt(e.target.value) || 0)} /></div>
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>

          {/* CUSTOM FIELDS */}
          <TabsContent value="custom" className="space-y-4">
            {customFields.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Field name" value={f.key} onChange={e => { const c = [...customFields]; c[i].key = e.target.value; setCustomFields(c); }} className="flex-1" />
                <Input placeholder="Value" value={f.value} onChange={e => { const c = [...customFields]; c[i].value = e.target.value; setCustomFields(c); }} className="flex-1" />
                <Button variant="ghost" size="icon" onClick={() => setCustomFields(customFields.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input placeholder="Field name" value={newFieldKey} onChange={e => setNewFieldKey(e.target.value)} className="flex-1" />
              <Input placeholder="Value" value={newFieldValue} onChange={e => setNewFieldValue(e.target.value)} className="flex-1" />
              <Button variant="outline" size="icon" onClick={addCustomField}><Plus className="w-4 h-4" /></Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex gap-3 mt-8 pt-4 border-t">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" loading={isBusy} onClick={handleSubmit}>
            {isEdit ? 'Update' : 'Save'} Item
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
