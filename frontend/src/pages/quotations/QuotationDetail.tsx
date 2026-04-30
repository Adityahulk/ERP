import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, FileText, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import toast from 'react-hot-toast';

function money(paise: number) {
  return `₹${((paise || 0) / 100).toFixed(2)}`;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
  converted: 'bg-violet-100 text-violet-700',
};

export default function QuotationDetail() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
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

  const handleConvertToInvoice = async () => {
    if (!id) return;
    setConverting(true);
    const t = toast.loading('Converting to invoice…');
    try {
      const res = await api.post(`/quotations/${id}/convert`);
      const invoiceId = res.data?.data?.invoice_id ?? res.data?.invoice_id;
      toast.success('Quotation converted to invoice!', { id: t });
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      if (invoiceId) {
        navigate(`/sales/${invoiceId}`);
      } else {
        refetch();
        setConvertConfirmOpen(false);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Conversion failed', { id: t });
    } finally {
      setConverting(false);
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

  const canConvert = quote.status !== 'converted' && quote.status !== 'rejected' && quote.status !== 'cancelled';
  const alreadyConverted = quote.status === 'converted';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/quotations')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{quote.quotation_number}</h1>
            <p className="text-sm text-muted-foreground">
              {quote.quotation_date ? new Date(quote.quotation_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              {quote.valid_until ? ` · Valid till ${new Date(quote.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[quote.status || 'draft'] || 'bg-slate-100 text-slate-600'}`}>
            {quote.status || 'draft'}
          </span>
          <Button variant="outline" size="sm" onClick={printPdf} loading={pdfLoading} className="gap-1.5">
            <Download className="w-4 h-4" />
            Print / PDF
          </Button>
          {alreadyConverted && quote.converted_to_invoice_id && (
            <Button size="sm" variant="outline" className="gap-1.5 text-violet-600 border-violet-200" onClick={() => navigate(`/sales/${quote.converted_to_invoice_id}`)}>
              <FileText className="w-4 h-4" />
              View Invoice
            </Button>
          )}
          {canConvert && (
            <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => setConvertConfirmOpen(true)}>
              <CheckCircle2 className="w-4 h-4" />
              Convert to Invoice
            </Button>
          )}
        </div>
      </div>

      {alreadyConverted && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          This quotation has been converted to an invoice.
          {quote.converted_to_invoice_id && (
            <button className="ml-1 font-semibold underline" onClick={() => navigate(`/sales/${quote.converted_to_invoice_id}`)}>
              Open invoice
            </button>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Customer</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="font-medium">{quote.party_name_override || quote.party_name || '—'}</p>
            {(quote.party_email_override || quote.party_phone_override) && (
              <p className="text-muted-foreground text-xs">
                {quote.party_email_override}
                {quote.party_phone_override ? ` · ${quote.party_phone_override}` : ''}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums font-medium">{money(quote.subtotal || 0)}</span>
            </div>
            {(quote.discount_amount > 0) && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="tabular-nums text-red-500">− {money(quote.discount_amount || 0)}</span>
              </div>
            )}
            {(quote.cgst_amount > 0 || quote.sgst_amount > 0) && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{money(quote.cgst_amount || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{money(quote.sgst_amount || 0)}</span></div>
              </>
            )}
            {quote.igst_amount > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{money(quote.igst_amount || 0)}</span></div>
            )}
            <div className="flex justify-between border-t pt-1.5 font-bold text-base">
              <span>Total</span>
              <span className="tabular-nums">{money(quote.total_amount || 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right hidden md:table-cell">Disc</th>
                  <th className="px-4 py-3 text-right hidden md:table-cell">GST</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it: any, i: number) => (
                  <tr key={it.id || i} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-medium">{it.item_name || 'Item'}</div>
                      {it.item_description ? <div className="text-xs text-muted-foreground">{it.item_description}</div> : null}
                      {it.unit && <div className="text-[10px] text-muted-foreground">{it.unit}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(it.unit_price || 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">{money(it.discount_amount || 0)}</td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">{it.gst_rate || 0}%</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(it.total_amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {quote.customer_notes && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Customer Notes</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.customer_notes}</CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={convertConfirmOpen}
        onOpenChange={setConvertConfirmOpen}
        title="Convert to Invoice?"
        description={`This will create a new tax invoice from quotation ${quote.quotation_number}. The quotation status will change to "converted". This action cannot be undone.`}
        confirmLabel="Convert to Invoice"
        variant="default"
        isPending={converting}
        onConfirm={handleConvertToInvoice}
      />
    </div>
  );
}
