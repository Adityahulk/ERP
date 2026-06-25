import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInvoices, useCancelInvoice } from '@/hooks/useBusiness';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Search, FileText, IndianRupee, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InvoiceList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<any>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('sale');
  const [statusFilter, setStatusFilter] = useState('');
  const cancelMutation = useCancelInvoice();

  const activeFilters = { ...filters, search: search || undefined, invoice_type: typeFilter || undefined, status: statusFilter || undefined };
  const { data, isLoading } = useInvoices(activeFilters);

  const invoices = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  const meta = data?.meta || {};

  const handleCancel = async (id: string, num: string) => {
    if (!confirm(`Cancel invoice ${num}? This will reverse stock and party balance.`)) return;
    try { await cancelMutation.mutateAsync(id); toast.success('Invoice cancelled'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const statusColors: Record<string, any> = {
    paid: 'success', partial: 'warning', unpaid: 'destructive', cancelled: 'secondary',
  };

  const stats = [
    { label: 'Total Sales', value: formatMoney(parseInt(meta.total_sales) || 0), icon: IndianRupee, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
    { label: 'Receivable', value: formatMoney(parseInt(meta.total_receivable) || 0), icon: Clock, color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
    { label: 'Unpaid', value: meta.unpaid_count || 0, icon: FileText, color: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
    { label: 'Overdue', value: meta.overdue_count || 0, icon: AlertTriangle, color: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Invoices</h1><p className="text-muted-foreground text-sm">Sales & Purchase invoices</p></div>
        <Button size="sm" onClick={() => navigate('/invoices/new')}><Plus className="w-4 h-4 mr-1" />New Invoice</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}><s.icon className="w-4 h-4" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold tabular-nums">{s.value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search invoice number or party..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setFilters((f: any) => ({ ...f, page: 1 })); }} />
        </div>
        {['sale', 'purchase'].map(t => (
          <button key={t} onClick={() => { setTypeFilter(t); setFilters((f: any) => ({ ...f, page: 1 })); }} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${typeFilter === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{t === 'sale' ? '📤 Sales' : '📥 Purchases'}</button>
        ))}
        <select className="h-8 rounded-md border bg-transparent px-3 text-xs" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setFilters((f: any) => ({ ...f, page: 1 })); }}>
          <option value="">All Status</option>
          <option value="unpaid">Unpaid</option><option value="partial">Partial</option>
          <option value="paid">Paid</option><option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40">
            <th className="p-3 text-left font-medium">Invoice #</th>
            <th className="p-3 text-left font-medium">Party</th>
            <th className="p-3 text-left font-medium hidden md:table-cell">Date</th>
            <th className="p-3 text-right font-medium">Amount</th>
            <th className="p-3 text-right font-medium hidden lg:table-cell">Balance Due</th>
            <th className="p-3 text-center font-medium">Status</th>
            <th className="w-20 p-3"></th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">Loading...</td></tr>}
            {!isLoading && invoices.length === 0 && <tr><td colSpan={7} className="p-12 text-center text-muted-foreground"><FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />No invoices found</td></tr>}
            {invoices.map((inv: any) => {
              const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.balance_due > 0 && inv.status !== 'cancelled';
              return (
                <tr key={inv.id} className={`border-b hover:bg-muted/30 cursor-pointer ${isOverdue ? 'border-l-4 border-l-red-400' : ''}`} onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <td className="p-3 font-medium font-mono text-xs">{inv.invoice_number}</td>
                  <td className="p-3">{inv.party_name || '—'}</td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{formatDate(inv.invoice_date)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{formatMoney(inv.total_amount)}</td>
                  <td className="p-3 text-right tabular-nums hidden lg:table-cell">{inv.balance_due > 0 ? <span className="text-red-500 font-medium">{formatMoney(inv.balance_due)}</span> : '—'}</td>
                  <td className="p-3 text-center"><Badge variant={statusColors[inv.status] || 'secondary'} className="text-[10px]">{inv.status}</Badge></td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px] text-red-600 hover:text-red-700"
                        loading={cancelMutation.isPending && cancelMutation.variables === inv.id}
                        onClick={() => handleCancel(inv.id, inv.invoice_number)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!pagination.hasPrev} onClick={() => setFilters((f: any) => ({ ...f, page: f.page - 1 }))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={!pagination.hasNext} onClick={() => setFilters((f: any) => ({ ...f, page: f.page + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
