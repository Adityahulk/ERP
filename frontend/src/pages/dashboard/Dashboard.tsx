import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMoney } from '@/lib/formatters';
import { IndianRupee, AlertTriangle, ArrowRight, Truck, Wrench } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { normalizeRole } from '@/lib/roles';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  
  if (normalizeRole(user?.role) === 'staff') {
      return <Navigate to="/attendance" replace />;
  }

  const { data: rawData } = useQuery({
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

  const todaySales = rawData?.today?.sales?.total || 0;
  const totalReceivable = rawData?.balances?.total_receivable || 0;
  const netProfit = rawData?.month?.profit || 0;
  
  const trendData = rawData?.sales_trend?.map((t:any) => ({
      name: new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' }),
      sales: Number(t.total)
  })) || [];

  const overdueCount = jwOverdue?.length ?? 0;
  const wsOrdersThisMonth = (wsStats?.confirmed_count ?? 0) + (wsStats?.dispatched_count ?? 0) + (wsStats?.delivered_count ?? 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
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

      {/* ROW 1: KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         {/* Today's Revenue */}
         <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center justify-between">
               <div>
                  <p className="text-sm font-medium text-slate-500">Today's Revenue</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{formatMoney(todaySales)}</p>
               </div>
               <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600"><IndianRupee className="w-5 h-5"/></div>
            </CardContent>
         </Card>

         {/* Wholesale Orders */}
         <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center justify-between">
               <div>
                  <p className="text-sm font-medium text-slate-500">Wholesale Orders (Month)</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{wsOrdersThisMonth}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">{formatMoney(wsStats?.delivered_value || 0)} delivered</p>
               </div>
               <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600"><Truck className="w-5 h-5"/></div>
            </CardContent>
         </Card>

         {/* Financial Summary (Merged Outstanding Receivable & Profit/Expenses) */}
         <Card className="hover:shadow-md transition-shadow border-amber-200">
            <CardContent className="p-5 flex flex-col justify-between h-full min-h-[90px]">
               <div>
                  <p className="text-xs font-medium text-slate-500">Net Profit (This Month)</p>
                  <p className="text-2xl font-bold text-green-600 mt-0.5">{formatMoney(netProfit)}</p>
               </div>
               <div className="mt-2 pt-2 border-t border-slate-100 flex flex-col gap-1 text-[10px]">
                  <div className="flex justify-between">
                     <span className="text-slate-500">Outstanding Receivable:</span>
                     <span className="text-amber-600 font-bold">{formatMoney(totalReceivable)}</span>
                  </div>
                  <div className="flex justify-between">
                     <span className="text-slate-500">This Month Expenses:</span>
                     <span className="text-red-500 font-bold">{formatMoney(rawData?.month?.expenses || 0)}</span>
                  </div>
               </div>
            </CardContent>
         </Card>

         {/* Customer Dues (All Time) (Replaces Low Stock Alerts) */}
         <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center justify-between">
               <div>
                  <p className="text-sm font-medium text-slate-500">Customer Dues</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                     {rawData?.balances?.due_customers_count || 0} Customer{Number(rawData?.balances?.due_customers_count) !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-red-500 mt-0.5">{formatMoney(totalReceivable)} Due</p>
               </div>
               <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500"><AlertTriangle className="w-5 h-5"/></div>
            </CardContent>
         </Card>
      </div>

      {/* ROW 2: Charts (Revenue Trend & Customer Dues List) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Revenue Trend Area Chart */}
         <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
               <CardTitle className="text-base font-semibold">Revenue Trend (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px]">
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

         {/* Top Customer Dues List */}
         <Card>
            <CardHeader className="pb-2">
               <CardTitle className="text-base font-semibold">Top Customer Dues (All Time)</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px] overflow-y-auto">
               {rawData?.topDueParties && rawData.topDueParties.length > 0 ? (
                  <div className="space-y-2">
                     {rawData.topDueParties.map((party: any) => (
                        <div
                           key={party.id}
                           onClick={() => navigate('/sales-hub/invoices?search=' + encodeURIComponent(party.name))}
                           className="flex justify-between items-center p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                           <div className="flex-1 min-w-0 mr-2">
                              <p className="font-semibold text-sm truncate text-slate-800">{party.name}</p>
                           </div>
                           <div className="flex items-center gap-3">
                              <p className="font-bold text-sm text-red-500">{formatMoney(party.balance)}</p>
                              {party.phone && (
                                 <a
                                    href={`tel:+91${party.phone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors text-xs"
                                 >
                                    📞
                                 </a>
                              )}
                           </div>
                        </div>
                     ))}
                  </div>
               ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 font-medium py-10">
                     No outstanding dues 🎉
                  </div>
               )}
            </CardContent>
         </Card>
      </div>

      {/* ROW 3: Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         {/* Recent Invoices */}
         <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
               <CardTitle className="text-base font-semibold">Recent Invoices</CardTitle>
               <Link to="/sales-hub/invoices" className="text-xs text-indigo-600 font-medium flex items-center hover:underline">View All <ArrowRight className="w-3 h-3 ml-1"/></Link>
            </CardHeader>
            <CardContent>
               <div className="space-y-2">
                  {rawData?.recent_invoices?.map((inv:any) => (
                     <div key={inv.id} className="flex justify-between items-center p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                        <div>
                           <p className="font-semibold text-sm">{inv.invoice_number}</p>
                           <p className="text-xs text-slate-500 truncate max-w-[180px]">{inv.party_name || 'Walk-in Customer'}</p>
                        </div>
                        <div className="text-right">
                           <p className="font-bold text-sm">{formatMoney(inv.total_amount)}</p>
                           <p className={`text-[10px] font-bold uppercase ${inv.status==='paid'?'text-emerald-600':'text-amber-500'}`}>{inv.status}</p>
                        </div>
                     </div>
                  ))}
                  {(!rawData?.recent_invoices || rawData.recent_invoices.length === 0) && <p className="text-sm text-slate-500 py-4 text-center">No recent invoices.</p>}
               </div>
            </CardContent>
         </Card>

         {/* Job Work Overdue */}
         <Card>
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
