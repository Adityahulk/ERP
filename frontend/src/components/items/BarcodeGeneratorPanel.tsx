import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Barcode, Printer } from 'lucide-react';
import { useItems } from '@/hooks/useItems';
import { openItemBarcodeInNewTab } from '@/lib/itemBarcode';
import type { Item } from '@/types';

/**
 * Shared barcode preview + print flow (Items & Materials → Barcodes tab, and Barcode → Generate Barcode).
 */
export function BarcodeGeneratorPanel() {
  const navigate = useNavigate();
  const { data: itemsRes, isLoading } = useItems({ page: 1, limit: 500 });
  const items: Item[] = itemsRes?.data?.data || [];

  const [selectedItemId, setSelectedItemId] = useState('');
  const [barcodePreviewUrl, setBarcodePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (items.length > 0) {
      const exists = items.some((item) => item.id === selectedItemId);
      if (!exists) setSelectedItemId(items[0].id);
    } else {
      setSelectedItemId('');
    }
  }, [items, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) {
      setBarcodePreviewUrl(null);
      return;
    }
    const ctrl = { url: null as string | null, cancelled: false };
    api
      .get(`/items/${selectedItemId}/barcode-image`, { responseType: 'blob' })
      .then((res) => {
        if (ctrl.cancelled) return;
        ctrl.url = URL.createObjectURL(res.data as Blob);
        setBarcodePreviewUrl(ctrl.url);
      })
      .catch(() => {
        if (!ctrl.cancelled) setBarcodePreviewUrl(null);
      });
    return () => {
      ctrl.cancelled = true;
      if (ctrl.url) URL.revokeObjectURL(ctrl.url);
      setBarcodePreviewUrl(null);
    };
  }, [selectedItemId]);

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">Barcode Generator</h2>
            <p className="text-xs text-muted-foreground">Generate and print barcodes for any item.</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => selectedItemId && openItemBarcodeInNewTab(selectedItemId)}
              disabled={!selectedItemId}
            >
              <Barcode className="w-4 h-4 mr-1" />
              Generate
            </Button>
            <Button type="button" onClick={() => selectedItemId && navigate(`/items/${selectedItemId}`)} disabled={!selectedItemId}>
              <Printer className="w-4 h-4 mr-1" />
              Open Print Detail
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-lg border max-h-[65vh] overflow-y-auto">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading items…</p>
            ) : items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No items yet. Add items under Items & Materials.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className={`w-full border-b p-3 text-left hover:bg-muted/30 ${selectedItemId === item.id ? 'bg-primary/5' : ''}`}
                >
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{item.sku || 'No SKU'}</div>
                </button>
              ))
            )}
          </div>
          <div className="rounded-xl border p-4 min-h-[320px] flex items-center justify-center">
            {!selectedItemId ? (
              <p className="text-sm text-muted-foreground">Select an item to generate or preview barcode.</p>
            ) : barcodePreviewUrl ? (
              <img src={barcodePreviewUrl} alt="Item barcode" className="max-w-full max-h-[300px] object-contain" />
            ) : (
              <p className="text-sm text-muted-foreground">Loading preview…</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
