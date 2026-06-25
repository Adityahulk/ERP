import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
  Repeat,
  Receipt,
  History,
  FileSpreadsheet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useCompany } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatMoney } from '@/lib/formatters';
import MoneyInput from '@/components/transactions/MoneyInput';

type Workspace = 'journal' | 'chart' | 'statement' | 'templates' | 'gst_ledger' | 'audit_logs' | 'gst_returns';
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
type JournalLine = { account_id: string; party_id?: string; debit: number; credit: number; description?: string };
type PartyOption = { id: string; name: string; balance?: number };
type AccountPickerOption =
  | (AccountNode & { level: number; optionType: 'account'; value: string })
  | {
      id: string;
      name: string;
      level: number;
      optionType: 'party';
      value: string;
      account_id: string;
      party_id: string;
      balance?: number;
    };

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

function isPartyLedgerAccount(account: AccountNode & { level: number }) {
  const name = account.name.toLowerCase();
  return name === 'sundry debtors' || name === 'sundry creditors';
}

function buildJournalAccountOptions(accounts: Array<AccountNode & { level: number }>, parties: PartyOption[]): AccountPickerOption[] {
  return accounts.flatMap((account) => {
    const accountOption: AccountPickerOption = { ...account, optionType: 'account', value: account.id };
    if (!isPartyLedgerAccount(account) || !parties.length) return [accountOption];
    const partyOptions: AccountPickerOption[] = parties.map((party) => ({
      id: `${account.id}:${party.id}`,
      name: party.name,
      level: account.level + 1,
      optionType: 'party',
      value: `party:${account.id}:${party.id}`,
      account_id: account.id,
      party_id: party.id,
      balance: party.balance,
    }));
    return [accountOption, ...partyOptions];
  });
}

function journalLineAccountValue(line: JournalLine) {
  return line.party_id ? `party:${line.account_id}:${line.party_id}` : line.account_id;
}

function drCrClass(kind?: string) {
  return kind === 'Cr' ? 'text-emerald-700' : 'text-sky-700';
}

export default function AccountingDashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: companyData } = useCompany();
  const gstEnabled = (companyData as any)?.tax_settings?.enable_gst !== false;
  const [workspace, setWorkspace] = useState<Workspace>('journal');
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Drill-down from Trial Balance (and anywhere else) lands here via
  // ?account=<id> — this is what actually opens the Account Statement
  // workspace pre-loaded with that account, rather than just navigating
  // to a blank page and leaving the user to pick it manually.
  useEffect(() => {
    const accountId = searchParams.get('account');
    if (accountId) {
      setWorkspace('statement');
      setStatementAccountId(accountId);
      // Clean the URL so refreshing/sharing the link later doesn't
      // re-trigger this every time, while keeping the selection live
      // in state for the rest of the session.
      const next = new URLSearchParams(searchParams);
      next.delete('account');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());

  const { data: accountsTree = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounting', 'accounts-tree'],
    queryFn: async () => (await api.get('/accounting/accounts/tree')).data?.data as AccountNode[],
  });

  const { data: partyOptions = [] } = useQuery({
    queryKey: ['accounting', 'party-options'],
    queryFn: async () => {
      const body = (await api.get('/parties', { params: { page: 1, limit: 500, is_active: true } })).data?.data;
      return ((body?.data ?? body ?? []) as PartyOption[]).map((party) => ({
        id: party.id,
        name: party.name,
        balance: Number(party.balance || 0),
      }));
    },
  });

  const accountOptions = useMemo(() => flattenAccounts(accountsTree), [accountsTree]);
  const journalAccountOptions = useMemo(
    () => buildJournalAccountOptions(accountOptions, partyOptions),
    [accountOptions, partyOptions],
  );
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

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['accounting', 'journal-templates'],
    queryFn: async () => (await api.get('/accounting/journal-templates')).data?.data || [],
    enabled: workspace === 'templates',
  });

  const { data: gstLedger, isLoading: gstLedgerLoading } = useQuery({
    queryKey: ['accounting', 'gst-ledger', fromDate, toDate],
    queryFn: async () => (await api.get('/accounting/gst-ledger', { params: { from_date: fromDate, to_date: toDate } })).data,
    enabled: workspace === 'gst_ledger' && gstEnabled,
  });

  const { data: auditLogs, isLoading: auditLogsLoading } = useQuery({
    queryKey: ['accounting', 'audit-logs'],
    queryFn: async () => (await api.get('/accounting/audit-logs', { params: { limit: 100 } })).data?.data,
    enabled: workspace === 'audit_logs',
  });

  const { data: gstDashboard, isLoading: gstDashboardLoading } = useQuery({
    queryKey: ['gst', 'dashboard'],
    queryFn: async () => (await api.get('/gst/dashboard')).data?.data,
    enabled: workspace === 'gst_returns' && gstEnabled,
  });

  const { data: gstValidation, isLoading: gstValidationLoading } = useQuery({
    queryKey: ['gst', 'validation'],
    queryFn: async () => (await api.get('/gst/validation')).data,
    enabled: workspace === 'gst_returns' && gstEnabled,
  });

  const { data: gstEligibility, isLoading: eligibilityLoading } = useQuery({
    queryKey: ['gst', 'eligibility'],
    queryFn: async () => (await api.get('/gst/eligibility')).data,
    enabled: workspace === 'gst_returns' && gstEnabled,
  });

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ['accounting', 'statement', statementAccountId, fromDate, toDate],
    enabled: !!statementAccountId,
    queryFn: async () =>
      (await api.get(`/accounting/accounts/${statementAccountId}/statement`, { params: { from_date: fromDate, to_date: toDate } })).data?.data,
  });

  const createJournalMutation = useMutation({
    mutationFn: (payload: any) => api.post('/accounting/journal-entries', payload),
    onSuccess: (_res, payload) => {
      toast.success(payload?.status === 'draft' ? 'Saved as draft' : 'Journal entry posted');
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

  const applyTemplateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/accounting/journal-templates/${id}/apply`),
    onSuccess: () => {
      toast.success('Draft journal entry created from template — review and post it from Journal Entries');
      setWorkspace('journal');
      qc.invalidateQueries({ queryKey: ['accounting', 'journal-entries'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not apply template'),
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (name: string) => api.post('/accounting/journal-templates', {
      name,
      voucher_type: 'journal',
      lines: journalForm.lines
        .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({ account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description })),
    }),
    onSuccess: () => {
      toast.success('Template saved — find it under Journal Templates');
      qc.invalidateQueries({ queryKey: ['accounting', 'journal-templates'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save template'),
  });

  const submitJournalMutation = useMutation({
    mutationFn: (id: string) => api.post(`/accounting/journal-entries/${id}/submit`),
    onSuccess: () => { toast.success('Submitted for approval'); qc.invalidateQueries({ queryKey: ['accounting'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not submit'),
  });
  const approveJournalMutation = useMutation({
    mutationFn: (id: string) => api.post(`/accounting/journal-entries/${id}/approve`),
    onSuccess: () => { toast.success('Journal entry approved and posted'); qc.invalidateQueries({ queryKey: ['accounting'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not approve'),
  });
  const rejectJournalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/accounting/journal-entries/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('Journal entry sent back to draft'); qc.invalidateQueries({ queryKey: ['accounting'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not reject'),
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

  const saveJournal = (status: 'draft' | 'posted' = 'posted') => {
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
      status,
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
            ['templates', Repeat, 'Journal Templates'],
            ...(gstEnabled ? [['gst_ledger', Receipt, 'GST Ledger']] : []),
            ...(gstEnabled ? [['gst_returns', FileSpreadsheet, 'GST Returns']] : []),
            ['audit_logs', History, 'Audit Logs'],
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
              onSubmit={(id) => submitJournalMutation.mutate(id)}
              onApprove={(id) => approveJournalMutation.mutate(id)}
              onReject={(id) => { const reason = window.prompt('Reason for rejecting this entry?'); if (reason) rejectJournalMutation.mutate({ id, reason }); }}
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

          {workspace === 'templates' && (
            <Card>
              <CardHeader className="border-b flex flex-row items-center justify-between">
                <CardTitle>Journal Templates</CardTitle>
                <p className="text-xs text-muted-foreground">Apply a template to create a draft entry — amounts are confirmed and posted manually, never auto-posted.</p>
              </CardHeader>
              <CardContent className="p-0">
                {templatesLoading && <p className="p-8 text-center text-slate-500">Loading templates...</p>}
                {!templatesLoading && !templates.length && (
                  <div className="grid place-items-center py-16 text-center">
                    <Repeat className="mx-auto h-12 w-12 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">No journal templates yet. Save a recurring entry (like monthly depreciation or rent) as a template from Journal Entries.</p>
                  </div>
                )}
                <div className="divide-y">
                  {templates.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-xs text-slate-500">{t.description || `${(t.lines || []).length} lines`} {t.is_recurring ? `· Recurring (${t.recurrence})` : ''}</p>
                      </div>
                      <Button size="sm" onClick={() => applyTemplateMutation.mutate(t.id)} disabled={applyTemplateMutation.isPending}>Use Template</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {workspace === 'gst_ledger' && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>GST Ledger</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Input/Output CGST, SGST, and IGST account balances — drawn from the same journal postings as every sale and purchase invoice.</p>
              </CardHeader>
              <CardContent className="p-4">
                {!gstEnabled ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="font-medium text-foreground">GST Disabled For This Company</p>
                    <p className="text-sm mt-1">Enable GST in Settings → Taxes &amp; GST to use the GST Ledger.</p>
                  </div>
                ) : (
                <div className="grid gap-3 md:grid-cols-2 mb-4">
                  <label className="text-sm font-medium">From<Input className="mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
                  <label className="text-sm font-medium">To<Input className="mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
                </div>
                )}
                {gstEnabled && gstLedgerLoading && <p className="text-center text-slate-500 py-8">Loading...</p>}
                {gstEnabled && !gstLedgerLoading && gstLedger && (
                  <>
                    <div className="grid gap-3 md:grid-cols-3 mb-4">
                      <SummaryTile label="Output GST (Payable)" value={formatMoney(gstLedger.meta?.total_output_gst_paise || 0)} />
                      <SummaryTile label="Input GST (Credit)" value={formatMoney(gstLedger.meta?.total_input_gst_paise || 0)} />
                      <SummaryTile label="Net GST Payable" value={formatMoney(gstLedger.meta?.net_gst_payable_paise || 0)} />
                    </div>
                    <div className="overflow-auto rounded-md border bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr></thead>
                        <tbody>
                          {(gstLedger.data || []).map((row: any) => (
                            <tr key={row.account_id} className="border-t">
                              <td className="px-3 py-2 font-medium">{row.account_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.debit)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.credit)}</td>
                            </tr>
                          ))}
                          {!(gstLedger.data || []).length && <tr><td colSpan={3} className="p-8 text-center text-slate-500">No GST postings in this period yet.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {workspace === 'gst_returns' && !gstEnabled && (
            <Card>
              <CardContent className="p-4">
                <div className="text-center py-12 text-muted-foreground">
                  <p className="font-medium text-foreground">GST Disabled For This Company</p>
                  <p className="text-sm mt-1">Enable GST in Settings → Taxes &amp; GST to use GST Returns.</p>
                </div>
              </CardContent>
            </Card>
          )}
          {workspace === 'gst_returns' && gstEnabled && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="border-b"><CardTitle>GST Dashboard</CardTitle></CardHeader>
                <CardContent className="p-4">
                  {gstDashboardLoading && <p className="text-center text-slate-500 py-6">Loading...</p>}
                  {!gstDashboardLoading && gstDashboard && (
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      <SummaryTile label="GST Collected" value={formatMoney(gstDashboard.gstCollectedPaise)} />
                      <SummaryTile label="GST Paid (Input)" value={formatMoney(gstDashboard.gstPaidPaise)} />
                      <SummaryTile label="Input Credit Available" value={formatMoney(gstDashboard.inputCreditAvailablePaise)} />
                      <SummaryTile label="Net Tax Liability" value={formatMoney(gstDashboard.netTaxLiabilityPaise)} />
                      <SummaryTile label="GST Pending" value={formatMoney(gstDashboard.gstPendingPaise)} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b flex flex-row items-center justify-between">
                  <CardTitle>GST Validation</CardTitle>
                  {gstValidation?.meta?.totalIssues > 0 ? (
                    <Badge className="bg-red-100 text-red-700">{gstValidation.meta.totalIssues} issue{gstValidation.meta.totalIssues === 1 ? '' : 's'}</Badge>
                  ) : (
                    <Badge className="bg-emerald-100 text-emerald-700">No issues found</Badge>
                  )}
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {gstValidationLoading && <p className="text-center text-slate-500 py-4">Checking...</p>}
                  {!gstValidationLoading && gstValidation?.data && (
                    <>
                      {gstValidation.data.missingGstin.length > 0 && (
                        <div className="text-sm"><span className="font-semibold text-red-700">{gstValidation.data.missingGstin.length} invoice(s)</span> over ₹2,50,000 with no party GSTIN on file.</div>
                      )}
                      {gstValidation.data.invalidGstin.length > 0 && (
                        <div className="text-sm"><span className="font-semibold text-red-700">{gstValidation.data.invalidGstin.length} part{gstValidation.data.invalidGstin.length === 1 ? 'y' : 'ies'}</span> with a GSTIN that doesn't match the standard 15-character format.</div>
                      )}
                      {gstValidation.data.missingHsn.length > 0 && (
                        <div className="text-sm"><span className="font-semibold text-red-700">{gstValidation.data.missingHsn.length} item(s)</span> sold with GST applied but no HSN code on file.</div>
                      )}
                      {gstValidation.data.taxMismatch.length > 0 && (
                        <div className="text-sm"><span className="font-semibold text-red-700">{gstValidation.data.taxMismatch.length} line item(s)</span> where the recorded tax doesn't match taxable value × GST rate.</div>
                      )}
                      {gstValidation.meta.totalIssues === 0 && <p className="text-sm text-muted-foreground">All checks passed for the current period.</p>}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b"><CardTitle>GST Returns</CardTitle></CardHeader>
                <CardContent className="p-4 grid gap-2 sm:grid-cols-2">
                  {[
                    ['GSTR-1 Data', 'Outward supplies — B2B, B2C, exports, nil-rated, exempted'],
                    ['GSTR2', 'Inward supplies from purchase bills and vendor GST data'],
                    ['GSTR-2A Reconciliation', 'Match your purchase records against vendor-filed data'],
                    ['GSTR-3B Summary', 'Monthly summary return — output GST, input GST, net payable'],
                    ['HSN Summary', 'Goods sold, grouped by HSN code'],
                    ['SAC Summary', 'Services sold, grouped by SAC code'],
                    ['GST Rate Report', 'Sales grouped by GST rate slab'],
                  ].map(([name, desc]) => (
                    <button key={name} onClick={() => navigate(`/reports?report=${encodeURIComponent(name)}`)} className="text-left p-3 rounded-md border hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors">
                      <p className="font-semibold text-sm">{name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </button>
                  ))}
                </CardContent>
                <CardContent className="p-4 pt-0">
                  <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
                    <strong>GSTR9 (annual return)</strong> is not built as a structured filing screen — it's a complex annual reconciliation with specific government schema requirements, and getting it wrong on an actual tax filing is a real risk. The monthly reports above give you the real underlying figures an accountant would need to prepare it manually.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b flex flex-row items-center justify-between">
                  <CardTitle>GSTR4 – GSTR9C Eligibility</CardTitle>
                  {!eligibilityLoading && gstEligibility?.meta?.companyRegistrationType && (
                    <select
                      value={gstEligibility.meta.companyRegistrationType}
                      onChange={async (e) => {
                        await api.patch('/gst/registration-type', { gst_registration_type: e.target.value });
                        qc.invalidateQueries({ queryKey: ['gst', 'eligibility'] });
                      }}
                      className="text-xs border rounded-md px-2 py-1"
                    >
                      {['regular', 'composition', 'casual_taxable', 'non_resident', 'input_service_distributor', 'tds_deductor', 'ecommerce_operator', 'unregistered'].map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  )}
                </CardHeader>
                <CardContent className="p-4 space-y-2">
                  <p className="text-xs text-muted-foreground mb-2">Which returns apply depends on how your company is registered under GST — set it above if it's wrong.</p>
                  {eligibilityLoading && <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>}
                  {!eligibilityLoading && (gstEligibility?.data || []).filter((r: any) => !['gstr1', 'gstr3b'].includes(r.key)).map((r: any) => (
                    <div key={r.key} className="flex items-center justify-between p-2.5 rounded-md border">
                      <div>
                        <p className="text-sm font-semibold">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.description}</p>
                      </div>
                      <Badge className={r.applicable ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                        {r.applicable ? 'Applicable' : 'Not Applicable'}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {workspace === 'audit_logs' && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Audit Logs</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Who created, modified, or approved records, with old/new values and IP address.</p>
              </CardHeader>
              <CardContent className="p-0">
                {auditLogsLoading && <p className="p-8 text-center text-slate-500">Loading...</p>}
                {!auditLogsLoading && (
                  <div className="overflow-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">IP Address</th></tr></thead>
                      <tbody>
                        {(auditLogs?.data || []).map((log: any) => (
                          <tr key={log.id} className="border-t align-top">
                            <td className="px-3 py-2 whitespace-nowrap">{new Date(log.created_at).toLocaleString('en-IN')}</td>
                            <td className="px-3 py-2">{log.user_name || 'System'}</td>
                            <td className="px-3 py-2 capitalize">{String(log.action).replace(/_/g, ' ')}</td>
                            <td className="px-3 py-2 capitalize">{log.entity}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-500">{log.ip_address || '—'}</td>
                          </tr>
                        ))}
                        {!(auditLogs?.data || []).length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No audit activity recorded yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
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
                            <select
                              className="h-10 w-full rounded-md border bg-white px-3"
                              value={journalLineAccountValue(line)}
                              onChange={(e) => {
                                const selected = journalAccountOptions.find((option) => option.value === e.target.value);
                                if (selected?.optionType === 'party') {
                                  updateLine(index, { account_id: selected.account_id, party_id: selected.party_id });
                                  return;
                                }
                                updateLine(index, { account_id: e.target.value, party_id: undefined });
                              }}
                            >
                              <option value="">Select account</option>
                              {journalAccountOptions.map((option) => (
                                <option key={option.id} value={option.value}>
                                  {`${'-- '.repeat(Math.min(option.level, 4))}${option.name}${option.optionType === 'party' ? ' (party)' : ''}`}
                                </option>
                              ))}
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
                <div className="mt-5 flex gap-2">
                  <Button variant="outline" className="flex-1" disabled={!totals.balanced || createJournalMutation.isPending} onClick={() => saveJournal('draft')}>Save as Draft</Button>
                  <Button className="flex-1" disabled={!totals.balanced || createJournalMutation.isPending} onClick={() => saveJournal('posted')}>Post Journal Entry</Button>
                </div>
                <button
                  type="button"
                  className="mt-2 w-full text-center text-xs text-indigo-600 hover:underline disabled:opacity-50"
                  disabled={!totals.balanced || saveTemplateMutation.isPending}
                  onClick={() => {
                    const name = window.prompt('Save this as a template named:', journalForm.description);
                    if (name?.trim()) saveTemplateMutation.mutate(name.trim());
                  }}
                >
                  Save these lines as a reusable template
                </button>
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

const JOURNAL_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_approval: 'bg-amber-100 text-amber-700',
  posted: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-500',
  reversed: 'bg-red-100 text-red-700',
};

function JournalEntries({ loading, rows, onReverse, onSubmit, onApprove, onReject }: {
  loading: boolean; rows: any[]; onReverse: (id: string) => void;
  onSubmit: (id: string) => void; onApprove: (id: string) => void; onReject: (id: string) => void;
}) {
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
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Voucher</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
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
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs capitalize ${JOURNAL_STATUS_COLORS[row.status] || 'bg-slate-100 text-slate-600'}`}>{(row.status || 'posted').replace('_', ' ')}</span></td>
                    <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                      {row.entry_type === 'manual' && row.status === 'draft' && (
                        <Button variant="outline" size="sm" onClick={() => onSubmit(row.id)}>Submit</Button>
                      )}
                      {row.status === 'pending_approval' && (
                        <>
                          <Button variant="outline" size="sm" className="text-emerald-700" onClick={() => onApprove(row.id)}>Approve</Button>
                          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onReject(row.id)}>Reject</Button>
                        </>
                      )}
                      {row.status === 'posted' && (
                        <Button variant="ghost" size="sm" onClick={() => onReverse(row.id)}>Reverse</Button>
                      )}
                    </td>
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
