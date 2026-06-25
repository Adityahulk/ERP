import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, AlertTriangle, CheckCircle2, Clock, RotateCcw, HeartPulse } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SuperAdminJobs() {
  const qc = useQueryClient();
  const [dlqQueue, setDlqQueue] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-jobs-overview'],
    queryFn: () => api.get('/admin/jobs/overview').then((r) => r.data?.data),
    refetchInterval: 15_000,
  });

  const { data: runs } = useQuery({
    queryKey: ['admin-jobs-runs'],
    queryFn: () => api.get('/admin/jobs/runs', { params: { limit: 50 } }).then((r) => r.data?.data ?? []),
    refetchInterval: 15_000,
  });

  const { data: dlqJobs } = useQuery({
    queryKey: ['admin-jobs-dlq', dlqQueue],
    enabled: !!dlqQueue,
    queryFn: () => api.get(`/admin/jobs/${dlqQueue}/dead-letter`).then((r) => r.data?.data ?? []),
  });

  const retryMutation = useMutation({
    mutationFn: ({ queue, id }: { queue: string; id: string }) => api.post(`/admin/jobs/${queue}/dead-letter/${id}/retry`),
    onSuccess: () => {
      toast.success('Job re-queued');
      qc.invalidateQueries({ queryKey: ['admin-jobs-dlq'] });
      qc.invalidateQueries({ queryKey: ['admin-jobs-overview'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Retry failed'),
  });

  const queues: any[] = data?.queues || [];
  const workers: any[] = data?.workers || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6" /> Background Jobs</h1>
        <p className="text-sm text-muted-foreground">Live queue depths, worker health, and run history across every tenant. Auto-refreshes every 15s.</p>
      </div>

      {isLoading && <div className="grid sm:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>}

      {!isLoading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {queues.map((q) => (
            <Card key={q.queue} className={q.deadLetterCount > 0 ? 'border-red-200' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  {q.queue}
                  {q.deadLetterCount > 0 && (
                    <button onClick={() => setDlqQueue(q.queue)} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {q.deadLetterCount} DLQ
                    </button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-muted-foreground">Waiting</p><p className="font-bold text-base">{q.counts.waiting ?? 0}</p></div>
                <div><p className="text-muted-foreground">Active</p><p className="font-bold text-base text-blue-600">{q.counts.active ?? 0}</p></div>
                <div><p className="text-muted-foreground">Failed</p><p className="font-bold text-base text-red-500">{q.counts.failed ?? 0}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><HeartPulse className="w-4 h-4" /> Worker Health</CardTitle></CardHeader>
        <CardContent className="p-0">
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No worker heartbeats yet — the worker process may not be running.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40 text-xs text-muted-foreground"><th className="px-4 py-2 text-left">Queue</th><th className="px-4 py-2 text-left">Instance</th><th className="px-4 py-2 text-right">Processed</th><th className="px-4 py-2 text-right">Failed</th><th className="px-4 py-2 text-center">Status</th></tr></thead>
              <tbody>
                {workers.map((w: any) => (
                  <tr key={w.id} className="border-b">
                    <td className="px-4 py-2 font-medium">{w.queue_name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{w.worker_instance_id}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.jobs_processed}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-500">{w.jobs_failed}</td>
                    <td className="px-4 py-2 text-center">
                      {w.healthy ? <Badge className="bg-emerald-100 text-emerald-700 gap-1"><CheckCircle2 className="w-3 h-3" /> Healthy</Badge> : <Badge className="bg-red-100 text-red-700 gap-1"><AlertTriangle className="w-3 h-3" /> Stalled</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Recent Runs</CardTitle></CardHeader>
        <CardContent className="p-0 max-h-96 overflow-y-auto">
          {(runs || []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2.5 border-b text-sm">
              <div>
                <p className="font-medium">{r.queue_name} {r.company_name && <span className="text-muted-foreground font-normal">— {r.company_name}</span>}</p>
                <p className="text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString('en-IN')} {r.duration_ms ? `· ${r.duration_ms}ms` : ''}</p>
                {r.error_message && <p className="text-xs text-red-600 mt-0.5 truncate max-w-md">{r.error_message}</p>}
              </div>
              <Badge variant="secondary" className={r.status === 'success' ? 'bg-emerald-100 text-emerald-700' : r.status === 'dead_letter' ? 'bg-red-100 text-red-700' : r.status === 'failed' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}>
                {r.status}
              </Badge>
            </div>
          ))}
          {(!runs || runs.length === 0) && <p className="text-sm text-muted-foreground text-center py-6">No job runs recorded yet.</p>}
        </CardContent>
      </Card>

      {dlqQueue && (
        <Card className="border-red-200">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base text-red-700">Dead Letter — {dlqQueue}</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setDlqQueue(null)}>Close</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {(dlqJobs || []).map((j: any) => (
              <div key={j.id} className="flex items-center justify-between p-2.5 rounded-lg border text-sm">
                <pre className="text-xs text-muted-foreground max-w-md overflow-x-auto">{JSON.stringify(j.data?.originalData, null, 0)}</pre>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => retryMutation.mutate({ queue: dlqQueue, id: j.id })} loading={retryMutation.isPending}>
                  <RotateCcw className="w-3.5 h-3.5" /> Retry
                </Button>
              </div>
            ))}
            {(!dlqJobs || dlqJobs.length === 0) && <p className="text-sm text-muted-foreground text-center py-4">Nothing in the dead-letter queue.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
