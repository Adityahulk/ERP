import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';

function money(paise: number) {
  return `₹${((paise || 0) / 100).toFixed(2)}`;
}

export default function QuotationDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [pdfLoading, setPdfLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: async () => {
      const res = await api.get(`/quotations/${id}`);
      return res.data?.data ?? res.data;
    },
    enabled: !!id,
  });

  const quote = data as any;
  const items = quote?.items || [];

  const printPdf = async () => {
    if (!id) return;
    setPdfLoading(true);
    const t = toast.loading('Opening PDF…');
    try {
      const res = await api.get(`/print/quotation/${id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      toast.success('PDF opened in a new tab', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not open PDF', { id: t });
    } finally {
      setPdfLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quote) return <div className="p-6 text-sm text-muted-foreground">Quotation not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/quotations')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{quote.quotation_number}</h1>
            <p className="text-sm text-muted-foreground">
              {quote.quotation_date ? new Date(quote.quotation_date).toLocaleDateString() : '—'}
              {quote.valid_until ? ` • valid till ${new Date(quote.valid_until).toLocaleDateString()}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">{quote.status || 'draft'}</Badge>
          <Button variant="outline" onClick={printPdf} loading={pdfLoading}>
            <Download className="w-4 h-4 mr-1.5" />
            Print / PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>{quote.party_name_override || quote.party_name || '—'}</p>
          <p className="text-muted-foreground">{quote.party_email_override || '—'} {quote.party_phone_override ? `• ${quote.party_phone_override}` : ''}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Disc</th>
                <th className="px-4 py-3 text-right">GST</th>
                <th className="px-4 py-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it: any) => (
                <tr key={it.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{it.item_name || 'Item'}</div>
                    {it.item_description ? <div className="text-xs text-muted-foreground">{it.item_description}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right">{it.quantity}</td>
                  <td className="px-4 py-3 text-right">{money(it.unit_price || 0)}</td>
                  <td className="px-4 py-3 text-right">{money(it.discount_amount || 0)}</td>
                  <td className="px-4 py-3 text-right">{it.gst_rate || 0}%</td>
                  <td className="px-4 py-3 text-right font-medium">{money(it.total_amount || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div>Subtotal: <b>{money(quote.subtotal || 0)}</b></div>
          <div>Discount: <b>{money(quote.discount_amount || 0)}</b></div>
          <div>Taxable: <b>{money(quote.taxable_amount || 0)}</b></div>
          <div>CGST: <b>{money(quote.cgst_amount || 0)}</b></div>
          <div>SGST: <b>{money(quote.sgst_amount || 0)}</b></div>
          <div>IGST: <b>{money(quote.igst_amount || 0)}</b></div>
          <div className="sm:col-span-2 md:col-span-3 text-base">Grand Total: <b>{money(quote.total_amount || 0)}</b></div>
        </CardContent>
      </Card>
    </div>
  );
}
