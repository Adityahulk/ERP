import { useEffect, useState } from 'react';
import { useCreateItem } from '@/hooks/useItems';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';

const GST_OPTIONS = [0, 5, 12, 18, 28] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills name when the sheet opens */
  defaultName?: string;
  /** Called with the created item row from the API (full `items` record) */
  onCreated: (item: Record<string, unknown>) => void;
};

function parseMoneyPaise(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim());
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function QuickAddItemSheet({ open, onOpenChange, defaultName = '', onCreated }: Props) {
  const createItem = useCreateItem();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [sellingRupee, setSellingRupee] = useState('');
  const [purchaseRupee, setPurchaseRupee] = useState('');
  const [gstRate, setGstRate] = useState<number>(18);

  useEffect(() => {
    if (open) {
      setName(defaultName.trim());
      setSku('');
      setHsnCode('');
      setSellingRupee('');
      setPurchaseRupee('');
      setGstRate(18);
    }
  }, [open, defaultName]);

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

    const body: Record<string, unknown> = {
      name: trimmedName,
      gst_rate: gstRate,
      selling_price: parseMoneyPaise(sellingRupee),
      purchase_price: parseMoneyPaise(purchaseRupee),
    };
    const s = sku.trim();
    if (s) body.sku = s;
    if (hsn) body.hsn_code = hsn;

    try {
      const res = await createItem.mutateAsync(body);
      const row = (res as { data?: Record<string, unknown> })?.data ?? (res as Record<string, unknown>);
      if (!row || typeof row !== 'object' || !('id' in row)) {
        toast.error('Unexpected response from server');
        return;
      }
      toast.success('Item saved — open Items to add category, units, stock, and more');
      onCreated(row as Record<string, unknown>);
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to create item');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add item</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground mt-2">
          Only the name is required. Add SKU, HSN, rates, and GST here if you know them — everything else can be completed later under{' '}
          <span className="font-medium text-foreground">Items & Materials</span>.
        </p>
        <div className="mt-6 space-y-4">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qa-item-sku">SKU (optional)</Label>
              <Input
                id="qa-item-sku"
                className="mt-1 font-mono text-sm"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                disabled={createItem.isPending}
              />
            </div>
            <div>
              <Label htmlFor="qa-item-hsn">HSN (optional)</Label>
              <Input
                id="qa-item-hsn"
                className="mt-1 font-mono text-sm"
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                maxLength={20}
                disabled={createItem.isPending}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qa-item-sp">Selling price ₹ (optional)</Label>
              <Input
                id="qa-item-sp"
                type="number"
                min={0}
                step="0.01"
                className="mt-1 tabular-nums"
                value={sellingRupee}
                onChange={(e) => setSellingRupee(e.target.value)}
                placeholder="0"
                disabled={createItem.isPending}
              />
            </div>
            <div>
              <Label htmlFor="qa-item-pp">Purchase price ₹ (optional)</Label>
              <Input
                id="qa-item-pp"
                type="number"
                min={0}
                step="0.01"
                className="mt-1 tabular-nums"
                value={purchaseRupee}
                onChange={(e) => setPurchaseRupee(e.target.value)}
                placeholder="0"
                disabled={createItem.isPending}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="qa-item-gst">GST %</Label>
            <select
              id="qa-item-gst"
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
          <div className="flex justify-end gap-2 pt-2">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
