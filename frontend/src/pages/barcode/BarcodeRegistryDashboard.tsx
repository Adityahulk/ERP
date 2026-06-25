import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { downloadXlsx } from '@/lib/reportExport';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ArrowLeft, Search, History } from 'lucide-react';

const STATUS_META: Record<string, { label: string; className: string }> = {
  never_scanned: { label: 'Never Scanned', className: 'bg-slate-100 text-slate-600' },
  scanned: { label: 'Scanned', className: 'bg-emerald-100 text-emerald-700' },
  low_stock: { label: 'Low Stock', className: 'bg-amber-100 text-amber-700' },
  out_of_stock: { label: 'Out of Stock', className: 'bg-red-100 text-red-700' },
};

export default function BarcodeRegistryDashboard() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [historyItem, setHistoryItem] = useState<{ id: string; name: string } | null>(null);
  const [view, setView] = useState<'registry' | 'analytics'>('registry');

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['barcode-scan-analytics'],
    queryFn: () => api.get('/barcode/scan-analytics').then((r) => r.data?.data),
    enabled: view === 'analytics',
  });

  const { data: itemHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['barcode-item-history', historyItem?.id],
    queryFn: () => api.get(`/barcode/registry/${historyItem!.id}/history`).then((r) => r.data?.data ?? []),
    enabled: !!historyItem,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['barcode-registry-stats'],
    queryFn: () => api.get('/barcode/registry/stats').then((r) => r.data?.data),
  });

  const { data: registry = [], isLoading: registryLoading } = useQuery({
    queryKey: ['barcode-registry', search, filter],
    queryFn: () => api.get('/barcode/registry', { params: { search: search || undefined, filter } }).then((r) => r.data?.data ?? []),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/barcode/scan')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Barcode Registry Dashboard</h1>
          <p className="text-sm text-muted-foreground">Every barcoded product, its scan history, and live stock — in one view.</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/barcode/test')} className="gap-1.5">
          <Search className="w-4 h-4" /> Barcode Test Page
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <button onClick={() => setView('registry')} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${view === 'registry' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Registry</button>
        <button onClick={() => setView('analytics')} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${view === 'analytics' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Scan Analytics</button>
      </div>

      {view === 'registry' && (
      <>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        {statsLoading ? (
          <p className="text-sm text-muted-foreground col-span-full text-center py-6">Loading…</p>
        ) : (
          <>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Total Products</p><p className="text-xl font-bold">{stats?.total_products ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Barcodes Generated</p><p className="text-xl font-bold">{stats?.total_barcodes_generated ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Products Scanned</p><p className="text-xl font-bold text-emerald-600">{stats?.total_products_scanned ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Not Scanned</p><p className="text-xl font-bold text-slate-500">{stats?.total_products_not_scanned ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Low Stock</p><p className="text-xl font-bold text-amber-600">{stats?.low_stock_products ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Out of Stock</p><p className="text-xl font-bold text-red-600">{stats?.out_of_stock_products ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Active Products</p><p className="text-xl font-bold text-emerald-600">{stats?.active_products ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Total Sold Qty</p><p className="text-xl font-bold">{Number(stats?.total_sold_quantity ?? 0).toLocaleString('en-IN')}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Total Inventory Qty</p><p className="text-xl font-bold">{Number(stats?.total_inventory_quantity ?? 0).toLocaleString('en-IN')}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Inventory Value</p><p className="text-xl font-bold">{formatMoney(stats?.inventory_value_paise ?? 0)}</p></CardContent></Card>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search barcode, assign code, or product…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5 items-center">
          {['all', 'scanned', 'never_scanned', 'low_stock', 'out_of_stock'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {f.replace(/_/g, ' ')}
            </button>
          ))}
          <Button size="sm" variant="outline" disabled={!registry.length} onClick={() => {
            downloadXlsx('barcode-registry.xlsx', 'Registry', registry.map((r: any) => ({
              Barcode: r.barcode || '', 'Assign Code': r.assign_code || '', Product: r.item_name,
              Category: r.category || '', Unit: r.unit || '', 'Current Stock': r.total_stock,
              'Last Scan': r.last_scanned_at ? formatDate(r.last_scanned_at) : 'Never', Status: STATUS_META[r.status]?.label || r.status,
            })));
          }}>
            Export Excel
          </Button>
          <Button size="sm" variant="outline" disabled={!registry.length} onClick={() => window.print()}>
            Export PDF / Print
          </Button>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5">Barcode</th>
              <th className="px-4 py-2.5">Assign Code</th>
              <th className="px-4 py-2.5">Product Name</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5">Unit</th>
              <th className="px-4 py-2.5 text-right">Current Stock</th>
              <th className="px-4 py-2.5">Last Scan</th>
              <th className="px-4 py-2.5 text-center">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {registryLoading && <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!registryLoading && registry.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">No products match this filter.</td></tr>}
            {registry.map((r: any) => (
              <tr key={r.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-2.5 font-mono text-xs">{r.barcode || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.assign_code || '—'}</td>
                <td className="px-4 py-2.5 font-medium">{r.item_name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.category || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.unit || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{Number(r.total_stock).toLocaleString('en-IN')}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.last_scanned_at ? formatDate(r.last_scanned_at) : 'Never'}</td>
                <td className="px-4 py-2.5 text-center"><Badge className={STATUS_META[r.status]?.className}>{STATUS_META[r.status]?.label || r.status}</Badge></td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Scan History" onClick={() => setHistoryItem({ id: r.id, name: r.item_name })}>
                    <History className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

      {view === 'analytics' && (
        <div className="space-y-5">
          {analyticsLoading && <p className="text-sm text-muted-foreground text-center py-10">Loading analytics…</p>}
          {!analyticsLoading && analytics && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Total Scans</p><p className="text-xl font-bold">{analytics.total_scans}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Today</p><p className="text-xl font-bold">{analytics.daily_scans}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Last 7 Days</p><p className="text-xl font-bold">{analytics.weekly_scans}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Last 30 Days</p><p className="text-xl font-bold">{analytics.monthly_scans}</p></CardContent></Card>
              </div>

              <Card>
                <CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Scan Trend (last 14 days)</p>
                  <div className="flex items-end gap-1 h-24">
                    {(analytics.scanTrend || []).map((d: any, i: number) => {
                      const max = Math.max(...analytics.scanTrend.map((x: any) => x.scan_count), 1);
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${formatDate(d.day)}: ${d.scan_count} scans`}>
                          <div className="w-full bg-primary/70 rounded-t" style={{ height: `${(d.scan_count / max) * 80}px`, minHeight: d.scan_count > 0 ? '4px' : 0 }} />
                          <span className="text-[9px] text-muted-foreground">{new Date(d.day).getDate()}</span>
                        </div>
                      );
                    })}
                    {!(analytics.scanTrend || []).length && <p className="text-sm text-muted-foreground">No scans recorded in this period.</p>}
                  </div>
                </CardContent>
              </Card>

              <div className="grid sm:grid-cols-2 gap-4">
                <Card><CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Most Scanned Products</p>
                  {(analytics.mostScanned || []).map((p: any) => (
                    <div key={p.id} className="flex justify-between text-sm py-1 border-b"><span>{p.name}</span><span className="font-semibold">{p.scan_count}</span></div>
                  ))}
                  {!(analytics.mostScanned || []).length && <p className="text-xs text-muted-foreground">No scans yet.</p>}
                </CardContent></Card>

                <Card><CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Never Scanned Products</p>
                  {(analytics.neverScanned || []).slice(0, 8).map((p: any) => (
                    <div key={p.id} className="flex justify-between text-sm py-1 border-b"><span>{p.name}</span><span className="text-xs text-muted-foreground font-mono">{p.barcode || p.sku || '—'}</span></div>
                  ))}
                  {!(analytics.neverScanned || []).length && <p className="text-xs text-muted-foreground">Every product has been scanned at least once.</p>}
                </CardContent></Card>

                <Card><CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Fast Moving Items (30d sales)</p>
                  {(analytics.fastMoving || []).map((p: any) => (
                    <div key={p.id} className="flex justify-between text-sm py-1 border-b"><span>{p.name}</span><span className="font-semibold text-emerald-600">{Number(p.qty_sold_30d)}</span></div>
                  ))}
                  {!(analytics.fastMoving || []).length && <p className="text-xs text-muted-foreground">No sales in the last 30 days.</p>}
                </CardContent></Card>

                <Card><CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Slow Moving Items (0 sales, 30d)</p>
                  {(analytics.slowMoving || []).map((p: any) => (
                    <div key={p.id} className="flex justify-between text-sm py-1 border-b"><span>{p.name}</span><span className="text-xs text-muted-foreground">No sales</span></div>
                  ))}
                  {!(analytics.slowMoving || []).length && <p className="text-xs text-muted-foreground">Every tracked item sold at least once in 30 days.</p>}
                </CardContent></Card>

                <Card><CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Scans by User</p>
                  {(analytics.userScans || []).map((u: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm py-1 border-b"><span>{u.user_name}</span><span className="font-semibold">{u.scan_count}</span></div>
                  ))}
                  {!(analytics.userScans || []).length && <p className="text-xs text-muted-foreground">No scan activity yet.</p>}
                </CardContent></Card>

                <Card><CardContent className="p-4">
                  <p className="text-sm font-semibold mb-2">Scans by Godown</p>
                  {(analytics.godownScans || []).map((g: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm py-1 border-b"><span>{g.godown_name}</span><span className="font-semibold">{g.scan_count}</span></div>
                  ))}
                  {!(analytics.godownScans || []).length && <p className="text-xs text-muted-foreground">No scan activity yet.</p>}
                </CardContent></Card>
              </div>
            </>
          )}
        </div>
      )}

      <Sheet open={!!historyItem} onOpenChange={(v) => { if (!v) setHistoryItem(null); }}>
        <SheetContent className="w-full max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Scan History — {historyItem?.name}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-2">
            {historyLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
            {!historyLoading && itemHistory.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No movements recorded for this item yet.</p>}
            {itemHistory.map((h: any) => (
              <div key={h.id} className="border-b pb-2 text-sm flex justify-between">
                <div>
                  <p className="font-medium capitalize">{String(h.movement_type).replace(/_/g, ' ')}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(h.created_at)} · {h.godown_name || 'Unknown godown'} · {h.user_name || 'System'}</p>
                </div>
                <span className={`tabular-nums font-semibold ${Number(h.quantity) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{Number(h.quantity) > 0 ? '+' : ''}{h.quantity}</span>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
