import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDate } from '@/lib/formatters';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Upload, Send, MessageSquare, BarChart3, Settings as SettingsIcon } from 'lucide-react';

const TABS = [
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'campaigns', label: 'Campaigns', icon: Send },
  { key: 'logs', label: 'Logs', icon: MessageSquare },
];

export default function WhatsappHub() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">Connection settings, campaigns, and message history.</p>
      </div>
      <div className="flex gap-2 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'settings' && <SettingsTab />}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['whatsapp-settings'],
    queryFn: () => api.get('/whatsapp/settings').then((r) => r.data?.data),
  });
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [number, setNumber] = useState('');
  const [cloudToken, setCloudToken] = useState('');
  const [cloudPhoneId, setCloudPhoneId] = useState('');

  const modeMut = useMutation({
    mutationFn: (mode: string) => api.patch('/whatsapp/mode', { mode }),
    onSuccess: () => { toast.success('Mode updated'); qc.invalidateQueries({ queryKey: ['whatsapp-settings'] }); },
  });
  const saveMut = useMutation({
    mutationFn: () => api.patch('/whatsapp/twilio-config', { account_sid: sid, auth_token: token, whatsapp_number: number }),
    onSuccess: () => { toast.success('Twilio config saved'); qc.invalidateQueries({ queryKey: ['whatsapp-settings'] }); setToken(''); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
  });
  const testMut = useMutation({
    mutationFn: () => api.post('/whatsapp/test-connection'),
    onSuccess: (res: any) => toast.success(`Connected — Twilio account status: ${res.data?.data?.accountStatus}`),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Connection test failed'),
  });
  const saveCloudMut = useMutation({
    mutationFn: () => api.patch('/whatsapp/cloud-config', { access_token: cloudToken, phone_number_id: cloudPhoneId }),
    onSuccess: () => { toast.success('Cloud API config saved'); qc.invalidateQueries({ queryKey: ['whatsapp-settings'] }); setCloudToken(''); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
  });
  const testCloudMut = useMutation({
    mutationFn: () => api.post('/whatsapp/test-cloud-connection'),
    onSuccess: (res: any) => {
      if (res.data?.data?.connected) toast.success(`Connected — ${res.data.data.detail}`);
      else toast.error(res.data?.data?.detail || 'Connection test failed');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Connection test failed'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label>WhatsApp Mode</Label>
          <div className="grid sm:grid-cols-3 gap-2">
            <button onClick={() => modeMut.mutate('twilio')} className={`text-left rounded-md border p-3 ${settings?.mode === 'twilio' ? 'border-indigo-600 ring-1 ring-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>
              <p className="font-semibold text-sm">Twilio</p>
              <p className="text-xs text-muted-foreground mt-0.5">Official WhatsApp Business API via Twilio.</p>
            </button>
            <button onClick={() => modeMut.mutate('cloud_api')} className={`text-left rounded-md border p-3 ${settings?.mode === 'cloud_api' ? 'border-indigo-600 ring-1 ring-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>
              <p className="font-semibold text-sm">WhatsApp Cloud API</p>
              <p className="text-xs text-muted-foreground mt-0.5">Meta's own official API directly — no Twilio markup.</p>
            </button>
            <button onClick={() => modeMut.mutate('qr_login')} className={`text-left rounded-md border p-3 ${settings?.mode === 'qr_login' ? 'border-indigo-600 ring-1 ring-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>
              <p className="font-semibold text-sm">WhatsApp Web QR Login</p>
              <p className="text-xs text-muted-foreground mt-0.5">Not implemented — see note below.</p>
            </button>
          </div>
          {settings?.mode === 'qr_login' && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">
              This mode is selected, but has no real connection. Implementing it means automating WhatsApp's personal app via an unofficial library — against WhatsApp's Terms of Service for business/bulk messaging, and a documented, common cause of permanent number bans. Sends will fail explicitly rather than silently going through a different channel. Use Twilio or Cloud API instead — both are official and don't carry that risk.
            </p>
          )}
        </CardContent>
      </Card>

      {settings?.mode === 'twilio' && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Label>Twilio Configuration</Label>
            {settings?.hasAuthToken && <p className="text-xs text-emerald-700">Account SID: {settings.twilioAccountSid} · Number: {settings.twilioNumber} {settings.twilioVerifiedAt ? `· Verified ${formatDate(settings.twilioVerifiedAt)}` : '· Not yet verified'}</p>}
            <Input placeholder="Account SID" value={sid} onChange={(e) => setSid(e.target.value)} />
            <Input placeholder="Auth Token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
            <Input placeholder="WhatsApp Number (e.g. +14155238886)" value={number} onChange={(e) => setNumber(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>Save</Button>
              <Button size="sm" variant="outline" disabled={!settings?.hasAuthToken || testMut.isPending} onClick={() => testMut.mutate()}>
                {testMut.isPending ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {settings?.mode === 'cloud_api' && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Label>WhatsApp Cloud API Configuration</Label>
            <p className="text-xs text-muted-foreground">From Meta for Developers → your WhatsApp Business app → API Setup.</p>
            {settings?.hasCloudToken && <p className="text-xs text-emerald-700">Phone Number ID: {settings.cloudPhoneNumberId} {settings.cloudVerifiedAt ? `· Verified ${formatDate(settings.cloudVerifiedAt)}` : '· Not yet verified'}</p>}
            <Input placeholder="Access Token" type="password" value={cloudToken} onChange={(e) => setCloudToken(e.target.value)} />
            <Input placeholder="Phone Number ID" value={cloudPhoneId} onChange={(e) => setCloudPhoneId(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={saveCloudMut.isPending} onClick={() => saveCloudMut.mutate()}>Save</Button>
              <Button size="sm" variant="outline" disabled={!settings?.hasCloudToken || testCloudMut.isPending} onClick={() => testCloudMut.mutate()}>
                {testCloudMut.isPending ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 rounded-md p-2">
              Note: Cloud API's free-form text messages only deliver within a 24-hour window after the customer last messaged you. Outside that window (e.g. an unprompted payment reminder), Meta requires a pre-approved message template instead — this isn't yet wired up here, so business-initiated sends outside that window may be rejected by Meta until template support is added.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DashboardTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-dashboard'],
    queryFn: () => api.get('/whatsapp/dashboard').then((r) => r.data?.data),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>;
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4">
        <p className="text-sm text-muted-foreground">Active Mode</p>
        <p className="text-lg font-bold capitalize">
          {data?.activeMode === 'qr_login' ? 'WhatsApp Web QR Login (not connected)' : data?.activeMode === 'cloud_api' ? 'WhatsApp Cloud API' : 'Twilio WhatsApp API'}
        </p>
        {data?.connectedNumber && <p className="text-xs text-muted-foreground">{data.connectedNumber}</p>}
      </CardContent></Card>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Today</p><p className="text-xl font-bold">{data?.total_today ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Delivered</p><p className="text-xl font-bold text-emerald-600">{data?.delivered_today ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Failed</p><p className="text-xl font-bold text-red-600">{data?.failed_today ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Pending</p><p className="text-xl font-bold text-amber-600">{data?.pending_today ?? 0}</p></CardContent></Card>
      </div>
    </div>
  );
}

function CampaignsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState('all');
  const [csvRecipients, setCsvRecipients] = useState<{ contact: string }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['whatsapp-campaigns'],
    queryFn: () => api.get('/whatsapp/campaigns').then((r) => r.data?.data ?? []),
  });

  const createMut = useMutation({
    mutationFn: () => api.post('/whatsapp/campaigns', {
      channel: 'whatsapp', name, message,
      ...(csvRecipients ? { recipients: csvRecipients } : { segment }),
    }),
    onSuccess: () => {
      toast.success('Campaign created as a draft');
      setShowForm(false); setName(''); setMessage(''); setCsvRecipients(null);
      qc.invalidateQueries({ queryKey: ['whatsapp-campaigns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not create campaign'),
  });

  const sendMut = useMutation({
    mutationFn: (id: string) => api.post(`/whatsapp/campaigns/${id}/send`),
    onSuccess: () => { toast.success('Campaign queued for sending'); qc.invalidateQueries({ queryKey: ['whatsapp-campaigns'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not send'),
  });

  const handleCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const rows = lines.slice(lines[0]?.toLowerCase().includes('phone') || lines[0]?.toLowerCase().includes('contact') ? 1 : 0)
        .map((l) => ({ contact: l.split(',')[0].trim() }))
        .filter((r) => r.contact);
      setCsvRecipients(rows);
      toast.success(`${rows.length} contacts loaded from CSV`);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'New Campaign'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Input placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="w-full border rounded-md p-2 text-sm" rows={3} placeholder="Message text" value={message} onChange={(e) => setMessage(e.target.value)} />
            {!csvRecipients ? (
              <div className="flex gap-2 items-center">
                <Label className="text-xs">Recipients:</Label>
                <select value={segment} onChange={(e) => setSegment(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  <option value="all">All parties</option>
                  <option value="customers">Customers only</option>
                  <option value="suppliers">Suppliers only</option>
                  <option value="with_dues">Parties with dues</option>
                </select>
                <span className="text-xs text-muted-foreground">or</span>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}><Upload className="w-3.5 h-3.5" /> Upload CSV</Button>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs bg-muted/40 rounded-md p-2">
                <span>{csvRecipients.length} contacts from CSV</span>
                <button className="text-red-600 hover:underline" onClick={() => setCsvRecipients(null)}>Remove</button>
              </div>
            )}
            <Button size="sm" disabled={!name.trim() || !message.trim() || createMut.isPending} onClick={() => createMut.mutate()}>Create Draft</Button>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
      {!isLoading && campaigns.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No campaigns yet.</p>}
      {campaigns.map((c: any) => (
        <Card key={c.id}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.recipient_count} recipients · {c.sent_count} sent · {c.failed_count} failed</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={c.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : c.status === 'draft' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}>{c.status}</Badge>
              {c.status === 'draft' && <Button size="sm" onClick={() => sendMut.mutate(c.id)} disabled={sendMut.isPending}>Send</Button>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LogsTab() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-logs', status, search],
    queryFn: () => api.get('/whatsapp/logs', { params: { status: status || undefined, search: search || undefined } }).then((r) => r.data),
  });
  const logs = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Search phone or name…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
            <th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Sent At</th><th className="px-3 py-2">Error</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && logs.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No messages logged yet.</td></tr>}
            {logs.map((l: any) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">{l.recipient_name || l.recipient_phone}</td>
                <td className="px-3 py-2 capitalize">{l.message_type || '—'}</td>
                <td className="px-3 py-2"><Badge className={l.status === 'sent' || l.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : l.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}>{l.status}</Badge></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{l.sent_at ? formatDate(l.sent_at) : formatDate(l.created_at)}</td>
                <td className="px-3 py-2 text-xs text-red-600">{l.error_message || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
