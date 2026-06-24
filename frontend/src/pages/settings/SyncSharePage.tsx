import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  ArrowLeft, HardDrive, History, RotateCcw, Download, Play,
  CheckCircle2, XCircle, Clock, AlertTriangle, Cloud, Database, Activity,
} from 'lucide-react';
import toast from 'react-hot-toast';

type Tab = 'dashboard' | 'auto' | 'computer' | 'drive' | 'restore';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <Badge className="bg-emerald-100 text-emerald-700 gap-1"><CheckCircle2 className="w-3 h-3" /> Success</Badge>;
  if (status === 'failed' || status === 'dead_letter') return <Badge className="bg-red-100 text-red-700 gap-1"><XCircle className="w-3 h-3" /> Failed</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 gap-1"><Clock className="w-3 h-3" /> Running</Badge>;
}

export default function SyncSharePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [restoreTarget, setRestoreTarget] = useState<any | null>(null);

  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ['sync-dashboard'],
    queryFn: () => api.get('/backup/dashboard').then((r) => r.data?.data),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['backup-history'],
    queryFn: () => api.get('/backup/history').then((r) => r.data?.data ?? []),
  });

  const { data: schedule } = useQuery({
    queryKey: ['backup-schedule'],
    queryFn: () => api.get('/backup/schedule').then((r) => r.data?.data),
  });

  const { data: restoreHistory = [] } = useQuery({
    queryKey: ['restore-history'],
    queryFn: () => api.get('/backup/restore-history').then((r) => r.data?.data ?? []),
    enabled: tab === 'restore',
  });

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get('/integrations').then((r) => r.data?.data ?? []),
    enabled: tab === 'drive',
  });

  const runNowMutation = useMutation({
    mutationFn: () => api.post('/backup/run'),
    onSuccess: () => {
      toast.success('Backup started — refresh history in a few seconds');
      setTimeout(() => { qc.invalidateQueries({ queryKey: ['backup-history'] }); qc.invalidateQueries({ queryKey: ['sync-dashboard'] }); }, 4000);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not start backup'),
  });

  const scheduleMutation = useMutation({
    mutationFn: (body: any) => api.patch('/backup/schedule', body),
    onSuccess: () => { toast.success('Schedule updated'); qc.invalidateQueries({ queryKey: ['backup-schedule'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not update schedule'),
  });

  const uploadToProviderMutation = useMutation({
    mutationFn: ({ jobRunId, provider }: { jobRunId: string; provider: string }) => api.post(`/backup/${jobRunId}/upload/${provider}`),
    onSuccess: () => toast.success('Uploaded to Drive'),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['restore-preview', restoreTarget?.id],
    enabled: !!restoreTarget,
    queryFn: () => api.get(`/backup/${restoreTarget.id}/restore/preview`).then((r) => r.data),
  });

  const applyRestoreMutation = useMutation({
    mutationFn: (jobRunId: string) => api.post(`/backup/${jobRunId}/restore/apply`),
    onSuccess: (res: any) => {
      toast.success(`Restore complete — ${res.data?.data?.rowsAffected ?? 0} row(s) added`);
      setRestoreTarget(null);
      qc.invalidateQueries({ queryKey: ['restore-history'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Restore failed'),
  });

  const downloadBackup = async (jobRunId: string) => {
    try {
      const res = await api.get(`/backup/${jobRunId}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${jobRunId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error('Could not download backup — it may have been rotated out');
    }
  };

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Sync & Share', icon: Activity },
    { id: 'auto', label: 'Auto Backup', icon: Clock },
    { id: 'computer', label: 'Backup to Computer', icon: HardDrive },
    { id: 'drive', label: 'Backup to Drive', icon: Cloud },
    { id: 'restore', label: 'Restore Backup', icon: RotateCcw },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}><ArrowLeft className="w-5 h-5" /></Button>
        <div>
          <h1 className="text-2xl font-bold">Sync & Share</h1>
          <p className="text-sm text-muted-foreground">Backups, restore, and background sync activity for your company.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b overflow-x-auto pb-px">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Last Backup</p>
              <p className="text-lg font-bold">{dashboard?.lastBackup ? new Date(dashboard.lastBackup.started_at).toLocaleString('en-IN') : '—'}</p>
              {dashboard?.lastBackup && <StatusBadge status={dashboard.lastBackup.status} />}
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Backups</p>
              <p className="text-lg font-bold">{dashboard?.totalBackups ?? '—'} <span className="text-xs text-muted-foreground font-normal">({dashboard?.successfulBackups ?? 0} successful)</span></p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Storage Used (last 30 backups, on disk)</p>
              <p className="text-lg font-bold">{formatBytes(dashboard?.storageUsedBytes || 0)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Backup Frequency</p>
              <p className="text-lg font-bold capitalize">{dashboard?.backupFrequency || 'manual'}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Integration Sync Health (7d)</p>
              <p className="text-lg font-bold text-emerald-600">{dashboard?.syncHealth7d?.success ?? 0} ok <span className="text-red-500">/ {dashboard?.syncHealth7d?.failed ?? 0} failed</span></p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Background Workers</p>
              <p className="text-lg font-bold">{dashboard?.workerHealth?.healthy ?? 0}/{dashboard?.workerHealth?.total ?? 0} <span className="text-xs font-normal text-muted-foreground">healthy</span></p>
            </CardContent></Card>
          </div>

          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="p-4 text-sm text-blue-900">
              <p className="font-semibold mb-1">About "sync" in Microtechnique ERP</p>
              <p>Every device — web, tablet, or a future mobile/desktop app — talks to the same live database through the API in real time. There's no separate copy to merge or reconcile, so there's nothing that can silently fall out of sync between devices. What <em>is</em> real and shown below: background job activity (backups, integration syncs with Google/Meta/etc., scheduled reminders) and whether those workers are healthy.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" /> Recent Background Activity</CardTitle></CardHeader>
            <CardContent className="p-0">
              {(dashboard?.recentSyncActivity || []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No integration sync activity yet — connect something under Settings → Integrations.</p>
              ) : (
                <div className="divide-y">
                  {dashboard.recentSyncActivity.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div><p className="font-medium capitalize">{s.provider.replace('_', ' ')}</p><p className="text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString('en-IN')}</p></div>
                      <StatusBadge status={s.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'auto' && (
        <Card>
          <CardHeader><CardTitle>Auto Backup</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {['manual', 'daily', 'weekly', 'monthly'].map((f) => (
                <button key={f} onClick={() => scheduleMutation.mutate({ frequency: f, retention_count: schedule?.retention_count || 14 })}
                  className={`px-3 py-2 rounded-md border text-sm capitalize ${schedule?.frequency === f ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : ''}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium">Keep last
                <Input type="number" className="w-20 inline-block mx-2 h-8" defaultValue={schedule?.retention_count || 14}
                  onBlur={(e) => scheduleMutation.mutate({ frequency: schedule?.frequency || 'manual', retention_count: parseInt(e.target.value) || 14 })} />
                backups
              </label>
            </div>
            <Button onClick={() => runNowMutation.mutate()} loading={runNowMutation.isPending} className="gap-2"><Play className="w-4 h-4" /> Run Backup Now</Button>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-sm mb-2">Backup History</h3>
              <BackupHistoryTable history={history} onDownload={downloadBackup} onRestore={(r) => setRestoreTarget(r)} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'computer' && (
        <Card>
          <CardHeader><CardTitle>Backup to Computer</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Generates a full export of your company's data (parties, items, invoices, purchases, payments, expenses) as a JSON file, then downloads it straight to your device. No data ever leaves your control unless you choose to upload it elsewhere.</p>
            <Button onClick={() => runNowMutation.mutate()} loading={runNowMutation.isPending} className="gap-2"><Database className="w-4 h-4" /> Generate Backup</Button>
            <BackupHistoryTable history={history} onDownload={downloadBackup} onRestore={(r) => setRestoreTarget(r)} />
          </CardContent>
        </Card>
      )}

      {tab === 'drive' && (
        <Card>
          <CardHeader><CardTitle>Backup to Drive</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Upload a completed backup to your own connected cloud storage. Connect Google Drive or S3/MinIO under Settings → Integrations first — Microtechnique never holds a copy itself.</p>
            <Button variant="outline" onClick={() => navigate('/settings/integrations')}>Manage Connections →</Button>
            <div className="border-t pt-4">
              <h3 className="font-semibold text-sm mb-2">Upload a completed backup</h3>
              {history.filter((h: any) => h.status === 'success').slice(0, 5).map((h: any) => {
                const drive = integrations.find((i: any) => i.key === 'google_drive');
                const s3 = integrations.find((i: any) => i.key === 's3_compatible');
                return (
                  <div key={h.id} className="flex items-center justify-between p-2.5 border rounded-md mb-2 text-sm">
                    <span>{new Date(h.started_at).toLocaleString('en-IN')}</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={drive?.connection?.status !== 'connected' || uploadToProviderMutation.isPending}
                        onClick={() => uploadToProviderMutation.mutate({ jobRunId: h.id, provider: 'google_drive' })}>
                        <CloudUpload className="w-3.5 h-3.5 mr-1.5" /> Google Drive
                      </Button>
                      <Button size="sm" variant="outline" disabled={s3?.connection?.status !== 'connected' || uploadToProviderMutation.isPending}
                        onClick={() => uploadToProviderMutation.mutate({ jobRunId: h.id, provider: 's3_compatible' })}>
                        <CloudUpload className="w-3.5 h-3.5 mr-1.5" /> S3 / MinIO
                      </Button>
                    </div>
                  </div>
                );
              })}
              {history.filter((h: any) => h.status === 'success').length === 0 && <p className="text-sm text-muted-foreground">No completed backups yet — create one under Auto Backup first.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'restore' && (
        <Card>
          <CardHeader><CardTitle>Restore Backup</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Restoring only adds rows that don't already exist — it never overwrites current data, so a recent backup can't accidentally erase newer real records.</p>
            <BackupHistoryTable history={history} onDownload={downloadBackup} onRestore={(r) => setRestoreTarget(r)} restoreOnly />
            <div className="border-t pt-4">
              <h3 className="font-semibold text-sm mb-2">Restore History</h3>
              {restoreHistory.length === 0 ? <p className="text-sm text-muted-foreground">No restores performed yet.</p> : (
                <div className="divide-y">
                  {restoreHistory.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{new Date(r.created_at).toLocaleString('en-IN')}</span>
                      <span>{r.rows_affected} rows added, {r.conflicts_found} skipped (already existed)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Sheet open={!!restoreTarget} onOpenChange={(v) => { if (!v) setRestoreTarget(null); }}>
        <SheetContent className="w-full max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Restore Preview</SheetTitle></SheetHeader>
          {previewLoading && <p className="text-sm text-muted-foreground py-8 text-center">Reading backup…</p>}
          {preview && (
            <div className="mt-4 space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Only rows that don't already exist will be added. Rows with a matching ID are skipped, never overwritten.
              </div>
              <div className="divide-y border rounded-md">
                {(preview.data || []).map((row: any) => (
                  <div key={row.table} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-medium">{row.table}</span>
                    <span className="text-xs text-muted-foreground">{row.newRows} new · {row.conflictingRows} already exist</span>
                  </div>
                ))}
              </div>
              <Button className="w-full" onClick={() => applyRestoreMutation.mutate(restoreTarget.id)} loading={applyRestoreMutation.isPending}>
                Confirm Restore
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BackupHistoryTable({ history, onDownload, onRestore, restoreOnly }: { history: any[]; onDownload: (id: string) => void; onRestore: (h: any) => void; restoreOnly?: boolean }) {
  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
        <tbody>
          {history.map((h: any) => (
            <tr key={h.id} className="border-t">
              <td className="px-3 py-2">{new Date(h.started_at).toLocaleDateString('en-IN')}</td>
              <td className="px-3 py-2">{new Date(h.started_at).toLocaleTimeString('en-IN')}</td>
              <td className="px-3 py-2"><StatusBadge status={h.status} /></td>
              <td className="px-3 py-2 text-right space-x-1">
                {h.status === 'success' && !restoreOnly && <Button size="sm" variant="outline" onClick={() => onDownload(h.id)}><Download className="w-3.5 h-3.5" /></Button>}
                {h.status === 'success' && <Button size="sm" variant="outline" onClick={() => onRestore(h)}><RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore</Button>}
              </td>
            </tr>
          ))}
          {!history.length && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No backups yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
