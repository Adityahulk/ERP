import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight, ArrowUpRight, Landmark, Plus, FileSpreadsheet, RefreshCcw,
  CheckCircle2, XCircle, Ban, Wallet, Building2, ArrowLeftRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDate, formatMoney } from '@/lib/formatters';
import MoneyInput from '@/components/transactions/MoneyInput';

type View = 'banks' | 'cash' | 'cheques' | 'loans' | 'transfers' | 'reconciliation';

function ChequeStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    deposited: 'bg-blue-100 text-blue-700',
    cleared: 'bg-emerald-100 text-emerald-700',
    bounced: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-200 text-slate-500',
  };
  return <Badge variant="secondary" className={`text-[10px] capitalize ${map[status] || ''}`}>{status}</Badge>;
}

export default function CashBankPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('banks');
  const [selectedBankId, setSelectedBankId] = useState('cash');
  const [bankFormOpen, setBankFormOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<any | null>(null);
  const [adjustType, setAdjustType] = useState<'bank_deposit' | 'bank_withdrawal'>('bank_deposit');
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustRef, setAdjustRef] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['cash-bank'] });

  const { data: summary } = useQuery({
    queryKey: ['cash-bank', 'summary'],
    queryFn: async () => (await api.get('/accounting/cash-bank/summary')).data?.data,
  });

  const { data: loanAccounts = [] } = useQuery({
    queryKey: ['cash-bank', 'loans'],
    queryFn: async () => (await api.get('/accounting/cash-bank/loans')).data?.data || [],
    enabled: view === 'loans',
  });

  const { data: cheques = [] } = useQuery({
    queryKey: ['cash-bank', 'cheques'],
    queryFn: async () => (await api.get('/accounting/cash-bank/cheques')).data?.data || [],
    enabled: view === 'cheques',
  });

  const { data: transfers = [] } = useQuery({
    queryKey: ['cash-bank', 'transfers'],
    queryFn: async () => (await api.get('/accounting/cash-bank/transfers')).data?.data || [],
    enabled: view === 'transfers',
  });

  const { data: reconciliations = [] } = useQuery({
    queryKey: ['cash-bank', 'reconciliations'],
    queryFn: async () => (await api.get('/accounting/cash-bank/reconciliations')).data?.data || [],
    enabled: view === 'reconciliation',
  });

  const selectedBank = summary?.bank_accounts?.find((b: any) => b.id === selectedBankId);
  const transactions = useMemo(() => {
    const rows = summary?.recent_transactions || [];
    if (selectedBankId === 'cash') return rows.filter((r: any) => Number(r.signed_cash_amount || 0) !== 0 || r.payment_mode === 'cash');
    if (selectedBankId === 'unassigned') return rows.filter((r: any) => !r.company_bank_account_id && ['bank_transfer', 'neft', 'rtgs', 'upi', 'online', 'card', 'cheque'].includes(r.payment_mode));
    return rows.filter((r: any) => r.company_bank_account_id === selectedBankId);
  }, [summary?.recent_transactions, selectedBankId]);

  const adjustMutation = useMutation({
    mutationFn: (payload: any) => api.post('/accounting/cash-bank/adjustment', payload),
    onSuccess: () => {
      toast.success(adjustType === 'bank_deposit' ? 'Cash deposit recorded' : 'Cash withdrawal recorded');
      setAdjustAmount(0); setAdjustRef(''); setAdjustNotes('');
      invalidateAll();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save cash/bank entry'),
  });

  const saveAdjustment = () => {
    if (!selectedBank?.id || adjustAmount <= 0) { toast.error('Select a bank account and enter amount'); return; }
    adjustMutation.mutate({
      type: adjustType, company_bank_account_id: selectedBank.id, amount: adjustAmount,
      reference_number: adjustRef || undefined, notes: adjustNotes || undefined,
    });
  };

  const chequeAction = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: any }) => api.post(`/accounting/cash-bank/cheques/${id}/${action}`, body || {}),
    onSuccess: () => { toast.success('Cheque updated'); qc.invalidateQueries({ queryKey: ['cash-bank', 'cheques'] }); invalidateAll(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="h-full bg-slate-50">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cash & Bank</h1>
            <p className="text-sm text-slate-500">Bank accounts, cash in hand, cheques, loans, transfers, and reconciliation.</p>
          </div>
          <Button onClick={() => { setEditingBank(null); setBankFormOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Bank Account
          </Button>
        </div>
      </div>

      <div className="grid h-[calc(100vh-132px)] grid-cols-[340px_minmax(0,1fr)] overflow-hidden bg-white">
        <aside className="border-r">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-bold">Accounts</h2>
            <Landmark className="h-4 w-4 text-slate-500" />
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {([
              ['banks', 'Banks'], ['cash', 'Cash'], ['cheques', 'Cheques'],
              ['loans', 'Loans'], ['transfers', 'Transfers'], ['reconciliation', 'Reconcile'],
            ] as [View, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setView(key)} className={`rounded-md border px-3 py-2 text-sm ${view === key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'bg-white'}`}>
                {label}
              </button>
            ))}
          </div>
          {(view === 'banks' || view === 'cash') && (
            <div className="h-[calc(100vh-250px)] overflow-y-auto px-3 pb-3">
              <button className={`mb-2 flex w-full justify-between rounded-md border p-3 text-left ${selectedBankId === 'cash' ? 'bg-sky-50' : ''}`} onClick={() => setSelectedBankId('cash')}>
                <span>Cash in Hand</span><b>{formatMoney(summary?.cash_in_hand || 0)}</b>
              </button>
              {(summary?.bank_accounts || []).map((b: any) => (
                <button key={b.id} className={`mb-2 w-full rounded-md border p-3 text-left ${selectedBankId === b.id ? 'bg-sky-50' : ''}`} onClick={() => setSelectedBankId(b.id)}>
                  <div className="flex justify-between gap-3">
                    <span className="font-medium flex items-center gap-1.5">
                      {b.account_type === 'upi' ? <Wallet className="w-3.5 h-3.5 text-muted-foreground" /> : <Building2 className="w-3.5 h-3.5 text-muted-foreground" />}
                      {b.account_label || b.bank_name}
                    </span>
                    <b>{formatMoney(Number(b.balance || 0))}</b>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{b.bank_name} {b.account_number ? `- ${b.account_number}` : ''}</p>
                  <button className="mt-1.5 text-[11px] text-indigo-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditingBank(b); setBankFormOpen(true); }}>Edit details</button>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="min-w-0 overflow-y-auto">
          {(view === 'banks' || view === 'cash') && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                <div>
                  <h2 className="text-lg font-bold">{selectedBank?.account_label || selectedBank?.bank_name || 'Cash in Hand'}</h2>
                  <p className="text-sm text-slate-500">{selectedBank ? `${selectedBank.bank_name || ''} ${selectedBank.account_number || ''}` : 'Cash account'}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant={adjustType === 'bank_deposit' ? 'default' : 'outline'} onClick={() => setAdjustType('bank_deposit')}><ArrowDownRight className="mr-2 h-4 w-4" /> Deposit</Button>
                  <Button variant={adjustType === 'bank_withdrawal' ? 'default' : 'outline'} onClick={() => setAdjustType('bank_withdrawal')}><ArrowUpRight className="mr-2 h-4 w-4" /> Withdraw</Button>
                </div>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <Card>
                  <CardHeader><CardTitle className="text-base">{adjustType === 'bank_deposit' ? 'Deposit Cash' : 'Withdraw Cash'}</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Label>Amount<MoneyInput className="mt-1" value={adjustAmount} onChange={setAdjustAmount} /></Label>
                    <Label>Reference No.<Input className="mt-1" value={adjustRef} onChange={(e) => setAdjustRef(e.target.value)} /></Label>
                    <Label>Notes<Input className="mt-1" value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} /></Label>
                    <Button className="w-full" onClick={saveAdjustment} disabled={selectedBankId === 'cash'}>{selectedBankId === 'cash' ? 'Select a bank account' : 'Save'}</Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Transactions</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-auto">
                      <table className="w-full min-w-[620px] text-sm">
                        <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                        <tbody>
                          {transactions.map((t: any) => {
                            const amount = Number(t.signed_bank_amount || t.signed_cash_amount || t.amount || 0);
                            return <tr key={t.id} className="border-t"><td className="px-3 py-2 capitalize">{String(t.payment_type || '').replace(/_/g, ' ')}</td><td className="px-3 py-2">{t.party_name || t.reference_number || '-'}</td><td className="px-3 py-2">{formatDate(t.payment_date)}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(Math.abs(amount))}</td></tr>;
                          })}
                          {!transactions.length ? <tr><td colSpan={4} className="p-8 text-center text-slate-500">No transactions yet.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {view === 'cheques' && (
            <div className="p-4 space-y-4">
              <h2 className="text-lg font-bold">Cheque Management</h2>
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Cheque No.</th><th className="px-3 py-2">Bank</th><th className="px-3 py-2">Party</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Issue Date</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {cheques.map((c: any) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2 font-mono">{c.cheque_number || '—'}</td>
                        <td className="px-3 py-2">{c.account_label || c.bank_name || '—'}</td>
                        <td className="px-3 py-2">{c.party_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(c.amount)}</td>
                        <td className="px-3 py-2">{c.instrument_date ? formatDate(c.instrument_date) : formatDate(c.payment_date)}</td>
                        <td className="px-3 py-2"><ChequeStatusBadge status={c.clearance_status} /></td>
                        <td className="px-3 py-2 text-right space-x-1">
                          {c.clearance_status === 'pending' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => chequeAction.mutate({ id: c.id, action: 'deposit' })}><ArrowUpRight className="w-3 h-3" /> Deposit</Button>
                          )}
                          {c.clearance_status === 'deposited' && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-700" onClick={() => chequeAction.mutate({ id: c.id, action: 'clear' })}><CheckCircle2 className="w-3 h-3" /> Clear</Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => { const reason = window.prompt('Reason for bounce?'); if (reason) chequeAction.mutate({ id: c.id, action: 'bounce', body: { reason } }); }}><XCircle className="w-3 h-3" /> Bounce</Button>
                            </>
                          )}
                          {['pending', 'deposited'].includes(c.clearance_status) && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => chequeAction.mutate({ id: c.id, action: 'cancel' })}><Ban className="w-3 h-3" /> Cancel</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!cheques.length && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No cheques recorded yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'loans' && <LoansPanel loanAccounts={loanAccounts} onChanged={() => { qc.invalidateQueries({ queryKey: ['cash-bank', 'loans'] }); invalidateAll(); }} bankAccounts={summary?.bank_accounts || []} />}

          {view === 'transfers' && <TransfersPanel transfers={transfers} bankAccounts={summary?.bank_accounts || []} onChanged={() => { qc.invalidateQueries({ queryKey: ['cash-bank', 'transfers'] }); invalidateAll(); }} />}

          {view === 'reconciliation' && <ReconciliationPanel reconciliations={reconciliations} bankAccounts={summary?.bank_accounts || []} onChanged={() => qc.invalidateQueries({ queryKey: ['cash-bank', 'reconciliations'] })} />}
        </section>
      </div>

      <BankAccountFormSheet open={bankFormOpen} onOpenChange={setBankFormOpen} bank={editingBank} onSaved={invalidateAll} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Full bank account form (account_type, opening balance/date, notes,
// print-on-invoice / print-UPI-QR / accept-online-payments toggles)
// ─────────────────────────────────────────────────────────────────
function BankAccountFormSheet({ open, onOpenChange, bank, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; bank: any | null; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({ account_type: 'current', is_active: true });

  useEffect(() => {
    if (open) setForm(bank ? { ...bank } : { account_type: 'current', is_active: true });
  }, [open, bank]);

  const save = useMutation({
    mutationFn: () => api.post('/company/bank-accounts', { ...form, id: bank?.id }),
    onSuccess: () => { toast.success('Bank account saved'); qc.invalidateQueries({ queryKey: ['cash-bank'] }); onSaved(); onOpenChange(false); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
  });

  if (!open) return null;
  const f = form;
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto w-full max-w-md">
        <SheetHeader><SheetTitle>{bank ? 'Edit' : 'Add'} Bank / UPI / Wallet Account</SheetTitle></SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <Label>Account Type</Label>
            <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" value={f.account_type || 'current'} onChange={(e) => set('account_type', e.target.value)}>
              <option value="current">Current Account</option>
              <option value="savings">Savings Account</option>
              <option value="credit_card">Credit Card</option>
              <option value="wallet">Wallet</option>
              <option value="upi">UPI Only</option>
            </select>
          </div>
          <div><Label>Display name *</Label><Input className="mt-1.5" value={f.account_label || ''} onChange={(e) => set('account_label', e.target.value)} /></div>
          <div><Label>Bank name</Label><Input className="mt-1.5" value={f.bank_name || ''} onChange={(e) => set('bank_name', e.target.value)} /></div>
          <div><Label>Account number</Label><Input className="mt-1.5 font-mono text-sm" value={f.account_number || ''} onChange={(e) => set('account_number', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>IFSC</Label><Input className="mt-1.5 uppercase font-mono text-sm" value={f.ifsc || ''} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} /></div>
            <div><Label>UPI ID</Label><Input className="mt-1.5 text-sm" value={f.upi_id || ''} onChange={(e) => set('upi_id', e.target.value)} /></div>
          </div>
          <div><Label>Branch</Label><Input className="mt-1.5" value={f.branch || ''} onChange={(e) => set('branch', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Opening Balance (₹)</Label><Input type="number" className="mt-1.5" value={f.opening_balance ? f.opening_balance / 100 : ''} onChange={(e) => set('opening_balance', Math.round(parseFloat(e.target.value || '0') * 100))} /></div>
            <div><Label>Opening Date</Label><Input type="date" className="mt-1.5" value={f.opening_date || ''} onChange={(e) => set('opening_date', e.target.value)} /></div>
          </div>
          <div><Label>Notes</Label><textarea className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></div>
          <div className="space-y-2 border-t pt-3">
            {[
              ['print_on_invoice', 'Print bank details on invoice'],
              ['print_upi_qr', 'Print UPI QR on invoice'],
              ['accept_online_payments', 'Accept online payments (requires a connected payment gateway)'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!f[key]} onChange={(e) => set(key, e.target.checked)} /> {label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm border-t pt-3">
            <input type="checkbox" checked={!!f.is_primary} onChange={(e) => set('is_primary', e.target.checked)} /> Set as primary account
          </div>
          <Button className="w-full" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────
// Loan Accounts panel — EMI/term/processing-fee, lender, record txn
// ─────────────────────────────────────────────────────────────────
function LoansPanel({ loanAccounts, onChanged, bankAccounts }: { loanAccounts: any[]; onChanged: () => void; bankAccounts: any[] }) {
  const [formOpen, setFormOpen] = useState(false);
  const [txnLoan, setTxnLoan] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ received_in: 'bank' });
  const [txnForm, setTxnForm] = useState<any>({ transaction_type: 'repayment' });

  const create = useMutation({
    mutationFn: () => api.post('/accounting/cash-bank/loans', form),
    onSuccess: () => { toast.success('Loan account created'); setFormOpen(false); setForm({ received_in: 'bank' }); onChanged(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const recordTxn = useMutation({
    mutationFn: () => api.post(`/accounting/cash-bank/loans/${txnLoan.id}/transactions`, txnForm),
    onSuccess: () => { toast.success('Loan transaction recorded'); setTxnLoan(null); setTxnForm({ transaction_type: 'repayment' }); onChanged(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Loan Accounts</h2>
        <Button size="sm" onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Add Loan</Button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {loanAccounts.map((l: any) => (
          <Card key={l.id}>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center justify-between">{l.account_name}{!l.is_active && <Badge variant="secondary">Closed</Badge>}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{l.lender_name || 'No lender on file'} {l.loan_type ? `· ${l.loan_type.replace('_', ' ')}` : ''}</p>
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-muted-foreground">Outstanding</p><p className="font-bold tabular-nums">{formatMoney(l.current_balance)}</p></div>
                <div><p className="text-xs text-muted-foreground">Principal</p><p className="font-semibold tabular-nums">{formatMoney(l.principal_amount)}</p></div>
                {l.emi_amount && <div><p className="text-xs text-muted-foreground">EMI</p><p className="font-semibold tabular-nums">{formatMoney(l.emi_amount)}/mo</p></div>}
                {l.interest_rate > 0 && <div><p className="text-xs text-muted-foreground">Interest</p><p className="font-semibold">{l.interest_rate}% p.a.</p></div>}
              </div>
              <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => setTxnLoan(l)}>Record Transaction</Button>
            </CardContent>
          </Card>
        ))}
        {!loanAccounts.length && <p className="text-sm text-muted-foreground col-span-2 text-center py-10">No loan accounts yet.</p>}
      </div>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader><SheetTitle>Add Loan Account</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div><Label>Account Name *</Label><Input className="mt-1.5" value={form.account_name || ''} onChange={(e) => setForm({ ...form, account_name: e.target.value })} /></div>
            <div><Label>Lender</Label><Input className="mt-1.5" value={form.lender_name || ''} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} /></div>
            <div>
              <Label>Loan Type</Label>
              <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" value={form.loan_type || ''} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
                <option value="">Select type</option>
                <option value="term_loan">Term Loan</option>
                <option value="overdraft">Overdraft</option>
                <option value="line_of_credit">Line of Credit</option>
                <option value="vehicle_loan">Vehicle Loan</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Principal Amount (₹)</Label><Input type="number" className="mt-1.5" onChange={(e) => setForm({ ...form, principal_amount: Math.round(parseFloat(e.target.value || '0') * 100) })} /></div>
              <div><Label>Interest Rate (% p.a.)</Label><Input type="number" className="mt-1.5" onChange={(e) => setForm({ ...form, interest_rate: parseFloat(e.target.value || '0') })} /></div>
              <div><Label>EMI Amount (₹)</Label><Input type="number" className="mt-1.5" onChange={(e) => setForm({ ...form, emi_amount: Math.round(parseFloat(e.target.value || '0') * 100) })} /></div>
              <div><Label>Term (months)</Label><Input type="number" className="mt-1.5" onChange={(e) => setForm({ ...form, term_months: parseInt(e.target.value || '0') })} /></div>
              <div><Label>Processing Fee (₹)</Label><Input type="number" className="mt-1.5" onChange={(e) => setForm({ ...form, processing_fee: Math.round(parseFloat(e.target.value || '0') * 100) })} /></div>
            </div>
            <div>
              <Label>Loan Received In</Label>
              <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" value={form.received_in} onChange={(e) => setForm({ ...form, received_in: e.target.value })}>
                <option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option>
              </select>
            </div>
            {form.received_in === 'bank' && (
              <div>
                <Label>Bank Account</Label>
                <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" onChange={(e) => setForm({ ...form, company_bank_account_id: e.target.value || undefined })}>
                  <option value="">Select</option>
                  {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.account_label || b.bank_name}</option>)}
                </select>
              </div>
            )}
            <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending}>Save</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!txnLoan} onOpenChange={(v) => { if (!v) setTxnLoan(null); }}>
        <SheetContent>
          <SheetHeader><SheetTitle>Record Transaction — {txnLoan?.account_name}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Type</Label>
              <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" value={txnForm.transaction_type} onChange={(e) => setTxnForm({ ...txnForm, transaction_type: e.target.value })}>
                <option value="repayment">Repayment (EMI)</option><option value="interest">Interest Charged</option><option value="disbursement">Additional Disbursement</option><option value="adjustment">Adjustment</option>
              </select>
            </div>
            <div><Label>Amount (₹)</Label><Input type="number" className="mt-1.5" onChange={(e) => setTxnForm({ ...txnForm, amount: Math.round(parseFloat(e.target.value || '0') * 100) })} /></div>
            <div><Label>Date</Label><Input type="date" className="mt-1.5" defaultValue={new Date().toISOString().split('T')[0]} onChange={(e) => setTxnForm({ ...txnForm, transaction_date: e.target.value })} /></div>
            <Button className="w-full" onClick={() => recordTxn.mutate()} loading={recordTxn.isPending}>Save</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Bank Transfers panel
// ─────────────────────────────────────────────────────────────────
function TransfersPanel({ transfers, bankAccounts, onChanged }: { transfers: any[]; bankAccounts: any[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const create = useMutation({
    mutationFn: () => api.post('/accounting/cash-bank/transfers', form),
    onSuccess: () => { toast.success('Transfer recorded'); setOpen(false); setForm({}); onChanged(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Bank Transfers</h2>
        <Button size="sm" onClick={() => setOpen(true)}><ArrowLeftRight className="w-4 h-4 mr-1.5" /> New Transfer</Button>
      </div>
      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">From</th><th className="px-3 py-2">To</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Reference</th></tr></thead>
          <tbody>
            {transfers.map((t: any) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2">{formatDate(t.transfer_date)}</td>
                <td className="px-3 py-2">{t.from_account_label || t.from_bank_name || 'Cash in Hand'}</td>
                <td className="px-3 py-2">{t.to_account_label || t.to_bank_name || 'Cash in Hand'}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(t.amount)}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.reference_number}</td>
              </tr>
            ))}
            {!transfers.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No transfers yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>New Bank Transfer</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>From</Label>
              <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" onChange={(e) => setForm({ ...form, from_account_id: e.target.value || undefined })}>
                <option value="">Cash in Hand</option>
                {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.account_label || b.bank_name}</option>)}
              </select>
            </div>
            <div>
              <Label>To</Label>
              <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" onChange={(e) => setForm({ ...form, to_account_id: e.target.value || undefined })}>
                <option value="">Cash in Hand</option>
                {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.account_label || b.bank_name}</option>)}
              </select>
            </div>
            <div><Label>Amount (₹)</Label><Input type="number" className="mt-1.5" onChange={(e) => setForm({ ...form, amount: Math.round(parseFloat(e.target.value || '0') * 100) })} /></div>
            <div><Label>Date</Label><Input type="date" className="mt-1.5" defaultValue={new Date().toISOString().split('T')[0]} onChange={(e) => setForm({ ...form, transfer_date: e.target.value })} /></div>
            <div><Label>Reference (optional)</Label><Input className="mt-1.5" onChange={(e) => setForm({ ...form, reference_number: e.target.value })} /></div>
            <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending}>Save Transfer</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Bank Reconciliation panel — CSV upload + matching
// ─────────────────────────────────────────────────────────────────
function ReconciliationPanel({ reconciliations, bankAccounts, onChanged }: { reconciliations: any[]; bankAccounts: any[]; onChanged: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [closingBalance, setClosingBalance] = useState('');
  const [csvText, setCsvText] = useState('');

  const { data: active } = useQuery({
    queryKey: ['cash-bank', 'reconciliation', activeId],
    enabled: !!activeId,
    queryFn: async () => (await api.get(`/accounting/cash-bank/reconciliations/${activeId}`)).data?.data,
  });

  const create = useMutation({
    mutationFn: () => {
      // Minimal CSV parse: Date,Description,Amount per line (no header
      // row assumed beyond skipping a non-numeric first line).
      const lines = csvText.trim().split('\n').map((l) => l.split(',')).filter((cols) => cols.length >= 3 && !isNaN(parseFloat(cols[2])));
      const parsed = lines.map((cols) => ({ date: cols[0].trim(), description: cols[1].trim(), amount: Math.round(parseFloat(cols[2]) * 100) }));
      return api.post('/accounting/cash-bank/reconciliations', {
        company_bank_account_id: accountId,
        statement_from_date: fromDate,
        statement_to_date: toDate,
        opening_balance: Math.round(parseFloat(openingBalance || '0') * 100),
        closing_balance: Math.round(parseFloat(closingBalance || '0') * 100),
        lines: parsed,
      });
    },
    onSuccess: (res: any) => { toast.success('Statement uploaded'); setOpen(false); onChanged(); setActiveId(res.data?.data?.id); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const matchLine = useMutation({
    mutationFn: ({ lineId, paymentId }: { lineId: string; paymentId: string | null }) => api.post(`/accounting/cash-bank/reconciliations/lines/${lineId}/match`, { payment_id: paymentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-bank', 'reconciliation', activeId] }),
  });

  const complete = useMutation({
    mutationFn: () => api.post(`/accounting/cash-bank/reconciliations/${activeId}/complete`),
    onSuccess: () => { toast.success('Reconciliation completed'); onChanged(); setActiveId(null); },
  });

  if (activeId && active) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold">{active.account_label || active.bank_name}</h2><p className="text-sm text-muted-foreground">{formatDate(active.statement_from_date)} – {formatDate(active.statement_to_date)}</p></div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setActiveId(null)}>Back</Button>
            {active.status === 'in_progress' && <Button size="sm" onClick={() => complete.mutate()} loading={complete.isPending}>Mark Completed</Button>}
          </div>
        </div>
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
            <tbody>
              {(active.lines || []).map((l: any) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">{formatDate(l.statement_date)}</td>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${l.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(Math.abs(l.amount))}</td>
                  <td className="px-3 py-2"><Badge variant="secondary" className={l.status === 'matched' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{l.status}</Badge></td>
                  <td className="px-3 py-2 text-right">
                    {l.status === 'unmatched' && l.suggestedPaymentId && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => matchLine.mutate({ lineId: l.id, paymentId: l.suggestedPaymentId })}><RefreshCcw className="w-3 h-3" /> Match suggestion</Button>
                    )}
                  </td>
                </tr>
              ))}
              {!(active.lines || []).length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No statement lines.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Bank Reconciliation</h2>
        <Button size="sm" onClick={() => setOpen(true)}><FileSpreadsheet className="w-4 h-4 mr-1.5" /> Upload Statement</Button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {reconciliations.map((r: any) => (
          <Card key={r.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveId(r.id)}>
            <CardContent className="p-4 space-y-1">
              <p className="font-semibold">{r.account_label || r.bank_name}</p>
              <p className="text-xs text-muted-foreground">{formatDate(r.statement_from_date)} – {formatDate(r.statement_to_date)}</p>
              <div className="flex items-center justify-between mt-2">
                <Badge variant="secondary" className={r.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}>{r.status.replace('_', ' ')}</Badge>
                <span className="text-xs text-muted-foreground">{r.matched_lines}/{r.total_lines} matched</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {!reconciliations.length && <p className="text-sm text-muted-foreground col-span-2 text-center py-10">No reconciliations yet.</p>}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto w-full max-w-lg">
          <SheetHeader><SheetTitle>Upload Bank Statement</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Bank Account</Label>
              <select className="mt-1.5 w-full h-9 rounded-md border bg-background px-3 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select</option>
                {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.account_label || b.bank_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" className="mt-1.5" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
              <div><Label>To</Label><Input type="date" className="mt-1.5" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
              <div><Label>Opening Balance (₹)</Label><Input type="number" className="mt-1.5" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} /></div>
              <div><Label>Closing Balance (₹)</Label><Input type="number" className="mt-1.5" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} /></div>
            </div>
            <div>
              <Label>Statement CSV (Date,Description,Amount — one per line)</Label>
              <textarea className="mt-1.5 w-full h-40 rounded-md border px-3 py-2 text-xs font-mono bg-transparent resize-none" placeholder={'2026-06-01,UPI-XYZ-STORE,1500.00\n2026-06-02,NEFT RECEIVED,-2300.00'} value={csvText} onChange={(e) => setCsvText(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Paste rows exported from your bank's CSV/Excel statement. Positive = money in, negative = money out.</p>
            </div>
            <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending} disabled={!accountId || !fromDate || !toDate}>Upload &amp; Start Matching</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
