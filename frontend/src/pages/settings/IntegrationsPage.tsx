import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  CheckCircle2, AlertTriangle, RefreshCw, Link2, Unlink, ArrowLeft,
  Megaphone, CreditCard, Sparkles, MessageCircle, ExternalLink, History, Cloud, Landmark,
} from 'lucide-react';
import toast from 'react-hot-toast';

const CATEGORY_META: Record<string, { label: string; icon: any }> = {
  marketing: { label: 'Marketing & Ads', icon: Megaphone },
  payments: { label: 'Payments', icon: CreditCard },
  ai: { label: 'AI Providers', icon: Sparkles },
  messaging: { label: 'Messaging', icon: MessageCircle },
  backup: { label: 'Backup Storage', icon: Cloud },
  finance: { label: 'Finance', icon: Landmark },
};

function StatusPill({ status }: { status: string }) {
  if (status === 'connected') return <Badge className="bg-emerald-100 text-emerald-700 gap-1"><CheckCircle2 className="w-3 h-3" /> Connected</Badge>;
  if (status === 'error' || status === 'expired') return <Badge className="bg-red-100 text-red-700 gap-1"><AlertTriangle className="w-3 h-3" /> {status === 'expired' ? 'Expired' : 'Error'}</Badge>;
  return <Badge variant="secondary" className="text-muted-foreground">Not connected</Badge>;
}

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [apiKeySheet, setApiKeySheet] = useState<any | null>(null);
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [logsSheet, setLogsSheet] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get('/integrations').then((r) => r.data?.data ?? []),
  });
  const integrations: any[] = data || [];

  // Surface the OAuth callback's redirect result (?provider=&status=&message=)
  useEffect(() => {
    const status = searchParams.get('status');
    const message = searchParams.get('message');
    if (status && message) {
      if (status === 'success') toast.success(message);
      else toast.error(message);
      qc.invalidateQueries({ queryKey: ['integrations'] });
      navigate('/settings/integrations', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const startOAuthMutation = useMutation({
    mutationFn: (key: string) => api.get(`/integrations/${key}/oauth/start`).then((r) => r.data?.data),
    onSuccess: (data) => {
      if (data?.authorizeUrl) window.location.href = data.authorizeUrl;
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not start the connection'),
  });

  const connectApiKeyMutation = useMutation({
    mutationFn: ({ key, values }: { key: string; values: Record<string, string> }) => api.post(`/integrations/${key}/api-key`, values),
    onSuccess: () => {
      toast.success('Connected — credentials verified');
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setApiKeySheet(null);
      setKeyValues({});
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Connection failed'),
  });

  const disconnectMutation = useMutation({
    mutationFn: (key: string) => api.post(`/integrations/${key}/disconnect`),
    onSuccess: () => {
      toast.success('Disconnected');
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (key: string) => api.post(`/integrations/${key}/sync`, { sync_type: 'manual_test' }),
    onSuccess: (res: any) => {
      toast.success(`Sync complete — ${res.data?.data?.recordsSynced ?? 0} record(s)`);
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Sync failed'),
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['integration-logs', logsSheet?.key],
    enabled: !!logsSheet,
    queryFn: () => api.get(`/integrations/${logsSheet.key}/logs`).then((r) => r.data?.data ?? []),
  });

  const grouped = integrations.reduce((acc: Record<string, any[]>, i) => {
    (acc[i.category] = acc[i.category] || []).push(i);
    return acc;
  }, {});

  const openApiKeySheet = (integration: any) => {
    setApiKeySheet(integration);
    setKeyValues({});
  };

  const submitApiKey = () => {
    for (const f of apiKeySheet.fields || []) {
      if (!keyValues[f.key]?.trim()) { toast.error(`${f.label} is required`); return; }
    }
    connectApiKeyMutation.mutate({ key: apiKeySheet.key, values: keyValues });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}><ArrowLeft className="w-5 h-5" /></Button>
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect your own Google, Meta, payment, and AI accounts. Microtechnique never creates these accounts for you — each connection uses your own credentials, stored encrypted and used only for your company.
          </p>
        </div>
      </div>

      {isLoading && <div className="grid sm:grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>}

      {!isLoading && Object.entries(CATEGORY_META).map(([catKey, meta]) => {
        const items = grouped[catKey] || [];
        if (items.length === 0) return null;
        return (
          <div key={catKey} className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-600 flex items-center gap-2"><meta.icon className="w-4 h-4" /> {meta.label}</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {items.map((it) => (
                <Card key={it.key} className="rounded-xl">
                  <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{it.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{it.description}</p>
                    </div>
                    <StatusPill status={it.connection.status} />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {it.connection.status === 'connected' && (
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {it.connection.account_label && <p className="font-medium text-slate-700">{it.connection.account_label}</p>}
                        {it.connection.last_synced_at && <p>Last synced {new Date(it.connection.last_synced_at).toLocaleString('en-IN')}</p>}
                        {it.connection.last_error && <p className="text-red-600">{it.connection.last_error}</p>}
                      </div>
                    )}
                    {it.authType === 'oauth' && !it.platformConfigured && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 rounded-md px-2 py-1.5">Not yet enabled by your platform administrator.</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {it.connection.status !== 'connected' ? (
                        it.authType === 'oauth' ? (
                          <Button size="sm" className="gap-1.5" disabled={!it.platformConfigured || startOAuthMutation.isPending} onClick={() => startOAuthMutation.mutate(it.key)}>
                            <Link2 className="w-3.5 h-3.5" /> Connect
                          </Button>
                        ) : (
                          <Button size="sm" className="gap-1.5" onClick={() => openApiKeySheet(it)}>
                            <Link2 className="w-3.5 h-3.5" /> Connect
                          </Button>
                        )
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => syncMutation.mutate(it.key)} loading={syncMutation.isPending}>
                            <RefreshCw className="w-3.5 h-3.5" /> Sync now
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setLogsSheet(it)}>
                            <History className="w-3.5 h-3.5" /> Logs
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10" onClick={() => disconnectMutation.mutate(it.key)}>
                            <Unlink className="w-3.5 h-3.5" /> Disconnect
                          </Button>
                        </>
                      )}
                      <a href={it.docsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-auto">
                        Docs <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {/* API key connect sheet */}
      <Sheet open={!!apiKeySheet} onOpenChange={(v) => { if (!v) { setApiKeySheet(null); setKeyValues({}); } }}>
        <SheetContent side="right">
          <SheetHeader className="mb-5"><SheetTitle>Connect {apiKeySheet?.name}</SheetTitle></SheetHeader>
          {apiKeySheet && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Paste your own {apiKeySheet.name} credentials below. We'll verify them with {apiKeySheet.name} before saving, and they're encrypted at rest.
              </p>
              {(apiKeySheet.fields || []).map((f: any) => (
                <div key={f.key}>
                  <Label className="text-xs">{f.label}</Label>
                  <Input
                    type={f.secret ? 'password' : 'text'}
                    className="mt-1 font-mono text-sm"
                    placeholder={f.placeholder}
                    value={keyValues[f.key] || ''}
                    onChange={(e) => setKeyValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-3 border-t">
                <Button variant="outline" className="flex-1" onClick={() => { setApiKeySheet(null); setKeyValues({}); }}>Cancel</Button>
                <Button className="flex-1" loading={connectApiKeyMutation.isPending} onClick={submitApiKey}>Verify &amp; Connect</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Sync logs sheet */}
      <Sheet open={!!logsSheet} onOpenChange={(v) => { if (!v) setLogsSheet(null); }}>
        <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>{logsSheet?.name} — Sync History</SheetTitle></SheetHeader>
          {logsLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {!logsLoading && (logsData || []).length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No syncs logged yet.</p>}
          <div className="space-y-2">
            {(logsData || []).map((log: any) => (
              <div key={log.id} className="flex items-center justify-between p-2.5 rounded-lg border text-sm">
                <div>
                  <p className="font-medium capitalize">{log.sync_type.replace('_', ' ')}</p>
                  <p className="text-xs text-muted-foreground">{new Date(log.started_at).toLocaleString('en-IN')}</p>
                  {log.error_message && <p className="text-xs text-red-600 mt-0.5">{log.error_message}</p>}
                </div>
                <Badge variant="secondary" className={log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : log.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                  {log.status}
                </Badge>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
