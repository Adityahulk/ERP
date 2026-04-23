import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, Send, AlertTriangle, QrCode, FileDown, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { useCancelEinvoice, useCompany, useGenerateEinvoice } from '@/hooks/useBusiness';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuthStore();
  const { data: company } = useCompany();
  const genEinv = useGenerateEinvoice();
  const cancelEinv = useCancelEinvoice();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('2');
  const [cancelNote, setCancelNote] = useState('');

  const { data: raw, isLoading, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const res = await api.get(`/invoices/${id}`);
      return res.data?.data ?? res.data;
    },
  });

  const inv: any = raw;

  useEffect(() => {
    if (inv?.invoice_number) {
      document.title = `${inv.invoice_number} — BizFlow`;
    }
    return () => {
      document.title = 'BizFlow';
    };
  }, [inv?.invoice_number]);

  useEffect(() => {
    if (inv && params.get('record') === '1') {
      toast('Record Payment Flow initiated', { icon: '💰' });
    }
  }, [inv, params]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading invoice details...</div>;
  if (!inv) return <div className="p-8 text-center text-destructive">Invoice not found.</div>;

  const canGenEinv =
    (user?.role === 'company_admin' || user?.role === 'accountant' || user?.role === 'super_admin') &&
    company?.einvoice_enabled &&
    company?.einvoice_turnover_above_5cr;

  const einvStatus = inv.einvoice_status || 'not_applicable';
  const einvLabel =
    einvStatus === 'not_applicable'
      ? 'Not Applicable'
      : einvStatus === 'pending'
        ? 'Pending'
        : einvStatus === 'generated'
          ? 'Generated'
          : einvStatus === 'cancelled'
            ? 'Cancelled'
            : einvStatus;

  const einvBadgeClass =
    einvStatus === 'generated'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : einvStatus === 'cancelled'
        ? 'bg-red-100 text-red-800 border-red-200'
        : 'bg-slate-100 text-slate-700 border-slate-200';

  const handleGenerateEInvoice = async () => {
    const loader = toast.loading('Generating IRN…');
    try {
      await genEinv.mutateAsync(id!);
      toast.success('E-invoice generated', { id: loader });
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed', { id: loader });
    }
  };

  const handleCancelEinvoice = async () => {
    try {
      await cancelEinv.mutateAsync({
        id: id!,
        reason_code: parseInt(cancelReason, 10),
        reason_description: cancelNote || 'Other',
      });
      toast.success('IRN cancelled');
      setCancelOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed');
    }
  };

  const printReceipt = async () => {
    const w = localStorage.getItem('bizflow_printer_type');
    const width = w === 'thermal58' ? '58' : '80';
    try {
      const res = await api.get(`/print/receipt/${id}`, { params: { width }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Print failed');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Invoice {inv.invoice_number}</h1>
          <Badge variant="outline" className="capitalize text-sm px-3">
            {inv.status}
          </Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={printReceipt}>
            Print Receipt
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
              const url = window.URL.createObjectURL(new Blob([res.data]));
              const link = document.createElement('a');
              link.href = url;
              link.setAttribute('download', `${inv.invoice_number}.pdf`);
              document.body.appendChild(link);
              link.click();
              link.remove();
            }}
          >
            <Download className="h-4 w-4 mr-2" /> Download PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await api.post(`/invoices/${inv.id}/whatsapp`);
              toast.success('WhatsApp dispatched');
            }}
          >
            <Send className="h-4 w-4 mr-2" /> WhatsApp
          </Button>
          {inv.irn && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await api.get(`/invoices/${id}/einvoice/pdf`, { responseType: 'blob' });
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `einvoice-${inv.invoice_number}.pdf`);
                document.body.appendChild(link);
              link.click();
              link.remove();
              }}
            >
              <FileDown className="h-4 w-4 mr-2" /> e-Invoice PDF
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Billed To
                </CardTitle>
                <div className="font-bold text-lg">{inv.party_name || inv.party_display_name || 'Walk-in Customer'}</div>
                {inv.party_phone && <div>{inv.party_phone}</div>}
                {inv.party_gstin && (
                  <div className="text-sm mt-1">
                    GSTIN: <span className="font-mono">{inv.party_gstin}</span>
                  </div>
                )}
              </div>
              <div className="text-right">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Invoice Info
                </CardTitle>
                <div>Date: {formatDate(inv.invoice_date)}</div>
                {inv.due_date && <div>Due: {formatDate(inv.due_date)}</div>}
                <div>Type: {inv.is_interstate ? 'Interstate (IGST)' : 'Intrastate (CGST/SGST)'}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="py-2 px-4 text-left font-medium">Item</th>
                  <th className="py-2 px-4 text-center font-medium">Qty</th>
                  <th className="py-2 px-4 text-right font-medium">Rate</th>
                  <th className="py-2 px-4 text-right font-medium">Tax</th>
                  <th className="py-2 px-4 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(inv.items || []).map((i: any) => (
                  <tr key={i.id}>
                    <td className="py-3 px-4">
                      <div className="font-medium">{i.item_name}</div>
                      <div className="text-xs text-muted-foreground">HSN: {i.hsn_code}</div>
                    </td>
                    <td className="py-3 px-4 text-center">{Number(i.quantity)}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{formatMoney(i.unit_price)}</td>
                    <td className="py-3 px-4 text-right text-xs">
                      {i.gst_rate}% <br />
                      <span className="text-muted-foreground">
                        {formatMoney((i.cgst_amount || 0) + (i.sgst_amount || 0) + (i.igst_amount || 0))}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium tabular-nums">{formatMoney(i.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t p-4 flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>{' '}
                  <span className="tabular-nums">{formatMoney(inv.subtotal)}</span>
                </div>
                {inv.discount_amount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Discount</span> <span className="tabular-nums">-{formatMoney(inv.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t pt-2 font-bold">
                  <span>Total</span> <span className="tabular-nums text-lg">{formatMoney(inv.total_amount)}</span>
                </div>
                <div className="flex justify-between text-sm text-emerald-600 font-medium">
                  <span>Paid</span> <span className="tabular-nums">{formatMoney(inv.paid_amount ?? inv.amount_paid)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-destructive border-t pt-2">
                  <span>Balance</span> <span className="tabular-nums">{formatMoney(inv.balance_due)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <QrCode className="h-4 w-4" /> e-Invoice
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Status</span>
                <Badge variant="outline" className={`capitalize ${einvBadgeClass}`}>
                  {einvLabel}
                </Badge>
              </div>
              {inv.irn ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">IRN</p>
                    <p className="text-xs font-mono break-all bg-muted p-2 rounded">{inv.irn}</p>
                  </div>
                  {inv.ack_number && (
                    <p className="text-xs">
                      ACK: <span className="font-mono">{inv.ack_number}</span>
                    </p>
                  )}
                  {inv.qr_code_url && !inv.qr_code_url.startsWith('eyJ') && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">QR</p>
                      <img src={inv.qr_code_url} alt="e-invoice QR" className="w-40 h-40 border rounded" />
                    </div>
                  )}
                  {(user?.role === 'company_admin' || user?.role === 'super_admin') && einvStatus === 'generated' && (
                    <Button variant="destructive" size="sm" className="w-full" onClick={() => setCancelOpen(true)}>
                      <Ban className="h-4 w-4 mr-2" /> Cancel IRN
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center space-y-4">
                  {!canGenEinv ? (
                    <p className="text-sm text-muted-foreground">
                      e-Invoice is disabled or turnover flag is off in company settings.
                    </p>
                  ) : (
                    <>
                      <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
                      <p className="text-sm text-muted-foreground">IRN not generated for this invoice.</p>
                      <Button
                        className="w-full"
                        disabled={genEinv.isPending}
                        onClick={handleGenerateEInvoice}
                      >
                        Generate IRN
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {cancelOpen && (
            <Card className="border-destructive/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cancel IRN</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <label className="block text-muted-foreground">Reason</label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                >
                  <option value="1">Duplicate</option>
                  <option value="2">Data entry mistake</option>
                  <option value="3">Order cancelled</option>
                  <option value="4">Other</option>
                </select>
                <textarea
                  className="w-full min-h-[60px] rounded-md border bg-background p-2"
                  placeholder="Description"
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setCancelOpen(false)}>
                    Close
                  </Button>
                  <Button variant="destructive" className="flex-1" disabled={cancelEinv.isPending} onClick={handleCancelEinvoice}>
                    Confirm cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-medium">Payments</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {inv.payments && inv.payments.length > 0 ? (
                <div className="space-y-3">
                  {inv.payments.map((p: any) => (
                    <div key={p.id} className="flex justify-between items-center text-sm border-b last:border-0 pb-2 last:pb-0">
                      <div>
                        <div className="font-medium">{formatDate(p.payment_date)}</div>
                        <div className="text-xs text-muted-foreground capitalize">
                          {p.payment_mode} • {p.payment_number}
                        </div>
                      </div>
                      <div className="font-bold tabular-nums text-emerald-600">{formatMoney(p.amount)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No payments recorded</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
