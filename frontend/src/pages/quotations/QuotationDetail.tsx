import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, FileText, CheckCircle2, Eye, MessageCircle, Mail, Send } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import toast from 'react-hot-toast';
import ProformaInvoiceDocument from '@/components/quotations/ProformaInvoiceDocument';
import QuotationDocument from '@/components/quotations/QuotationDocument';

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
  const isProforma = quote?.document_type === 'proforma';
  const documentLabel = isProforma ? 'Proforma Invoice' : 'Quotation';
  const listPath = isProforma ? '/sales-hub/proforma' : '/sales-hub/quotations';

  const updateStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/quotations/${id}`, { status }),
    onSuccess: (_res, status) => {
      qc.invalidateQueries({ queryKey: ['quotations', isProforma ? 'proforma' : 'quotation'] });
      refetch();
      toast.success(status === 'accepted' ? 'Customer confirmation recorded' : `${documentLabel} updated`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not update status'),
  });

  const previewPdf = async () => {
    if (!id) return;
    setPdfLoading(true);
    const t = toast.loading('Opening preview…');
    try {
      const res = await api.get(`/print/quotation/${id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      toast.success('Preview opened', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not open preview', { id: t });
    } finally {
      setPdfLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (!id) return;
    setPdfLoading(true);
    const t = toast.loading('Preparing PDF…');
    try {
      const res = await api.get(`/print/quotation/${id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quote?.quotation_number || 'quotation'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Could not download PDF', { id: t });
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
      toast.success(`${documentLabel} converted to Sales Invoice!`, { id: t });
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

  const shareQuotation = async (mode: 'whatsapp' | 'email') => {
    if (!id) return;
    try {
      const res = await api.post(`/quotations/${id}/${mode}`, {});
      const url = res.data?.data?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Share failed';
      const value = window.prompt(msg);
      if (!value) return;
      const res = await api.post(`/quotations/${id}/${mode}`, mode === 'whatsapp' ? { phone: value } : { email: value });
      const url = res.data?.data?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quote) return <div className="p-6 text-sm text-muted-foreground">Document not found.</div>;

  const canConvert = quote.status !== 'converted' && quote.status !== 'rejected' && quote.status !== 'cancelled' && (!isProforma || quote.status === 'accepted');
  const alreadyConverted = quote.status === 'converted';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(listPath)}>
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
          <Button variant="outline" size="sm" onClick={previewPdf} loading={pdfLoading} className="gap-1.5">
            <Eye className="w-4 h-4" />
            Preview
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPdf} loading={pdfLoading} className="gap-1.5">
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => shareQuotation('whatsapp')} className="gap-1.5">
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={() => shareQuotation('email')} className="gap-1.5">
            <Mail className="w-4 h-4" />
            Email
          </Button>
          {isProforma && quote.status === 'draft' && (
            <Button variant="outline" size="sm" loading={updateStatus.isPending} onClick={() => updateStatus.mutate('sent')} className="gap-1.5">
              <Send className="w-4 h-4" />
              Mark sent
            </Button>
          )}
          {isProforma && quote.status === 'sent' && (
            <Button size="sm" loading={updateStatus.isPending} onClick={() => updateStatus.mutate('accepted')} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              Customer confirmed
            </Button>
          )}
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
          This {documentLabel.toLowerCase()} has been converted to a Sales Invoice.
          {quote.converted_to_invoice_id && (
            <button className="ml-1 font-semibold underline" onClick={() => navigate(`/sales/${quote.converted_to_invoice_id}`)}>
              Open invoice
            </button>
          )}
        </div>
      )}

      {isProforma ? (
        <ProformaInvoiceDocument quote={quote} items={items} />
      ) : <QuotationDocument quote={quote} items={items} />}

      <ConfirmDialog
        open={convertConfirmOpen}
        onOpenChange={setConvertConfirmOpen}
        title="Create Sales Invoice?"
        description={`This will create a new Sales Invoice from ${documentLabel.toLowerCase()} ${quote.quotation_number}. The source document will be marked converted. This action cannot be undone.`}
        confirmLabel="Create Sales Invoice"
        variant="default"
        isPending={converting}
        onConfirm={handleConvertToInvoice}
      />
    </div>
  );
}
