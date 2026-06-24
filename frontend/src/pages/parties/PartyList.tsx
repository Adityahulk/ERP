import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useParties, useParty, useCreateParty, useUpdateParty, useDeleteParty, usePartyStatement,
} from '@/hooks/useBusiness';
import { formatMoney, formatDate, paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Search, Users, UserPlus, Trash2, Phone, Mail, MessageCircle, Edit2,
  FileText, CreditCard, Loader2, Building2, MapPin, ShieldCheck, Hash, Receipt,
  StickyNote, FolderOpen, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}
function cleanMoneyPaise(value: unknown): number {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return 0;
  return rupeesToPaise(text);
}
function cleanDays(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700',
    unpaid: 'bg-red-100 text-red-700',
    partial: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-slate-100 text-slate-500',
    draft: 'bg-slate-100 text-slate-500',
    posted: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium capitalize ${colors[status] || 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

function PartyTypeTag({ type }: { type?: string }) {
  if (!type) return null;
  const map: Record<string, string> = {
    customer: 'bg-blue-100 text-blue-700',
    supplier: 'bg-purple-100 text-purple-700',
    both: 'bg-teal-100 text-teal-700',
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${map[type] || 'bg-slate-100 text-slate-600'}`}>
      {type}
    </span>
  );
}

export default function PartyList() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>(routeId);
  const [activeTab, setActiveTab] = useState('overview');
  const [showForm, setShowForm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (routeId) setSelectedId(routeId);
  }, [routeId]);

  const { data: listResp, isLoading: listLoading } = useParties({ page: 1, limit: 100, search: search || undefined });
  const parties = listResp?.data?.data || [];
  const meta = listResp?.meta || {};

  const { data: partyRaw, isLoading: detailLoading, refetch } = useParty(selectedId);
  const party = (partyRaw as any)?.id ? (partyRaw as any) : null;

  const { data: statement } = usePartyStatement(activeTab === 'ledger' ? selectedId : undefined);

  const createMutation = useCreateParty();
  const updateMutation = useUpdateParty();
  const deleteMutation = useDeleteParty();

  // Auto-select the first party once the list loads, if nothing is selected yet.
  useEffect(() => {
    if (!selectedId && parties.length > 0) {
      setSelectedId(parties[0].id);
    }
  }, [parties, selectedId]);

  const selectParty = (id: string) => {
    setSelectedId(id);
    setActiveTab('overview');
    navigate(`/parties/${id}`, { replace: true });
  };

  const [form, setForm] = useState<any>({});
  const u = (f: string, v: any) => setForm((p: any) => ({ ...p, [f]: v }));

  const handleCreate = async () => {
    if (!form.name?.trim()) { toast.error('Name is required'); return; }
    const g = String(form.gstin || '').trim().toUpperCase();
    if (g.length > 0 && g.length !== 15) { toast.error('GSTIN must be exactly 15 characters, or leave it blank'); return; }
    try {
      const payload: Record<string, unknown> = { ...form, name: form.name.trim() };
      if (g.length === 15) payload.gstin = g; else delete payload.gstin;
      if (form.credit_limit !== undefined && form.credit_limit !== '') payload.credit_limit = rupeesToPaise(form.credit_limit);
      if (form.opening_balance !== undefined && form.opening_balance !== '') payload.opening_balance = rupeesToPaise(form.opening_balance);
      if (form.payment_terms !== undefined && form.payment_terms !== '') payload.payment_terms = parseInt(String(form.payment_terms), 10);
      else delete payload.payment_terms;
      const res = await createMutation.mutateAsync(payload);
      toast.success('Party created');
      setShowForm(false);
      setForm({});
      const newId = res?.data?.id || res?.id;
      if (newId) selectParty(newId);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const openEdit = () => {
    if (!party) return;
    setForm({
      name: party.name,
      phone: party.phone || '',
      email: party.email || '',
      gstin: party.gstin || '',
      pan: party.pan || '',
      billing_address: party.billing_address || '',
      city: party.billing_city || party.city || '',
      state: party.billing_state || party.state || '',
      pincode: party.billing_pincode || party.pincode || '',
      credit_limit: party.credit_limit ? paiseToRupees(party.credit_limit).toFixed(2) : '',
      credit_days: party.credit_days || party.payment_terms || 30,
      notes: party.notes || '',
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error('Name is required'); return; }
    const g = String(form.gstin || '').trim().toUpperCase();
    if (g.length > 0 && g.length !== 15) { toast.error('GSTIN must be exactly 15 characters, or leave it blank'); return; }
    try {
      const payload: any = {
        name: String(form.name || '').trim(),
        phone: cleanText(form.phone),
        email: cleanText(form.email),
        gstin: g.length === 15 ? g : null,
        pan: cleanText(form.pan ? String(form.pan).toUpperCase() : ''),
        billing_address: cleanText(form.billing_address),
        city: cleanText(form.city),
        state: cleanText(form.state),
        pincode: cleanText(form.pincode),
        credit_limit: cleanMoneyPaise(form.credit_limit),
        credit_days: cleanDays(form.credit_days),
        notes: cleanText(form.notes),
      };
      await updateMutation.mutateAsync({ id: selectedId!, data: payload });
      toast.success('Party updated');
      setEditOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to update');
    }
  };

  const runDeleteParty = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success('Deleted');
      if (pendingDelete.id === selectedId) setSelectedId(undefined);
      setPendingDelete(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const digitsOnlyPhone = (phone?: string) => {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `91${digits}`;
    else if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
    return digits;
  };

  const openWhatsApp = () => {
    if (!party?.phone) { toast.error('No phone number on file'); return; }
    const msg = encodeURIComponent(`Hello ${party.name},`);
    window.open(`https://wa.me/${digitsOnlyPhone(party.phone)}?text=${msg}`, '_blank', 'noopener,noreferrer');
  };

  const invoices: any[] = party?.invoices || [];
  const payments: any[] = party?.payments || [];
  const ledger = party?.ledger_summary || {};
  const totalDebit = parseInt(ledger.total_debit) || 0;
  const totalCredit = parseInt(ledger.total_credit) || 0;
  const balance = party?.balance || 0;

  // Unified transaction table: invoices + payments, merged and sorted by date (most recent first).
  const transactions = [
    ...invoices.map((inv) => ({
      kind: 'Sale' as const,
      id: inv.id,
      number: inv.invoice_number,
      date: inv.invoice_date,
      amount: parseInt(inv.total_amount) || 0,
      paid: (parseInt(inv.total_amount) || 0) - (parseInt(inv.balance_due) || 0),
      balance: parseInt(inv.balance_due) || 0,
      status: inv.payment_status || inv.status || 'draft',
      onClick: () => navigate(`/sales/${inv.id}`),
    })),
    ...payments.map((p) => ({
      kind: 'Payment' as const,
      id: p.id,
      number: p.payment_number || '—',
      date: p.payment_date,
      amount: parseInt(p.amount) || 0,
      paid: parseInt(p.amount) || 0,
      balance: 0,
      status: p.status || 'posted',
      onClick: undefined,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="h-[calc(100vh-60px)] flex -m-4 sm:-m-6 lg:-m-8 overflow-hidden">
      {/* LEFT PANEL — 30% */}
      <div className="w-[30%] min-w-[280px] max-w-[420px] border-r bg-white flex flex-col shrink-0">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Parties</h1>
            <Button size="sm" onClick={() => { setForm({}); setShowForm(true); }}>
              <UserPlus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search party name, phone, GSTIN…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-emerald-50 px-2.5 py-1.5">
              <p className="text-emerald-700 font-medium">Receivable</p>
              <p className="font-bold text-emerald-700 tabular-nums">{formatMoney(parseInt(meta.total_receivable) || 0)}</p>
            </div>
            <div className="rounded-lg bg-red-50 px-2.5 py-1.5">
              <p className="text-red-600 font-medium">Payable</p>
              <p className="font-bold text-red-600 tabular-nums">{formatMoney(parseInt(meta.total_payable) || 0)}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {listLoading && (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          )}
          {!listLoading && parties.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No parties found</p>
            </div>
          )}
          {parties.map((p: any) => {
            const isSelected = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectParty(p.id)}
                className={`w-full text-left px-4 py-3 border-b transition-colors flex items-center justify-between gap-2 ${
                  isSelected ? 'bg-indigo-50 border-l-[3px] border-l-indigo-600' : 'hover:bg-slate-50 border-l-[3px] border-l-transparent'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={`font-semibold text-sm truncate ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>{p.name}</p>
                    <PartyTypeTag type={p.party_type} />
                  </div>
                  {p.phone && <p className="text-xs text-muted-foreground truncate">{p.phone}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold tabular-nums ${p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    {p.balance !== 0 ? formatMoney(Math.abs(p.balance)) : '—'}
                  </p>
                  {p.balance !== 0 && <p className="text-[9px] text-muted-foreground">{p.balance > 0 ? 'receivable' : 'payable'}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT PANEL — 70% */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        {!selectedId && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Users className="w-12 h-12 mb-3 opacity-30" />
            <p>Select a party to see their details</p>
          </div>
        )}

        {selectedId && detailLoading && (
          <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        )}

        {selectedId && !detailLoading && !party && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <p>Party not found.</p>
          </div>
        )}

        {party && (
          <div className="p-5 space-y-5">
            {/* Header + action buttons */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold">{party.name}</h2>
                  <PartyTypeTag type={party.party_type} />
                  {!party.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {(party.billing_city || party.city) && `${party.billing_city || party.city}`}
                  {(party.billing_state || party.state) && `, ${party.billing_state || party.state}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={() => navigate(`/sales/new?party_id=${party.id}`)}>+ New Sale</Button>
                <Button size="sm" variant="outline" onClick={() => navigate(`/sales-hub/payment-in?party_id=${party.id}`)}>+ New Payment</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openEdit}><Edit2 className="w-3.5 h-3.5" /> Edit</Button>
                {party.phone && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={openWhatsApp}>
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </Button>
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a href={`tel:${party.phone}`}><Phone className="w-3.5 h-3.5" /> Call</a>
                    </Button>
                  </>
                )}
                {party.email && (
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={`mailto:${party.email}`}><Mail className="w-3.5 h-3.5" /> Email</a>
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete({ id: party.id, name: party.name })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: balance >= 0 ? 'Receivable' : 'Payable', value: formatMoney(Math.abs(balance)), color: balance > 0 ? 'text-emerald-600 bg-emerald-50' : balance < 0 ? 'text-red-500 bg-red-50' : 'text-slate-500 bg-slate-50', icon: Receipt },
                { label: 'Total Business', value: formatMoney(invoices.reduce((s, i) => s + (parseInt(i.total_amount) || 0), 0)), color: 'text-blue-600 bg-blue-50', icon: FileText },
                { label: 'Total Debited', value: formatMoney(totalDebit), color: 'text-orange-600 bg-orange-50', icon: Receipt },
                { label: 'Total Credited', value: formatMoney(totalCredit), color: 'text-violet-600 bg-violet-50', icon: CreditCard },
              ].map((c) => (
                <Card key={c.label} className="rounded-xl">
                  <CardContent className="p-3.5 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${c.color}`}><c.icon className="w-4 h-4" /></div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground truncate">{c.label}</p>
                      <p className="text-sm font-bold tabular-nums truncate">{c.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-white border">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="transactions">Transactions</TabsTrigger>
                <TabsTrigger value="ledger">Ledger</TabsTrigger>
                <TabsTrigger value="payments">Payment History</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="p-4 space-y-3 text-sm">
                      <h3 className="font-semibold flex items-center gap-2 text-slate-700"><Building2 className="w-4 h-4" /> Party Information</h3>
                      {party.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3.5 h-3.5" />{party.phone}</div>}
                      {party.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5" /><span className="truncate">{party.email}</span></div>}
                      {party.billing_address && (
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{party.billing_address}{(party.billing_city || party.city) && `, ${party.billing_city || party.city}`}{(party.billing_state || party.state) && `, ${party.billing_state || party.state}`}{(party.billing_pincode || party.pincode) && ` - ${party.billing_pincode || party.pincode}`}</span>
                        </div>
                      )}
                      {party.gstin && <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /><span className="font-mono text-xs">{party.gstin}</span></div>}
                      {party.pan && <div className="flex items-center gap-2"><Hash className="w-3.5 h-3.5" /><span className="font-mono text-xs">{party.pan}</span></div>}
                      {party.credit_limit > 0 && <div className="border-t pt-2 flex justify-between"><span className="text-muted-foreground">Credit Limit</span><span className="font-medium">{formatMoney(party.credit_limit)}</span></div>}
                      {(party.credit_days || party.payment_terms) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Payment Terms</span><span className="font-medium">{party.credit_days || party.payment_terms} days</span></div>}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <h3 className="font-semibold flex items-center gap-2 text-slate-700 mb-3"><CreditCard className="w-4 h-4" /> Recent Payments</h3>
                      {payments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No payments recorded</p> : (
                        <div className="divide-y">
                          {payments.slice(0, 5).map((p) => (
                            <div key={p.id} className="flex justify-between items-center py-2 text-sm">
                              <div><p className="font-medium text-xs">{p.payment_number || '—'}</p><p className="text-muted-foreground text-[11px]">{formatDate(p.payment_date)} · {p.payment_mode}</p></div>
                              <span className="font-semibold text-emerald-600 tabular-nums">{formatMoney(parseInt(p.amount) || 0)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="transactions" className="mt-4">
                <Card>
                  <CardContent className="p-0">
                    {transactions.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-10">No transactions yet</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-slate-50/70">
                              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Type</th>
                              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Invoice No</th>
                              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Date</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground hidden sm:table-cell">Paid</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Balance</th>
                              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {transactions.map((t) => (
                              <tr key={`${t.kind}-${t.id}`} className={t.onClick ? 'hover:bg-slate-50 cursor-pointer' : ''} onClick={t.onClick}>
                                <td className="px-4 py-2.5"><span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${t.kind === 'Sale' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{t.kind}</span></td>
                                <td className="px-4 py-2.5 font-medium text-indigo-700">{t.number}</td>
                                <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{formatDate(t.date)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(t.amount)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{formatMoney(t.paid)}</td>
                                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${t.balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{t.balance > 0 ? formatMoney(t.balance) : '✓'}</td>
                                <td className="px-4 py-2.5 text-center"><StatusBadge status={t.status} /></td>
                                <td className="px-4 py-2.5 text-right">{t.onClick && <ChevronRight className="w-4 h-4 text-muted-foreground inline" />}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ledger" className="mt-4">
                <Card>
                  <CardContent className="p-0">
                    {!statement || statement.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-10">No ledger entries yet</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-slate-50/70">
                              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
                              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Narration</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Debit</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Credit</th>
                              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Balance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {statement.map((l: any) => (
                              <tr key={l.id}>
                                <td className="px-4 py-2.5 text-muted-foreground">{formatDate(l.created_at)}</td>
                                <td className="px-4 py-2.5">{l.narration || l.reference_type || '—'}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{l.type === 'debit' ? formatMoney(parseInt(l.amount) || 0) : ''}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{l.type === 'credit' ? formatMoney(parseInt(l.amount) || 0) : ''}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatMoney(parseInt(l.balance_after) || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="payments" className="mt-4">
                <Card>
                  <CardContent className="p-0">
                    {payments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10">No payments recorded</p> : (
                      <div className="divide-y">
                        {payments.map((p) => (
                          <div key={p.id} className="flex justify-between items-center px-4 py-3 text-sm">
                            <div><p className="font-medium">{p.payment_number || '—'}</p><p className="text-muted-foreground text-xs">{formatDate(p.payment_date)} · {p.payment_mode}</p></div>
                            <span className="font-bold text-emerald-600 tabular-nums">{formatMoney(parseInt(p.amount) || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <Card>
                  <CardContent className="p-10 text-center text-muted-foreground">
                    <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No documents yet</p>
                    <p className="text-xs mt-1">Document uploads for parties aren't available in this version.</p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <Card>
                  <CardContent className="p-5">
                    {party.notes ? (
                      <p className="text-sm whitespace-pre-wrap">{party.notes}</p>
                    ) : (
                      <div className="text-center text-muted-foreground py-6">
                        <StickyNote className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No notes yet</p>
                        <Button variant="link" size="sm" onClick={openEdit}>Add a note</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* New party sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader className="mb-6"><SheetTitle>New party</SheetTitle></SheetHeader>
          <p className="text-sm text-muted-foreground -mt-2 mb-4">Name is required. GSTIN and everything else are optional and can be edited later.</p>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => u('name', e.target.value)} autoFocus /></div>
            <div><Label>GSTIN (optional)</Label><Input className="mt-1 uppercase font-mono" maxLength={15} value={form.gstin || ''} onChange={(e) => u('gstin', e.target.value.toUpperCase())} placeholder="15-character GSTIN" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input className="mt-1" value={form.phone || ''} onChange={(e) => u('phone', e.target.value)} /></div>
              <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email || ''} onChange={(e) => u('email', e.target.value)} /></div>
            </div>
            <div><Label>PAN</Label><Input className="mt-1 uppercase font-mono" maxLength={10} value={form.pan || ''} onChange={(e) => u('pan', e.target.value.toUpperCase())} /></div>
            <div><Label>Billing address</Label><textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={form.billing_address || ''} onChange={(e) => u('billing_address', e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>City</Label><Input className="mt-1" value={form.city || ''} onChange={(e) => u('city', e.target.value)} /></div>
              <div><Label>State</Label><Input className="mt-1" value={form.state || ''} onChange={(e) => u('state', e.target.value)} /></div>
              <div><Label>Pincode</Label><Input className="mt-1" maxLength={6} value={form.pincode || ''} onChange={(e) => u('pincode', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Credit limit (₹)</Label><Input className="mt-1" type="number" min={0} step={0.01} value={form.credit_limit || ''} onChange={(e) => u('credit_limit', e.target.value)} /></div>
              <div><Label>Payment terms (days)</Label><Input className="mt-1" type="text" inputMode="numeric" value={form.payment_terms ?? ''} onChange={(e) => u('payment_terms', e.target.value.replace(/\D/g, ''))} placeholder="30" /></div>
            </div>
            <div>
              <Label>Opening balance (₹)</Label>
              <span className="text-muted-foreground text-[10px] ml-1">(+ve = receivable, −ve = payable)</span>
              <Input className="mt-1" type="number" step={0.01} value={form.opening_balance || ''} onChange={(e) => u('opening_balance', e.target.value)} />
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending} onClick={handleCreate}>Save party</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit party sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="overflow-y-auto w-full max-w-md">
          <SheetHeader className="mb-5"><SheetTitle>Edit Party — {party?.name}</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input className="mt-1" value={form.phone || ''} onChange={(e) => setForm((p: any) => ({ ...p, phone: e.target.value }))} /></div>
              <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email || ''} onChange={(e) => setForm((p: any) => ({ ...p, email: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>GSTIN (optional)</Label><Input className="mt-1 font-mono uppercase" maxLength={15} value={form.gstin || ''} onChange={(e) => setForm((p: any) => ({ ...p, gstin: e.target.value.toUpperCase() }))} /></div>
              <div><Label>PAN</Label><Input className="mt-1 font-mono uppercase" maxLength={10} value={form.pan || ''} onChange={(e) => setForm((p: any) => ({ ...p, pan: e.target.value.toUpperCase() }))} /></div>
            </div>
            <div><Label>Billing Address</Label><textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={form.billing_address || ''} onChange={(e) => setForm((p: any) => ({ ...p, billing_address: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>City</Label><Input className="mt-1" value={form.city || ''} onChange={(e) => setForm((p: any) => ({ ...p, city: e.target.value }))} /></div>
              <div><Label>State</Label><Input className="mt-1" value={form.state || ''} onChange={(e) => setForm((p: any) => ({ ...p, state: e.target.value }))} /></div>
              <div><Label>Pincode</Label><Input className="mt-1" maxLength={6} value={form.pincode || ''} onChange={(e) => setForm((p: any) => ({ ...p, pincode: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Credit Limit (₹)</Label><Input className="mt-1" type="number" min={0} step={0.01} value={form.credit_limit || ''} onChange={(e) => setForm((p: any) => ({ ...p, credit_limit: e.target.value }))} /></div>
              <div><Label>Payment Terms (days)</Label><Input className="mt-1" type="text" inputMode="numeric" value={form.credit_days ?? ''} onChange={(e) => setForm((p: any) => ({ ...p, credit_days: e.target.value.replace(/\D/g, '') }))} placeholder="30" /></div>
            </div>
            <div><Label>Notes</Label><textarea rows={3} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={form.notes || ''} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Internal notes about this party…" /></div>
            <div className="flex gap-3 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button className="flex-1" loading={updateMutation.isPending} onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete party?"
        description={pendingDelete ? `Remove "${pendingDelete.name}". Invoices or balances may block deletion.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={runDeleteParty}
      />
    </div>
  );
}
