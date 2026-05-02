import { useEffect, useState } from 'react';
import { useCreateItem, useItemCategories, useItemUnits } from '@/hooks/useItems';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Loader2, Sparkles } from 'lucide-react';

const GST_OPTIONS = [0, 5, 12, 18, 28] as const;

const ITEM_TYPES = [
  { value: 'product', label: 'Product' },
  { value: 'service', label: 'Service' },
  { value: 'raw_material', label: 'Raw material' },
  { value: 'finished_good', label: 'Finished good' },
  { value: 'consumable', label: 'Consumable' },
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  onCreated: (item: Record<string, unknown>) => void;
};

type CustomRow = { key: string; value: string };

function parseMoneyPaise(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim());
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function emptyCustomRows(): CustomRow[] {
  return [];
}

export function QuickAddItemSheet({ open, onOpenChange, defaultName = '', onCreated }: Props) {
  const createItem = useCreateItem();
  const { data: catData } = useItemCategories();
  const { data: unitData } = useItemUnits();
  const { data: godownRes } = useGodowns();

  const categories = Array.isArray((catData as any)?.data?.flat) ? (catData as any).data.flat : [];
  const units = Array.isArray((unitData as any)?.data) ? (unitData as any).data : [];
  const godowns = godownRes?.data ?? [];

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [itemType, setItemType] = useState<string>('product');
  const [trackInventory, setTrackInventory] = useState(true);
  const [isSerialized, setIsSerialized] = useState(false);
  const [sellingRupee, setSellingRupee] = useState('');
  const [purchaseRupee, setPurchaseRupee] = useState('');
  const [gstRate, setGstRate] = useState<number>(18);
  const [taxPreference, setTaxPreference] = useState<string>('taxable');
  const [cessRate, setCessRate] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [openingStockValueRupee, setOpeningStockValueRupee] = useState('');
  const [openingStockDate, setOpeningStockDate] = useState('');
  const [godownId, setGodownId] = useState('');
  const [reorderPoint, setReorderPoint] = useState('');
  const [maxStockLevel, setMaxStockLevel] = useState('');
  const [secondaryUnitId, setSecondaryUnitId] = useState('');
  const [unitConversionFactor, setUnitConversionFactor] = useState('');
  const [customRows, setCustomRows] = useState<CustomRow[]>(emptyCustomRows);
  const [newCustomKey, setNewCustomKey] = useState('');
  const [newCustomVal, setNewCustomVal] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(defaultName.trim());
    setSku('');
    setBrand('');
    setDescription('');
    setHsnCode('');
    setCategoryId('');
    setUnitId('');
    setItemType('product');
    setTrackInventory(true);
    setIsSerialized(false);
    setSellingRupee('');
    setPurchaseRupee('');
    setGstRate(18);
    setTaxPreference('taxable');
    setCessRate('');
    setOpeningStock('');
    setOpeningStockValueRupee('');
    setOpeningStockDate('');
    setGodownId('');
    setReorderPoint('');
    setMaxStockLevel('');
    setSecondaryUnitId('');
    setUnitConversionFactor('');
    setCustomRows(emptyCustomRows());
    setNewCustomKey('');
    setNewCustomVal('');
  }, [open, defaultName]);

  const addCustomRow = () => {
    const k = newCustomKey.trim();
    if (!k) return;
    setCustomRows((r) => [...r, { key: k, value: newCustomVal }]);
    setNewCustomKey('');
    setNewCustomVal('');
  };

  const removeCustomRow = (i: number) => setCustomRows((r) => r.filter((_, idx) => idx !== i));

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Item name is required');
      return;
    }
    const hsn = hsnCode.trim();
    if (hsn.length > 20) {
      toast.error('HSN is too long (max 20 characters)');
      return;
    }

    const sec = secondaryUnitId.trim();
    const ucf = parseFloat(unitConversionFactor);
    if (sec && (Number.isNaN(ucf) || ucf <= 0)) {
      toast.error('Enter a positive unit conversion factor when a secondary unit is selected');
      return;
    }

    const isService = itemType === 'service';
    const os = !isService && trackInventory ? parseInt(openingStock, 10) || 0 : 0;
    if (os > 0 && !godownId.trim()) {
      toast.error('Select a godown when adding opening stock');
      return;
    }

    const body: Record<string, unknown> = {
      name: trimmedName,
      item_type: itemType,
      track_inventory: isService ? false : trackInventory,
      is_serialized: isService ? false : isSerialized,
      gst_rate: gstRate,
      tax_preference: taxPreference,
      selling_price: parseMoneyPaise(sellingRupee),
      purchase_price: parseMoneyPaise(purchaseRupee),
    };

    const s = sku.trim();
    if (s) body.sku = s;
    const b = brand.trim();
    if (b) body.brand = b;
    const desc = description.trim();
    if (desc) body.description = desc;
    if (hsn) body.hsn_code = hsn;
    if (categoryId) body.category_id = categoryId;
    if (unitId) body.unit_id = unitId;
    if (sec && sec !== unitId.trim()) {
      body.secondary_unit_id = sec;
      body.unit_conversion_factor = ucf;
    }

    const cess = parseFloat(cessRate);
    if (!Number.isNaN(cess) && cess >= 0) body.cess_rate = cess;

    if (os > 0) body.opening_stock = os;
    const osv = parseMoneyPaise(openingStockValueRupee);
    if (os > 0 && osv > 0) body.opening_stock_value = osv;
    const osd = openingStockDate.trim();
    if (osd) body.opening_stock_date = osd;
    const gid = godownId.trim();
    if (gid) body.godown_id = gid;

    const rp = parseInt(reorderPoint, 10);
    if (!Number.isNaN(rp) && rp >= 0) body.reorder_point = rp;
    const mx = parseInt(maxStockLevel, 10);
    if (!Number.isNaN(mx) && mx >= 0) body.max_stock_level = mx;

    if (customRows.length) {
      const cf: Record<string, string> = {};
      customRows.forEach((row) => {
        if (row.key.trim()) cf[row.key.trim()] = row.value;
      });
      if (Object.keys(cf).length) body.custom_fields = cf;
    }

    try {
      const res = await createItem.mutateAsync(body);
      const row = (res as { data?: Record<string, unknown> })?.data ?? (res as Record<string, unknown>);
      if (!row || typeof row !== 'object' || !('id' in row)) {
        toast.error('Unexpected response from server');
        return;
      }
      toast.success('Item saved — you can still adjust anything under Items & Materials');
      onCreated(row as Record<string, unknown>);
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to create item');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto flex flex-col p-0">
        <div className="px-6 pt-6 pb-2">
          <SheetHeader className="p-0 pr-8 space-y-0">
            <SheetTitle>Add item</SheetTitle>
          </SheetHeader>
          <p className="text-sm text-muted-foreground mt-2">
            Only <span className="font-medium text-foreground">name</span> is required. Use the tabs for full details; anything left blank can be filled later under{' '}
            <span className="font-medium text-foreground">Items & Materials</span>.
          </p>
        </div>

        <Tabs defaultValue="basic" className="flex flex-col flex-1 min-h-0 px-6">
          <TabsList className="grid w-full shrink-0 grid-cols-2 sm:grid-cols-4 h-auto gap-1">
            <TabsTrigger value="basic" className="text-xs">
              Basic
            </TabsTrigger>
            <TabsTrigger value="pricing" className="text-xs">
              Pricing & tax
            </TabsTrigger>
            <TabsTrigger value="stock" className="text-xs">
              Stock
            </TabsTrigger>
            <TabsTrigger value="extra" className="text-xs">
              More
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto py-4 min-h-[200px]">
            <TabsContent value="basic" className="mt-0 space-y-4 pb-2">
              <div>
                <Label htmlFor="qa-item-name">Name *</Label>
                <Input
                  id="qa-item-name"
                  className="mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  disabled={createItem.isPending}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>SKU / code</Label>
                  <div className="flex gap-1 mt-1">
                    <Input value={sku} onChange={(e) => setSku(e.target.value)} disabled={createItem.isPending} className="font-mono text-sm" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Auto-generate"
                      disabled={createItem.isPending}
                      onClick={() => setSku(`SKU-${Date.now().toString(36).toUpperCase()}`)}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Brand</Label>
                  <Input className="mt-1" value={brand} onChange={(e) => setBrand(e.target.value)} disabled={createItem.isPending} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={createItem.isPending}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <select
                    className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    disabled={createItem.isPending}
                  >
                    <option value="">— None —</option>
                    {categories.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Unit</Label>
                  <select
                    className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm"
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    disabled={createItem.isPending}
                  >
                    <option value="">— None —</option>
                    {units.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.abbreviation})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label>Item type</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {ITEM_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setItemType(t.value)}
                      disabled={createItem.isPending}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        itemType === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="pricing" className="mt-0 space-y-4 pb-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Purchase price (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 tabular-nums"
                    value={purchaseRupee}
                    onChange={(e) => setPurchaseRupee(e.target.value)}
                    disabled={createItem.isPending}
                  />
                </div>
                <div>
                  <Label>Selling price (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 tabular-nums"
                    value={sellingRupee}
                    onChange={(e) => setSellingRupee(e.target.value)}
                    disabled={createItem.isPending}
                  />
                </div>
              </div>
              <div>
                <Label>HSN code</Label>
                <Input className="mt-1 font-mono text-sm" maxLength={20} value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} disabled={createItem.isPending} />
              </div>
              <div>
                <Label>GST %</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={gstRate}
                  onChange={(e) => setGstRate(parseInt(e.target.value, 10))}
                  disabled={createItem.isPending}
                >
                  {GST_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}%
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Tax preference</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={taxPreference}
                  onChange={(e) => setTaxPreference(e.target.value)}
                  disabled={createItem.isPending}
                >
                  <option value="taxable">Taxable</option>
                  <option value="exempt">Exempt</option>
                  <option value="nil_rated">Nil rated</option>
                  <option value="non_gst">Non-GST</option>
                </select>
              </div>
              <div>
                <Label>Cess % (optional)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="mt-1 w-28 tabular-nums"
                  value={cessRate}
                  onChange={(e) => setCessRate(e.target.value)}
                  disabled={createItem.isPending}
                />
              </div>
            </TabsContent>

            <TabsContent value="stock" className="mt-0 space-y-4 pb-2">
              {itemType === 'service' ? (
                <p className="text-sm text-muted-foreground">Stock fields do not apply to services.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Track inventory</p>
                      <p className="text-xs text-muted-foreground">Stock levels for this item</p>
                    </div>
                    <Switch checked={trackInventory} onCheckedChange={setTrackInventory} disabled={createItem.isPending} />
                  </div>
                  {trackInventory && (
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">Serialized</p>
                        <p className="text-xs text-muted-foreground">Serial / IMEI tracking</p>
                      </div>
                      <Switch checked={isSerialized} onCheckedChange={setIsSerialized} disabled={createItem.isPending} />
                    </div>
                  )}
                  {trackInventory && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Opening stock (qty)</Label>
                          <Input
                            type="number"
                            min={0}
                            className="mt-1 tabular-nums"
                            value={openingStock}
                            onChange={(e) => setOpeningStock(e.target.value)}
                            disabled={createItem.isPending}
                          />
                        </div>
                        <div>
                          <Label>Opening stock value (₹)</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="mt-1 tabular-nums"
                            value={openingStockValueRupee}
                            onChange={(e) => setOpeningStockValueRupee(e.target.value)}
                            disabled={createItem.isPending}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Godown (for opening stock)</Label>
                          <select
                            className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm"
                            value={godownId}
                            onChange={(e) => setGodownId(e.target.value)}
                            disabled={createItem.isPending}
                          >
                            <option value="">— Select —</option>
                            {godowns.map((g: any) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label>Opening stock date</Label>
                          <Input type="date" className="mt-1" value={openingStockDate} onChange={(e) => setOpeningStockDate(e.target.value)} disabled={createItem.isPending} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Reorder point</Label>
                          <Input type="number" min={0} className="mt-1" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} disabled={createItem.isPending} />
                        </div>
                        <div>
                          <Label>Max stock level</Label>
                          <Input type="number" min={0} className="mt-1" value={maxStockLevel} onChange={(e) => setMaxStockLevel(e.target.value)} disabled={createItem.isPending} />
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="extra" className="mt-0 space-y-4 pb-2">
              <div>
                <Label>Secondary unit</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={secondaryUnitId}
                  onChange={(e) => setSecondaryUnitId(e.target.value)}
                  disabled={createItem.isPending}
                >
                  <option value="">— None —</option>
                  {units.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Conversion factor (secondary per primary)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  className="mt-1 max-w-[200px] tabular-nums"
                  value={unitConversionFactor}
                  onChange={(e) => setUnitConversionFactor(e.target.value)}
                  placeholder="e.g. 12"
                  disabled={createItem.isPending}
                />
              </div>
              <div className="border-t pt-3">
                <Label className="text-sm">Custom fields</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">Optional key–value pairs stored on the item.</p>
                {customRows.map((row, i) => (
                  <div key={`${row.key}-${i}`} className="flex gap-2 mb-2">
                    <Input value={row.key} readOnly className="flex-1 text-xs" />
                    <Input value={row.value} readOnly className="flex-1 text-xs" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeCustomRow(i)}>
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Input placeholder="Field name" className="flex-1 min-w-[100px]" value={newCustomKey} onChange={(e) => setNewCustomKey(e.target.value)} disabled={createItem.isPending} />
                  <Input placeholder="Value" className="flex-1 min-w-[100px]" value={newCustomVal} onChange={(e) => setNewCustomVal(e.target.value)} disabled={createItem.isPending} />
                  <Button type="button" variant="outline" size="sm" onClick={addCustomRow} disabled={createItem.isPending}>
                    Add field
                  </Button>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0 bg-background">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createItem.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={createItem.isPending}>
            {createItem.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save & add to document'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
