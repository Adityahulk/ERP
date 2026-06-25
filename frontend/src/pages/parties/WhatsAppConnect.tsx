import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { useCompany } from '@/hooks/useBusiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageCircle, CheckCircle2, XCircle, Megaphone, Users, Zap, ShieldCheck,
  Settings as SettingsIcon, History, FileText, BellRing,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

const AUTO_SHARE_KEY = 'erp_whatsapp_auto_share';

const BENEFITS = [
  { icon: Zap, title: 'Instant invoice sharing', desc: 'Send sale invoices, estimates, and payment receipts to customers in one tap.' },
  { icon: BellRing, title: 'Automatic payment reminders', desc: 'Nudge customers with overdue balances without making a single phone call.' },
  { icon: ShieldCheck, title: 'Business-grade delivery', desc: "Messages are sent through your registered WhatsApp Business API number via Twilio." },
  { icon: Users, title: 'Stay in the conversation', desc: 'Customers can reply on WhatsApp the same way they already talk to you.' },
];

const TEMPLATES = [
  { key: 'INVOICE_SHARE', label: 'Invoice Share', desc: 'Sent when you tap "WhatsApp" on a sale invoice — includes the invoice link and amount due.' },
  { key: 'PAYMENT_REMINDER', label: 'Payment Reminder', desc: 'Sent from Parties → bulk reminder, to customers with an outstanding balance.' },
];

export default function WhatsAppConnect() {
  const { data: company, isLoading: companyLoading } = useCompany();
  const [testPhone, setTestPhone] = useState('');
  const testMessageMut = useMutation({
    mutationFn: (phone: string) => api.post('/notifications/whatsapp-test', { phone }),
    onSuccess: (res: any) => {
      const delivered = res.data?.data?.delivered;
      if (delivered) toast.success('Test message sent — check WhatsApp on that number.');
      else toast.error(`Could not deliver: ${res.data?.data?.reason || 'unknown reason'}. Check Twilio configuration in Settings.`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to send test message'),
  });
  const [autoShare, setAutoShare] = useState(false);

  useEffect(() => {
    try { setAutoShare(localStorage.getItem(AUTO_SHARE_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  const toggleAutoShare = (checked: boolean) => {
    setAutoShare(checked);
    try { localStorage.setItem(AUTO_SHARE_KEY, checked ? '1' : '0'); } catch { /* ignore */ }
    toast.success(checked ? 'WhatsApp will be suggested by default when you share invoices' : 'Auto-share preference turned off');
  };

  // Real activity feed — same /notifications/logs endpoint used elsewhere,
  // filtered to the whatsapp channel.
  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['whatsapp-connect-logs'],
    queryFn: () => api.get('/notifications/logs').then((r) => r.data?.data ?? []),
  });
  const waLogs: any[] = (Array.isArray(logs) ? logs : []).filter((l: any) => l.channel === 'whatsapp').slice(0, 10);

  const phone: string | undefined = (company as any)?.phone;
  const isConfigured = !!phone;
  const waLink = phone ? `https://wa.me/${String(phone).replace(/\D/g, '')}` : '';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="w-6 h-6 text-emerald-600" /> WhatsApp Connect</h1>
          <p className="text-muted-foreground text-sm mt-1">Reach customers on WhatsApp directly from your invoices and follow-ups.</p>
        </div>
        <Link to="/whatsapp" className="text-sm font-medium text-indigo-600 hover:underline whitespace-nowrap mt-1">
          Campaigns, Logs &amp; Twilio Settings →
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* LEFT — illustration, benefits, feature explanation */}
        <div className="space-y-5">
          <Card className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white border-emerald-100">
            <CardContent className="p-8 flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-3xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-200 mb-4">
                <MessageCircle className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">Sell, remind, and support — on WhatsApp</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                Microtechnique Accounts sends invoices and payment reminders straight to your customers'
                WhatsApp, using your business's WhatsApp number.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Why connect WhatsApp</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {BENEFITS.map((b) => (
                <div key={b.title} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><b.icon className="w-4.5 h-4.5" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{b.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{b.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — QR card, status, instructions, controls */}
        <div className="space-y-5">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Connection status</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {companyLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className={`flex items-center gap-3 p-3 rounded-xl border ${isConfigured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  {isConfigured ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> : <XCircle className="w-5 h-5 text-amber-600 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${isConfigured ? 'text-emerald-800' : 'text-amber-800'}`}>
                      {isConfigured ? 'WhatsApp messaging is set up' : 'No business phone number set'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {isConfigured ? `Sending as ${company?.name} · ${phone}` : 'Add a business phone number in Settings to enable WhatsApp sharing'}
                    </p>
                  </div>
                  {!isConfigured && (
                    <Button asChild size="sm" variant="outline"><Link to="/settings">Open Settings</Link></Button>
                  )}
                </div>
              )}

              {/* Customer-facing chat QR — a real, working wa.me deep link, not an
                  account-linking code. Scanning it opens a WhatsApp chat with this
                  business's number, the same way a "Chat with us" sticker would. */}
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2">
                <span className="font-bold shrink-0">Note:</span>
                <span>This QR opens a WhatsApp <strong>chat</strong> with your business number when a customer scans it — it is <strong>not</strong> a "Link a Device" / WhatsApp Web pairing code. If you scan it with WhatsApp's device-linking scanner, WhatsApp will correctly reject it as invalid, because it isn't meant for that. Message sending below works through Twilio's API directly and needs no device pairing at all.</span>
              </div>

              <div className="flex flex-col items-center py-2">
                {isConfigured ? (
                  <>
                    <div className="p-3 bg-white rounded-xl border">
                      <QRCodeSVG value={waLink} size={148} level="M" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 text-center max-w-xs">
                      Customers can scan this to start a WhatsApp chat with your business directly.
                      Print it on receipts, counters, or packaging.
                    </p>
                  </>
                ) : (
                  <div className="w-[148px] h-[148px] rounded-xl border-2 border-dashed flex items-center justify-center text-muted-foreground text-xs text-center p-4">
                    Set a business phone number to generate your chat QR code
                  </div>
                )}
              </div>

              {isConfigured && (
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">Quick send</p>
                  {[
                    { key: 'invoice', label: 'Send Invoice', endpoint: (id: string) => `/notifications/send-invoice/${id}`, searchPath: '/invoices', placeholder: 'Search invoice number…' },
                    { key: 'reminder', label: 'Send Payment Reminder', endpoint: (id: string) => `/notifications/send-reminder/${id}`, searchPath: '/invoices', placeholder: 'Search invoice number…' },
                    { key: 'receipt', label: 'Send Receipt', endpoint: (id: string) => `/notifications/send-receipt/${id}`, searchPath: '/payments', placeholder: 'Search payment number…' },
                  ].map((action) => (
                    <QuickSendRow key={action.key} {...action} />
                  ))}
                </div>
              )}

              <div className="border-t pt-4 space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Send a test message</p>
                  <p className="text-xs text-muted-foreground">Verifies your Twilio WhatsApp setup actually delivers, end to end — separate from the chat QR above.</p>
                  <div className="flex gap-2">
                    <Input placeholder="Recipient's WhatsApp number" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className="text-sm" />
                    <Button size="sm" disabled={!testPhone.trim() || testMessageMut.isPending} onClick={() => testMessageMut.mutate(testPhone.trim())}>
                      {testMessageMut.isPending ? 'Sending…' : 'Send Test'}
                    </Button>
                  </div>
              </div>

              <div className="border-t pt-4 space-y-2 text-xs text-muted-foreground">
                <p className="font-semibold text-slate-700 text-sm mb-1">How sending works here</p>
                <p>1. Outgoing messages (invoice links, payment reminders) are sent via your WhatsApp Business API number, configured by your Microtechnique administrator.</p>
                <p>2. The QR code above is for customers to message <em>you</em> — it doesn't need a phone-linking step like personal WhatsApp Web.</p>
                <p>3. Update your business phone number any time from Settings → Company Profile.</p>
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  <p className="text-sm font-medium">Default to WhatsApp when sharing</p>
                  <p className="text-xs text-muted-foreground">Applies the next time you use the share button on an invoice (saved on this device).</p>
                </div>
                <Switch checked={autoShare} onCheckedChange={toggleAutoShare} />
              </div>
            </CardContent>
          </Card>

          {/* Message Template Settings */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><SettingsIcon className="w-4 h-4" /> Message Template Settings</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {TEMPLATES.map((t) => (
                <div key={t.key} className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-slate-50/60">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">{t.label} <Badge variant="outline" className="text-[9px]">{t.key}</Badge></p>
                    <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-1" />
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground pt-1">Template wording is managed by your administrator and applies to every WhatsApp message of that type.</p>
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Recent WhatsApp Activity</CardTitle></CardHeader>
            <CardContent className="p-0">
              {logsLoading && <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
              {!logsLoading && waLogs.length === 0 && (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No WhatsApp messages sent yet
                </div>
              )}
              {!logsLoading && waLogs.length > 0 && (
                <div className="divide-y">
                  {waLogs.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-muted-foreground" />{l.template_type || 'Message'}</p>
                        <p className="text-xs text-muted-foreground truncate">{l.recipient || '—'}</p>
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {l.created_at ? new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickSendRow({ label, endpoint, searchPath, placeholder }: { label: string; endpoint: (id: string) => string; searchPath: string; placeholder: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const sendMut = useMutation({
    mutationFn: () => api.post(endpoint(selected.id), phone ? { phone } : {}),
    onSuccess: (res: any) => {
      const delivered = res.data?.data?.delivered;
      if (delivered) toast.success(`${label} sent successfully.`);
      else toast.error(`Could not deliver: ${res.data?.data?.reason || 'unknown reason'}.`);
      setSelected(null); setQuery(''); setPhone('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || `Failed to send`),
  });

  const search = async (q: string) => {
    setQuery(q);
    setSelected(null);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await api.get(searchPath, { params: { search: q, limit: 5 } });
      const payload = res.data?.data;
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      setResults(rows);
    } catch { setResults([]); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {!selected ? (
        <div className="relative">
          <Input placeholder={placeholder} value={query} onChange={(e) => search(e.target.value)} className="text-sm h-9" />
          {results.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {results.map((r: any) => (
                <button key={r.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between" onClick={() => { setSelected(r); setResults([]); }}>
                  <span>{r.invoice_number || r.payment_number || r.id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{r.party_name || r.party_display || ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2 items-center">
          <div className="flex-1 text-sm bg-muted/40 rounded-md px-2.5 py-1.5">
            {selected.invoice_number || selected.payment_number} — {selected.party_name || 'No phone on file'}
          </div>
          <Input placeholder="Override phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} className="text-xs h-9 w-40" />
          <Button size="sm" disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>{sendMut.isPending ? 'Sending…' : 'Send'}</Button>
          <button className="text-xs text-muted-foreground hover:underline" onClick={() => setSelected(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
