import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, Send, FileCheck, Eye, Download, MessageCircle, Mail } from 'lucide-react';
import toast from 'react-hot-toast';

type QuoteDocumentType = 'quotation' | 'proforma';

export default function QuotationList({ documentType = 'quotation' }: { documentType?: QuoteDocumentType }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isProforma = documentType === 'proforma';
  const queryKey = ['quotations', documentType];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get('/quotations', { params: { limit: 50, document_type: documentType } });
      return res.data?.data ?? res.data;
    },
  });

  const rows = (data as any)?.data ?? [];

  const patchStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/quotations/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success(isProforma ? 'Proforma Invoice updated' : 'Quotation updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const convert = useMutation({
    mutationFn: (id: string) => api.post(`/quotations/${id}/convert`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey });
      toast.success(res.data?.data?.message || 'Sales Invoice created');
      const invoiceId = res.data?.data?.invoice_id;
      if (invoiceId) navigate(`/sales/${invoiceId}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Convert failed'),
  });

  const openPreview = async (id: string) => {
    const t = toast.loading('Opening preview…');
    try {
      const res = await api.get(`/print/quotation/${id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('Preview opened', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Preview failed', { id: t });
    }
  };

  const downloadPdf = async (id: string, number: string) => {
    const t = toast.loading('Preparing PDF…');
    try {
      const res = await api.get(`/print/quotation/${id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Download failed', { id: t });
    }
  };

  const shareQuotation = async (id: string, mode: 'whatsapp' | 'email') => {
    try {
      const res = await api.post(`/quotations/${id}/${mode}`, {});
      const url = res.data?.data?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Share failed';
      if (mode === 'whatsapp') {
        const phone = window.prompt(msg);
        if (!phone) return;
        const res = await api.post(`/quotations/${id}/whatsapp`, { phone });
        if (res.data?.data?.url) window.open(res.data.data.url, '_blank', 'noopener,noreferrer');
      } else {
        const email = window.prompt(msg);
        if (!email) return;
        const res = await api.post(`/quotations/${id}/email`, { email });
        if (res.data?.data?.url) window.open(res.data.data.url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{isProforma ? 'Proforma Invoices' : 'Quotations'}</h1>
          <p className="text-muted-foreground text-sm">
            {isProforma
              ? 'Create customer-ready offers, record confirmation, then convert them into Sales Invoices.'
              : 'Formal price offers to customers. Each row shows the quote reference, validity, and amount.'}
          </p>
        </div>
        <Button onClick={() => navigate(isProforma ? '/proforma-invoices/new' : '/quotations/new')} className="gap-2">
          <Plus className="w-4 h-4" />
          New {isProforma ? 'Proforma Invoice' : 'quotation'}
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
                  <th className="px-4 py-3">{isProforma ? 'Proforma No.' : 'Quote ref.'}</th>
                  <th className="px-4 py-3">{isProforma ? 'Date' : 'Quote date'}</th>
                  <th className="px-4 py-3">Valid until</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((q: any) => (
                  <tr key={q.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => navigate(`${isProforma ? '/proforma-invoices' : '/quotations'}/${q.id}`)}
                      >
                        {q.quotation_number}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.quotation_date ? new Date(q.quotation_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '—'}
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
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => openPreview(q.id)}>
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Preview
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => downloadPdf(q.id, q.quotation_number)}>
                        <Download className="w-3.5 h-3.5 mr-1" />
                        PDF
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => shareQuotation(q.id, 'whatsapp')}>
                        <MessageCircle className="w-3.5 h-3.5 mr-1" />
                        WhatsApp
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => shareQuotation(q.id, 'email')}>
                        <Mail className="w-3.5 h-3.5 mr-1" />
                        Email
                      </Button>
                      {q.status === 'draft' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          loading={
                            patchStatus.isPending &&
                            patchStatus.variables?.id === q.id &&
                            patchStatus.variables?.status === 'sent'
                          }
                          onClick={() => patchStatus.mutate({ id: q.id, status: 'sent' })}
                        >
                          <Send className="w-3.5 h-3.5 mr-1" />
                          Mark sent
                        </Button>
                      )}
                      {isProforma && q.status === 'sent' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-emerald-700"
                          loading={patchStatus.isPending && patchStatus.variables?.id === q.id}
                          onClick={() => patchStatus.mutate({ id: q.id, status: 'accepted' })}
                        >
                          <FileCheck className="w-3.5 h-3.5 mr-1" />
                          Confirmed
                        </Button>
                      )}
                      {(!isProforma || q.status === 'accepted') && q.status !== 'converted' && q.status !== 'rejected' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          loading={convert.isPending && convert.variables === q.id}
                          onClick={() => convert.mutate(q.id)}
                        >
                          <FileCheck className="w-3.5 h-3.5 mr-1" />
                          Convert to Sale
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      No {isProforma ? 'Proforma Invoices' : 'quotations'} yet. Create one to get started.
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
