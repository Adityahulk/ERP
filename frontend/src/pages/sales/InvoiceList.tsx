import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
// import { DropdownMenu } from 'lucide-react';
import { FileText, Search, Plus, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InvoiceList() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['salesInvoices', tab, search],
    queryFn: async () => {
      const parts: string[] = [];
      if (tab !== 'all') {
        if (tab === 'overdue') parts.push('overdue=true');
        else parts.push(`status=${tab}`);
      }
      if (search) parts.push(`search=${search}`);
      const res = await api.get(`/invoices?${parts.join('&')}`);
      return res.data?.data ?? res.data;
    }
  });

  const generatePDF = async (id: string, number: string) => {
    try {
      const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) { toast.error('Failed to download PDF'); }
  };

  const statusColors: any = {
    paid: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    unpaid: 'bg-red-100 text-red-700',
    draft: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-slate-200 text-slate-500 line-through',
  };

  const meta = (data as any)?.meta || {};
  const invoices = (data as any)?.data || [];

  return (
    <div className="space-y-6">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20"><CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground">Today's Sales</p>
          <p className="text-2xl font-bold font-mono tracking-tight">{formatMoney(meta.total_sales || 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-bold font-mono tracking-tight text-amber-600">{formatMoney(meta.total_receivable || 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground">Unpaid Bills</p>
          <p className="text-2xl font-bold font-mono tracking-tight">{meta.unpaid_count || 0}</p>
        </CardContent></Card>
        <Card className="bg-red-50 border-red-100"><CardContent className="p-4">
          <p className="text-sm font-medium text-red-800">Overdue Invoices</p>
          <p className="text-2xl font-bold font-mono tracking-tight text-red-600">{meta.overdue_count || 0}</p>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex bg-muted p-1 rounded-lg overflow-x-auto">
          {['all', 'draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map(t => (
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
          <Button onClick={() => navigate('/billing')} className="gap-2">
            <Plus className="h-4 w-4" /> POS Billing
          </Button>
          <Button onClick={() => navigate('/sales/new')} variant="outline" className="gap-2">
            <FileText className="h-4 w-4" /> Bulk Form
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
                <th className="py-3 px-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading sales...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground"><FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />No invoices found</td></tr>
              ) : (
                invoices.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4 tabular-nums">{formatDate(inv.invoice_date)}</td>
                    <td className="py-3 px-4 font-medium">
                       <button onClick={() => navigate(`/sales/${inv.id}`)} className="text-primary hover:underline">{inv.invoice_number}</button>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">{inv.party_name || 'Walk-in Customer'}</div>
                      <div className="text-xs text-muted-foreground">{inv.party_phone || '-'}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">{formatMoney(inv.total_amount)}</td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
                      <span className={inv.due_date && new Date(inv.due_date) < new Date() && inv.balance_due > 0 ? 'text-red-600' : ''}>
                        {formatMoney(inv.balance_due)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="secondary" className={`capitalize ${statusColors[inv.status] || ''}`}>{inv.status}</Badge>
                    </td>
                    <td className="py-3 px-4 text-right z-10">
                      <div className="flex justify-end gap-2">
                         <Button variant="ghost" size="sm" onClick={() => navigate(`/sales/${inv.id}`)}>View</Button>
                         <Button variant="ghost" size="sm" onClick={() => generatePDF(inv.id, inv.invoice_number)}><Download className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
