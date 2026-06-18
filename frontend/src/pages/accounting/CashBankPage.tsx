import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Landmark, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatMoney } from '@/lib/formatters';
import MoneyInput from '@/components/transactions/MoneyInput';
import { QuickAddBankAccountSheet } from '@/components/company/QuickAddBankAccountSheet';

export default function CashBankPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'banks' | 'cash' | 'cheques' | 'loans'>('banks');
  const [selectedBankId, setSelectedBankId] = useState('cash');
  const [addBankOpen, setAddBankOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<'bank_deposit' | 'bank_withdrawal'>('bank_deposit');
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustRef, setAdjustRef] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');

  const { data: summary } = useQuery({
    queryKey: ['cash-bank', 'summary'],
    queryFn: async () => (await api.get('/accounting/cash-bank/summary')).data?.data,
  });

  const { data: loanAccounts = [] } = useQuery({
    queryKey: ['cash-bank', 'loans'],
    queryFn: async () => (await api.get('/accounting/cash-bank/loans')).data?.data || [],
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
      setAdjustAmount(0);
      setAdjustRef('');
      setAdjustNotes('');
      qc.invalidateQueries({ queryKey: ['cash-bank'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save cash/bank entry'),
  });

  const saveAdjustment = () => {
    if (!selectedBank?.id || adjustAmount <= 0) {
      toast.error('Select a bank account and enter amount');
      return;
    }
    adjustMutation.mutate({
      type: adjustType,
      company_bank_account_id: selectedBank.id,
      amount: adjustAmount,
      reference_number: adjustRef || undefined,
      notes: adjustNotes || undefined,
    });
  };

  return (
    <div className="h-full bg-slate-50">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cash & Bank</h1>
            <p className="text-sm text-slate-500">Bank accounts, cash in hand, cheques, loans, deposits and withdrawals.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/cash-bank/reconciliation">Reconcile bank</Link>
            </Button>
            <Button onClick={() => setAddBankOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Bank
            </Button>
          </div>
        </div>
      </div>

      <div className="grid h-[calc(100vh-132px)] grid-cols-[340px_minmax(0,1fr)] overflow-hidden bg-white">
        <aside className="border-r">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-bold">Accounts</h2>
            <Landmark className="h-4 w-4 text-slate-500" />
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {[
              ['banks', 'Banks'],
              ['cash', 'Cash'],
              ['cheques', 'Cheques'],
              ['loans', 'Loans'],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setView(key as any)} className={`rounded-md border px-3 py-2 text-sm ${view === key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'bg-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="h-[calc(100vh-250px)] overflow-y-auto px-3 pb-3">
            <button className={`mb-2 flex w-full justify-between rounded-md border p-3 text-left ${selectedBankId === 'cash' ? 'bg-sky-50' : ''}`} onClick={() => setSelectedBankId('cash')}>
              <span>Cash in Hand</span><b>{formatMoney(summary?.cash_in_hand || 0)}</b>
            </button>
            {(summary?.bank_accounts || []).map((b: any) => (
              <button key={b.id} className={`mb-2 w-full rounded-md border p-3 text-left ${selectedBankId === b.id ? 'bg-sky-50' : ''}`} onClick={() => setSelectedBankId(b.id)}>
                <div className="flex justify-between gap-3"><span className="font-medium">{b.account_label || b.bank_name}</span><b>{formatMoney(Number(b.balance || 0))}</b></div>
                <p className="mt-1 text-xs text-slate-500">{b.bank_name} {b.account_number ? `- ${b.account_number}` : ''}</p>
              </button>
            ))}
            {view === 'loans' ? (loanAccounts || []).map((l: any) => (
              <div key={l.id} className="mb-2 rounded-md border p-3">
                <b>{l.account_name}</b>
                <p className="text-xs text-slate-500">{l.lender_name || 'Loan account'}</p>
                <p className="mt-1 font-semibold">{formatMoney(Number(l.current_balance || 0))}</p>
              </div>
            )) : null}
          </div>
        </aside>

        <section className="min-w-0">
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
                <Button className="w-full" onClick={saveAdjustment}>Save</Button>
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
        </section>
      </div>

      <QuickAddBankAccountSheet open={addBankOpen} onOpenChange={setAddBankOpen} onCreated={() => qc.invalidateQueries({ queryKey: ['cash-bank'] })} />
    </div>
  );
}
