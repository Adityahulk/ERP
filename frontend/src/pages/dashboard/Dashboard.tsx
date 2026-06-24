import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { formatMoney } from '@/lib/formatters';
import {
  IndianRupee, AlertTriangle, ArrowRight, Truck, Wrench, ArrowUpRight, ArrowDownRight,
  TrendingUp, TrendingDown, Wallet, Package, Bell, Clock,
} from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { normalizeRole } from '@/lib/roles';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function KpiCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5 flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-10 w-10 rounded-full" />
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  if (normalizeRole(user?.role) === 'staff') {
      return <Navigate to="/attendance" replace />;
  }

  const { data: rawData, isLoading: dashLoading } = useQuery({
     queryKey: ['dashboard_hub'],
     queryFn: async () => (await api.get('/reports/dashboard')).data?.data
  });

  const { data: wsStats } = useQuery({
    queryKey: ['dashboard-ws-stats'],
    queryFn: () => api.get('/wholesale', { params: { page: 1, limit: 1 } }).then(r => r.data?.meta),
  });

  const { data: jwOverdue } = useQuery({
    queryKey: ['dashboard-jw-overdue'],
    queryFn: () => api.get('/job-work/overdue').then(r => r.data?.data ?? []),
  });

  // Low Stock Items widget — real data from the existing /reports/low-stock endpoint
  const { data: lowStockItems } = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: () => api.get('/reports/low-stock').then(r => r.data?.data ?? []),
  });

  // Purchase Analytics widget — real data from the existing /reports/purchase-register
  // endpoint (defaults to the current month when no from/to is given).
  const { data: purchaseRows } = useQuery({
    queryKey: ['dashboard-purchase-register'],
    queryFn: () => api.get('/reports/purchase-register').then(r => r.data?.data ?? []),
  });

  const todaySales = rawData?.today?.sales?.total || 0;
  const totalReceivable = rawData?.balances?.total_receivable || 0;
  const totalPayable = rawData?.balances?.total_payable || 0;
  const netProfit = rawData?.month?.profit || 0;
  const dueCustomers = rawData?.balances?.due_customers_count || 0;

  const trendData = rawData?.sales_trend?.map((t:any) => ({
      name: new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' }),
      sales: Number(t.total)
  })) || [];

  // Real day-over-day growth indicator for Today's Revenue, derived from the
  // same 7-day trend series the chart below uses (no fabricated numbers).
  const todayGrowthPct = (() => {
    const series = rawData?.sales_trend;
    if (!Array.isArray(series) || series.length < 2) return null;
    const yesterday = Number(series[series.length - 2]?.total || 0);
    const today = Number(series[series.length - 1]?.total || 0);
    if (yesterday <= 0) return null;
    return Math.round(((today - yesterday) / yesterday) * 100);
  })();

  const overdueCount = jwOverdue?.length ?? 0;
  const wsOrdersThisMonth = (wsStats?.confirmed_count ?? 0) + (wsStats?.dispatched_count ?? 0) + (wsStats?.delivered_count ?? 0);

  const purchaseTotalThisMonth = (purchaseRows || []).reduce((s: number, r: any) => s + (parseInt(r.total_amount) || 0), 0);

  const kpis = [
    {
      label: "Today's Revenue",
      value: formatMoney(todaySales),
      icon: IndianRupee,
      color: 'text-indigo-600 bg-indigo-50',
      growth: todayGrowthPct,
      growthLabel: 'vs yesterday',
    },
    {
      label: 'Total Receivable',
      value: formatMoney(totalReceivable),
      icon: ArrowUpRight,
      color: 'text-emerald-600 bg-emerald-50',
      sub: `${dueCustomers} customer${dueCustomers !== 1 ? 's' : ''} owe you`,
    },
    {
      label: 'Total Payable',
      value: formatMoney(totalPayable),
      icon: ArrowDownRight,
      color: 'text-rose-600 bg-rose-50',
      sub: 'You owe suppliers',
    },
    {
      label: 'Net Profit',
      value: formatMoney(netProfit),
      icon: TrendingUp,
      color: 'text-violet-600 bg-violet-50',
      sub: 'This month',
    },
    {
      label: 'Customer Dues',
      value: `${dueCustomers}`,
      icon: AlertTriangle,
      color: 'text-amber-600 bg-amber-50',
      sub: `${formatMoney(totalReceivable)} outstanding`,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="flex justify-between items-end">
         <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{getGreeting()}, {user?.name}</h1>
            <p className="text-slate-500 text-sm mt-1">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
         </div>
      </div>

      {/* Job Work Overdue Alert */}
      {overdueCount > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-red-800">{overdueCount} Overdue Job Work Challan{overdueCount > 1 ? 's' : ''}</p>
              <p className="text-xs text-red-600">Materials not returned within GST Section 143 deadline — may be treated as deemed supply.</p>
            </div>
            <Link to="/job-work" className="text-xs font-medium text-red-700 hover:underline flex items-center gap-1">View <ArrowRight className="w-3 h-3" /></Link>
          </CardContent>
        </Card>
      )}

      {/* ROW 1: 5 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {dashLoading
          ? Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
          : kpis.map((c) => (
            <Card key={c.label} className="rounded-2xl hover:shadow-md transition-shadow">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 truncate">{c.label}</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 truncate">{c.value}</p>
                  {c.growth !== undefined && c.growth !== null ? (
                    <p className={`text-[11px] mt-0.5 flex items-center gap-1 font-semibold ${c.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {c.growth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(c.growth)}% {c.growthLabel}
                    </p>
                  ) : c.sub ? (
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">{c.sub}</p>
                  ) : null}
                </div>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${c.color}`}><c.icon className="w-5 h-5"/></div>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* ROW 2: Revenue Trend + Sales/Purchase Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         <Card className="lg:col-span-2 rounded-2xl">
            <CardHeader className="pb-2">
               <CardTitle className="text-base font-semibold">Revenue Trend (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[260px]">
               {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={trendData}>
                        <defs>
                           <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                           </linearGradient>
                        </defs>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                        <YAxis axisLine={false} tickLine={false} tickFormatter={(val) => `₹${val/100000}L`} tick={{fontSize: 12, fill: '#64748b'}}/>
                        <Tooltip formatter={(value: number) => formatMoney(value)} />
                        <Area type="monotone" dataKey="sales" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                     </AreaChart>
                  </ResponsiveContainer>
               ) : (
                  <div className="h-full flex items-center justify-center bg-slate-50 rounded text-slate-400">Not enough data to graph</div>
               )}
            </CardContent>
         </Card>

         {/* Sales & Purchase Analytics stacked */}
         <div className="space-y-4">
           <Card className="rounded-2xl">
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-600" /> Sales Analytics</CardTitle>
             </CardHeader>
             <CardContent className="grid grid-cols-2 gap-3 text-sm">
               <div>
                 <p className="text-muted-foreground text-xs">Today</p>
                 <p className="font-bold tabular-nums">{rawData?.today?.sales?.count ?? 0} bills</p>
               </div>
               <div>
                 <p className="text-muted-foreground text-xs">This month</p>
                 <p className="font-bold tabular-nums">{rawData?.month?.sales?.count ?? 0} bills</p>
               </div>
             </CardContent>
           </Card>
           <Card className="rounded-2xl">
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-semibold flex items-center gap-2"><Truck className="w-4 h-4 text-sky-600" /> Purchase Analytics</CardTitle>
             </CardHeader>
             <CardContent className="text-sm">
               <p className="text-muted-foreground text-xs">This month's purchases</p>
               <p className="font-bold tabular-nums text-lg">{formatMoney(purchaseTotalThisMonth)}</p>
               <p className="text-[11px] text-muted-foreground mt-0.5">{(purchaseRows || []).length} bill{(purchaseRows || []).length !== 1 ? 's' : ''} recorded</p>
             </CardContent>
           </Card>
         </div>
      </div>

      {/* ROW 3: Recent Transactions + Right widget rail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <Card className="lg:col-span-2 rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
             <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
             <Link to="/sales-hub/invoices" className="text-xs text-indigo-600 font-medium flex items-center hover:underline">View All <ArrowRight className="w-3 h-3 ml-1"/></Link>
          </CardHeader>
          <CardContent className="p-0">
            {(!rawData?.recent_invoices || rawData.recent_invoices.length === 0) ? (
              <p className="text-sm text-slate-500 py-8 text-center">No recent invoices.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/60">
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Invoice</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Party</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Date</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Amount</th>
                      <th className="px-4 py-2 text-center font-medium text-xs text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rawData.recent_invoices.map((inv:any) => (
                      <tr key={inv.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/sales/${inv.id}`)}>
                        <td className="px-4 py-2.5 font-medium text-indigo-700">{inv.invoice_number}</td>
                        <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[160px] hidden sm:table-cell">{inv.party_name || 'Walk-in Customer'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(inv.total_amount)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${inv.status==='paid'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right widget rail */}
        <div className="space-y-4">
          {/* Top Customer Dues */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-amber-600" /> Top Customer Dues</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[180px] overflow-y-auto p-0">
              {rawData?.topDueParties && rawData.topDueParties.length > 0 ? (
                <div className="divide-y">
                  {rawData.topDueParties.slice(0, 5).map((party: any) => (
                    <div
                      key={party.id}
                      onClick={() => navigate('/parties')}
                      className="flex justify-between items-center px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      <span className="truncate font-medium">{party.name}</span>
                      <span className="font-bold text-red-500 tabular-nums text-xs shrink-0">{formatMoney(party.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">No outstanding dues 🎉</p>
              )}
            </CardContent>
          </Card>

          {/* Low Stock Items */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-orange-600" /> Low Stock Items</CardTitle>
              {(lowStockItems?.length ?? 0) > 0 && <Link to="/inventory" className="text-[11px] text-indigo-600 hover:underline">View all</Link>}
            </CardHeader>
            <CardContent className="max-h-[180px] overflow-y-auto p-0">
              {lowStockItems && lowStockItems.length > 0 ? (
                <div className="divide-y">
                  {lowStockItems.slice(0, 5).map((it: any) => (
                    <div key={it.id} onClick={() => navigate(`/items/${it.id}`)} className="flex justify-between items-center px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                      <span className="truncate font-medium">{it.name}</span>
                      <span className="font-bold text-orange-600 tabular-nums text-xs shrink-0">{it.total_qty} left</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">Stock levels are healthy ✓</p>
              )}
            </CardContent>
          </Card>

          {/* Pending Payments (today) */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-blue-600" /> Pending Payments Today</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Received</p>
                <p className="font-bold text-emerald-600 tabular-nums">{formatMoney(rawData?.today?.payments?.received || 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Paid out</p>
                <p className="font-bold text-red-500 tabular-nums">{formatMoney(rawData?.today?.payments?.paid || 0)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ROW 4: Wholesale + Job Work — preserved from the original dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         <Card className="rounded-2xl">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
               <CardTitle className="text-base font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-emerald-600" /> Wholesale Orders (Month)</CardTitle>
               <Link to="/wholesale" className="text-xs text-indigo-600 font-medium flex items-center hover:underline">View All <ArrowRight className="w-3 h-3 ml-1"/></Link>
            </CardHeader>
            <CardContent>
               <div className="flex items-center justify-between">
                 <div>
                    <p className="text-2xl font-bold">{wsOrdersThisMonth}</p>
                    <p className="text-xs text-emerald-600 mt-0.5">{formatMoney(wsStats?.delivered_value || 0)} delivered</p>
                 </div>
                 <ResponsiveContainer width="50%" height={60}>
                   <BarChart data={[{ n: 'Confirmed', v: wsStats?.confirmed_count ?? 0 }, { n: 'Dispatched', v: wsStats?.dispatched_count ?? 0 }, { n: 'Delivered', v: wsStats?.delivered_count ?? 0 }]}>
                     <Bar dataKey="v" fill="#10b981" radius={[4,4,0,0]} />
                   </BarChart>
                 </ResponsiveContainer>
               </div>
            </CardContent>
         </Card>

         <Card className="rounded-2xl">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
               <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-600" /> Job Work Status
               </CardTitle>
               <Link to="/job-work" className="text-xs text-indigo-600 font-medium flex items-center hover:underline">View All <ArrowRight className="w-3 h-3 ml-1"/></Link>
            </CardHeader>
            <CardContent>
               {overdueCount > 0 ? (
                  <div className="space-y-2">
                    {(jwOverdue || []).slice(0, 5).map((ch: any) => (
                      <div key={ch.id} className="flex justify-between items-center p-2.5 rounded-lg border border-red-100 bg-red-50/50 hover:bg-red-50 transition-colors">
                        <div>
                          <p className="font-medium text-sm">{ch.challan_number}</p>
                          <p className="text-xs text-red-600">{ch.party_name} • {ch.days_overdue}d overdue</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-xs text-red-600">OVERDUE</p>
                          <p className="text-[10px] text-slate-500">Due: {new Date(ch.return_due_date).toLocaleDateString('en-IN')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
               ) : (
                  <div className="flex flex-col items-center justify-center py-8 bg-emerald-50/50 rounded-xl border border-emerald-100 border-dashed">
                     <span className="text-3xl mb-3">✅</span>
                     <p className="text-slate-700 font-medium text-sm">All clear</p>
                     <p className="text-xs text-slate-500 max-w-[200px] text-center mt-1">No overdue job work challans. GST Section 143 compliant.</p>
                  </div>
               )}
            </CardContent>
         </Card>
      </div>

    </div>
  );
}
