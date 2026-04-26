import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, ArrowRightLeft, Database, Activity, Loader2 } from 'lucide-react';
import { formatMoney } from '@/lib/formatters';

type ProfitLossReport = {
  period?: { from: string; to: string };
  revenue?: { gross?: number };
  total_expenses?: number;
  net_profit?: number;
};

type BalanceSheetReport = {
  period?: { from: string; to: string };
  assets?: { total_paise?: number };
  liabilities?: { total_paise?: number };
  equity?: { total_paise?: number };
};

export default function AccountingDashboard() {
  const [tab, setTab] = useState('dashboard');

  const { data: plRes, isLoading: plLoading } = useQuery({
    queryKey: ['reports', 'profit-loss', 'accounting-dashboard'],
    queryFn: async () => (await api.get('/reports/profit-loss')).data?.data as ProfitLossReport,
    enabled: tab === 'dashboard',
  });

  const { data: bsRes, isLoading: bsLoading } = useQuery({
    queryKey: ['reports', 'balance-sheet', 'accounting-dashboard'],
    queryFn: async () => (await api.get('/reports/balance-sheet')).data?.data as BalanceSheetReport,
    enabled: tab === 'dashboard',
  });

  const loadingSnap = tab === 'dashboard' && (plLoading || bsLoading);

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          Accounting & Ledgers
        </h1>
        <div className="flex space-x-2">
          <Button variant="outline" className="gap-2">
            <Plus className="w-4 h-4" /> New Journal
          </Button>
        </div>
      </div>

      <div className="flex space-x-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('dashboard')}
          className={`py-2 px-4 border-b-2 font-medium ${tab === 'dashboard' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => setTab('coa')}
          className={`py-2 px-4 border-b-2 font-medium ${tab === 'coa' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          Chart of Accounts
        </button>
        <button
          type="button"
          onClick={() => setTab('jv')}
          className={`py-2 px-4 border-b-2 font-medium ${tab === 'jv' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          Journal Entries
        </button>
        <button
          type="button"
          onClick={() => setTab('ledger')}
          className={`py-2 px-4 border-b-2 font-medium ${tab === 'ledger' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          Ledger Statements
        </button>
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-4">
          {loadingSnap ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              Loading financial snapshot…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Profit & Loss (reports)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    Period {plRes?.period?.from ?? '—'} → {plRes?.period?.to ?? '—'} (operational sales & expenses).
                  </p>
                  <div className="mt-4 p-4 bg-slate-50 rounded border space-y-3">
                    <div className="flex justify-between">
                      <span>Revenue (taxable)</span>
                      <span className="font-medium tabular-nums">{formatMoney(plRes?.revenue?.gross ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Expenses</span>
                      <span className="font-medium text-red-600 tabular-nums">{formatMoney(plRes?.total_expenses ?? 0)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-bold">
                      <span>Net profit</span>
                      <span className="text-emerald-600 tabular-nums">{formatMoney(plRes?.net_profit ?? 0)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <Database className="w-4 h-4" /> Balance sheet (reports)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    Period {bsRes?.period?.from ?? '—'} → {bsRes?.period?.to ?? '—'} — journal-based view with P&amp;L in equity.
                  </p>
                  <div className="mt-4 p-4 bg-slate-50 rounded border space-y-3">
                    <div className="flex justify-between">
                      <span>Total assets</span>
                      <span className="font-medium text-emerald-600 tabular-nums">{formatMoney(bsRes?.assets?.total_paise ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total liabilities</span>
                      <span className="font-medium text-red-600 tabular-nums">{formatMoney(bsRes?.liabilities?.total_paise ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total equity</span>
                      <span className="font-medium text-indigo-600 tabular-nums">{formatMoney(bsRes?.equity?.total_paise ?? 0)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {tab === 'coa' && (
        <Card>
          <CardContent className="p-8 text-center min-h-[300px] flex flex-col justify-center items-center">
            <span className="text-5xl mb-4">🗂️</span>
            <h2 className="text-xl font-bold">Chart of Accounts Management</h2>
            <p className="text-slate-500">
              Standardizing assets, liabilities, equity, income, and expenses structures connected to double-entry journals.
            </p>
            <Button className="mt-4 bg-indigo-600">Add Account Category</Button>
          </CardContent>
        </Card>
      )}

      {tab === 'jv' && (
        <Card>
          <CardContent className="p-8 text-center min-h-[300px] flex flex-col justify-center items-center">
            <ArrowRightLeft className="w-12 h-12 text-slate-300 mb-4" />
            <h2 className="text-xl font-bold">Manual Journal Entries</h2>
            <p className="text-slate-500">
              Record depreciation, asset transfers, or complex adjustments mapping debits to credits via JV forms.
            </p>
            <div className="mt-4 flex gap-4">
              <Input type="date" className="w-40" />
              <Button className="bg-slate-900">Load Entries</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'ledger' && (
        <Card>
          <CardContent className="p-8 text-center text-slate-500">
            <p className="mb-2">Per-account ledgers are available from the API:</p>
            <code className="text-xs bg-muted px-2 py-1 rounded">GET /api/accounting/accounts/:id/ledger?from=YYYY-MM-DD&to=YYYY-MM-DD</code>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
