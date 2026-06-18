import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { FileText, Search, Plus, Download, Loader2, Eye, Pencil, FileCheck, Truck, MoreHorizontal, Printer, Send, Trash2, Ban, Files, ReceiptIndianRupee, History, Copy, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { InvoicePreviewWorkspace } from '@/components/invoices/InvoicePreviewWorkspace';
import { useCompany, useUpdateCompany } from '@/hooks/useBusiness';

const BULK_COLUMN_OPTIONS = [
  { id: 'serial_no', label: '#' },
  { id: 'invoice_number', label: 'Invoice No.' },
  { id: 'billing_date', label: 'Billing Date' },
  { id: 'item_name', label: 'Item name' },
  { id: 'item_description', label: 'Description' },
  { id: 'hsn_code', label: 'HSN/SAC' },
  { id: 'quantity', label: 'Qty' },
  { id: 'unit', label: 'Unit' },
  { id: 'unit_price', label: 'Rate' },
  { id: 'discount_amount', label: 'Discount' },
  { id: 'taxable_amount', label: 'Taxable' },
  { id: 'gst_rate', label: 'GST %' },
  { id: 'cgst_amount', label: 'CGST' },
  { id: 'sgst_amount', label: 'SGST' },
  { id: 'igst_amount', label: 'IGST' },
  { id: 'cess_amount', label: 'Cess' },
  { id: 'amount', label: 'Amount' },
  { id: 'payment_status', label: 'Payment Status' },
] as const;

const DEFAULT_BULK_COLUMNS = ['serial_no', 'item_name', 'billing_date', 'quantity', 'unit', 'unit_price', 'gst_rate', 'amount'];
const BULK_TAX_COLUMN_IDS = new Set(['gst_rate', 'cgst_amount', 'sgst_amount', 'igst_amount', 'cess_amount']);
const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
];

function salesCustomBulkOptions(company: any) {
  const defs = Array.isArray(company?.sales_invoice_custom_fields) ? company.sales_invoice_custom_fields : [];
  return defs
    .filter((d: any) => d?.enabled !== false && d?.id && d?.label)
    .map((d: any) => ({
      id: `custom:item:${String(d.id)}`,
      label: String(d.label),
    }));
}

function defaultRange() {
  const to = new Date().toISOString().split('T')[0];
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  return { from, to };
}

function sanitizeBulkColumns(value: unknown, extraOptions: Array<{ id: string }> = []): string[] {
  const allowed = new Set<string>([...BULK_COLUMN_OPTIONS.map((c) => c.id), ...extraOptions.map((c) => c.id)]);
  const raw = Array.isArray(value) ? value : [];
  const cols = raw.map((v) => String(v || '')).filter((v) => allowed.has(v));
  return cols.length ? Array.from(new Set(cols)) : [...DEFAULT_BULK_COLUMNS];
}

export default function InvoiceList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company } = useCompany();
  const updateCompany = useUpdateCompany();
  const initialRange = defaultRange();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [irnLoadingId, setIrnLoadingId] = useState<string | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<any | null>(null);
  const [menuInvoiceId, setMenuInvoiceId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPartySearch, setBulkPartySearch] = useState('');
  const [bulkPartyId, setBulkPartyId] = useState('');
  const [bulkFromDate, setBulkFromDate] = useState(initialRange.from);
  const [bulkToDate, setBulkToDate] = useState(initialRange.to);
  const [bulkColumns, setBulkColumns] = useState<string[]>(DEFAULT_BULK_COLUMNS);
  const [bulkIsGstBill, setBulkIsGstBill] = useState(true);
  const [bulkLoading, setBulkLoading] = useState<'preview' | 'download' | null>(null);
  const [bulkSavedLoadingId, setBulkSavedLoadingId] = useState<string | null>(null);
  const [receiveInvoice, setReceiveInvoice] = useState<any | null>(null);
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [receiveMode, setReceiveMode] = useState('cash');
  const [receiveReference, setReceiveReference] = useState('');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [historyInvoice, setHistoryInvoice] = useState<any | null>(null);
  const customBulkColumnOptions = useMemo(() => salesCustomBulkOptions(company), [company]);

  const companyDefaultBulkColumns = useMemo(
    () => sanitizeBulkColumns((company as any)?.bulk_sales_invoice_columns, customBulkColumnOptions),
    [company, customBulkColumnOptions],
  );

  useEffect(() => {
    if (bulkOpen) setBulkColumns(companyDefaultBulkColumns);
  }, [bulkOpen, companyDefaultBulkColumns]);

  useEffect(() => {
    if (!menuInvoiceId) return;
    const close = () => {
      setMenuInvoiceId(null);
      setMenuPosition(null);
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuInvoiceId]);

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

  const { data: partiesData, isLoading: bulkPartiesLoading } = useQuery({
    queryKey: ['bulk-sales-parties', bulkPartySearch],
    enabled: bulkOpen,
    queryFn: () => api.get('/parties/search', { params: { q: bulkPartySearch } }).then((r) => r.data?.data ?? r.data),
  });
  const bulkParties: any[] = Array.isArray(partiesData) ? partiesData : [];
  const selectedBulkParty = bulkParties.find((p) => p.id === bulkPartyId);

  const { data: bulkInvoicesData, isLoading: bulkInvoicesLoading } = useQuery({
    queryKey: ['bulk-sales-invoices'],
    enabled: bulkOpen,
    queryFn: () => api.get('/invoices/bulk-sales', { params: { page: 1, limit: 20 } }).then((r) => r.data?.data ?? r.data),
  });
  const bulkInvoices: any[] = bulkInvoicesData?.data ?? bulkInvoicesData ?? [];

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['invoice-history', historyInvoice?.id],
    enabled: !!historyInvoice?.id,
    queryFn: () => api.get(`/invoices/${historyInvoice.id}/history`).then((r) => r.data?.data ?? r.data),
  });
  const historyEntries: any[] = historyData?.entries ?? [];

  const receivePaymentMutation = useMutation({
    mutationFn: (payload: any) => api.post('/payments', payload),
    onSuccess: () => {
      toast.success('Payment-In recorded');
      queryClient.invalidateQueries({ queryKey: ['salesInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-in'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-history'] });
      setReceiveInvoice(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Failed to record payment'),
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

  const toggleBulkColumn = useCallback((id: string, enabled: boolean) => {
    setBulkColumns((current) => {
      if (enabled) {
        if (current.includes(id)) return current;
        return [...current, id];
      }
      const next = current.filter((c) => c !== id);
      return next.length ? next : current;
    });
  }, []);

  const saveBulkDefaults = useCallback(async () => {
    try {
      await updateCompany.mutateAsync({ bulk_sales_invoice_columns: bulkColumns });
      toast.success('Bulk invoice columns saved as default');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save default columns');
    }
  }, [bulkColumns, updateCompany]);

  const generateBulkInvoicePdf = useCallback(async (mode: 'preview' | 'download') => {
    if (!bulkPartyId) { toast.error('Select a party'); return; }
    if (!bulkFromDate || !bulkToDate) { toast.error('Select from and to dates'); return; }
    if (bulkFromDate > bulkToDate) { toast.error('From date must be on or before to date'); return; }
    setBulkLoading(mode);
    const t = toast.loading(mode === 'preview' ? 'Preparing preview…' : 'Preparing bulk invoice…');
    try {
      const endpoint = mode === 'download' ? '/invoices/bulk-sales' : '/invoices/bulk-sales-pdf';
      const res = await api.post(endpoint, {
        party_id: bulkPartyId,
        from_date: bulkFromDate,
        to_date: bulkToDate,
        columns: bulkColumns,
        is_gst_bill: bulkIsGstBill,
        inline: mode === 'preview',
      }, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      if (mode === 'preview') {
        window.open(url, '_blank', 'noopener,noreferrer');
        toast.success('Bulk invoice preview opened', { id: t });
        setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      } else {
        const safeName = String(selectedBulkParty?.name || 'party').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');
        const link = document.createElement('a');
        link.href = url;
        link.download = `bulk-sales-${safeName}-${bulkFromDate}-${bulkToDate}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        toast.success('Bulk invoice download started', { id: t });
        queryClient.invalidateQueries({ queryKey: ['bulk-sales-invoices'] });
      }
    } catch (err: any) {
      if (err?.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          toast.error(parsed.error || parsed.message || 'Failed to generate bulk invoice', { id: t });
        } catch {
          toast.error('Failed to generate bulk invoice', { id: t });
        }
      } else {
        toast.error(err?.response?.data?.error || 'Failed to generate bulk invoice', { id: t });
      }
    } finally {
      setBulkLoading(null);
    }
  }, [bulkColumns, bulkFromDate, bulkIsGstBill, bulkPartyId, bulkToDate, queryClient, selectedBulkParty]);

  const downloadSavedBulkInvoice = useCallback(async (bulk: any) => {
    setBulkSavedLoadingId(bulk.id);
    const t = toast.loading('Preparing bulk invoice…');
    try {
      const res = await api.get(`/invoices/bulk-sales/${bulk.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(bulk.bulk_invoice_number || 'bulk-invoice').replace(/[^\w.-]+/g, '-')}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Bulk invoice download started', { id: t });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to download bulk invoice', { id: t });
    } finally {
      setBulkSavedLoadingId(null);
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

  const downloadEinvoicePdf = useCallback(async (inv: any) => {
    const t = toast.loading('Preparing e-invoice PDF…');
    try {
      const res = await api.get(`/invoices/${inv.id}/einvoice/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `einvoice-${inv.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('E-invoice PDF download started', { id: t });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to download e-invoice PDF', { id: t });
    }
  }, []);

  const openDeliveryChallanPdf = useCallback(async (inv: any) => {
    const t = toast.loading('Opening delivery challan…');
    try {
      const endpoint = inv.delivery_challan_id
        ? `/sales/challans/${inv.delivery_challan_id}/pdf`
        : `/invoices/${inv.id}/delivery-challan-preview`;
      const res = await api.get(endpoint, {
        params: { inline: 1 },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('Delivery challan preview opened', { id: t });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not open delivery challan', { id: t });
    }
  }, []);

  const openReceivePayment = useCallback((inv: any) => {
    if (!inv.party_id) {
      toast.error('Select a saved party before receiving payment for this invoice');
      return;
    }
    const balance = Math.max(Number(inv.balance_due ?? inv.total_amount ?? 0), 0);
    if (balance <= 0) {
      toast.error('This invoice has no balance due');
      return;
    }
    setReceiveInvoice(inv);
    setReceiveAmount((balance / 100).toFixed(2));
    setReceiveDate(new Date().toISOString().split('T')[0]);
    setReceiveMode('cash');
    setReceiveReference('');
    setReceiveNotes(`Payment for invoice ${inv.invoice_number}`);
  }, []);

  const saveReceivePayment = useCallback(() => {
    if (!receiveInvoice) return;
    const paise = Math.round(Number(receiveAmount || 0) * 100);
    const balance = Math.max(Number(receiveInvoice.balance_due ?? receiveInvoice.total_amount ?? 0), 0);
    if (paise <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (paise > balance) {
      toast.error('Received amount cannot exceed invoice balance due');
      return;
    }
    receivePaymentMutation.mutate({
      party_id: receiveInvoice.party_id,
      payment_type: 'incoming',
      amount: paise,
      payment_date: receiveDate,
      payment_mode: receiveMode,
      reference_number: receiveReference || undefined,
      notes: receiveNotes || `Payment for invoice ${receiveInvoice.invoice_number}`,
      allocations: [{ invoice_id: receiveInvoice.id, amount: paise }],
    });
  }, [receiveAmount, receiveDate, receiveInvoice, receiveMode, receiveNotes, receivePaymentMutation, receiveReference]);

  const deleteInvoice = useCallback(async (inv: any) => {
    const ok = window.confirm(`Delete invoice ${inv.invoice_number}? This removes it from active records.`);
    if (!ok) return;
    const t = toast.loading('Deleting invoice…');
    try {
      await api.delete(`/invoices/${inv.id}`);
      toast.success('Invoice deleted', { id: t });
      setMenuInvoiceId(null);
      queryClient.invalidateQueries({ queryKey: ['salesInvoices'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete invoice', { id: t });
    }
  }, [queryClient]);

  const cancelInvoice = useCallback(async (inv: any) => {
    const ok = window.confirm(`Cancel invoice ${inv.invoice_number}? This will keep the invoice visible as cancelled and reverse stock/party effects where applicable.`);
    if (!ok) return;
    const t = toast.loading('Cancelling invoice…');
    try {
      await api.patch(`/invoices/${inv.id}/cancel`);
      toast.success('Invoice cancelled', { id: t });
      setMenuInvoiceId(null);
      queryClient.invalidateQueries({ queryKey: ['salesInvoices'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to cancel invoice', { id: t });
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
  const activeMenuInvoice = menuInvoiceId ? invoices.find((inv: any) => inv.id === menuInvoiceId) : null;
  const activeMenuHasIrn = !!activeMenuInvoice?.irn && activeMenuInvoice?.einvoice_status === 'generated';
  const activeMenuCanEdit = !!activeMenuInvoice && !activeMenuHasIrn && activeMenuInvoice.status !== 'cancelled';
  const activeMenuCanIRN = activeMenuCanEdit;
  const activeMenuCanEWB = !!activeMenuInvoice && activeMenuHasIrn && !activeMenuInvoice.eway_bill_no && activeMenuInvoice.status !== 'cancelled';
  const activeMenuCanDelete = activeMenuCanEdit;
  const activeMenuCanCancel = !!activeMenuInvoice && !activeMenuHasIrn && activeMenuInvoice.status !== 'cancelled' && Number(activeMenuInvoice.paid_amount || 0) === 0;
  const activeMenuCanReceive = !!activeMenuInvoice && activeMenuInvoice.status !== 'cancelled' && Number(activeMenuInvoice.balance_due ?? 0) > 0;

  const closeActionMenu = useCallback(() => {
    setMenuInvoiceId(null);
    setMenuPosition(null);
  }, []);

  const toggleActionMenu = useCallback((inv: any, target: EventTarget & HTMLButtonElement) => {
    if (menuInvoiceId === inv.id) {
      closeActionMenu();
      return;
    }
    const rect = target.getBoundingClientRect();
    const menuWidth = 280;
    const margin = 12;
    const belowSpace = window.innerHeight - rect.bottom - margin;
    const aboveSpace = rect.top - margin;
    const preferredHeight = 560;
    const openAbove = belowSpace < 280 && aboveSpace > belowSpace;
    const maxHeight = Math.max(220, Math.min(preferredHeight, openAbove ? aboveSpace : belowSpace));
    const top = openAbove
      ? Math.max(margin, rect.top - maxHeight - 6)
      : Math.min(window.innerHeight - margin - maxHeight, rect.bottom + 6);
    const left = Math.min(window.innerWidth - margin - menuWidth, Math.max(margin, rect.right - menuWidth));
    setMenuPosition({ top, left, maxHeight });
    setMenuInvoiceId(inv.id);
  }, [closeActionMenu, menuInvoiceId]);

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
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-2">
            <Files className="h-4 w-4" /> Bulk Invoice
          </Button>
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
                  const hasActiveIrn = !!inv.irn && inv.einvoice_status === 'generated';
                  const canDelete = !hasActiveIrn && inv.status !== 'cancelled';
                  const canCancel = !hasActiveIrn && inv.status !== 'cancelled' && Number(inv.paid_amount || 0) === 0;

                  return (
                    <tr key={inv.id} className="hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-4 tabular-nums">{formatDate(inv.invoice_date)}</td>
                      <td className="py-3 px-4 font-medium">
                        <button onClick={() => navigate(`/sales/${inv.id}`)} className="text-primary hover:underline">
                          {inv.invoice_number}
                        </button>
                        {hasActiveIrn && <span className="ml-1 text-xs text-emerald-600 font-semibold">IRN</span>}
                        {inv.irn && inv.einvoice_status === 'cancelled' && <span className="ml-1 text-xs text-slate-500 font-semibold">IRN cancelled</span>}
                        {inv.eway_bill_no && <span className="ml-1 text-xs text-blue-600 font-semibold">EWB</span>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium">{inv.party_name || 'Walk-in Customer'}</div>
                        <div className="text-xs text-muted-foreground">{inv.party_phone || '-'}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-bold tabular-nums">{formatMoney(inv.total_amount, inv.currency_code)}</td>
                      <td className="py-3 px-4 text-right font-bold tabular-nums">
                        <span className={isOverdue ? 'text-red-600' : ''}>
                          {formatMoney(inv.balance_due ?? 0, inv.currency_code)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary" className={`capitalize ${statusColors[displayStatus] || 'bg-muted text-muted-foreground'}`}>
                          {displayStatus.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="relative flex justify-end items-center gap-1">
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => setPreviewInvoice(inv)}
                            title="Preview invoice"
                          >
                            <Eye className="h-4 w-4" />
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

                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteInvoice(inv)}
                              title="Delete invoice"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          {canCancel && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelInvoice(inv)}
                              title="Cancel invoice"
                              className="text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(event) => toggleActionMenu(inv, event.currentTarget)}
                            title="More actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
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

      {activeMenuInvoice && menuPosition && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            aria-label="Close invoice actions"
            onClick={closeActionMenu}
          />
          <div
            className="fixed z-40 w-[280px] overflow-y-auto rounded-lg border bg-white p-1.5 shadow-2xl"
            style={{ top: menuPosition.top, left: menuPosition.left, maxHeight: menuPosition.maxHeight }}
          >
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); setPreviewInvoice(activeMenuInvoice); }}>
              <Eye className="h-4 w-4" /> Preview / print
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); setPreviewInvoice(activeMenuInvoice); }}>
              <Send className="h-4 w-4" /> Share / WhatsApp / email
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); setPreviewInvoice(activeMenuInvoice); }}>
              <Printer className="h-4 w-4" /> Print A4 / receipt
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); generatePDF(activeMenuInvoice.id, activeMenuInvoice.invoice_number); }}>
              <Download className="h-4 w-4" /> Download invoice PDF
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); openDeliveryChallanPdf(activeMenuInvoice); }}>
              <Truck className="h-4 w-4" /> Preview delivery challan
            </button>
            {activeMenuHasIrn && (
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); downloadEinvoicePdf(activeMenuInvoice); }}>
                <FileCheck className="h-4 w-4" /> Download e-Invoice PDF
              </button>
            )}
            <div className="my-1 border-t" />
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); navigate(`/sales/${activeMenuInvoice.id}`); }}>
              <Eye className="h-4 w-4" /> View / edit
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40" disabled={!activeMenuCanReceive} onClick={() => { closeActionMenu(); if (activeMenuCanReceive) openReceivePayment(activeMenuInvoice); }}>
              <ReceiptIndianRupee className="h-4 w-4" /> Receive payment
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); setHistoryInvoice(activeMenuInvoice); }}>
              <History className="h-4 w-4" /> View history
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { closeActionMenu(); navigate(`/sales/new?duplicate_from=${activeMenuInvoice.id}`); }}>
              <Copy className="h-4 w-4" /> Duplicate this invoice
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40" disabled={!activeMenuCanEdit} onClick={() => { closeActionMenu(); if (activeMenuCanEdit) navigate(`/sales/${activeMenuInvoice.id}/edit`); }}>
              <Pencil className="h-4 w-4" /> Edit invoice
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40" disabled={!activeMenuCanIRN || irnLoadingId === activeMenuInvoice.id} onClick={() => { closeActionMenu(); if (activeMenuCanIRN) generateIRN(activeMenuInvoice.id); }}>
              <FileCheck className="h-4 w-4" /> Generate e-Invoice
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40" disabled={!activeMenuCanEWB} onClick={() => { closeActionMenu(); if (activeMenuCanEWB) navigate(`/sales/${activeMenuInvoice.id}?tab=ewb`); }}>
              <Truck className="h-4 w-4" /> Generate E-Way Bill
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-40" disabled={!activeMenuCanCancel} onClick={() => { closeActionMenu(); if (activeMenuCanCancel) cancelInvoice(activeMenuInvoice); }}>
              <Ban className="h-4 w-4" /> Cancel invoice
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-40" disabled={!activeMenuCanDelete} onClick={() => { closeActionMenu(); if (activeMenuCanDelete) deleteInvoice(activeMenuInvoice); }}>
              <Trash2 className="h-4 w-4" /> Delete invoice
            </button>
          </div>
        </>
      )}

      <Sheet open={bulkOpen} onOpenChange={setBulkOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Bulk Sales Invoice</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-600">
              Creates a reference-only party-wise bulk invoice from existing sales in the selected date range. It is saved separately and does not change ledger, stock, payments, IRN, E-Way Bill, or accounting records.
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Party</Label>
                <Input
                  className="mt-1"
                  placeholder="Search party..."
                  value={bulkPartySearch}
                  onChange={(e) => setBulkPartySearch(e.target.value)}
                />
                <select
                  className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm"
                  value={bulkPartyId}
                  onChange={(e) => setBulkPartyId(e.target.value)}
                >
                  <option value="">{bulkPartiesLoading ? 'Loading parties...' : 'Select party'}</option>
                  {bulkParties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.phone ? ` (${p.phone})` : ''}{p.gstin ? ` - ${p.gstin}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>From date</Label>
                <Input type="date" className="mt-1" value={bulkFromDate} onChange={(e) => setBulkFromDate(e.target.value)} />
              </div>
              <div>
                <Label>To date</Label>
                <Input type="date" className="mt-1" value={bulkToDate} onChange={(e) => setBulkToDate(e.target.value)} />
              </div>
            </div>

            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Bill type</h3>
                  <p className="text-xs text-muted-foreground">
                    Non-GST hides GST columns and GST totals in the reference PDF.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm font-medium">
                  <span className={!bulkIsGstBill ? 'text-foreground' : 'text-muted-foreground'}>Non-GST</span>
                  <Switch checked={bulkIsGstBill} onCheckedChange={setBulkIsGstBill} />
                  <span className={bulkIsGstBill ? 'text-foreground' : 'text-muted-foreground'}>GST</span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Columns</h3>
                  <p className="text-xs text-muted-foreground">Enabled columns appear in this order in the PDF.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setBulkColumns([...DEFAULT_BULK_COLUMNS])}>
                  Reset
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[...BULK_COLUMN_OPTIONS, ...customBulkColumnOptions].map((col) => {
                  const isTaxColumn = BULK_TAX_COLUMN_IDS.has(col.id);
                  const checked = bulkColumns.includes(col.id);
                  const required = bulkColumns.length === 1 && checked;
                  return (
                    <div key={col.id} className={`flex items-center justify-between gap-3 rounded-md border bg-white p-3 ${!bulkIsGstBill && isTaxColumn ? 'opacity-50' : ''}`}>
                      <span className="text-sm font-medium">{col.label}</span>
                      <Switch
                        checked={checked}
                        disabled={required || (!bulkIsGstBill && isTaxColumn)}
                        onCheckedChange={(v) => toggleBulkColumn(col.id, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Bulk invoice section</h3>
                  <p className="text-xs text-muted-foreground">Saved reference invoices. Status is derived from the included source invoices.</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Bulk Invoice #</th>
                      <th className="px-3 py-2">Party</th>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bulkInvoicesLoading ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading bulk invoices...</td></tr>
                    ) : bulkInvoices.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No bulk invoices created yet.</td></tr>
                    ) : bulkInvoices.map((bulk) => (
                      <tr key={bulk.id}>
                        <td className="px-3 py-2 font-semibold">{bulk.bulk_invoice_number}</td>
                        <td className="px-3 py-2">{bulk.party_name}</td>
                        <td className="px-3 py-2 tabular-nums">{formatDate(bulk.from_date)} - {formatDate(bulk.to_date)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(Number(bulk.total_amount || 0))}</td>
                        <td className="px-3 py-2">
                          <Badge variant="secondary" className={`capitalize ${statusColors[bulk.payment_status] || 'bg-muted text-muted-foreground'}`}>
                            {String(bulk.payment_status || 'unpaid').replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button type="button" variant="ghost" size="icon" disabled={bulkSavedLoadingId === bulk.id} onClick={() => downloadSavedBulkInvoice(bulk)}>
                            {bulkSavedLoadingId === bulk.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="sticky bottom-0 -mx-6 border-t bg-background/95 px-6 py-4 backdrop-blur">
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={saveBulkDefaults} loading={updateCompany.isPending}>
                  Save as default columns
                </Button>
                <Button type="button" variant="outline" className="gap-2" onClick={() => generateBulkInvoicePdf('preview')} loading={bulkLoading === 'preview'}>
                  <Eye className="h-4 w-4" /> Preview PDF
                </Button>
                <Button type="button" className="gap-2" onClick={() => generateBulkInvoicePdf('download')} loading={bulkLoading === 'download'}>
                  <Download className="h-4 w-4" /> Create & Download PDF
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!receiveInvoice} onOpenChange={(open) => { if (!open) setReceiveInvoice(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Receive Payment</SheetTitle>
          </SheetHeader>
          {receiveInvoice && (
            <div className="mt-6 space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs text-muted-foreground">Party</div>
                <div className="font-semibold">{receiveInvoice.party_name || 'Customer'}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Invoice</div>
                    <div className="font-medium">{receiveInvoice.invoice_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Balance Due</div>
                    <div className="font-semibold text-primary">{formatMoney(Number(receiveInvoice.balance_due || 0), receiveInvoice.currency_code)}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Receipt Date</Label>
                  <Input type="date" className="mt-1" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Payment Type</Label>
                  <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={receiveMode} onChange={(e) => setReceiveMode(e.target.value)}>
                    {PAYMENT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Received Amount *</Label>
                <Input type="number" min={0.01} step={0.01} className="mt-1 text-lg tabular-nums" value={receiveAmount} onChange={(e) => setReceiveAmount(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Reference No.</Label>
                <Input className="mt-1" placeholder="UTR, cheque no., receipt ref." value={receiveReference} onChange={(e) => setReceiveReference(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <textarea className="mt-1 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm" rows={3} value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} />
              </div>

              <div className="flex gap-3 border-t pt-4">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setReceiveInvoice(null)}>Cancel</Button>
                <Button type="button" className="flex-1" loading={receivePaymentMutation.isPending} onClick={saveReceivePayment}>Save Payment</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {historyInvoice && (
        <div className="fixed inset-0 z-40 bg-black/40 p-4">
          <div className="mx-auto mt-8 flex max-h-[86vh] max-w-4xl flex-col rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-xl font-bold">Edit History for Sale #{historyInvoice.invoice_number}</h2>
              <Button type="button" variant="ghost" size="icon" onClick={() => setHistoryInvoice(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading history...
                </div>
              ) : historyEntries.length === 0 ? (
                <div className="rounded-lg border p-6 text-muted-foreground">No history found for this sale.</div>
              ) : (
                <div className="space-y-3">
                  {historyEntries.map((entry) => (
                    <div key={entry.id} className="rounded-lg border p-4">
                      <div className="flex gap-3">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-500" />
                        <div>
                          <div className="font-semibold">{entry.message}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatDate(entry.created_at)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <InvoicePreviewWorkspace
        open={!!previewInvoice}
        onClose={() => setPreviewInvoice(null)}
        mode="saved"
        invoiceId={previewInvoice?.id}
        invoiceIdForPrint={previewInvoice?.id}
        shareContext={{
          invoiceNumber: previewInvoice?.invoice_number || 'Invoice',
          invoiceDate: previewInvoice?.invoice_date || new Date().toISOString(),
          totalAmountPaise: Number(previewInvoice?.total_amount || 0),
          partyName: previewInvoice?.party_name || 'Customer',
        }}
        partyPhone={previewInvoice?.party_phone || ''}
      />
    </div>
  );
}
