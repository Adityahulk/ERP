import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Truck, Plus, Search, ArrowRight, Package, IndianRupee, Clock, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import type { WholesaleOrder } from '@/types';

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  confirmed: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function WholesaleOrderList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['wholesale-orders', search, statusFilter, page],
    queryFn: () => api.get('/wholesale', { params: { search: search || undefined, status: statusFilter || undefined, page, limit: 20 } }).then(r => r.data),
  });
  const orders: WholesaleOrder[] = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;
  const stats = data?.meta;

  const fmtAmt = (v: number) => `₹${((v || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Truck className="w-7 h-7 text-indigo-600" /> Wholesale Orders</h1>
          <p className="text-slate-500 text-sm mt-1">Manage bulk orders, dispatch, and delivery tracking</p>
        </div>
        <Button className="gap-2" onClick={() => navigate('/wholesale/new')}><Plus className="w-4 h-4" /> New Order</Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[
            { label: 'Draft', value: stats.draft_count, icon: Clock, color: 'text-slate-600' },
            { label: 'Confirmed', value: stats.confirmed_count, icon: CheckCircle2, color: 'text-blue-600' },
            { label: 'Dispatched', value: stats.dispatched_count, icon: Truck, color: 'text-amber-600' },
            { label: 'Delivered', value: stats.delivered_count, icon: Package, color: 'text-emerald-600' },
            { label: 'Delivered Value', value: fmtAmt(stats.delivered_value), icon: IndianRupee, color: 'text-indigo-600' },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <div><p className="text-xs text-slate-500">{s.label}</p><p className="font-bold text-lg">{s.value}</p></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input className="pl-10" placeholder="Search by order #, party..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex gap-1.5">
          {['', 'draft', 'confirmed', 'dispatched', 'delivered', 'cancelled'].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-4 py-3 font-semibold text-slate-600">Order #</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Date</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Party</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Items</th>
              <th className="px-4 py-3 font-semibold text-slate-600 text-right">Amount</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={7}>Loading...</td></tr>}
            {!isLoading && !orders.length && <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={7}>No wholesale orders found</td></tr>}
            {orders.map(order => (
              <tr key={order.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => navigate(`/wholesale/${order.id}`)}>
                <td className="px-4 py-3 font-mono text-xs font-bold">{order.order_number}</td>
                <td className="px-4 py-3">{new Date(order.order_date).toLocaleDateString('en-IN')}</td>
                <td className="px-4 py-3 font-medium">{order.party_name_snapshot || order.party_name || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{(order as any).item_count ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">{fmtAmt(order.total_amount)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${STATUS_BADGES[order.status] || 'bg-slate-100'}`}>{order.status}</span>
                </td>
                <td className="px-4 py-3 text-right"><ArrowRight className="w-4 h-4 text-slate-400 inline" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-slate-500 self-center">Page {pagination.page} of {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
