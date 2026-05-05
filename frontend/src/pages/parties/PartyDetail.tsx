import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useParty, useUpdateParty } from '@/hooks/useBusiness';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  ArrowLeft, Edit2, MessageCircle, Phone, Mail, MapPin,
  Building2, FileText, CreditCard, TrendingUp, Loader2,
  Receipt, IndianRupee, ShieldCheck, Hash
} from 'lucide-react';
import toast from 'react-hot-toast';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700',
    unpaid: 'bg-red-100 text-red-700',
    partial: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-slate-100 text-slate-500',
    draft: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium capitalize ${colors[status] || 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

export default function PartyDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: raw, isLoading, refetch, isError } = useParty(id);
  const updateMutation = useUpdateParty();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  /** useParty returns the party payload (same unwrap as invoice detail), not the full { success, data } envelope */
  const party = (raw as any)?.id != null ? (raw as any) : null;

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
      credit_limit: party.credit_limit || '',
      credit_days: party.credit_days || party.payment_terms || 30,
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast.error('Name is required');
      return;
    }
    const g = String(form.gstin || '')
      .trim()
      .toUpperCase();
    if (g.length > 0 && g.length !== 15) {
      toast.error('GSTIN must be exactly 15 characters, or leave it blank');
      return;
    }
    try {
      const payload: any = { ...form, gstin: g.length === 15 ? g : null };
      if (payload.credit_limit !== '') payload.credit_limit = Math.round(parseFloat(payload.credit_limit));
      await updateMutation.mutateAsync({ id: id!, data: payload });
      toast.success('Party updated');
      setEditOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to update');
    }
  };

  const openWhatsApp = () => {
    if (!party?.phone) { toast.error('No phone number on file'); return; }
    // Strip all non-digits
    let digits = String(party.phone).replace(/\D/g, '');
    // If already starts with 91 and is 12 digits, use as-is; otherwise prepend 91 (India)
    if (digits.length === 10) digits = `91${digits}`;
    else if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
    // If still not valid (not 12 digits starting with 91), try opening with just the number
    const msg = encodeURIComponent(`Hello ${party.name},`);
    window.open(`https://wa.me/${digits}?text=${msg}`, '_blank', 'noopener,noreferrer');
  };

  if (!id || id === 'undefined' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Invalid party link.{' '}
        <button type="button" className="text-primary underline" onClick={() => navigate('/parties')}>
          Go back
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !party) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Party not found.{' '}
        <button type="button" className="text-primary underline" onClick={() => navigate('/parties')}>
          Go back
        </button>
      </div>
    );
  }

  const invoices: any[] = party.invoices || [];
  const payments: any[] = party.payments || [];
  const ledger = party.ledger_summary || {};

  const totalDebit = parseInt(ledger.total_debit) || 0;
  const totalCredit = parseInt(ledger.total_credit) || 0;
  const balance = party.balance || 0;
  const isReceivable = balance > 0;
  const isPayable = balance < 0;

  const summaryCards = [
    {
      label: balance >= 0 ? 'Receivable' : 'Payable',
      value: formatMoney(Math.abs(balance)),
      sub: balance === 0 ? 'Settled' : balance > 0 ? 'You will receive' : 'You owe',
      icon: IndianRupee,
      color: isReceivable ? 'text-emerald-600 bg-emerald-50' : isPayable ? 'text-red-500 bg-red-50' : 'text-slate-500 bg-slate-50',
    },
    {
      label: 'Total Business',
      value: formatMoney(invoices.reduce((s: number, inv: any) => s + (parseInt(inv.total_amount) || 0), 0)),
      sub: `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`,
      icon: TrendingUp,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: 'Total Debited',
      value: formatMoney(totalDebit),
      sub: 'All charges',
      icon: Receipt,
      color: 'text-orange-600 bg-orange-50',
    },
    {
      label: 'Total Credited',
      value: formatMoney(totalCredit),
      sub: 'All payments',
      icon: CreditCard,
      color: 'text-violet-600 bg-violet-50',
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/parties')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{party.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200">
                Party
              </span>
              {!party.is_active && (
                <Badge variant="outline" className="text-[10px]">Inactive</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {(party.billing_city || party.city) && `${party.billing_city || party.city}`}
              {(party.billing_state || party.state) && `, ${party.billing_state || party.state}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {party.phone && (
            <Button variant="outline" size="sm" className="gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={openWhatsApp}>
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={openEdit}>
            <Edit2 className="w-4 h-4" />
            Edit Party
          </Button>
          <Button size="sm" onClick={() => navigate(`/sales/new?party_id=${party.id}`)}>
            + New invoice
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/new?party_id=${party.id}`)}>
            + Purchase order
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.color}`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-base font-bold tabular-nums truncate">{c.value}</p>
                <p className="text-[10px] text-muted-foreground">{c.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Party Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Party Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {party.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{party.phone}</span>
              </div>
            )}
            {party.email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{party.email}</span>
              </div>
            )}
            {party.billing_address && (
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  {party.billing_address}
                  {(party.billing_city || party.city) && <>, {party.billing_city || party.city}</>}
                  {(party.billing_state || party.state) && <>, {party.billing_state || party.state}</>}
                  {(party.billing_pincode || party.pincode) && <> - {party.billing_pincode || party.pincode}</>}
                </span>
              </div>
            )}
            {party.gstin && (
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                <span className="font-mono text-xs tracking-wide">{party.gstin}</span>
                <Badge variant="outline" className="text-[9px] py-0 px-1">GSTIN</Badge>
              </div>
            )}
            {party.pan && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-mono text-xs">{party.pan}</span>
                <Badge variant="outline" className="text-[9px] py-0 px-1">PAN</Badge>
              </div>
            )}
            {party.credit_limit > 0 && (
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-muted-foreground">Credit Limit</span>
                <span className="font-medium">{formatMoney(party.credit_limit)}</span>
              </div>
            )}
            {party.credit_days > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payment Terms</span>
                <span className="font-medium">{party.credit_days} days</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Payments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> Recent Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">No payments recorded</p>
            ) : (
              <div className="divide-y">
                {payments.slice(0, 5).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-xs">{p.payment_number || '—'}</p>
                      <p className="text-muted-foreground text-[11px]">{formatDate(p.payment_date)} · {p.payment_mode}</p>
                    </div>
                    <span className="font-semibold text-emerald-600 tabular-nums">{formatMoney(parseInt(p.amount) || 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" /> Recent Invoices
          </CardTitle>
          {invoices.length > 0 && (
            <Link to={`/sales?party_id=${party.id}`} className="text-xs text-primary hover:underline">View all</Link>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">No invoices yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Invoice</th>
                    <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Date</th>
                    <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((inv: any) => (
                    <tr
                      key={inv.id}
                      className="hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/sales/${inv.id}`)}
                    >
                      <td className="px-4 py-2.5 font-medium text-primary">{inv.invoice_number}</td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusBadge status={inv.payment_status || inv.status || 'draft'} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(inv.total_amount) || 0)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${parseInt(inv.balance_due) > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {parseInt(inv.balance_due) > 0 ? formatMoney(parseInt(inv.balance_due)) : '✓ Paid'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Party Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="overflow-y-auto w-full max-w-md">
          <SheetHeader className="mb-5">
            <SheetTitle>Edit Party — {party.name}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input className="mt-1" value={form.name || ''} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input className="mt-1" value={form.phone || ''} onChange={(e) => setForm((p: any) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input className="mt-1" type="email" value={form.email || ''} onChange={(e) => setForm((p: any) => ({ ...p, email: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>GSTIN (optional)</Label>
                <Input
                  className="mt-1 font-mono uppercase"
                  maxLength={15}
                  value={form.gstin || ''}
                  onChange={(e) => setForm((p: any) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                />
              </div>
              <div>
                <Label>PAN</Label>
                <Input className="mt-1 font-mono uppercase" maxLength={10} value={form.pan || ''} onChange={(e) => setForm((p: any) => ({ ...p, pan: e.target.value.toUpperCase() }))} />
              </div>
            </div>

            <div>
              <Label>Billing Address</Label>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none"
                value={form.billing_address || ''}
                onChange={(e) => setForm((p: any) => ({ ...p, billing_address: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>City</Label>
                <Input className="mt-1" value={form.city || ''} onChange={(e) => setForm((p: any) => ({ ...p, city: e.target.value }))} />
              </div>
              <div>
                <Label>State</Label>
                <Input className="mt-1" value={form.state || ''} onChange={(e) => setForm((p: any) => ({ ...p, state: e.target.value }))} />
              </div>
              <div>
                <Label>Pincode</Label>
                <Input className="mt-1" maxLength={6} value={form.pincode || ''} onChange={(e) => setForm((p: any) => ({ ...p, pincode: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Credit Limit (₹)</Label>
                <Input className="mt-1" type="number" min={0} value={form.credit_limit || ''} onChange={(e) => setForm((p: any) => ({ ...p, credit_limit: e.target.value }))} />
              </div>
              <div>
                <Label>Payment Terms (days)</Label>
                <Input className="mt-1" type="number" min={0} value={form.credit_days || 30} onChange={(e) => setForm((p: any) => ({ ...p, credit_days: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button className="flex-1" loading={updateMutation.isPending} onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
