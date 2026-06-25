import { useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarcodeScanner } from '@/components/shared/BarcodeScanner';
import { Camera, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const SIZES = [
  { key: '50x24', label: '50×24mm Label' },
  { key: '58', label: '58mm Thermal' },
  { key: '80', label: '80mm Thermal' },
];

export default function BarcodeTestPage() {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<{ matched: boolean; value: string } | null>(null);

  const generate = async () => {
    if (!text.trim()) return toast.error('Enter a barcode value (e.g. an Assign Code or SKU) to test');
    setLoading(true);
    setScanResult(null);
    try {
      const fetched: Record<string, any> = {};
      for (const s of SIZES) {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.get('/items/barcode-test', { params: { text: text.trim(), size: s.key } });
        fetched[s.key] = res.data?.data;
      }
      setResults(fetched);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not generate test barcode');
    } finally {
      setLoading(false);
    }
  };

  const checkScan = (value: string) => {
    const matched = value.trim() === text.trim();
    setScanResult({ matched, value: value.trim() });
    if (matched) toast.success('Scan matched — this barcode is genuinely scannable.');
    else toast.error(`Scan returned "${value.trim()}" — does not match. Try moving closer or improving lighting/print quality.`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Barcode Test Page</h1>
        <p className="text-sm text-muted-foreground">Generates a real barcode at each label/thermal size using the exact same code path real labels and invoices use, with real measured quality metrics — then lets you actually scan it back to confirm it's genuinely readable, not just generated.</p>
      </div>

      <Card>
        <CardContent className="p-4 flex gap-2">
          <Input placeholder="Enter Assign Code, SKU, or any value to test…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && generate()} />
          <Button onClick={generate} disabled={loading}>{loading ? 'Generating…' : 'Generate'}</Button>
        </CardContent>
      </Card>

      {Object.keys(results).length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          {SIZES.map((s) => {
            const r = results[s.key];
            if (!r) return null;
            return (
              <Card key={s.key} className={r.quality.ok ? 'border-emerald-200' : 'border-amber-300'}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{s.label}</p>
                    {r.quality.ok ? <Badge className="bg-emerald-100 text-emerald-700 gap-1"><CheckCircle2 className="w-3 h-3" /> OK</Badge> : <Badge className="bg-amber-100 text-amber-700 gap-1"><AlertTriangle className="w-3 h-3" /> Warning</Badge>}
                  </div>
                  <div className="bg-white border rounded-md p-3 flex justify-center">
                    <img src={r.dataUri} alt="test barcode" style={{ width: `${r.quality.estimatedPhysicalWidthMm}mm`, height: `${r.quality.estimatedPhysicalHeightMm}mm`, imageRendering: 'pixelated' }} />
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Physical size: {r.quality.estimatedPhysicalWidthMm}mm × {r.quality.estimatedPhysicalHeightMm}mm</p>
                    <p>Module width: {r.quality.estimatedModuleWidthMm}mm <span className="text-[10px]">(min reliable: 0.25mm)</span></p>
                    <p>Native resolution: {r.widthPx}×{r.heightPx}px</p>
                  </div>
                  {r.quality.warning && <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">{r.quality.warning}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {Object.keys(results).length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Scan validation — verify with a real scanner</p>
            <p className="text-xs text-muted-foreground">Print this page (or display it on a screen) and scan the barcode above with your actual hardware. USB and wireless scanners type into whatever field is focused, like a keyboard — click the box below first, then scan.</p>
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder="Click here, then scan with USB/wireless scanner…"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { checkScan(scanInput); setScanInput(''); } }}
              />
              <Button variant="outline" className="gap-1.5" onClick={() => setCameraOpen(true)}>
                <Camera className="w-4 h-4" /> Use Phone Camera
              </Button>
            </div>
            {scanResult && (
              <div className={`flex items-center gap-2 p-2.5 rounded-md text-sm ${scanResult.matched ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {scanResult.matched ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                Scanned value: <span className="font-mono font-semibold">{scanResult.value}</span> — {scanResult.matched ? 'matches, genuinely scannable' : 'does not match'}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <BarcodeScanner isOpen={cameraOpen} onClose={() => setCameraOpen(false)} onScan={(value) => { setCameraOpen(false); checkScan(value); }} />
    </div>
  );
}
