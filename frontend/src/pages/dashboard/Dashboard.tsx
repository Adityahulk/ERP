import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatMoney } from '@/lib/formatters';
import { IndianRupee, AlertTriangle, ArrowRight, Package, Factory, Truck, Wrench } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';

const BRAND_COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuthStore();
  
  if (user?.role === 'staff' || user?.role === 'cashier') {
      return <Navigate to="/billing" replace />;
  }

  const { data: rawData } = useQuery({
     queryKey: ['dashboard_hub'],
     queryFn: async () => (await api.get('/reports/dashboard')).data?.data
  });

  // Manufacturing-specific queries
  const { data: wsStats } = useQuery({
    queryKey: ['dashboard-ws-stats'],
    queryFn: () => api.get('/wholesale', { params: { page: 1, limit: 1 } }).then(r => r.data?.meta),
  });

  const { data: jwOverdue } = useQuery({
    queryKey: ['dashboard-jw-overdue'],
    queryFn: () => api.get('/job-work/overdue').then(r => r.data?.data ?? []),
  });

  const { data: recentProduction } = useQuery({
    queryKey: ['dashboard-production'],
    queryFn: () => api.get('/bom/production-logs', { params: { page: 1, limit: 5 } }).then(r => r.data?.data?.data ?? []),
  });

  const todaySales = rawData?.today?.sales?.total || 0;
  const totalReceivable = rawData?.balances?.total_receivable || 0;
  const lowStockCount = rawData?.low_stock_count || 0;
  
  const trendData = rawData?.sales_trend?.map((t:any) => ({
      name: new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' }),
      sales: Number(t.total)
  })) || [];

  const topItems = rawData?.top_items?.map((t:any) => ({
      name: t.name, value: Number(t.total_amount)
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

      {/* ROW 1: Manufacturing Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center justify-between">
               <div>
                  <p className="text-sm font-medium text-slate-500">Today's Revenue</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{formatMoney(todaySales)}</p>
               </div>
               <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600"><IndianRupee className="w-5 h-5"/></div>
            </CardContent>
         </Card>
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
         <Card className="hover:shadow-md transition-shadow border-amber-200">
            <CardContent className="p-5 flex items-center justify-between">
               <div>
                  <p className="text-sm font-medium text-slate-500">Outstanding Receivable</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1">{formatMoney(totalReceivable)}</p>
               </div>
               <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600"><AlertTriangle className="w-5 h-5"/></div>
            </CardContent>
         </Card>
         <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center justify-between">
               <div>
                  <p className="text-sm font-medium text-slate-500">Low Stock Alerts</p>
                  <p className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{lowStockCount}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{lowStockCount > 0 ? 'items below reorder' : 'all stock healthy'}</p>
               </div>
               <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600"><Package className="w-5 h-5"/></div>
            </CardContent>
         </Card>
      </div>

      {/* ROW 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

         <Card>
            <CardHeader className="pb-2">
               <CardTitle className="text-base font-semibold">Top Items (This Month)</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px]">
               {topItems.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie data={topItems} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                           {topItems.map((_:any, index:number) => (
                              <Cell key={`cell-${index}`} fill={BRAND_COLORS[index % BRAND_COLORS.length]} />
                           ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatMoney(value)} />
                     </PieChart>
                  </ResponsiveContainer>
               ) : (
                  <div className="h-full flex items-center justify-center bg-slate-50 rounded text-slate-400">Awaiting sales data</div>
               )}
            </CardContent>
         </Card>
      </div>

      {/* ROW 3: Manufacturing Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Recent Production */}
         <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
               <CardTitle className="text-base font-semibold flex items-center gap-2"><Factory className="w-4 h-4 text-indigo-600" /> Recent Production</CardTitle>
               <Link to="/production" className="text-xs text-indigo-600 font-medium flex items-center hover:underline">View All <ArrowRight className="w-3 h-3 ml-1"/></Link>
            </CardHeader>
            <CardContent>
               <div className="space-y-2">
                  {recentProduction?.map((log: any) => (
                     <div key={log.id} className="flex justify-between items-center p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                        <div>
                           <p className="font-medium text-sm">{log.finished_item_name}</p>
                           <p className="text-xs text-slate-500">{log.production_number} • {new Date(log.production_date).toLocaleDateString('en-IN')}</p>
                        </div>
                        <div className="text-right">
                           <p className="font-bold text-sm">{log.quantity_produced} units</p>
                           <p className="text-[10px] text-slate-500">{formatMoney(log.total_cost)}</p>
                        </div>
                     </div>
                  ))}
                  {(!recentProduction || recentProduction.length === 0) && <p className="text-sm text-slate-400 py-4 text-center">No production yet. Create a BOM to start.</p>}
               </div>
            </CardContent>
         </Card>

         {/* Recent Invoices */}
         <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
               <CardTitle className="text-base font-semibold">Recent Invoices</CardTitle>
               <Link to="/sales" className="text-xs text-indigo-600 font-medium flex items-center hover:underline">View All <ArrowRight className="w-3 h-3 ml-1"/></Link>
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
