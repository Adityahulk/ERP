import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wrench, Plus, Search, ArrowRight, AlertTriangle, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import api from '@/lib/api';
import type { JobWorkChallan } from '@/types';

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', sent: 'bg-blue-100 text-blue-700',
  partial_return: 'bg-amber-100 text-amber-700', returned: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700', cancelled: 'bg-red-50 text-red-500',
};

export default function JobWorkChallanList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['jw-challans', search, typeFilter, statusFilter, page],
    queryFn: () => api.get('/job-work/challans', {
      params: { search: search || undefined, challan_type: typeFilter || undefined, status: statusFilter || undefined, page, limit: 20 }
    }).then(r => r.data),
  });
  const challans: JobWorkChallan[] = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;
  const stats = data?.meta;

  const { data: overdueData } = useQuery({
    queryKey: ['jw-overdue'],
    queryFn: () => api.get('/job-work/overdue').then(r => r.data?.data ?? []),
  });
  const overdueCount = overdueData?.length ?? 0;

  const fmtAmt = (v: number) => `₹${((v || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Wrench className="w-7 h-7 text-indigo-600" /> Job Work Challans</h1>
          <p className="text-slate-500 text-sm mt-1">Track material movement and service-only job work with job workers</p>
        </div>
        <Button className="gap-2" onClick={() => navigate('/job-work/new')}><Plus className="w-4 h-4" /> New Challan</Button>
      </div>

      {/* Overdue Warning */}
      {overdueCount > 0 && (
        <Card className="mb-6 border-red-200 bg-red-50"><CardContent className="p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <div className="flex-1">
            <p className="font-bold text-red-800">{overdueCount} Overdue Challan{overdueCount > 1 ? 's' : ''}</p>
            <p className="text-xs text-red-600">Materials not returned within GST Section 143 deadline. This may be treated as deemed supply.</p>
          </div>
          <Button variant="outline" size="sm" className="text-red-600 border-red-300" onClick={() => setStatusFilter('sent')}>View</Button>
        </CardContent></Card>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Active Outward', value: stats.active_outward ?? 0, color: 'text-blue-600' },
            { label: 'Overdue', value: stats.overdue_count ?? 0, color: 'text-red-600' },
            { label: 'Materials Out Value', value: fmtAmt(stats.materials_out_value), color: 'text-amber-600' },
            { label: 'Total Inward', value: stats.total_inward ?? 0, color: 'text-emerald-600' },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4">
              <p className="text-xs text-slate-500">{s.label}</p>
              <p className={`font-bold text-lg ${s.color}`}>{s.value}</p>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input className="pl-10" placeholder="Search by challan # or party..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex gap-1.5">
          {['', 'outward', 'inward'].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${typeFilter === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t === 'outward' && <ArrowUpRight className="w-3 h-3" />}
              {t === 'inward' && <ArrowDownLeft className="w-3 h-3" />}
              {t || 'All'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {['', 'draft', 'sent', 'partial_return', 'returned'].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {s || 'All Status'}
            </button>
          ))}
        </div>
      </div>

      {/* Challans Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b"><tr>
            <th className="px-4 py-3 font-semibold text-slate-600">Challan #</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Type</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Date</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Party</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Material Value</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Due Date</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody className="divide-y">
            {isLoading && <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={8}>Loading...</td></tr>}
            {!isLoading && !challans.length && <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={8}>No challans found</td></tr>}
            {challans.map(ch => {
              const isOverdue = ch.challan_type === 'outward' && ch.return_due_date && !ch.is_returned && ch.status !== 'cancelled' && ch.status !== 'returned' && new Date(ch.return_due_date) < new Date();
              return (
                <tr key={ch.id} className={`hover:bg-slate-50/50 cursor-pointer ${isOverdue ? 'bg-red-50/50' : ''}`} onClick={() => navigate(`/job-work/${ch.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs font-bold">{ch.challan_number}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${ch.challan_type === 'outward' ? 'text-blue-600' : 'text-emerald-600'}`}>
                      {ch.challan_type === 'outward' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                      {ch.challan_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{new Date(ch.challan_date).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 font-medium">{ch.party_name_snapshot || ch.party_name || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(ch.total_material_value)}</td>
                  <td className="px-4 py-3">
                    {ch.return_due_date ? (
                      <span className={isOverdue ? 'text-red-600 font-bold' : 'text-slate-500'}>
                        {new Date(ch.return_due_date).toLocaleDateString('en-IN')}
                        {isOverdue && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${isOverdue ? STATUS_BADGES.overdue : (STATUS_BADGES[ch.status] || 'bg-slate-100')}`}>
                      {isOverdue ? 'overdue' : ch.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right"><ArrowRight className="w-4 h-4 text-slate-400 inline" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
