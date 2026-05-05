import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Barcode, FileText, Printer } from 'lucide-react';
import { useItems } from '@/hooks/useItems';
import { openItemBarcodeInNewTab } from '@/lib/itemBarcode';
import type { Item } from '@/types';
import PrintLabels from '@/components/shared/PrintLabels';

/**
 * Shared barcode preview + print flow (Items & Materials → Barcodes tab, and Barcode → Generate Barcode).
 */
export function BarcodeGeneratorPanel() {
  const navigate = useNavigate();
  const { data: itemsRes, isLoading } = useItems({ page: 1, limit: 500 });
  const items: Item[] = itemsRes?.data?.data || [];

  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [printQtyById, setPrintQtyById] = useState<Record<string, number>>({});
  const [showPrintLabels, setShowPrintLabels] = useState(false);
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

  const togglePrintItem = (item: Item) => {
    setSelectedIds((prev) => {
      const exists = prev.includes(item.id);
      if (exists) return prev.filter((id) => id !== item.id);
      return [...prev, item.id];
    });
    setPrintQtyById((prev) => ({ ...prev, [item.id]: prev[item.id] || 1 }));
  };

  const selectedForPrint = selectedIds
    .map((id) => items.find((item) => item.id === id))
    .filter(Boolean)
    .map((item: any) => ({
      item_id: item.id,
      sku: item.barcode || item.sku || '',
      name: item.name,
      quantity: Math.max(1, Number(printQtyById[item.id] || 1)),
    }));

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">Barcode Generator</h2>
            <p className="text-xs text-muted-foreground">Select items, preview a barcode, then generate A4 or thermal label PDFs.</p>
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
            <Button variant="outline" type="button" onClick={() => selectedItemId && navigate(`/items/${selectedItemId}`)} disabled={!selectedItemId}>
              <Printer className="w-4 h-4 mr-1" />
              Item Detail
            </Button>
            <Button type="button" onClick={() => setShowPrintLabels(true)} disabled={selectedForPrint.length === 0}>
              <FileText className="w-4 h-4 mr-1" />
              Print Labels ({selectedForPrint.length})
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
                <div
                  key={item.id}
                  className={`w-full border-b p-3 hover:bg-muted/30 ${selectedItemId === item.id ? 'bg-primary/5' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => togglePrintItem(item)}
                      aria-label={`Select ${item.name} for label printing`}
                    />
                    <button type="button" onClick={() => setSelectedItemId(item.id)} className="min-w-0 flex-1 text-left">
                      <div className="font-medium truncate">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.barcode || item.sku || 'No barcode / SKU'}</div>
                    </button>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-16 text-center tabular-nums"
                      value={printQtyById[item.id] || 1}
                      onChange={(e) => setPrintQtyById((prev) => ({ ...prev, [item.id]: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                      disabled={!selectedIds.includes(item.id)}
                    />
                  </div>
                </div>
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
      {showPrintLabels && <PrintLabels selectedItems={selectedForPrint} onClose={() => setShowPrintLabels(false)} />}
    </Card>
  );
}
