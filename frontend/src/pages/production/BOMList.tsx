import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Factory, Plus, Search, Package, ArrowRight, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import type { BOM } from '@/types';

export default function BOMList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['bom-list', search, page],
    queryFn: () => api.get('/bom', { params: { search: search || undefined, page, limit: 20 } }).then(r => r.data?.data ?? r.data),
  });
  const boms: BOM[] = data?.data ?? [];
  const pagination = data?.pagination;

  const { data: logsData } = useQuery({
    queryKey: ['production-logs'],
    queryFn: () => api.get('/bom/production-logs', { params: { page: 1, limit: 10 } }).then(r => r.data?.data ?? r.data),
  });
  const logs = logsData?.data ?? [];

  const deleteBOM = useMutation({
    mutationFn: (id: string) => api.delete(`/bom/${id}`),
    onSuccess: () => { toast.success('BOM deleted'); qc.invalidateQueries({ queryKey: ['bom-list'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const fmtCost = (v: number) => `₹${((v || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Factory className="w-7 h-7 text-indigo-600" /> BOM & Production
          </h1>
          <p className="text-slate-500 text-sm mt-1">Define how finished goods are made from raw materials</p>
        </div>
        <Button className="gap-2" onClick={() => navigate('/production/new')}>
          <Plus className="w-4 h-4" /> New BOM
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <Input className="pl-10" placeholder="Search by BOM name, number, or item..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* BOM Cards */}
      <div className="grid gap-4 mb-8">
        {isLoading && <p className="text-slate-500 text-sm">Loading BOMs...</p>}
        {!isLoading && !boms.length && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <Factory className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-600 mb-1">No BOMs yet</h3>
              <p className="text-sm text-slate-400 mb-4">Create your first Bill of Materials to start production</p>
              <Button onClick={() => navigate('/production/new')}><Plus className="w-4 h-4 mr-1" /> Create BOM</Button>
            </CardContent>
          </Card>
        )}
        {boms.map(bom => (
          <Card key={bom.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/production/${bom.id}`)}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{bom.bom_name || 'Untitled BOM'}</p>
                  <p className="text-xs text-slate-500">
                    {bom.bom_number} • {bom.finished_item_name}
                    {bom.finished_item_sku ? ` (${bom.finished_item_sku})` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-slate-900">{fmtCost(bom.total_cost)}</p>
                  <p className="text-xs text-slate-500">per unit cost</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={(e) => { e.stopPropagation(); deleteBOM.mutate(bom.id); }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-slate-500 self-center">Page {pagination.page} of {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Recent Production Logs */}
      {logs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Recent Production</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-600">Production #</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Date</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Finished Good</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 text-right">Qty</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 text-right">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono text-xs">{log.production_number}</td>
                    <td className="px-4 py-3">{new Date(log.production_date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3 font-medium">{log.finished_item_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{log.quantity_produced}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtCost(log.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
