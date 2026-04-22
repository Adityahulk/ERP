import { useDashboard } from '@/hooks/useBusiness';
import { formatMoney, formatMoneyShort, formatDate } from '@/lib/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  IndianRupee, TrendingUp, TrendingDown, Clock,
  Package, ArrowUpRight, ArrowDownRight, Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { company } = useAuthStore();
  const { data, isLoading } = useDashboard();
  const d = data?.data;

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!d) return null;

  const kpis = [
    { label: "Today's Sales", value: formatMoney(d.today?.sales?.total || 0), sub: `${d.today?.sales?.count || 0} invoices`, icon: IndianRupee, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10', trend: 'up' as const },
    { label: 'Month Sales', value: formatMoneyShort(d.month?.sales?.total || 0).display, sub: `${d.month?.sales?.count || 0} invoices`, icon: TrendingUp, color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' },
    { label: 'Receivable', value: formatMoneyShort(d.balances?.total_receivable || 0).display, sub: 'from customers', icon: ArrowDownRight, color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
    { label: 'Payable', value: formatMoneyShort(d.balances?.total_payable || 0).display, sub: 'to suppliers', icon: ArrowUpRight, color: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
    { label: 'Month Expenses', value: formatMoneyShort(d.month?.expenses || 0).display, sub: '', icon: TrendingDown, color: 'text-orange-600 bg-orange-50 dark:bg-orange-500/10' },
    { label: 'Net Profit', value: formatMoneyShort(d.month?.profit || 0).display, sub: 'this month', icon: IndianRupee, color: (d.month?.profit || 0) >= 0 ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' : 'text-red-600 bg-red-50 dark:bg-red-500/10' },
  ];

  const alerts = [
    d.overdue?.count > 0 && { label: `${d.overdue.count} overdue invoices`, value: formatMoney(d.overdue.total), icon: Clock, color: 'border-red-200 bg-red-50 dark:bg-red-500/5 dark:border-red-500/20' },
    d.low_stock_count > 0 && { label: `${d.low_stock_count} low stock items`, value: 'Needs reorder', icon: Package, color: 'border-amber-200 bg-amber-50 dark:bg-amber-500/5 dark:border-amber-500/20' },
  ].filter(Boolean) as any[];

  const statusColors: Record<string, string> = {
    paid: 'success', partial: 'warning', unpaid: 'destructive', cancelled: 'secondary', overdue: 'destructive',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Welcome back to {company?.name || 'BizFlow'}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${kpi.color}`}>
                  <kpi.icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-lg font-bold tabular-nums">{kpi.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-3 p-4 rounded-xl border ${a.color}`}>
              <a.icon className="w-5 h-5 shrink-0" />
              <div className="flex-1"><p className="text-sm font-medium">{a.label}</p></div>
              <span className="text-sm font-bold tabular-nums">{a.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Sales Trend */}
        <Card className="lg:col-span-3">
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4">Sales Trend (Last 7 Days)</h3>
            <div className="flex items-end gap-1 h-32">
              {(d.sales_trend || []).map((day: any, i: number) => {
                const max = Math.max(...(d.sales_trend || []).map((s: any) => parseInt(s.total) || 0), 1);
                const height = max > 0 ? ((parseInt(day.total) || 0) / max) * 100 : 0;
                const dateStr = new Date(day.date).toLocaleDateString('en-IN', { weekday: 'short' });
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] text-muted-foreground tabular-nums">{formatMoneyShort(parseInt(day.total) || 0).display}</span>
                    <div className="w-full rounded-t-md bg-primary/80 transition-all duration-500" style={{ height: `${Math.max(height, 4)}%` }} />
                    <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Top Items */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4">Top Selling Items</h3>
            <div className="space-y-3">
              {(d.top_items || []).length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No sales this month</p>}
              {(d.top_items || []).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">{i + 1}</span>
                    <div className="min-w-0"><p className="text-sm font-medium truncate">{item.name}</p><p className="text-[10px] text-muted-foreground">{item.total_qty} sold</p></div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{formatMoney(parseInt(item.total_amount) || 0)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Invoices</h3>
            <button onClick={() => navigate('/invoices')} className="text-sm text-primary hover:underline">View all →</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-muted-foreground">
                <th className="text-left p-2 font-medium">Invoice</th>
                <th className="text-left p-2 font-medium">Party</th>
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-right p-2 font-medium">Amount</th>
                <th className="text-center p-2 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {(d.recent_invoices || []).map((inv: any) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <td className="p-2 font-medium">{inv.invoice_number}</td>
                    <td className="p-2 text-muted-foreground">{inv.party_name || '—'}</td>
                    <td className="p-2 text-muted-foreground">{formatDate(inv.invoice_date)}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{formatMoney(inv.total_amount)}</td>
                    <td className="p-2 text-center"><Badge variant={statusColors[inv.status] as any || 'secondary'}>{inv.status}</Badge></td>
                  </tr>
                ))}
                {(d.recent_invoices || []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No invoices yet</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
