import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Search, Plus, Download, Loader2, Eye, Pencil, FileCheck, Truck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InvoiceList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [irnLoadingId, setIrnLoadingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['salesInvoices', tab, search],
    queryFn: async () => {
      const parts: string[] = [];
      if (tab !== 'all') {
        if (tab === 'overdue') parts.push('overdue=true');
        else parts.push(`status=${tab}`);
      }
      if (search) parts.push(`search=${encodeURIComponent(search)}`);
      const res = await api.get(`/invoices?${parts.join('&')}`);
      // Return full response so we can access meta stats
      return res.data;
    }
  });

  const generatePDF = useCallback(async (id: string, number: string) => {
    setPdfLoadingId(id);
    const t = toast.loading('Preparing PDF…');
    try {
      const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch {
      toast.error('Failed to download PDF', { id: t });
    } finally {
      setPdfLoadingId(null);
    }
  }, []);

  const generateIRN = useCallback(async (id: string) => {
    setIrnLoadingId(id);
    const t = toast.loading('Generating IRN…');
    try {
      await api.post(`/invoices/${id}/einvoice/generate`);
      toast.success('IRN generated successfully', { id: t });
      queryClient.invalidateQueries({ queryKey: ['salesInvoices'] });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to generate IRN';
      toast.error(msg, { id: t });
    } finally {
      setIrnLoadingId(null);
    }
  }, [queryClient]);

  const statusColors: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    unpaid: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-200 text-slate-500 line-through',
  };

  const meta = data?.meta || {};
  // Response: { success, data: { data: [...], pagination: {...} }, meta: {...} }
  const invoices: any[] = data?.data?.data || data?.data || [];

  return (
    <div className="space-y-6">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Today's Sales</p>
            <p className="text-2xl font-bold font-mono tracking-tight">{formatMoney(meta.total_sales || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Outstanding</p>
            <p className="text-2xl font-bold font-mono tracking-tight text-amber-600">{formatMoney(meta.total_receivable || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Unpaid Bills</p>
            <p className="text-2xl font-bold font-mono tracking-tight">{meta.unpaid_count || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-100">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-red-800">Overdue Invoices</p>
            <p className="text-2xl font-bold font-mono tracking-tight text-red-600">{meta.overdue_count || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex bg-muted p-1 rounded-lg overflow-x-auto">
          {['all', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map(t => (
            <button
              key={t}
              className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize whitespace-nowrap transition-all ${tab === t ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab(t)}
            >{t}</button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search invoice or party..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button onClick={() => navigate('/sales/new')} className="gap-2">
            <Plus className="h-4 w-4" /> Add Sales
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground font-medium border-b">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Party</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Balance Due</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading sales...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground"><FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />No invoices found</td></tr>
              ) : (
                invoices.map((inv: any) => {
                  const displayStatus = inv.status === 'cancelled' ? 'cancelled' : (inv.payment_status || inv.status);
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && (inv.balance_due ?? inv.total_amount) > 0;
                  const hasPaid = Number(inv.paid_amount ?? 0) > 0;
                  const canEdit = !inv.irn && inv.status !== 'cancelled' && !hasPaid;
                  const canIRN = !inv.irn && inv.status !== 'cancelled';
                  const canEWB = inv.irn && !inv.ewb_no && inv.status !== 'cancelled';

                  return (
                    <tr key={inv.id} className="hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4 tabular-nums">{formatDate(inv.invoice_date)}</td>
                      <td className="py-3 px-4 font-medium">
                        <button onClick={() => navigate(`/sales/${inv.id}`)} className="text-primary hover:underline">
                          {inv.invoice_number}
                        </button>
                        {inv.irn && <span className="ml-1 text-xs text-emerald-600 font-semibold">IRN</span>}
                        {inv.ewb_no && <span className="ml-1 text-xs text-blue-600 font-semibold">EWB</span>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium">{inv.party_name || 'Walk-in Customer'}</div>
                        <div className="text-xs text-muted-foreground">{inv.party_phone || '-'}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-bold tabular-nums">{formatMoney(inv.total_amount)}</td>
                      <td className="py-3 px-4 text-right font-bold tabular-nums">
                        <span className={isOverdue ? 'text-red-600' : ''}>
                          {formatMoney(inv.balance_due ?? 0)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary" className={`capitalize ${statusColors[displayStatus] || 'bg-muted text-muted-foreground'}`}>
                          {displayStatus.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-end items-center gap-1">
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => navigate(`/sales/${inv.id}`)}
                            title="View invoice"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost" size="icon"
                            disabled={!canEdit}
                            onClick={() => canEdit && navigate(`/sales/${inv.id}/edit`)}
                            title={canEdit ? 'Edit invoice' : inv.irn ? 'IRN generated — cannot edit' : hasPaid ? 'Has payments — cannot edit' : 'Cannot edit'}
                            className={canEdit ? '' : 'opacity-30 cursor-not-allowed'}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost" size="icon"
                            disabled={!canIRN || irnLoadingId === inv.id}
                            onClick={() => canIRN && generateIRN(inv.id)}
                            title={canIRN ? 'Generate IRN e-invoice' : inv.irn ? `IRN: ${inv.irn.slice(0, 8)}…` : 'Cannot generate IRN'}
                            className={canIRN ? 'text-emerald-600 hover:text-emerald-700' : 'opacity-30 cursor-not-allowed'}
                          >
                            {irnLoadingId === inv.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <FileCheck className="h-4 w-4" />}
                          </Button>

                          <Button
                            variant="ghost" size="icon"
                            disabled={!canEWB}
                            onClick={() => canEWB && navigate(`/sales/${inv.id}?tab=ewb`)}
                            title={canEWB ? 'Generate E-Way Bill' : inv.ewb_no ? `EWB: ${inv.ewb_no}` : 'Need IRN first for E-Way Bill'}
                            className={canEWB ? 'text-blue-600 hover:text-blue-700' : 'opacity-30 cursor-not-allowed'}
                          >
                            <Truck className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost" size="icon"
                            disabled={pdfLoadingId === inv.id}
                            onClick={() => generatePDF(inv.id, inv.invoice_number)}
                            title="Download PDF"
                          >
                            {pdfLoadingId === inv.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Download className="h-4 w-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
