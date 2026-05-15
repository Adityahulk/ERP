import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Building2, CalendarDays, ChevronsUpDown, FileText, Plus, Printer, Search, WalletCards } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatMoney, rupeesToPaise } from '@/lib/formatters';

type CashBankSummary = {
  cash_in_hand: number;
  unassigned_bank_balance: number;
  bank_accounts: any[];
  cheques: any[];
  recent_transactions: any[];
};

const paymentModes = [
  ['cash', 'Cash'],
  ['upi', 'UPI / Online'],
  ['bank_transfer', 'NEFT / Bank Transfer'],
  ['cheque', 'Cheque'],
  ['card', 'Card'],
] as const;

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function unwrapRows(body: any) {
  return body?.data?.data || body?.data || [];
}

export default function AccountingDashboard() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'cash-bank' | 'party-ledger'>('cash-bank');
  const [selectedBankId, setSelectedBankId] = useState<string>('cash');
  const [adjustType, setAdjustType] = useState<'bank_deposit' | 'bank_withdrawal'>('bank_deposit');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustRef, setAdjustRef] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');

  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [party, setParty] = useState<any>(null);
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptMode, setReceiptMode] = useState('cash');
  const [receiptRef, setReceiptRef] = useState('');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['accounting', 'cash-bank', 'summary'],
    queryFn: async () => (await api.get('/accounting/cash-bank/summary')).data?.data as CashBankSummary,
  });

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ['party-statement', party?.id, fromDate, toDate],
    queryFn: async () => (await api.get(`/parties/${party.id}/statement`, { params: { from_date: fromDate, to_date: toDate } })).data?.data,
    enabled: !!party?.id,
  });

  const selectedBank = useMemo(
    () => summary?.bank_accounts?.find((b: any) => b.id === selectedBankId),
    [summary?.bank_accounts, selectedBankId],
  );

  const visibleTransactions = useMemo(() => {
    const rows = summary?.recent_transactions || [];
    if (selectedBankId === 'cash') return rows.filter((r: any) => Number(r.signed_cash_amount || 0) !== 0 || r.payment_mode === 'cash');
    if (selectedBankId === 'unassigned') return rows.filter((r: any) => !r.company_bank_account_id && ['bank_transfer', 'neft', 'rtgs', 'upi', 'online', 'card', 'cheque'].includes(r.payment_mode));
    return rows.filter((r: any) => r.company_bank_account_id === selectedBankId);
  }, [summary?.recent_transactions, selectedBankId]);

  const adjustMutation = useMutation({
    mutationFn: (payload: any) => api.post('/accounting/cash-bank/adjustment', payload),
    onSuccess: () => {
      toast.success(adjustType === 'bank_deposit' ? 'Cash deposit recorded' : 'Cash withdrawal recorded');
      setAdjustAmount('');
      setAdjustRef('');
      setAdjustNotes('');
      qc.invalidateQueries({ queryKey: ['accounting', 'cash-bank'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save cash/bank entry'),
  });

  const receiptMutation = useMutation({
    mutationFn: (payload: any) => api.post('/payments', payload),
    onSuccess: () => {
      toast.success('Payment recorded');
      setReceiptAmount('');
      setReceiptRef('');
      qc.invalidateQueries({ queryKey: ['party-statement'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'cash-bank'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not record payment'),
  });

  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (q.trim().length < 2) {
      setPartyResults([]);
      return;
    }
    try {
      const res = await api.get('/parties/search', { params: { q } });
      setPartyResults(unwrapRows(res.data));
    } catch {
      setPartyResults([]);
    }
  };

  const saveAdjustment = () => {
    if (!selectedBank || !adjustAmount || Number(adjustAmount) <= 0) {
      toast.error('Select a bank account and enter amount');
      return;
    }
    adjustMutation.mutate({
      type: adjustType,
      company_bank_account_id: selectedBank.id,
      amount: rupeesToPaise(adjustAmount),
      reference_number: adjustRef || undefined,
      notes: adjustNotes || undefined,
    });
  };

  const recordReceipt = () => {
    if (!party?.id) {
      toast.error('Select a party');
      return;
    }
    if (!receiptAmount || Number(receiptAmount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    receiptMutation.mutate({
      party_id: party.id,
      payment_type: 'incoming',
      amount: rupeesToPaise(receiptAmount),
      payment_date: today(),
      payment_mode: receiptMode,
      reference_number: receiptRef || undefined,
      cheque_number: receiptMode === 'cheque' ? receiptRef || undefined : undefined,
      notes: `Payment from ${party.name}`,
    });
  };

  const printStatement = () => {
    window.print();
  };

  const exportStatementCsv = () => {
    if (!party || !statement) return;
    const rows = [
      ['Date', 'Type', 'Narration', 'Debit', 'Credit', 'Balance'],
      ...(statement.transactions || []).map((r: any) => [
        formatDate(r.transaction_date || r.created_at),
        r.type,
        String(r.narration || '').replace(/"/g, '""'),
        r.type === 'debit' ? (Number(r.amount || 0) / 100).toFixed(2) : '',
        r.type === 'credit' ? (Number(r.amount || 0) / 100).toFixed(2) : '',
        (Number(r.running_balance || 0) / 100).toFixed(2),
      ]),
    ];
    const csv = rows.map((r: Array<string | number>) => r.map((c: string | number) => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${party.name || 'party'}-statement-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounting</h1>
          <p className="text-sm text-muted-foreground">Cash, bank, cheques, receipts and monthly party ledgers.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        <button type="button" onClick={() => setTab('cash-bank')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'cash-bank' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
          Cash & Bank
        </button>
        <button type="button" onClick={() => setTab('party-ledger')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'party-ledger' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
          Party Monthly Ledger
        </button>
      </div>

      {tab === 'cash-bank' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Accounts</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading accounts...</div>
              ) : (
                <div className="divide-y">
                  <button type="button" onClick={() => setSelectedBankId('cash')} className={`w-full p-4 flex items-center gap-3 text-left hover:bg-muted/50 ${selectedBankId === 'cash' ? 'bg-muted' : ''}`}>
                    <WalletCards className="h-5 w-5 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Cash in Hand</p>
                      <p className="text-xs text-muted-foreground">Cash receipts and withdrawals</p>
                    </div>
                    <span className="font-semibold tabular-nums">{formatMoney(summary?.cash_in_hand || 0)}</span>
                  </button>
                  {(summary?.bank_accounts || []).map((b: any) => (
                    <button key={b.id} type="button" onClick={() => setSelectedBankId(b.id)} className={`w-full p-4 flex items-center gap-3 text-left hover:bg-muted/50 ${selectedBankId === b.id ? 'bg-muted' : ''}`}>
                      <Building2 className="h-5 w-5 text-blue-600" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{b.account_label || b.bank_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{b.bank_name} {b.account_number ? `- ${b.account_number}` : ''}</p>
                      </div>
                      <span className="font-semibold tabular-nums">{formatMoney(Number(b.balance || 0))}</span>
                    </button>
                  ))}
                  {Number(summary?.unassigned_bank_balance || 0) !== 0 && (
                    <button type="button" onClick={() => setSelectedBankId('unassigned')} className={`w-full p-4 flex items-center gap-3 text-left hover:bg-muted/50 ${selectedBankId === 'unassigned' ? 'bg-muted' : ''}`}>
                      <Banknote className="h-5 w-5 text-slate-600" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">Unassigned Bank/UPI</p>
                        <p className="text-xs text-muted-foreground">Payments without selected bank</p>
                      </div>
                      <span className="font-semibold tabular-nums">{formatMoney(summary?.unassigned_bank_balance || 0)}</span>
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ChevronsUpDown className="h-4 w-4" /> Deposit / Withdraw
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <Label>Type</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={adjustType} onChange={(e) => setAdjustType(e.target.value as any)}>
                    <option value="bank_deposit">Deposit cash to bank</option>
                    <option value="bank_withdrawal">Withdraw cash from bank</option>
                  </select>
                </div>
                <div>
                  <Label>Amount (₹)</Label>
                  <Input className="mt-1" inputMode="decimal" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input className="mt-1" value={adjustRef} onChange={(e) => setAdjustRef(e.target.value)} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input className="mt-1" value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button className="w-full gap-2" loading={adjustMutation.isPending} onClick={saveAdjustment}>
                    <Plus className="h-4 w-4" /> Save
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Transactions</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-y">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-left font-medium">Type</th>
                      <th className="px-4 py-2 text-left font-medium">Name</th>
                      <th className="px-4 py-2 text-left font-medium">Mode</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTransactions.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No transactions yet.</td></tr>
                    ) : visibleTransactions.map((t: any) => {
                      const cash = Number(t.signed_cash_amount || 0);
                      const bank = Number(t.signed_bank_amount || 0);
                      const amount = selectedBankId === 'cash' ? cash : bank;
                      return (
                        <tr key={t.id} className="border-b">
                          <td className="px-4 py-2 text-muted-foreground">{formatDate(t.payment_date)}</td>
                          <td className="px-4 py-2 capitalize">{String(t.payment_type || '').replace(/_/g, ' ')}</td>
                          <td className="px-4 py-2">{t.party_name || t.notes || '-'}</td>
                          <td className="px-4 py-2 capitalize">{String(t.payment_mode || '').replace(/_/g, ' ')}</td>
                          <td className={`px-4 py-2 text-right font-semibold tabular-nums ${amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatMoney(Math.abs(amount || Number(t.amount || 0)))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cheques</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(summary?.cheques || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cheque payments recorded.</p>
                ) : (summary?.cheques || []).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <p className="font-medium">{c.party_name || c.notes || 'Cheque entry'}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(c.payment_date)} - Cheque {c.cheque_number || c.reference_number || '-'}</p>
                    </div>
                    <span className="font-semibold tabular-nums">{formatMoney(Number(c.amount || 0))}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'party-ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 print:block">
          <Card className="print:hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Party & Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Label>Party</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={partySearch || party?.name || ''} onChange={(e) => { setParty(null); searchParties(e.target.value); }} placeholder="Search customer or supplier" />
                </div>
                {partyResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow">
                    {partyResults.map((p) => (
                      <button key={p.id} type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { setParty(p); setPartySearch(''); setPartyResults([]); }}>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.phone || p.gstin || p.city || ''}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From</Label>
                  <Input className="mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <Label>To</Label>
                  <Input className="mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-semibold">Record Payment</p>
                <Input inputMode="decimal" placeholder="Amount in rupees" value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} />
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={receiptMode} onChange={(e) => setReceiptMode(e.target.value)}>
                  {paymentModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <Input placeholder={receiptMode === 'cheque' ? 'Cheque number' : 'Reference number'} value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} />
                <Button className="w-full" loading={receiptMutation.isPending} onClick={recordReceipt}>Record Receipt</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="print:shadow-none print:border-0">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5" /> Monthly Ledger Statement</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{party?.name || 'Select a party'} - {formatDate(fromDate)} to {formatDate(toDate)}</p>
                </div>
                <div className="flex gap-2 print:hidden">
                  <Button variant="outline" size="sm" onClick={exportStatementCsv} disabled={!party || !statement}>Download CSV</Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={printStatement} disabled={!party || !statement}><Printer className="h-4 w-4" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!party ? (
                <div className="p-12 text-center text-muted-foreground">
                  <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  Select a party to view monthly bills, payments and balance.
                </div>
              ) : statementLoading ? (
                <div className="p-12 text-center text-muted-foreground">Loading statement...</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 divide-x border-b text-sm">
                    <div className="p-4">
                      <p className="text-muted-foreground">Opening</p>
                      <p className="font-bold tabular-nums">{formatMoney(statement?.opening_balance || 0)}</p>
                    </div>
                    <div className="p-4">
                      <p className="text-muted-foreground">Transactions</p>
                      <p className="font-bold tabular-nums">{statement?.transactions?.length || 0}</p>
                    </div>
                    <div className="p-4">
                      <p className="text-muted-foreground">Closing</p>
                      <p className="font-bold tabular-nums">{formatMoney(statement?.closing_balance || 0)}</p>
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium">Date</th>
                          <th className="px-4 py-2 text-left font-medium">Particulars</th>
                          <th className="px-4 py-2 text-right font-medium">Debit</th>
                          <th className="px-4 py-2 text-right font-medium">Credit</th>
                          <th className="px-4 py-2 text-right font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(statement?.transactions || []).length === 0 ? (
                          <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No ledger entries in this period.</td></tr>
                        ) : (statement?.transactions || []).map((r: any) => (
                          <tr key={r.id} className="border-b">
                            <td className="px-4 py-2 text-muted-foreground">{formatDate(r.transaction_date || r.created_at)}</td>
                            <td className="px-4 py-2">{r.narration || r.reference_type || '-'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{r.type === 'debit' ? formatMoney(Number(r.amount || 0)) : '-'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{r.type === 'credit' ? formatMoney(Number(r.amount || 0)) : '-'}</td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(Number(r.running_balance || 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
