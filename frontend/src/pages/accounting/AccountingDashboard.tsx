import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Landmark,
  ListTree,
  Plus,
  Printer,
  RefreshCcw,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatMoney } from '@/lib/formatters';
import MoneyInput from '@/components/transactions/MoneyInput';

type Workspace = 'journal' | 'chart' | 'statement';
type AccountNode = {
  id: string;
  name: string;
  code?: string;
  account_type: string;
  account_category?: string;
  normal_balance?: 'debit' | 'credit';
  is_locked?: boolean;
  is_system?: boolean;
  balance_paise: number;
  balance_type: 'Dr' | 'Cr';
  children?: AccountNode[];
};
type JournalLine = { account_id: string; debit: number; credit: number; description?: string };

const accountTypes = [
  ['Assets', 'asset'],
  ['Equities & Liabilities', 'liability'],
  ['Incomes', 'income'],
  ['Expenses', 'expense'],
] as const;

function today() {
  return new Date().toISOString().split('T')[0];
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

function flattenAccounts(nodes: AccountNode[] = [], level = 0): Array<AccountNode & { level: number }> {
  return nodes.flatMap((node) => [{ ...node, level }, ...flattenAccounts(node.children || [], level + 1)]);
}

function drCrClass(kind?: string) {
  return kind === 'Cr' ? 'text-emerald-700' : 'text-sky-700';
}

export default function AccountingDashboard() {
  const qc = useQueryClient();
  const [workspace, setWorkspace] = useState<Workspace>('journal');
  const [accountType, setAccountType] = useState<string>('Assets');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [accountSearch, setAccountSearch] = useState('');
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: '', code: '', type: 'asset', parent_id: '', opening_balance: 0, opening_balance_type: 'debit' });

  const [journalOpen, setJournalOpen] = useState(false);
  const [journalForm, setJournalForm] = useState({
    voucher_number: '',
    entry_date: today(),
    description: '',
    remarks: '',
    attachment_url: '',
    lines: [
      { account_id: '', debit: 0, credit: 0, description: '' },
      { account_id: '', debit: 0, credit: 0, description: '' },
    ] as JournalLine[],
  });

  const [statementAccountId, setStatementAccountId] = useState('');
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());

  const { data: accountsTree = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounting', 'accounts-tree'],
    queryFn: async () => (await api.get('/accounting/accounts/tree')).data?.data as AccountNode[],
  });

  const accountOptions = useMemo(() => flattenAccounts(accountsTree), [accountsTree]);
  const filteredChartRoots = useMemo(() => {
    const roots = accountsTree.filter((a) => (a.account_category || '') === accountType || a.account_type === accountType);
    const q = accountSearch.trim().toLowerCase();
    if (!q) return roots;
    const keep = (node: AccountNode): AccountNode | null => {
      const children = (node.children || []).map(keep).filter(Boolean) as AccountNode[];
      if (node.name.toLowerCase().includes(q) || String(node.code || '').toLowerCase().includes(q) || children.length) {
        return { ...node, children };
      }
      return null;
    };
    return roots.map(keep).filter(Boolean) as AccountNode[];
  }, [accountsTree, accountSearch, accountType]);

  const { data: journals = [], isLoading: journalsLoading } = useQuery({
    queryKey: ['accounting', 'journal-entries'],
    queryFn: async () => (await api.get('/accounting/journal-entries')).data?.data || [],
  });

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ['accounting', 'statement', statementAccountId, fromDate, toDate],
    enabled: !!statementAccountId,
    queryFn: async () =>
      (await api.get(`/accounting/accounts/${statementAccountId}/statement`, { params: { from_date: fromDate, to_date: toDate } })).data?.data,
  });

  const createJournalMutation = useMutation({
    mutationFn: (payload: any) => api.post('/accounting/journal-entries', payload),
    onSuccess: () => {
      toast.success('Journal entry posted');
      setJournalOpen(false);
      setJournalForm((f) => ({
        ...f,
        voucher_number: '',
        description: '',
        remarks: '',
        attachment_url: '',
        lines: [
          { account_id: '', debit: 0, credit: 0, description: '' },
          { account_id: '', debit: 0, credit: 0, description: '' },
        ],
      }));
      qc.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not post journal entry'),
  });

  const reverseJournalMutation = useMutation({
    mutationFn: (id: string) => api.post(`/accounting/journal-entries/${id}/reverse`),
    onSuccess: () => {
      toast.success('Journal entry reversed');
      qc.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not reverse entry'),
  });

  const createAccountMutation = useMutation({
    mutationFn: (payload: any) => api.post('/accounting/accounts', payload),
    onSuccess: () => {
      toast.success('Account created');
      setNewAccountOpen(false);
      setNewAccount({ name: '', code: '', type: 'asset', parent_id: '', opening_balance: 0, opening_balance_type: 'debit' });
      qc.invalidateQueries({ queryKey: ['accounting', 'accounts-tree'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not create account'),
  });

  const rebuildMutation = useMutation({
    mutationFn: () => api.post('/accounting/rebuild-ledger'),
    onSuccess: (res) => {
      toast.success(`Ledger rebuilt (${res.data?.data?.posted || 0} vouchers checked)`);
      qc.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not rebuild ledger'),
  });

  const totals = useMemo(() => {
    const debit = journalForm.lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const credit = journalForm.lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    return { debit, credit, balanced: debit > 0 && debit === credit };
  }, [journalForm.lines]);

  const updateLine = (index: number, patch: Partial<JournalLine>) => {
    setJournalForm((form) => ({
      ...form,
      lines: form.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const saveJournal = () => {
    const lines = journalForm.lines.filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (!journalForm.description.trim()) return toast.error('Enter journal description');
    if (lines.length < 2) return toast.error('Add at least two journal lines');
    if (!totals.balanced) return toast.error('Debit and credit totals must match');
    createJournalMutation.mutate({
      entry_date: journalForm.entry_date,
      voucher_number: journalForm.voucher_number || undefined,
      description: journalForm.description,
      remarks: journalForm.remarks || undefined,
      attachment_url: journalForm.attachment_url || undefined,
      lines,
    });
  };

  const saveAccount = () => {
    if (!newAccount.name.trim()) return toast.error('Enter account name');
    createAccountMutation.mutate({
      name: newAccount.name.trim(),
      code: newAccount.code.trim() || undefined,
      account_type: newAccount.type,
      parent_id: newAccount.parent_id || undefined,
      opening_balance: newAccount.opening_balance,
      opening_balance_type: newAccount.opening_balance_type,
    });
  };

  const exportStatementCsv = () => {
    const rows = statement?.lines || [];
    const header = ['Date', 'Voucher No.', 'Particulars', 'Debit', 'Credit', 'Balance'];
    const csv = [
      header.join(','),
      ...rows.map((r: any) => [
        formatDate(r.entry_date),
        r.entry_number || '',
        `"${String(r.description || r.entry_description || '').replace(/"/g, '""')}"`,
        Number(r.debit || 0) / 100,
        Number(r.credit || 0) / 100,
        Number(r.balance_after_paise || 0) / 100,
      ].join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'account-statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full bg-slate-50">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Accounting</h1>
            <p className="text-sm text-slate-500">Journal vouchers, chart of accounts, and account statements.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Rebuild Ledger
            </Button>
            <Button onClick={() => setJournalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Journal Entry
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-132px)] grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-r bg-white p-3">
          {[
            ['journal', FileText, 'Journal Entries'],
            ['chart', ListTree, 'Chart of Accounts'],
            ['statement', BookOpen, 'Account Statements'],
          ].map(([key, Icon, label]) => {
            const I = Icon as typeof FileText;
            return (
              <button
                key={String(key)}
                onClick={() => setWorkspace(key as Workspace)}
                className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium ${workspace === key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                <I className="h-4 w-4" /> {String(label)}
              </button>
            );
          })}
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mb-2 h-4 w-4" />
            Journal entries affect accounting balances. Use reversals instead of deleting posted vouchers.
          </div>
        </aside>

        <main className="min-w-0 p-4">
          {workspace === 'journal' && (
            <JournalEntries
              loading={journalsLoading}
              rows={journals}
              onReverse={(id) => reverseJournalMutation.mutate(id)}
            />
          )}

          {workspace === 'chart' && (
            <ChartOfAccounts
              loading={accountsLoading}
              roots={filteredChartRoots}
              accountType={accountType}
              onType={setAccountType}
              search={accountSearch}
              onSearch={setAccountSearch}
              expanded={expanded}
              onToggle={(id) => setExpanded((s) => ({ ...s, [id]: !s[id] }))}
              onNew={() => setNewAccountOpen(true)}
            />
          )}

          {workspace === 'statement' && (
            <Card>
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Account Statement</CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
                    <Button variant="outline" size="sm" disabled={!statementAccountId} onClick={exportStatementCsv}><Download className="mr-2 h-4 w-4" /> XLS</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid gap-3 md:grid-cols-[1.3fr_180px_180px]">
                  <label className="text-sm font-medium">
                    Account
                    <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={statementAccountId} onChange={(e) => setStatementAccountId(e.target.value)}>
                      <option value="">Search / select account</option>
                      {accountOptions.map((a) => (
                        <option key={a.id} value={a.id}>{`${'-- '.repeat(Math.min(a.level, 3))}${a.name}`}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium">From<Input className="mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
                  <label className="text-sm font-medium">To<Input className="mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <SummaryTile label="Opening Balance" value={formatMoney(statement?.opening_balance_paise || 0)} />
                  <SummaryTile label="Total Debit" value={formatMoney((statement?.lines || []).reduce((s: number, r: any) => s + Number(r.debit || 0), 0))} />
                  <SummaryTile label="Closing Balance" value={formatMoney(statement?.closing_balance_paise || 0)} />
                </div>
                <div className="mt-4 overflow-auto rounded-md border bg-white">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                      <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Voucher No.</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr>
                    </thead>
                    <tbody>
                      {statementLoading ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading statement...</td></tr> : null}
                      {!statementLoading && !(statement?.lines || []).length ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">Select an account to view transactions.</td></tr> : null}
                      {(statement?.lines || []).map((r: any) => (
                        <tr key={r.id || `${r.entry_id}-${r.entry_date}`} className="border-t">
                          <td className="px-3 py-2">{formatDate(r.entry_date)}</td>
                          <td className="px-3 py-2 font-medium">{r.entry_number}</td>
                          <td className="px-3 py-2">{r.description || r.entry_description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(r.debit) ? formatMoney(Number(r.debit)) : '-'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(r.credit) ? formatMoney(Number(r.credit)) : '-'}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(Number(r.balance_after_paise || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </div>

      {journalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-bold">Add Journal Entry</h2>
              <Button variant="ghost" onClick={() => setJournalOpen(false)}>Close</Button>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_260px]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Label>Voucher No.<Input className="mt-1" value={journalForm.voucher_number} placeholder="Auto generated" onChange={(e) => setJournalForm((f) => ({ ...f, voucher_number: e.target.value }))} /></Label>
                  <Label>Date<Input className="mt-1" type="date" value={journalForm.entry_date} onChange={(e) => setJournalForm((f) => ({ ...f, entry_date: e.target.value }))} /></Label>
                  <Label>Attachment URL<Input className="mt-1" value={journalForm.attachment_url} onChange={(e) => setJournalForm((f) => ({ ...f, attachment_url: e.target.value }))} /></Label>
                </div>
                <Label>Description<Input className="mt-1" value={journalForm.description} onChange={(e) => setJournalForm((f) => ({ ...f, description: e.target.value }))} /></Label>
                <div className="overflow-auto rounded-md border">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                      <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Debit</th><th className="px-3 py-2">Credit</th><th /></tr>
                    </thead>
                    <tbody>
                      {journalForm.lines.map((line, index) => (
                        <tr className="border-t" key={index}>
                          <td className="px-3 py-2">
                            <select className="h-10 w-full rounded-md border bg-white px-3" value={line.account_id} onChange={(e) => updateLine(index, { account_id: e.target.value })}>
                              <option value="">Select account</option>
                              {accountOptions.map((a) => <option key={a.id} value={a.id}>{`${'-- '.repeat(Math.min(a.level, 3))}${a.name}`}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2"><Input value={line.description || ''} onChange={(e) => updateLine(index, { description: e.target.value })} /></td>
                          <td className="px-3 py-2"><MoneyInput value={line.debit || 0} onChange={(v) => updateLine(index, { debit: v, credit: v > 0 ? 0 : line.credit })} /></td>
                          <td className="px-3 py-2"><MoneyInput value={line.credit || 0} onChange={(v) => updateLine(index, { credit: v, debit: v > 0 ? 0 : line.debit })} /></td>
                          <td className="px-3 py-2"><Button variant="ghost" size="sm" disabled={journalForm.lines.length <= 2} onClick={() => setJournalForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }))}>Remove</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button variant="outline" onClick={() => setJournalForm((f) => ({ ...f, lines: [...f.lines, { account_id: '', debit: 0, credit: 0, description: '' }] }))}><Plus className="mr-2 h-4 w-4" /> Add Line</Button>
                <Label>Remarks<Input className="mt-1" value={journalForm.remarks} onChange={(e) => setJournalForm((f) => ({ ...f, remarks: e.target.value }))} /></Label>
              </div>
              <div className="rounded-lg border bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Voucher Total</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between"><span>Debit</span><b>{formatMoney(totals.debit)}</b></div>
                  <div className="flex justify-between"><span>Credit</span><b>{formatMoney(totals.credit)}</b></div>
                  <div className={`rounded-md p-3 font-semibold ${totals.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{totals.balanced ? 'Balanced' : 'Debit and credit must match'}</div>
                </div>
                <Button className="mt-5 w-full" disabled={!totals.balanced || createJournalMutation.isPending} onClick={saveJournal}>Post Journal Entry</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {newAccountOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">New Account</h2>
              <Button variant="ghost" onClick={() => setNewAccountOpen(false)}>Close</Button>
            </div>
            <div className="mt-4 grid gap-3">
              <Label>Account Name<Input className="mt-1" value={newAccount.name} onChange={(e) => setNewAccount((a) => ({ ...a, name: e.target.value }))} /></Label>
              <Label>Account Code<Input className="mt-1" value={newAccount.code} onChange={(e) => setNewAccount((a) => ({ ...a, code: e.target.value }))} /></Label>
              <Label>Account Type
                <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={newAccount.type} onChange={(e) => setNewAccount((a) => ({ ...a, type: e.target.value }))}>
                  <option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="income">Income</option><option value="expense">Expense</option>
                </select>
              </Label>
              <Label>Parent Account
                <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={newAccount.parent_id} onChange={(e) => setNewAccount((a) => ({ ...a, parent_id: e.target.value }))}>
                  <option value="">No parent</option>
                  {accountOptions.filter((a) => a.account_type === newAccount.type).map((a) => <option key={a.id} value={a.id}>{`${'-- '.repeat(Math.min(a.level, 3))}${a.name}`}</option>)}
                </select>
              </Label>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Label>Opening Balance<MoneyInput className="mt-1" value={newAccount.opening_balance} onChange={(v) => setNewAccount((a) => ({ ...a, opening_balance: v }))} /></Label>
                <Label>Type
                  <select className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={newAccount.opening_balance_type} onChange={(e) => setNewAccount((a) => ({ ...a, opening_balance_type: e.target.value }))}>
                    <option value="debit">Dr</option><option value="credit">Cr</option>
                  </select>
                </Label>
              </div>
              <Button onClick={saveAccount} disabled={createAccountMutation.isPending}>Create Account</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value}</p></div>;
}

function JournalEntries({ loading, rows, onReverse }: { loading: boolean; rows: any[]; onReverse: (id: string) => void }) {
  return (
    <Card>
      <CardHeader className="border-b"><CardTitle>Journal Entries</CardTitle></CardHeader>
      <CardContent className="p-0">
        {!loading && !rows.length ? (
          <div className="grid place-items-center py-20 text-center">
            <div className="max-w-xl">
              <Landmark className="mx-auto h-14 w-14 text-amber-500" />
              <h2 className="mt-4 text-xl font-bold">Journal Entry</h2>
              <p className="mt-2 text-sm text-slate-500">Manual vouchers are for adjustments, equity, opening balances, and entries that cannot be handled by sales, purchases, payments, or expenses.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Voucher</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2">Status</th><th /></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="p-8 text-center text-slate-500">Loading journal entries...</td></tr> : null}
                {rows.map((row: any) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">{formatDate(row.entry_date)}</td>
                    <td className="px-3 py-2 font-semibold">{row.voucher_number || row.entry_number}</td>
                    <td className="px-3 py-2 capitalize">{row.voucher_type || row.entry_type}</td>
                    <td className="px-3 py-2">{row.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Number(row.total_debit || 0))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Number(row.total_credit || 0))}</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">{row.status || 'posted'}</span></td>
                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" disabled={row.status === 'reversed'} onClick={() => onReverse(row.id)}>Reverse</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartOfAccounts(props: {
  loading: boolean;
  roots: AccountNode[];
  accountType: string;
  onType: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="grid h-[calc(100vh-170px)] grid-cols-[190px_minmax(0,1fr)] overflow-hidden rounded-lg border bg-white">
      <aside className="border-r bg-slate-50">
        <div className="border-b p-3 text-xs font-bold uppercase text-slate-500">Account Type</div>
        {accountTypes.map(([label]) => <button key={label} className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium ${props.accountType === label ? 'bg-sky-100 text-sky-900' : 'hover:bg-white'}`} onClick={() => props.onType(label)}>{label}<ChevronDown className="h-4 w-4" /></button>)}
      </aside>
      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-xl font-bold">Chart of Accounts</h2>
          <div className="flex min-w-0 flex-wrap gap-2">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="w-64 pl-9" value={props.search} onChange={(e) => props.onSearch(e.target.value)} placeholder="Search accounts" /></div>
            <Button onClick={props.onNew}><Plus className="mr-2 h-4 w-4" /> New Account</Button>
          </div>
        </div>
        <div className="overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-28" />
              <col className="w-40" />
            </colgroup>
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Account Name</th><th className="px-3 py-2">Code</th><th className="px-4 py-2 text-right">Balance</th></tr></thead>
            <tbody>
              {props.loading ? <tr><td colSpan={3} className="p-8 text-center text-slate-500">Loading accounts...</td></tr> : null}
              {props.roots.map((node) => <AccountRow key={node.id} node={node} level={0} expanded={props.expanded} onToggle={props.onToggle} />)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AccountRow({ node, level, expanded, onToggle }: { node: AccountNode; level: number; expanded: Record<string, boolean>; onToggle: (id: string) => void }) {
  const hasChildren = !!node.children?.length;
  const isOpen = expanded[node.id] ?? level < 2;
  return (
    <>
      <tr className="border-t hover:bg-slate-50">
        <td className="min-w-0 px-4 py-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: level * 18 }}>
            {hasChildren ? <button onClick={() => onToggle(node.id)}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="w-4" />}
            <span className={`truncate ${level <= 1 ? 'font-semibold' : ''}`} title={node.name}>{node.name}</span>
            {node.is_locked ? <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">locked</span> : null}
          </div>
        </td>
        <td className="px-3 py-2 text-slate-500">{node.code || '-'}</td>
        <td className={`px-4 py-2 text-right font-semibold tabular-nums ${drCrClass(node.balance_type)}`}>{formatMoney(Math.abs(Number(node.balance_paise || 0)))} {node.balance_type}</td>
      </tr>
      {hasChildren && isOpen ? node.children!.map((child) => <AccountRow key={child.id} node={child} level={level + 1} expanded={expanded} onToggle={onToggle} />) : null}
    </>
  );
}
