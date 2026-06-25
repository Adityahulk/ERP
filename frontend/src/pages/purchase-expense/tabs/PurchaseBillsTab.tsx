import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useCompany } from '@/hooks/useBusiness';
import { printPdfFromUrl } from '@/lib/printPdf';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Search, IndianRupee, CheckCircle2, AlertCircle, FileText, UserPlus, Pencil, Eye, Download, X, FileSpreadsheet, Printer } from 'lucide-react';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import LineItemsEditor, { type LineItem } from '@/components/shared/LineItemsEditor';
import { useGodowns } from '@/hooks/useStock';
import MoneyInput from '@/components/transactions/MoneyInput';
import { useTransactionDraft } from '@/hooks/useTransactionDraft';
import { downloadXlsx } from '@/lib/reportExport';
import toast from 'react-hot-toast';

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'credit'];
const BILL_NUMBER_PATTERN = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const BILL_NUMBER_HELP = 'Use 1-16 characters: A-Z, 0-9, / or -. First character cannot be 0.';

function PaymentBadge({ status }: { status: string }) {
  if (status === 'paid') return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">Paid</span>;
  if (status === 'partial') return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700">Partial</span>;
  return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">Unpaid</span>;
}

export default function PurchaseBillsTab() {
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilterId, setSupplierFilterId] = useState('');
  const [supplierFilterName, setSupplierFilterName] = useState('');
  const [supplierFilterOpen, setSupplierFilterOpen] = useState(false);
  const [supplierFilterSearch, setSupplierFilterSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const billHydratedRef = useRef<string | null>(null);
  const [showPayDialog, setShowPayDialog] = useState<{ id: string; billNo: string; balance: number } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('cash');

  // Form state
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [billNumber, setBillNumber] = useState('');
  const [godownId, setGodownId] = useState('');
  const [isGst, setIsGst] = useState(true);
  const { data: companyData } = useCompany();
  const gstDefaultAppliedRef = useRef(false);
  useEffect(() => {
    // One-time default from the real company setting for a fresh
    // bill only — editing an existing bill sets its own value via the
    // edit handler, and a restored draft sets its own value too.
    if (gstDefaultAppliedRef.current) return;
    if (editingBillId) { gstDefaultAppliedRef.current = true; return; }
    if (!companyData) return;
    setIsGst((companyData as any)?.tax_settings?.enable_gst !== false);
    gstDefaultAppliedRef.current = true;
  }, [companyData, editingBillId]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);
  const [companyBankAccountId, setCompanyBankAccountId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-bills', search, statusFilter, supplierFilterId],
    queryFn: () =>
      api.get('/purchases/invoices', {
        params: { search: search || undefined, payment_status: statusFilter || undefined, party_id: supplierFilterId || undefined, limit: 100 },
      }).then(r => r.data),
  });

  // Supplier filter dropdown — same /parties/search endpoint already used by the create form below.
  const { data: supplierFilterResults } = useQuery({
    queryKey: ['purchase-bills-supplier-filter', supplierFilterSearch],
    enabled: supplierFilterOpen,
    queryFn: () => api.get('/parties/search', { params: { q: supplierFilterSearch } }).then((r) => r.data?.data ?? r.data),
  });

  const { data: editBillRes, isLoading: editBillLoading } = useQuery({
    queryKey: ['purchase-bill', editingBillId],
    queryFn: () =>
      api.get(`/purchases/invoices/${editingBillId}`).then((r) => {
        const body = r.data as { data?: unknown };
        return body?.data ?? r.data;
      }),
    enabled: !!editingBillId,
  });

  const bills = ((data as any)?.data?.data || [])
    .filter((b: any) => (!dateFrom || b.bill_date >= dateFrom))
    .filter((b: any) => (!dateTo || b.bill_date <= dateTo));
  const meta = (data as any)?.meta || {};
  const stats = [
    { label: 'Total Purchase Amount', value: formatMoney(parseInt(meta.total_amount) || 0), icon: IndianRupee, color: 'text-blue-600 bg-blue-50' },
    { label: 'Paid Amount', value: formatMoney(parseInt(meta.total_paid) || 0), icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Outstanding Amount', value: formatMoney(parseInt(meta.total_unpaid) || 0), icon: AlertCircle, color: 'text-red-500 bg-red-50' },
  ];

  const { clearDraft, saveDraft, loadDraft, hasDraft } = useTransactionDraft(
    'bizflow:draft:purchase-bill',
    { partyId, partyName, billDate, billNumber, godownId, isGst, notes, items, companyBankAccountId },
    (draft: any) => {
      setPartyId(String(draft.partyId || ''));
      setPartyName(String(draft.partyName || ''));
      setBillDate(String(draft.billDate || new Date().toISOString().split('T')[0]));
      setBillNumber(String(draft.billNumber || ''));
      setGodownId(String(draft.godownId || ''));
      setIsGst(draft.isGst !== false);
      setNotes(String(draft.notes || ''));
      setItems(Array.isArray(draft.items) ? draft.items : []);
      setCompanyBankAccountId(String(draft.companyBankAccountId || ''));
      if (draft.partyId || draft.partyName || draft.billNumber || draft.notes || (Array.isArray(draft.items) && draft.items.length)) {
        setShowForm(true);
      }
    },
    {
      enabled: !editingBillId,
      shouldSave: (draft) => Boolean(
        draft.partyId || draft.partyName || draft.billNumber || draft.notes ||
        draft.companyBankAccountId || draft.items.length
      ),
    },
  );

  const saveCurrentDraft = () => {
    if (saveDraft()) toast.success('Purchase bill draft saved');
    else toast.error('Add purchase bill details before saving a draft');
  };

  const loadSavedDraft = () => {
    if (loadDraft()) toast.success('Purchase bill draft loaded');
    else toast.error('No saved draft found');
  };

  const clearSavedDraft = () => {
    clearDraft();
    toast.success('Draft cleared');
  };

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/purchases/invoices', payload),
    onSuccess: () => {
      toast.success('Purchase bill created');
      clearDraft();
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      resetForm();
      setEditingBillId(null);
      billHydratedRef.current = null;
      setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create bill'),
  });

  const updateBillMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.patch(`/purchases/invoices/${id}`, payload),
    onSuccess: () => {
      toast.success('Purchase bill updated');
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      qc.invalidateQueries({ queryKey: ['purchase-bill'] });
      resetForm();
      setEditingBillId(null);
      billHydratedRef.current = null;
      setShowForm(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update bill'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amount, mode }: { id: string; amount: number; mode: string }) =>
      api.post(`/purchases/invoices/${id}/payment`, { amount, payment_mode: mode }),
    onSuccess: () => {
      toast.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      qc.invalidateQueries({ queryKey: ['purchase-bill'] });
      setShowPayDialog(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Payment failed'),
  });

  const searchSuppliers = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) { setPartyResults([]); return; }
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch { setPartyResults([]); }
  };

  const selectSupplier = (p: any) => {
    const rawId = p?.id;
    const id =
      rawId != null && rawId !== '' && String(rawId) !== 'undefined' ? String(rawId) : '';
    if (!id) {
      toast.error('Invalid party id from server.');
      return;
    }
    setPartyId(id);
    setPartyName(String(p.name ?? ''));
    setPartySearch('');
    setPartyResults([]);
  };
  const clearSupplier = () => { setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]); };

  const resetForm = () => {
    setPartyId(''); setPartyName(''); setPartySearch(''); setPartyResults([]);
    setBillDate(new Date().toISOString().split('T')[0]); setBillNumber('');
    setGodownId(''); setNotes(''); setItems([]);
    setCompanyBankAccountId('');
    setEditingBillId(null);
    billHydratedRef.current = null;
  };

  useEffect(() => {
    if (!showForm || !editingBillId || !editBillRes) return;
    if (billHydratedRef.current === editingBillId) return;
    const b = editBillRes as Record<string, unknown>;
    if (String(b.id) !== editingBillId) return;

    setPartyId(String(b.party_id || ''));
    setBillDate(b.bill_date ? String(b.bill_date).slice(0, 10) : new Date().toISOString().split('T')[0]);
    setBillNumber(String(b.bill_number || ''));
    setGodownId(b.godown_id ? String(b.godown_id) : '');
    setIsGst(b.is_gst_invoice !== false);
    setNotes(String(b.notes || ''));
    setCompanyBankAccountId(b.company_bank_account_id ? String(b.company_bank_account_id) : '');

    const rows = (b.items as any[]) || [];
    setItems(
      rows.map((it: any) => ({
        item_id: it.item_id ? String(it.item_id) : undefined,
        name: String(it.item_name || ''),
        hsn_code: it.hsn_code ? String(it.hsn_code) : '',
        unit: it.unit ? String(it.unit) : 'PCS',
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
        discount_amount: Number(it.discount_amount || 0),
        gst_rate: Number(it.gst_rate) || 0,
      })),
    );

    billHydratedRef.current = editingBillId;
  }, [showForm, editingBillId, editBillRes]);

  const openNewBill = () => {
    if (editingBillId) {
      resetForm();
      setEditingBillId(null);
      billHydratedRef.current = null;
    }
    setShowForm(true);
  };

  const openEditBill = (billId: string, partyDisplayName?: string) => {
    resetForm();
    setEditingBillId(billId);
    setPartyName((partyDisplayName || '').trim());
    billHydratedRef.current = null;
    setShowForm(true);
  };

  const buildPayload = () => ({
    party_id: partyId,
    bill_date: billDate,
    bill_number: billNumber.trim() || undefined,
    godown_id: godownId || undefined,
    is_gst_invoice: isGst,
    notes: notes.trim() || undefined,
    company_bank_account_id: companyBankAccountId || undefined,
    items: items.map((it) => ({
      item_id: it.item_id,
      item_name: it.name,
      hsn_code: it.hsn_code,
      unit: it.unit,
      quantity: it.quantity,
      unit_price: it.unit_price,
      gst_rate: isGst ? (it.gst_rate || 0) : 0,
    })),
  });

  const handleSave = () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    const normalizedBillNumber = billNumber.trim();
    if (editingBillId && !normalizedBillNumber) { toast.error('Bill number is required while editing'); return; }
    if (normalizedBillNumber && !BILL_NUMBER_PATTERN.test(normalizedBillNumber)) {
      toast.error(BILL_NUMBER_HELP);
      return;
    }
    const payload = buildPayload();
    if (editingBillId) updateBillMutation.mutate({ id: editingBillId, payload });
    else createMutation.mutate(payload);
  };

  const previewBill = async (id: string) => {
    const t = toast.loading('Opening preview…');
    try {
      const res = await api.get(`/purchases/invoices/${id}/pdf`, { params: { inline: 1 }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('Preview opened', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Preview failed', { id: t });
    }
  };

  const downloadBillPdf = async (id: string, billNumber?: string) => {
    const t = toast.loading('Preparing PDF…');
    try {
      const res = await api.get(`/purchases/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${billNumber || 'purchase-bill'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download started', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Download failed', { id: t });
    }
  };

  const exportBillsToExcel = () => {
    const rows = bills.map((b: any) => {
      const paidAmt = parseInt(b.paid_amount) || 0;
      const totalAmt = parseInt(b.total_amount) || 0;
      return {
        'Bill No.': b.bill_number || '',
        Supplier: b.party_name || '',
        Date: formatDate(b.bill_date),
        Amount: totalAmt / 100,
        Paid: paidAmt / 100,
        Balance: (totalAmt - paidAmt) / 100,
        Status: b.payment_status || 'unpaid',
      };
    });
    downloadXlsx(`purchase-bills-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Purchase Bills', rows);
    toast.success('Exported to Excel');
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.color}`}>
                <s.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search bills…" className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['', 'unpaid', 'partial', 'paid'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        {/* Supplier filter — backed by the real /parties/search + party_id param listPurchaseInvoices already accepts */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSupplierFilterOpen((o) => !o)}
            className="h-9 px-3 rounded-md border bg-background text-xs flex items-center gap-2 hover:bg-muted/50 min-w-[150px]"
          >
            <span className="truncate flex-1 text-left">{supplierFilterName || 'All suppliers'}</span>
            {supplierFilterId && (
              <span onClick={(e) => { e.stopPropagation(); setSupplierFilterId(''); setSupplierFilterName(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
          {supplierFilterOpen && (
            <div className="absolute z-20 mt-1 w-64 rounded-md border bg-background shadow-lg p-2">
              <Input autoFocus placeholder="Search supplier…" value={supplierFilterSearch} onChange={(e) => setSupplierFilterSearch(e.target.value)} className="mb-2 h-8" />
              <div className="max-h-48 overflow-y-auto">
                {(supplierFilterResults || []).map((p: any) => (
                  <button key={p.id} type="button" className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted"
                    onClick={() => { setSupplierFilterId(p.id); setSupplierFilterName(p.name); setSupplierFilterOpen(false); }}>
                    {p.name}
                  </button>
                ))}
                {supplierFilterSearch && (supplierFilterResults || []).length === 0 && <p className="text-xs text-muted-foreground px-2 py-2">No matches</p>}
              </div>
            </div>
          )}
        </div>

        {/* Date range — client-side filter, since listPurchaseInvoices has no from_date/to_date param */}
        <div className="flex items-center gap-1.5">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[130px] text-xs" title="From date" />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[130px] text-xs" title="To date" />
          {(dateFrom || dateTo) && (
            <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-muted-foreground hover:text-foreground" title="Clear date filter">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {hasDraft && !editingBillId && (
            <Button size="sm" variant="outline" onClick={loadSavedDraft}>
              Open draft
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportBillsToExcel} disabled={bills.length === 0}>
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openNewBill}>
            <Plus className="w-4 h-4" /> Add Purchase
          </Button>
        </div>
      </div>

      {/* Bills Table */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Bill No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Party</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground hidden lg:table-cell">Items</th>
              <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground hidden sm:table-cell">Status</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Amount</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground hidden sm:table-cell">Paid</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground hidden md:table-cell">Balance</th>
              <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && bills.length === 0 && (
              <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No purchase bills. Click <strong>Add Purchase</strong> to create one.
              </td></tr>
            )}
            {bills.map((b: any) => {
              const balance = (parseInt(b.total_amount)||0) - (parseInt(b.paid_amount)||0);
              const paidAmt = parseInt(b.paid_amount) || 0;
              const canEditBill = paidAmt === 0;
              return (
                <tr key={b.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(b.bill_date)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">{b.bill_number || '—'}</td>
                  <td className="px-4 py-2.5 font-medium">{b.party_name || '—'}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-muted-foreground hidden lg:table-cell">
                    {b.item_count ?? 0}{parseFloat(b.total_quantity) ? <span className="text-muted-foreground/70"> ({parseFloat(b.total_quantity)} qty)</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-center hidden sm:table-cell">
                    <PaymentBadge status={b.payment_status || 'unpaid'} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(parseInt(b.total_amount)||0)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 hidden sm:table-cell">{paidAmt > 0 ? formatMoney(paidAmt) : '—'}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold hidden md:table-cell ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    {balance > 0 ? formatMoney(balance) : '✓ Paid'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => previewBill(b.id)} title="Preview bill">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => printPdfFromUrl(`/purchases/invoices/${b.id}/pdf`, undefined, `purchase bill ${b.id}`)} title="Print">
                        <Printer className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => downloadBillPdf(b.id, b.bill_number)} title="Download PDF">
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      {canEditBill && (
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={() => openEditBill(b.id, b.party_name)}>
                          <Pencil className="w-3 h-3" /> Edit
                        </Button>
                      )}
                      {balance > 0 && (
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                          onClick={() => { setShowPayDialog({ id: b.id, billNo: b.bill_number, balance }); setPayAmount((balance / 100).toFixed(2)); }}>
                          Pay
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Bill Sheet */}
      <Sheet
        open={showForm}
        onOpenChange={(v) => {
          if (!v) {
            if (editingBillId) resetForm();
            setShowForm(false);
          } else setShowForm(true);
        }}
      >
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>{editingBillId ? 'Edit Purchase Bill' : 'Add Purchase Bill'}</SheetTitle>
          </SheetHeader>
          {!editingBillId && (
            <div className="mb-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={saveCurrentDraft}>Save draft</Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasDraft} onClick={loadSavedDraft}>Load draft</Button>
              {hasDraft && <Button type="button" variant="ghost" size="sm" onClick={clearSavedDraft}>Clear draft</Button>}
            </div>
          )}
          {editingBillId && editBillLoading && (
            <p className="text-sm text-muted-foreground mb-4">Loading bill…</p>
          )}
          <div className="space-y-4">
            {/* Party */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Party *</Label>
                {partyId ? (
                  <div className="mt-1 flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                    <span className="font-medium text-sm">{partyName || 'Selected party'}</span>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={clearSupplier}>Change</button>
                  </div>
                ) : (
                  <div className="mt-1 flex gap-2">
                    <div className="relative flex-1">
                      <Input placeholder="Search party…" value={partySearch} onChange={e => searchSuppliers(e.target.value)} className="h-9" />
                      {partyResults.length > 0 && (
                        <div className="absolute z-20 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {partyResults.map((p: any) => (
                            <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectSupplier(p)}>
                              <span className="font-medium">{p.name}</span>
                              {p.gstin && <span className="text-muted-foreground ml-2 text-xs font-mono">{p.gstin}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={() => { setQuickAddOpen(true); }}>
                      <UserPlus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Bill Date</Label>
                <Input type="date" className="mt-1 h-9" value={billDate} onChange={e => setBillDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Vendor bill no. (optional)</Label>
                <Input
                  className="mt-1 h-9 font-mono text-xs"
                  placeholder="Auto-generated"
                  value={billNumber}
                  maxLength={16}
                  onChange={e => setBillNumber(e.target.value.trim().toUpperCase())}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">{BILL_NUMBER_HELP}</p>
              </div>
              <div>
                <Label className="text-xs">Godown (optional)</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                  <option value="">None</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 h-9">
                  <input type="checkbox" checked={isGst} onChange={e => setIsGst(e.target.checked)} />
                  GST Invoice
                </label>
              </div>
              <div className="col-span-2">
                <BankAccountPicker
                  remountKey={showForm ? 1 : 0}
                  value={companyBankAccountId}
                  onChange={setCompanyBankAccountId}
                />
              </div>
            </div>

            {/* Items */}
            <div>
              <Label className="text-xs mb-2 block">Items</Label>
              <LineItemsEditor
                items={items}
                onChange={setItems}
                isGst={isGst}
                searchMode="catalog"
                defaultRateFrom="purchase"
                godownId={godownId}
                showHsn={true}
                showUnit={true}
              />
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <div className="flex gap-3 pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              <Button
                className="flex-1"
                loading={createMutation.isPending || updateBillMutation.isPending}
                onClick={handleSave}
                disabled={!partyId || items.length === 0 || (!!editingBillId && editBillLoading)}
              >
                {editingBillId ? 'Save changes' : 'Save Bill'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Payment Dialog */}
      {showPayDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">Record Payment</h3>
            <p className="text-sm text-muted-foreground">Bill: {showPayDialog.billNo} · Balance: {formatMoney(showPayDialog.balance)}</p>
            <div>
              <Label className="text-xs">Amount (₹) *</Label>
              <MoneyInput className="mt-1" value={Math.round((parseFloat(payAmount || '0') || 0) * 100)} onChange={(paise) => setPayAmount(String(paise / 100))} />
            </div>
            <div>
              <Label className="text-xs">Payment Mode</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={payMode} onChange={e => setPayMode(e.target.value)}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowPayDialog(null)}>Cancel</Button>
              <Button className="flex-1" loading={payMutation.isPending}
                onClick={() => payMutation.mutate({ id: showPayDialog.id, amount: Math.round(parseFloat(payAmount || '0') * 100), mode: payMode })}>
                Record Payment
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName="" onCreated={(row) => selectSupplier(row)} />
    </div>
  );
}
