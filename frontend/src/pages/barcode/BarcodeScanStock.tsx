import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGodowns, useScanAndDeduct, useBarcodeScanHistory } from '@/hooks/useStock';
import { BarcodeScanner } from '@/components/shared/BarcodeScanner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Camera, History, PackageMinus } from 'lucide-react';
import toast from 'react-hot-toast';

interface LastScanResult {
  item_name: string;
  sku?: string;
  barcode?: string;
  godown_name: string;
  quantity_scanned: number;
  quantity_before: number;
  quantity_after: number;
  at: string;
}

export default function BarcodeScanStock() {
  const navigate = useNavigate();
  const { data: godownData } = useGodowns();
  const godowns = godownData?.data || [];

  const [godownId, setGodownId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastResult, setLastResult] = useState<LastScanResult | null>(null);

  const scanAndDeduct = useScanAndDeduct();
  const { data: historyData, isLoading: historyLoading } = useBarcodeScanHistory({ limit: 15 });
  const history = historyData?.data?.data || [];

  // Default to the first available godown once the list loads.
  useEffect(() => {
    if (!godownId && godowns.length >= 1) {
      setGodownId(godowns[0].id);
    }
  }, [godowns, godownId]);

  const handleScan = async (barcodeValue: string) => {
    if (!godownId) {
      toast.error('Select a godown before scanning');
      return;
    }
    const t = toast.loading(`Looking up ${barcodeValue}…`);
    try {
      const res = await scanAndDeduct.mutateAsync({ barcode: barcodeValue, godown_id: godownId, quantity });
      const data = res.data;
      setLastResult({
        item_name: data.item.name,
        sku: data.item.sku,
        barcode: data.item.barcode,
        godown_name: data.godown.name,
        quantity_scanned: data.quantity_scanned,
        quantity_before: data.quantity_before,
        quantity_after: data.quantity_after,
        at: new Date().toLocaleTimeString(),
      });
      toast.success(
        `${data.item.name}: stock ${data.quantity_before} → ${data.quantity_after}`,
        { id: t }
      );
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Scan failed', { id: t });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Scan Barcode &amp; Update Stock</h1>
          <p className="text-sm text-muted-foreground">
            Scan an item's barcode to instantly reduce stock and log a movement
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/barcode/registry')} className="gap-1.5">
          <History className="w-4 h-4" /> Registry Dashboard
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label>Godown *</Label>
          <select
            className="mt-1 w-full h-10 rounded-md border bg-transparent px-3 text-sm"
            value={godownId}
            onChange={(e) => setGodownId(e.target.value)}
          >
            <option value="">Select godown</option>
            {godowns.map((g: any) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Quantity per scan</Label>
          <Input
            type="number"
            min={1}
            step="1"
            className="mt-1"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
      </div>

      <Button
        size="lg"
        className="w-full gap-2"
        disabled={!godownId}
        onClick={() => setScannerOpen(true)}
      >
        <Camera className="h-5 w-5" /> Open Scanner
      </Button>

      {lastResult && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PackageMinus className="h-4 w-4" /> Last Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-semibold">{lastResult.item_name} {lastResult.sku ? `(${lastResult.sku})` : ''}</div>
            <div className="text-muted-foreground">Barcode: {lastResult.barcode || '—'} • Godown: {lastResult.godown_name}</div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="secondary">-{lastResult.quantity_scanned} units</Badge>
              <span className="tabular-nums">{lastResult.quantity_before} → {lastResult.quantity_after}</span>
              <span className="text-xs text-muted-foreground ml-auto">{lastResult.at}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Barcode Scan History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}
          {!historyLoading && history.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No scans yet — scan a barcode above to get started.</p>
          )}
          {history.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="p-3 text-left font-medium">Item</th>
                    <th className="p-3 text-left font-medium">Godown</th>
                    <th className="p-3 text-right font-medium">Qty</th>
                    <th className="p-3 text-right font-medium">Balance After</th>
                    <th className="p-3 text-left font-medium">Scanned By</th>
                    <th className="p-3 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((m: any) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="p-3 font-medium">{m.item_name} {m.sku ? <span className="text-muted-foreground">({m.sku})</span> : null}</td>
                      <td className="p-3 text-muted-foreground">{m.godown_name || '—'}</td>
                      <td className="p-3 text-right tabular-nums text-red-600">{m.quantity}</td>
                      <td className="p-3 text-right tabular-nums">{m.balance_after}</td>
                      <td className="p-3 text-muted-foreground">{m.scanned_by_name || '—'}</td>
                      <td className="p-3 text-right text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <BarcodeScanner isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
    </div>
  );
}
