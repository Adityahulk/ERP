import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, Send, FileCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function QuotationList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['quotations'],
    queryFn: async () => {
      const res = await api.get('/quotations', { params: { limit: 50 } });
      return res.data?.data ?? res.data;
    },
  });

  const rows = (data as any)?.data ?? [];

  const patchStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/quotations/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      toast.success('Quotation updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const convert = useMutation({
    mutationFn: (id: string) => api.post(`/quotations/${id}/convert`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      toast.success(res.data?.data?.message || 'Convert requested');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Convert failed'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotations</h1>
          <p className="text-muted-foreground text-sm">Customer quotes before they become invoices.</p>
        </div>
        <Button onClick={() => navigate('/quotations/new')} className="gap-2">
          <Plus className="w-4 h-4" />
          New quotation
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 border-b font-medium">
                <tr>
                  <th className="px-4 py-3">Number</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((q: any) => (
                  <tr key={q.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{q.quotation_number}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.quotation_date ? new Date(q.quotation_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">{q.party_name || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ₹{((q.total_amount || 0) / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="capitalize">
                        {q.status || 'draft'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {q.status === 'draft' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => patchStatus.mutate({ id: q.id, status: 'sent' })}
                        >
                          <Send className="w-3.5 h-3.5 mr-1" />
                          Mark sent
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => convert.mutate(q.id)}>
                        <FileCheck className="w-3.5 h-3.5 mr-1" />
                        Convert
                      </Button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      No quotations yet. Create one or run seed for demo rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
