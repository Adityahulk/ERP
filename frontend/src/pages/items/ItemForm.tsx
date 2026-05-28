import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCreateItem, useUpdateItem, useItemCategories, useItemUnits, useCreateItemCategory, useCreateItemUnit } from '@/hooks/useItems';
import { useGodowns } from '@/hooks/useStock';
import { useCompany } from '@/hooks/useBusiness';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import api from '@/lib/api';
import { currencySymbol, normalizeCurrencyCode, SUPPORTED_CURRENCIES, paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { companyGstRateOptions, gstRateLabel } from '@/lib/gstRates';
import { enabledItemCustomFields } from '@/lib/itemCustomFields';


import { Plus, X, Sparkles } from 'lucide-react';
import type { Item } from '@/types';
import toast from 'react-hot-toast';
import { OcrUploadButton, type OcrExtractedData } from '@/components/shared/OcrUploadButton';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Item | null;
  defaultItemType?: string;
}

const ITEM_TYPES = [
  { value: 'finished_good', label: 'Finished Good' },
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'product', label: 'Product' },
  { value: 'service', label: 'Service' },
];

export default function ItemForm({ open, onOpenChange, item, defaultItemType = 'product' }: Props) {
  const qc = useQueryClient();
  const isEdit = !!item;
  const createMutation = useCreateItem();
  const updateMutation = useUpdateItem();
  const createCategory = useCreateItemCategory();
  const createUnit = useCreateItemUnit();
  const { data: catData } = useItemCategories();
  const { data: unitData } = useItemUnits();
  const { data: godownData } = useGodowns();
  const { data: company } = useCompany();
  const gstRateOptions = companyGstRateOptions(company);
  const categories = catData?.data?.flat || [];
  const units = unitData?.data || [];
  const godowns = godownData?.data || [];
  const enabledCurrencies = Array.isArray((company as any)?.enabled_currencies)
    ? (company as any).enabled_currencies.map((c: unknown) => normalizeCurrencyCode(c))
    : ['INR'];
  const configuredCustomFields = enabledItemCustomFields((company as any)?.item_custom_fields);

  const [form, setForm] = useState<any>({});
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [showWholesalePricing, setShowWholesalePricing] = useState(false);
  const [wholesaleTiers, setWholesaleTiers] = useState<Array<{ tier_name: string; min_quantity: number; price: number }>>([]);
  const [showCategoryAdd, setShowCategoryAdd] = useState(false);
  const [showUnitAdd, setShowUnitAdd] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitAbbr, setNewUnitAbbr] = useState('');

  const { data: existingWholesaleTiers } = useQuery({
    queryKey: ['item-wholesale-tiers', item?.id],
    enabled: !!item?.id && open,
    queryFn: () =>
      api.get('/wholesale/price-tiers', { params: { item_id: item?.id } }).then((r) => r.data?.data ?? []),
  });

  const saveWholesaleTiers = useMutation({
    mutationFn: (payload: any) => api.post('/wholesale/price-tiers', payload).then((r) => r.data),
  });

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name, description: item.description, sku: item.sku, barcode: item.barcode,
        hsn_code: item.hsn_code, category_id: item.category_id, brand: item.brand,
        unit_id: item.unit_id, item_type: item.item_type,
        track_inventory: item.track_inventory, is_serialized: item.is_serialized,
        purchase_price: (item.purchase_price || 0) / 100, selling_price: (item.selling_price || 0) / 100,
        price_currency_code: normalizeCurrencyCode((item as any).price_currency_code || (company as any)?.default_currency || (company as any)?.currency || 'INR'),
        gst_rate: item.gst_rate, tax_preference: item.tax_preference,
        opening_stock: item.opening_stock || 0,
        opening_stock_value: item.opening_stock_value ? paiseToRupees(item.opening_stock_value).toFixed(2) : '',
        godown_id: item.stock?.[0]?.godown_id || '',
        reorder_point: item.reorder_point || 0,
      });
      const cf = item.custom_fields ? Object.entries(item.custom_fields).map(([k, v]) => ({ key: k, value: String(v) })) : [];
      setCustomFields(cf);
      setShowWholesalePricing(false);
    } else {
      const isService = defaultItemType === 'service';
      setForm({ name: '', item_type: defaultItemType, gst_rate: 18, tax_preference: 'taxable', track_inventory: !isService, is_serialized: false, purchase_price: 0, selling_price: 0, price_currency_code: normalizeCurrencyCode((company as any)?.default_currency || (company as any)?.currency || 'INR'), opening_stock: 0, opening_stock_value: '', godown_id: '', reorder_point: 0 });
      setCustomFields([]);
      setShowWholesalePricing(false);
      setWholesaleTiers([]);
    }
  }, [item, open, defaultItemType, company]);

  useEffect(() => {
    if (!open) return;
    if (!existingWholesaleTiers || !Array.isArray(existingWholesaleTiers)) return;
    setWholesaleTiers(
      existingWholesaleTiers.map((t: any) => ({
        tier_name: t.tier_name || '',
        min_quantity: Number(t.min_quantity || 1),
        price: paiseToRupees(Number(t.price || 0)),
      }))
    );
  }, [existingWholesaleTiers, open]);

  const update = (field: string, value: any) => setForm((f: any) => {
    if (field === 'item_type' && value === 'service') {
      return { ...f, item_type: value, track_inventory: false, is_serialized: false, opening_stock: 0, opening_stock_value: '', godown_id: '' };
    }
    return { ...f, [field]: value };
  });

  const margin = (form.selling_price || 0) - (form.purchase_price || 0);
  const marginPct = form.purchase_price > 0 ? ((margin / form.purchase_price) * 100).toFixed(1) : '—';

  const handleSubmit = async () => {
    if (!form.name?.trim()) { toast.error('Product name is required'); return; }
    const isService = form.item_type === 'service';

    const data: any = {
      ...form,
      track_inventory: isService ? false : form.track_inventory,
      is_serialized: isService ? false : form.is_serialized,
      opening_stock: isService ? 0 : form.opening_stock,
      purchase_price: Math.round((form.purchase_price || 0) * 100),
      selling_price: Math.round((form.selling_price || 0) * 100),
      price_currency_code: normalizeCurrencyCode(form.price_currency_code),
      opening_stock_value: isService || form.opening_stock_value === '' ? undefined : rupeesToPaise(form.opening_stock_value),
    };
    if (isService) {
      delete data.godown_id;
      delete data.opening_stock_date;
    }
    if (data.opening_stock_value === undefined) delete data.opening_stock_value;
    if (!data.godown_id) delete data.godown_id;

    if (customFields.length) {
      data.custom_fields = {};
      customFields.forEach(f => { if (f.key) data.custom_fields[f.key] = f.value; });
    }

    try {
      let itemId = item?.id;
      if (isEdit) {
        await updateMutation.mutateAsync({ id: item!.id, data });
        toast.success('Item updated');
      } else {
        const created = await createMutation.mutateAsync(data);
        itemId = created?.data?.id || created?.id;
        toast.success('Item created');
      }

      const validWholesaleTiers = wholesaleTiers
        .filter((t) => t.min_quantity > 0 && t.price >= 0)
        .map((t) => ({ ...t, price: rupeesToPaise(t.price) }));
      if (itemId && validWholesaleTiers.length > 0) {
        await saveWholesaleTiers.mutateAsync({
          item_id: itemId,
          tiers: validWholesaleTiers,
        });
        qc.invalidateQueries({ queryKey: ['price-tiers', itemId] });
      }
      onOpenChange(false);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to save'); }
  };

  const addCustomField = () => {
    if (!newFieldKey.trim()) return;
    setCustomFields([...customFields, { key: newFieldKey, value: newFieldValue }]);
    setNewFieldKey(''); setNewFieldValue('');
  };

  const customValue = (key: string) => customFields.find((f) => f.key === key)?.value || '';
  const setConfiguredCustomValue = (key: string, value: string) => {
    setCustomFields((prev) => {
      const idx = prev.findIndex((f) => f.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], value };
        return next;
      }
      return [...prev, { key, value }];
    });
  };

  const saveQuickCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return toast.error('Category name is required');
    try {
      const res = await createCategory.mutateAsync({ name });
      const row = (res as any)?.data || res;
      if (row?.id) update('category_id', row.id);
      setNewCategoryName('');
      setShowCategoryAdd(false);
      toast.success('Category added');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to add category');
    }
  };

  const saveQuickUnit = async () => {
    const name = newUnitName.trim();
    if (!name) return toast.error('Unit name is required');
    try {
      const res = await createUnit.mutateAsync({ name, abbreviation: newUnitAbbr.trim() || undefined });
      const row = (res as any)?.data || res;
      if (row?.id) update('unit_id', row.id);
      setNewUnitName('');
      setNewUnitAbbr('');
      setShowUnitAdd(false);
      toast.success('Unit added');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to add unit');
    }
  };

  const isBusy = createMutation.isPending || updateMutation.isPending || saveWholesaleTiers.isPending;

  /**
   * OCR auto-fill for items:
   * - party_name  → item name (first prominent text line on the label/catalog)
   * - invoice_number → SKU / product code
   * - total_amount_paise → selling price (MRP / rate printed on document)
   */
  const handleItemOcr = (data: OcrExtractedData) => {
    setForm((f: any) => ({
      ...f,
      ...(data.party_name ? { name: data.party_name } : {}),
      ...(data.invoice_number ? { sku: data.invoice_number } : {}),
      ...(data.total_amount_paise
        ? { selling_price: Number((data.total_amount_paise / 100).toFixed(2)) }
        : {}),
    }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle>{isEdit ? 'Edit' : 'New'} {form.item_type === 'service' ? 'Service' : 'Product'}</SheetTitle>
              <SheetDescription>{isEdit ? 'Update item details' : 'Add a new item to your inventory'}</SheetDescription>
            </div>
            {!isEdit && (
              <OcrUploadButton
                label="Scan Label"
                onExtracted={handleItemOcr}
                variant="outline"
                size="sm"
                className="shrink-0 mt-0.5"
              />
            )}
          </div>
        </SheetHeader>
        {!isEdit && (
          <p className="text-xs text-muted-foreground mb-4">
            Tip: upload a product label or catalog image to auto-fill item details.
          </p>
        )}

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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>SKU / Item Code</Label>
                <div className="flex gap-1 mt-1">
                  <Input placeholder="RICE-5KG" value={form.sku || ''} onChange={e => update('sku', e.target.value)} />
                  <Button variant="outline" size="icon" title="Auto-generate" onClick={() => update('sku', `SKU-${Date.now().toString(36).toUpperCase()}`)}><Sparkles className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div><Label>Barcode</Label><Input className="mt-1 font-mono text-sm" value={form.barcode || ''} onChange={e => update('barcode', e.target.value)} /></div>
              <div><Label>Brand</Label><Input className="mt-1" value={form.brand || ''} onChange={e => update('brand', e.target.value)} /></div>
            </div>
            <div><Label>Description</Label><textarea rows={3} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none focus:ring-1 focus:ring-ring" value={form.description || ''} onChange={e => update('description', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label>Category</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowCategoryAdd((v) => !v)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Quick Add
                  </Button>
                </div>
                <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.category_id || ''} onChange={e => update('category_id', e.target.value || null)}>
                  <option value="">- Select -</option>
                  {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {showCategoryAdd && (
                  <div className="mt-2 flex gap-2">
                    <Input placeholder="New category" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
                    <Button type="button" size="sm" loading={createCategory.isPending} onClick={saveQuickCategory}>Save</Button>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label>Unit</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowUnitAdd((v) => !v)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Quick Add
                  </Button>
                </div>
                <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.unit_id || ''} onChange={e => update('unit_id', e.target.value || null)}>
                  <option value="">- Select -</option>
                  {units.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
                </select>
                {showUnitAdd && (
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_90px_auto] gap-2">
                    <Input placeholder="New unit" value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} />
                    <Input placeholder="Abbr" value={newUnitAbbr} onChange={(e) => setNewUnitAbbr(e.target.value)} />
                    <Button type="button" size="sm" loading={createUnit.isPending} onClick={saveQuickUnit}>Save</Button>
                  </div>
                )}
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
            <div>
              <Label>Price Currency</Label>
              <select
                className="mt-1 h-10 w-full max-w-xs rounded-md border bg-background px-3 text-sm"
                value={normalizeCurrencyCode(form.price_currency_code)}
                onChange={(e) => update('price_currency_code', normalizeCurrencyCode(e.target.value))}
              >
                {SUPPORTED_CURRENCIES.filter((c) => enabledCurrencies.includes(c.code)).map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Purchase Price ({currencySymbol(form.price_currency_code)})</Label><Input type="number" className="mt-1 tabular-nums" min={0} step={0.01} value={form.purchase_price || ''} onChange={e => update('purchase_price', parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Selling Price ({currencySymbol(form.price_currency_code)})</Label><Input type="number" className="mt-1 tabular-nums font-medium" min={0} step={0.01} value={form.selling_price || ''} onChange={e => update('selling_price', parseFloat(e.target.value) || 0)} /></div>
            </div>
            {form.selling_price > 0 && (
              <div className={`p-3 rounded-lg text-sm font-medium ${margin >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
                {currencySymbol(form.price_currency_code)}{margin.toFixed(2)} profit ({marginPct}% margin)
              </div>
            )}
            <div>
              <Label>{form.item_type === 'service' ? 'SAC Code' : 'HSN Code'}</Label>
              <Input
                className="mt-1"
                placeholder={form.item_type === 'service' ? 'e.g. 9983' : 'e.g. 1006'}
                value={form.hsn_code || ''}
                onChange={e => update('hsn_code', e.target.value)}
              />
              <a href="https://cbic-gst.gov.in/gst-goods-services-rates.html" target="_blank" className="text-xs text-primary mt-1 inline-block hover:underline">
                Look up {form.item_type === 'service' ? 'SAC' : 'HSN'} code →
              </a>
            </div>
            <div>
              <Label>GST Rate</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.gst_rate ?? 18} onChange={e => update('gst_rate', parseFloat(e.target.value) || 0)}>
                {gstRateOptions.map((rate) => <option key={rate} value={rate}>{gstRateLabel(rate)}</option>)}
              </select>
              <p className="text-xs text-muted-foreground mt-1">CGST and SGST apply for local sales; IGST applies for interstate sales.</p>
            </div>
            <div>
              <Label>Tax Preference</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.tax_preference || 'taxable'} onChange={e => update('tax_preference', e.target.value)}>
                <option value="taxable">Taxable</option><option value="exempt">Exempt</option>
                <option value="nil_rated">Nil Rated</option><option value="non_gst">Non-GST</option>
              </select>
            </div>
            <div className="pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const nextShow = !showWholesalePricing;
                  setShowWholesalePricing(nextShow);
                  if (nextShow && wholesaleTiers.length === 0) {
                    setWholesaleTiers([{ tier_name: '', min_quantity: 10, price: Number(form.selling_price || 0) }]);
                  }
                }}
              >
                Add Wholesale Pricing
              </Button>
              {showWholesalePricing && (
                <div className="mt-3 space-y-2 rounded-md border p-3">
                  {wholesaleTiers.map((tier, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <Label className="text-xs">Tier name</Label>
                        <Input
                          value={tier.tier_name}
                          placeholder="e.g. Bulk"
                          onChange={(e) => {
                            const next = [...wholesaleTiers];
                            next[idx] = { ...next[idx], tier_name: e.target.value };
                            setWholesaleTiers(next);
                          }}
                        />
                      </div>
                      <div className="col-span-3">
                        <Label className="text-xs">Min qty</Label>
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={tier.min_quantity}
                          onChange={(e) => {
                            const next = [...wholesaleTiers];
                            next[idx] = { ...next[idx], min_quantity: parseFloat(e.target.value) || 1 };
                            setWholesaleTiers(next);
                          }}
                        />
                      </div>
                      <div className="col-span-4">
                        <Label className="text-xs">Price (₹)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={tier.price}
                          onChange={(e) => {
                            const next = [...wholesaleTiers];
                            next[idx] = { ...next[idx], price: parseFloat(e.target.value) || 0 };
                            setWholesaleTiers(next);
                          }}
                        />
                      </div>
                      <div className="col-span-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setWholesaleTiers((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setWholesaleTiers((prev) => [
                        ...prev,
                        { tier_name: '', min_quantity: 10, price: Number(form.selling_price || 0) },
                      ])
                    }
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Tier
                  </Button>
                </div>
              )}
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
                      <div><Label>Opening Stock</Label><Input type="number" className="mt-1 tabular-nums" min={0} step={0.01} value={form.opening_stock || ''} onChange={e => update('opening_stock', parseFloat(e.target.value) || 0)} /></div>
                      <div><Label>Reorder Alert Point</Label><Input type="number" className="mt-1 tabular-nums" min={0} step={0.01} value={form.reorder_point || ''} onChange={e => update('reorder_point', parseFloat(e.target.value) || 0)} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Opening Stock Value (₹)</Label>
                        <Input type="number" className="mt-1 tabular-nums" min={0} step={0.01} value={form.opening_stock_value || ''} onChange={e => update('opening_stock_value', e.target.value)} />
                      </div>
                      <div>
                        <Label>Opening Stock Godown</Label>
                        <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.godown_id || ''} onChange={e => update('godown_id', e.target.value)}>
                          <option value="">Default / existing godown</option>
                          {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>

          {/* CUSTOM FIELDS */}
          <TabsContent value="custom" className="space-y-4">
            {configuredCustomFields.length > 0 && (
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="mb-3 text-sm font-semibold">Configured item fields</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {configuredCustomFields.map((field) => (
                    <div key={field.id}>
                      <Label className="text-xs">{field.label}</Label>
                      <Input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        className="mt-1"
                        value={customValue(field.id)}
                        onChange={(e) => setConfiguredCustomValue(field.id, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {customFields.map((f, i) => (
              configuredCustomFields.some((field) => field.id === f.key) ? null : (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Field name" value={f.key} onChange={e => { const c = [...customFields]; c[i].key = e.target.value; setCustomFields(c); }} className="flex-1" />
                <Input placeholder="Value" value={f.value} onChange={e => { const c = [...customFields]; c[i].value = e.target.value; setCustomFields(c); }} className="flex-1" />
                <Button variant="ghost" size="icon" onClick={() => setCustomFields(customFields.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>
              </div>
              )
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
