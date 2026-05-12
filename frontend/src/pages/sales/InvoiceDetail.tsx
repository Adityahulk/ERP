import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { InvoicePreviewWorkspace } from '@/components/invoices/InvoicePreviewWorkspace';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ArrowLeft, Download, Send, AlertTriangle, QrCode, FileDown, Ban, Eye, Pencil, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { normalizeRole } from '@/lib/roles';
import {
  useCancelEinvoice,
  useCancelEwayBill,
  useCompany,
  useGenerateEinvoice,
  useGenerateEwayBill,
  useInvoice,
} from '@/hooks/useBusiness';

const ROLE_RANK: Record<string, number> = {
  staff: 1,
  manager: 2,
  admin: 3,
  super_admin: 4,
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { data: company } = useCompany();
  const genEinv = useGenerateEinvoice();
  const cancelEinv = useCancelEinvoice();
  const genEwb = useGenerateEwayBill();
  const cancelEwb = useCancelEwayBill();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('2');
  const [cancelNote, setCancelNote] = useState('');
  const [waPickerOpen, setWaPickerOpen] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [sharePhone, setSharePhone] = useState('');
  const [printLoading, setPrintLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [einvPdfLoading, setEinvPdfLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewbCancelOpen, setEwbCancelOpen] = useState(false);
  const [ewbForm, setEwbForm] = useState({
    transporter_id: '',
    transporter_name: '',
    vehicle_no: '',
    vehicle_type: 'R' as 'R' | 'O',
    transport_mode: '1',
    distance_km: '',
    trans_doc_no: '',
    trans_doc_dt: '',
  });

  const [ewbCancelReason, setEwbCancelReason] = useState('2');
  const [ewbCancelNote, setEwbCancelNote] = useState('');

  const { data: raw, isLoading, isError, refetch } = useInvoice(id);

  const inv: any = raw;

  useEffect(() => {
    setSharePhone(inv?.party_phone || '');
  }, [inv?.party_phone]);

  useEffect(() => {
    if (inv?.invoice_number) {
      document.title = `${inv.invoice_number} — Microtechnique Accounts`;
    }
    return () => {
      document.title = 'Microtechnique Accounts';
    };
  }, [inv?.invoice_number]);

  useEffect(() => {
    if (inv && params.get('record') === '1') {
      toast('Record Payment Flow initiated', { icon: '💰' });
    }
  }, [inv, params]);

  useEffect(() => {
    if (!params.get('preview')) return;
    setPreviewOpen(true);
    const next = new URLSearchParams(params);
    next.delete('preview');
    setSearchParams(next, { replace: true });
  }, [params, setSearchParams]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading invoice details...</div>;
  if (isError || !inv) return <div className="p-8 text-center text-destructive">Invoice not found.</div>;

  const normalizedRole = normalizeRole(user?.role);
  const userRank = ROLE_RANK[normalizedRole] ?? 0;
  const hasPaidAmount = Number(inv.paid_amount ?? inv.amount_paid ?? 0) > 0;
  const hasPayments = Array.isArray(inv.payments) && inv.payments.length > 0;
  const canEditInvoice =
    userRank >= ROLE_RANK.manager &&
    !inv.irn &&
    inv.status !== 'cancelled' &&
    !hasPaidAmount &&
    !hasPayments;

  const editBlockReason = inv.irn
    ? 'E-Invoice IRN is generated — cancel the IRN first to edit.'
    : inv.status === 'cancelled'
    ? 'Cancelled invoices cannot be edited.'
    : hasPaidAmount || hasPayments
    ? 'Invoice has payments recorded. Reverse all payments to enable editing.'
    : userRank < ROLE_RANK.manager
    ? 'Only managers and above can edit invoices.'
    : '';

  const canGenEinvRole = normalizedRole === 'admin' || normalizedRole === 'super_admin';
  const canGenEinv = canGenEinvRole && !!company?.einvoice_enabled;
  const canGenEwb = canGenEinvRole;
  const canCancelEwb = normalizedRole === 'admin' || normalizedRole === 'super_admin';

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
    const t = toast.loading('Cancelling IRN…');
    try {
      await cancelEinv.mutateAsync({
        id: id!,
        reason_code: parseInt(cancelReason, 10),
        reason_description: cancelNote || 'Other',
      });
      toast.success('IRN cancelled', { id: t });
      setCancelOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed', { id: t });
    }
  };

  const handleSubmitEwb = async () => {
    const tid = ewbForm.transporter_id.trim().toUpperCase();
    const vn = ewbForm.vehicle_no.trim().toUpperCase();
    if (tid && tid.length !== 15) {
      toast.error('Transporter ID must be blank or exactly 15 characters (GSTIN / TRANSIN)');
      return;
    }
    if (vn.length < 4) {
      toast.error('Vehicle number must be at least 4 characters');
      return;
    }
    const t = toast.loading('Generating E-Way Bill…');
    try {
      await genEwb.mutateAsync({
        id: id!,
        data: {
          transporter_id: tid || undefined,
          transporter_name: ewbForm.transporter_name.trim() || undefined,
          vehicle_no: vn,
          vehicle_type: ewbForm.vehicle_type,
          transport_mode: ewbForm.transport_mode,
          distance_km: ewbForm.distance_km === '' ? 0 : Number(ewbForm.distance_km),
          trans_doc_no: ewbForm.trans_doc_no.trim() || undefined,
          trans_doc_dt: ewbForm.trans_doc_dt.trim() || undefined,
        },
      });
      toast.success('E-Way Bill generated', { id: t });
      setEwbOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed', { id: t });
    }
  };

  const handleCancelEwb = async () => {
    const t = toast.loading('Cancelling E-Way Bill…');
    try {
      await cancelEwb.mutateAsync({
        id: id!,
        reason_code: parseInt(ewbCancelReason, 10),
        reason_description: ewbCancelNote.trim() || 'Cancelled',
      });
      toast.success('E-Way Bill cancelled', { id: t });
      setEwbCancelOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed', { id: t });
    }
  };

  const ewbStatus = inv.eway_bill_status as string | undefined;
  const hasActiveEwb = !!inv.eway_bill_no && ewbStatus !== 'cancelled';
  const ewbWasCancelled = !!inv.eway_bill_no && ewbStatus === 'cancelled';

  const printReceipt = async () => {
    const w = localStorage.getItem('bizflow_printer_type');
    const width = w === 'thermal58' ? '58' : '80';
    setPrintLoading(true);
    const t = toast.loading('Opening receipt…');
    try {
      const res = await api.get(`/print/receipt/${id}`, { params: { width }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      toast.success('Receipt opened in a new tab', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Print failed', { id: t });
    } finally {
      setPrintLoading(false);
    }
  };

  const downloadInvoicePdf = async () => {
    setPdfLoading(true);
    const t = toast.loading('Preparing PDF…');
    try {
      const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${inv.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Download failed', { id: t });
    } finally {
      setPdfLoading(false);
    }
  };

  const downloadEinvoicePdf = async () => {
    setEinvPdfLoading(true);
    const t = toast.loading('Preparing e-invoice PDF…');
    try {
      const res = await api.get(`/invoices/${id}/einvoice/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `einvoice-${inv.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Download failed', { id: t });
    } finally {
      setEinvPdfLoading(false);
    }
  };

  const normalizePhone = (raw?: string) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `91${digits}`;
    if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
    return digits;
  };

  const buildWaMessage = () => {
    const partyName = inv.party_name || inv.party_display_name || 'Customer';
    return `Hi ${partyName},

Please find invoice ${inv.invoice_number} dated ${formatDate(inv.invoice_date)} for ${formatMoney(inv.total_amount)}.
Thank you.
- ${company?.name || 'Microtechnique Accounts'}`;
  };

  const fetchInvoicePdfFile = async (): Promise<File> => {
    const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    return new File([blob], `${inv.invoice_number}.pdf`, { type: 'application/pdf' });
  };

  const openWhatsApp = async (target: 'web' | 'app') => {
    const phone = normalizePhone(sharePhone);
    if (!phone) {
      toast.error('Enter a mobile number to share this invoice.');
      return;
    }

    const text = buildWaMessage();
    setWaSending(true);
    try {
      if (target === 'app') {
        // On supported devices this opens native share sheet with WhatsApp option and PDF attached.
        if (navigator.share) {
          const file = await fetchInvoicePdfFile();
          const navAny = navigator as any;
          const canShareFiles = typeof navAny.canShare === 'function' ? navAny.canShare({ files: [file] }) : false;
          if (canShareFiles) {
            await navigator.share({
              title: `Invoice ${inv.invoice_number}`,
              text,
              files: [file],
            });
            toast.success('Shared via app chooser');
            setWaPickerOpen(false);
            return;
          }
        }
        const appUrl = `whatsapp://send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
        window.open(appUrl, '_blank');
        toast.success('Opening WhatsApp app…');
        setWaPickerOpen(false);
        return;
      }

      // Web flow: open WhatsApp Web with prefilled message and auto-download invoice PDF for manual attach.
      const file = await fetchInvoicePdfFile();
      const localUrl = window.URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = localUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(localUrl);

      const webUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
      window.open(webUrl, '_blank', 'noopener,noreferrer');
      toast.success('Opening WhatsApp Web. Attach the downloaded PDF and send.');
      setWaPickerOpen(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to open WhatsApp');
    } finally {
      setWaSending(false);
    }
  };

  const openEmailShare = () => {
    const subject = encodeURIComponent(`Invoice ${inv.invoice_number}`);
    const body = encodeURIComponent(buildWaMessage());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const openSmsShare = () => {
    const phone = normalizePhone(sharePhone);
    const body = encodeURIComponent(buildWaMessage());
    window.location.href = phone ? `sms:${phone}?&body=${body}` : `sms:?&body=${body}`;
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
          {userRank >= ROLE_RANK.manager && inv.status !== 'cancelled' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!canEditInvoice}
              title={editBlockReason || 'Edit this invoice'}
              onClick={() => canEditInvoice && navigate(`/sales/${id}/edit`)}
            >
              <Pencil className="h-4 w-4" /> Edit
              {!canEditInvoice && ' (locked)'}
            </Button>
          )}
          <Button variant="default" size="sm" className="gap-1.5 bg-indigo-600 hover:bg-indigo-700" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4" /> Preview &amp; share
          </Button>
          <Button variant="outline" size="sm" onClick={printReceipt} loading={printLoading}>
            Print Receipt
          </Button>
          <Button variant="outline" size="sm" onClick={downloadInvoicePdf} loading={pdfLoading}>
            <Download className="h-4 w-4 mr-2" /> Download PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWaPickerOpen((v) => !v)}
          >
            <Send className="h-4 w-4 mr-2" /> WhatsApp
          </Button>
          {inv.irn && (
            <Button variant="outline" size="sm" onClick={downloadEinvoicePdf} loading={einvPdfLoading}>
              <FileDown className="h-4 w-4 mr-2" /> e-Invoice PDF
            </Button>
          )}
        </div>
      </div>

      {waPickerOpen && (
        <Card className="border-emerald-200">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <Input
              value={sharePhone}
              onChange={(e) => setSharePhone(e.target.value)}
              placeholder="Mobile number"
              className="h-9 w-full sm:w-56"
            />
            <Button size="sm" onClick={() => openWhatsApp('web')} loading={waSending}>
              WhatsApp Web
            </Button>
            <Button size="sm" variant="outline" onClick={() => openWhatsApp('app')} loading={waSending}>
              WhatsApp App
            </Button>
            <Button size="sm" variant="outline" onClick={openEmailShare}>
              Email
            </Button>
            <Button size="sm" variant="outline" onClick={openSmsShare}>
              SMS
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWaPickerOpen(false)} disabled={waSending}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

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
                  {(normalizedRole === 'admin' || normalizedRole === 'super_admin') && einvStatus === 'generated' && (
                    <Button variant="destructive" size="sm" className="w-full" onClick={() => setCancelOpen(true)}>
                      <Ban className="h-4 w-4 mr-2" /> Cancel IRN
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center space-y-4">
                  {!canGenEinv ? (
                    <div className="text-sm text-muted-foreground space-y-2 text-left">
                      {!company?.einvoice_enabled ? (
                        <p>
                          Turn on e-Invoice in{' '}
                          <Link to="/settings" className="text-primary font-medium underline underline-offset-2">
                            Company settings
                          </Link>
                          .
                        </p>
                      ) : !canGenEinvRole ? (
                        <p>Only accountant, company admin, or super admin can generate IRN.</p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
                      <p className="text-sm text-muted-foreground">IRN not generated for this invoice.</p>
                      <Button className="w-full" loading={genEinv.isPending} onClick={handleGenerateEInvoice}>
                        Generate IRN
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Truck className="h-4 w-4" /> E-Way Bill
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Status</span>
                <Badge
                  variant="outline"
                  className={`capitalize ${
                    hasActiveEwb
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : ewbWasCancelled
                        ? 'bg-red-100 text-red-800 border-red-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {hasActiveEwb ? 'Generated' : ewbWasCancelled ? 'Cancelled' : 'Not generated'}
                </Badge>
              </div>
              {hasActiveEwb && (
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">E-Way Bill No.</p>
                    <p className="font-mono font-medium">{inv.eway_bill_no}</p>
                  </div>
                  {inv.eway_bill_date && <p className="text-xs">Date: {formatDate(inv.eway_bill_date)}</p>}
                  {inv.eway_bill_valid_upto && (
                    <p className="text-xs text-muted-foreground">Valid up to: {formatDate(inv.eway_bill_valid_upto)}</p>
                  )}
                  {canCancelEwb && (
                    <Button variant="destructive" size="sm" className="w-full mt-2" onClick={() => setEwbCancelOpen(true)}>
                      <Ban className="h-4 w-4 mr-2" /> Cancel E-Way Bill
                    </Button>
                  )}
                </div>
              )}
              {!hasActiveEwb && (
                <div className="text-center space-y-3">
                  {ewbWasCancelled && (
                    <p className="text-xs text-muted-foreground text-left">
                      Previous E-Way Bill was cancelled. You can generate a new one with updated transport details.
                    </p>
                  )}
                  {!inv.irn || einvStatus !== 'generated' ? (
                    <p className="text-sm text-muted-foreground text-left">
                      Generate a valid IRN first; E-Way Bill is created against the e-invoice.
                    </p>
                  ) : !canGenEwb ? (
                    <p className="text-sm text-muted-foreground text-left">
                      Only accountant, company admin, or super admin can generate E-Way Bill.
                    </p>
                  ) : (
                    <Button className="w-full" variant="secondary" onClick={() => setEwbOpen(true)}>
                      <Truck className="h-4 w-4 mr-2" />
                      Generate E-Way Bill
                    </Button>
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
                  <Button variant="destructive" className="flex-1" loading={cancelEinv.isPending} onClick={handleCancelEinvoice}>
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

      <Sheet open={ewbOpen} onOpenChange={setEwbOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Generate E-Way Bill</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4 text-sm">
            <p className="text-muted-foreground text-xs">
              Transporter ID is optional. Enter it only when you have a valid 15-character transporter GSTIN or TRANSIN.
              Vehicle number must be at least 4 characters.
            </p>
            <div className="space-y-2">
              <Label htmlFor="ewb-transporter-id">Transporter ID (optional)</Label>
              <Input
                id="ewb-transporter-id"
                className="font-mono uppercase"
                maxLength={15}
                value={ewbForm.transporter_id}
                onChange={(e) => setEwbForm((f) => ({ ...f, transporter_id: e.target.value }))}
                placeholder="Leave blank for own vehicle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ewb-vehicle">Vehicle number</Label>
              <Input
                id="ewb-vehicle"
                className="font-mono uppercase"
                value={ewbForm.vehicle_no}
                onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_no: e.target.value }))}
                placeholder="e.g. TS09AB1234"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ewb-transporter-name">Transporter name (optional)</Label>
              <Input
                id="ewb-transporter-name"
                value={ewbForm.transporter_name}
                onChange={(e) => setEwbForm((f) => ({ ...f, transporter_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ewb-mode">Transport mode</Label>
                <select
                  id="ewb-mode"
                  className="w-full h-10 rounded-md border bg-background px-2"
                  value={ewbForm.transport_mode}
                  onChange={(e) => setEwbForm((f) => ({ ...f, transport_mode: e.target.value }))}
                >
                  <option value="1">Road (1)</option>
                  <option value="2">Rail (2)</option>
                  <option value="3">Air (3)</option>
                  <option value="4">Ship (4)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-distance">Distance (km)</Label>
                <Input
                  id="ewb-distance"
                  type="number"
                  min={0}
                  value={ewbForm.distance_km}
                  onChange={(e) => setEwbForm((f) => ({ ...f, distance_km: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Vehicle type</Label>
              <select
                className="w-full h-10 rounded-md border bg-background px-2"
                value={ewbForm.vehicle_type}
                onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_type: e.target.value as 'R' | 'O' }))}
              >
                <option value="R">Regular (R)</option>
                <option value="O">ODC / Over dimensional (O)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ewb-doc-no">Trans doc no (optional)</Label>
                <Input
                  id="ewb-doc-no"
                  value={ewbForm.trans_doc_no}
                  onChange={(e) => setEwbForm((f) => ({ ...f, trans_doc_no: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ewb-doc-dt">Trans doc date (optional)</Label>
                <Input
                  id="ewb-doc-dt"
                  type="date"
                  value={ewbForm.trans_doc_dt}
                  onChange={(e) => setEwbForm((f) => ({ ...f, trans_doc_dt: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEwbOpen(false)}>
                Close
              </Button>
              <Button className="flex-1" loading={genEwb.isPending} onClick={handleSubmitEwb}>
                Submit
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={ewbCancelOpen} onOpenChange={setEwbCancelOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Cancel E-Way Bill</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3 text-sm">
            <label className="block text-muted-foreground">Reason</label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2"
              value={ewbCancelReason}
              onChange={(e) => setEwbCancelReason(e.target.value)}
            >
              <option value="1">Duplicate</option>
              <option value="2">Data entry mistake</option>
              <option value="3">Order cancelled</option>
              <option value="4">Other</option>
            </select>
            <textarea
              className="w-full min-h-[60px] rounded-md border bg-background p-2"
              placeholder="Description"
              value={ewbCancelNote}
              onChange={(e) => setEwbCancelNote(e.target.value)}
            />
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEwbCancelOpen(false)}>
                Close
              </Button>
              <Button variant="destructive" className="flex-1" loading={cancelEwb.isPending} onClick={handleCancelEwb}>
                Confirm cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <InvoicePreviewWorkspace
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        mode="saved"
        invoiceId={id}
        invoiceIdForPrint={id}
        shareContext={{
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          totalAmountPaise: inv.total_amount,
          partyName: inv.party_name || inv.party_display_name || 'Customer',
        }}
        partyPhone={inv.party_phone}
        companyName={company?.name}
      />
    </div>
  );
}
