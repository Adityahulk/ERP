import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useCreateInvoice, useCompany, useInvoice, useUpdateInvoice } from '@/hooks/useBusiness';
import { useGodowns } from '@/hooks/useStock';
import { formatMoney, paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { GST_RATE_OPTIONS } from '@/lib/gstRates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Trash2, Search, Eye, UserPlus, ScanLine, PackagePlus } from 'lucide-react';
import { DOCUMENT_THEME_OPTIONS, InvoicePreviewWorkspace, readSkipInvoicePreview, type DocumentThemeId } from '@/components/invoices/InvoicePreviewWorkspace';
import { INVOICE_PDF_TEMPLATES, type InvoicePdfTemplateId } from '@/components/invoices/InvoicePreviewWorkspace';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import { QuickAddItemSheet } from '@/components/items/QuickAddItemSheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import OcrBillSheet, { type OcrResult } from '@/components/shared/OcrBillSheet';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface LineItem {
  item_id?: string; name: string; description?: string; hsn_code?: string;
  unit?: string;
  quantity: number; unit_price: number; gst_rate: number;
  discount_percent: number; cess_rate: number;
}

const GST_STATE_OPTIONS = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'],
] as const;

function partyFullAddress(p: any, kind: 'shipping' | 'billing' = 'shipping') {
  const direct = kind === 'shipping' ? p?.shipping_address : p?.billing_address;
  if (direct) return String(direct);
  return [
    p?.billing_address,
    p?.billing_city || p?.city,
    p?.billing_state || p?.state,
    p?.billing_pincode || p?.pincode,
  ].filter(Boolean).join(', ');
}

function cleanMoneyInput(value: string) {
  const cleaned = String(value || '').replace(/[^\d.]/g, '');
  const [whole, ...decimalParts] = cleaned.split('.');
  const decimals = decimalParts.join('').slice(0, 2);
  return decimalParts.length ? `${whole}.${decimals}` : whole;
}

function formatEditableRupees(paise: number) {
  if (!paise) return '';
  return paiseToRupees(paise).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const { id: routeParamId } = useParams();
  const { pathname } = useLocation();
  const editInvoiceId = pathname.endsWith('/edit') && routeParamId ? routeParamId : undefined;

  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();
  const { data: existingInv, isLoading: editInvLoading, isError: editInvError } = useInvoice(editInvoiceId);
  const { data: company } = useCompany();
  const { data: godownData } = useGodowns();
  const godowns = godownData?.data || [];

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [godownId, setGodownId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [isInterstate, setIsInterstate] = useState(false);
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [isGstInvoice, setIsGstInvoice] = useState(true);
  const [pdfTemplate, setPdfTemplate] = useState<InvoicePdfTemplateId>('standard');
  const [documentTheme, setDocumentTheme] = useState<DocumentThemeId>('classic');
  const [notes, setNotes] = useState('');
  const [amountPaid, setAmountPaid] = useState(0);
  const [items, setItems] = useState<LineItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [draftPreviewOpen, setDraftPreviewOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');
  const [quickAddItemOpen, setQuickAddItemOpen] = useState(false);
  const [quickAddItemDefaultName, setQuickAddItemDefaultName] = useState('');
  const [partySearchLoading, setPartySearchLoading] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [companyBankAccountId, setCompanyBankAccountId] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentReferenceNumber, setPaymentReferenceNumber] = useState('');
  const [moneyDrafts, setMoneyDrafts] = useState<Record<string, string>>({});

  const hydratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editInvoiceId) {
      hydratedIdRef.current = null;
      return;
    }
    if (!existingInv) return;
    const inv = existingInv as Record<string, unknown>;
    if (String(inv.id) !== editInvoiceId) return;
    if (hydratedIdRef.current === editInvoiceId) return;

    if (
      inv.irn ||
      Number(inv.paid_amount ?? inv.amount_paid ?? 0) > 0 ||
      (Array.isArray(inv.payments) && inv.payments.length > 0)
    ) {
      toast.error('This invoice cannot be edited (payments on file or e-invoice IRN).');
      navigate(`/sales/${editInvoiceId}`);
      return;
    }

    const nonGst = inv.invoice_type === 'non_gst' || inv.is_gst_invoice === false;
    setIsGstInvoice(!nonGst);
    setPartyId(String(inv.party_id || ''));
    setPartyName(String(inv.party_display_name || inv.party_name_snapshot || inv.party_name || ''));
    setPartyPhone(String(inv.party_phone || ''));
    setGodownId(inv.godown_id ? String(inv.godown_id) : '');
    const invDate = inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '';
    setInvoiceDate(invDate || new Date().toISOString().split('T')[0]);
    setDueDate(inv.due_date ? String(inv.due_date).slice(0, 10) : '');
    setIsInterstate(Boolean(inv.is_interstate));
    setPlaceOfSupply(inv.place_of_supply ? String(inv.place_of_supply) : '');
    setShippingAddress(String(inv.shipping_address_snapshot || ''));
    setNotes(String(inv.notes || ''));
    setAmountPaid(0);
    const tpl = String(inv.pdf_template || 'standard');
    setPdfTemplate((['standard', 'simple', 'performa'].includes(tpl) ? tpl : 'standard') as InvoicePdfTemplateId);
    const th = String(inv.document_theme || 'classic');
    setDocumentTheme((DOCUMENT_THEME_OPTIONS.some((opt) => opt.id === th) ? th : 'classic') as DocumentThemeId);
    setCompanyBankAccountId(inv.company_bank_account_id ? String(inv.company_bank_account_id) : '');

    const mappedItems: LineItem[] = ((inv.items as any[]) || []).map((it: any) => {
      const qty = Number(it.quantity) || 1;
      const up = Number(it.unit_price) || 0;
      const base = qty * up;
      const discAmt = Number(it.discount_amount || 0);
      const discount_percent =
        base > 0 ? Math.min(100, Math.round(((discAmt / base) * 100 + Number.EPSILON) * 100) / 100) : 0;
      const taxable = Number(it.taxable_amount) || 0;
      const cessAmt = Number(it.cess_amount || 0);
      const cess_rate = taxable > 0 && cessAmt ? Math.round((cessAmt / taxable) * 10000) / 100 : 0;
      return {
        item_id: it.item_id ? String(it.item_id) : undefined,
        name: String(it.item_name || ''),
        description: String(it.item_description || ''),
        hsn_code: it.hsn_code ? String(it.hsn_code) : '',
        unit: String(it.unit || it.unit_abbr || 'PCS'),
        quantity: qty,
        unit_price: up,
        gst_rate: Number(it.gst_rate) || 0,
        discount_percent,
        cess_rate,
      };
    });
    setItems(mappedItems);
    setMoneyDrafts({});

    hydratedIdRef.current = editInvoiceId;
  }, [editInvoiceId, existingInv, navigate]);

  /** OCR confirmed from a customer PO / incoming bill → pre-fill invoice fields */
  const handleOcrConfirm = (data: OcrResult & { overrides: any }) => {
    if (data.bill_date) setInvoiceDate(data.bill_date);
    if (data.party_name) {
      // Seed party search so the user can pick or quick-add the customer
      setPartySearch(data.party_name);
      searchParties(data.party_name);
    }
    toast.success('Invoice details applied — select the party and verify');
  };

  const clearPartySelection = () => {
    setPartyId('');
    setPartyName('');
    setPartyPhone('');
    setPartySearch('');
    setPartyResults([]);
    setShippingAddress('');
  };

  // Search parties
  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (q.length < 2) {
      setPartyResults([]);
      setPartySearchLoading(false);
      return;
    }
    setPartySearchLoading(true);
    try {
      const { data: res } = await api.get('/parties/search', { params: { q } });
      setPartyResults(res.data || []);
    } catch {
      setPartyResults([]);
    } finally {
      setPartySearchLoading(false);
    }
  };

  const selectParty = (p: any) => {
    const rawId = p?.id;
    const id =
      rawId != null && rawId !== '' && String(rawId) !== 'undefined' ? String(rawId) : '';
    if (!id) {
      toast.error('Could not select party — invalid id. Try again or add the party under Parties.');
      return;
    }
    setPartyId(id);
    setPartyName(String(p.name ?? ''));
    setPartyPhone(p.phone || '');
    setShippingAddress(partyFullAddress(p, 'shipping') || partyFullAddress(p, 'billing'));
    setPartySearch('');
    setPartyResults([]);
    const companyStateCode = String((company as any)?.state_code || '').trim();
    const partyStateCode = String(p.billing_state_code || p.state_code || '').trim();
    if (!placeOfSupply && companyStateCode && partyStateCode) {
      setIsInterstate(companyStateCode !== partyStateCode);
    }
  };

  const updatePlaceOfSupply = (value: string) => {
    setPlaceOfSupply(value);
    const companyStateCode = String((company as any)?.state_code || '').trim();
    if (value && companyStateCode) setIsInterstate(companyStateCode !== value);
  };

  const openQuickAdd = (prefillName?: string) => {
    setQuickAddDefaultName(prefillName ?? '');
    setQuickAddOpen(true);
  };

  const openQuickAddItem = (prefillName?: string) => {
    setQuickAddItemDefaultName(prefillName ?? itemSearch.trim());
    setQuickAddItemOpen(true);
  };

  // Search items
  const searchItems = async (q: string) => {
    setItemSearch(q);
    if (q.length < 2) { setItemResults([]); return; }
    try {
      const { data: res } = await api.post('/invoices/search-items', { q, godown_id: godownId || undefined });
      setItemResults(res.data || []);
    } catch { setItemResults([]); }
  };

  const addItem = (item: any) => {
    if (items.find(i => i.item_id === item.id)) return;
    setItems([...items, {
      item_id: item.id, name: item.name, hsn_code: item.hsn_code || '',
      unit: item.unit || item.unit_abbr || item.unit_name || 'PCS',
      quantity: 1, unit_price: item.unit_price ?? item.selling_price,
      gst_rate: item.gst_rate || 18, discount_percent: 0, cess_rate: 0,
    }]);
    setItemSearch(''); setItemResults([]);
  };

  const updateLine = (idx: number, f: string, v: any) => {
    const updated = [...items];
    (updated[idx] as any)[f] = v;
    setItems(updated);
  };

  const removeLine = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const setMoneyDraft = (key: string, raw: string, applyPaise: (paise: number) => void) => {
    const next = cleanMoneyInput(raw);
    setMoneyDrafts((drafts) => ({ ...drafts, [key]: next }));
    applyPaise(rupeesToPaise(next || '0'));
  };

  const clearMoneyDraft = (key: string) => {
    setMoneyDrafts((drafts) => {
      const next = { ...drafts };
      delete next[key];
      return next;
    });
  };

  const moneyValue = (key: string, paise: number) => (
    Object.prototype.hasOwnProperty.call(moneyDrafts, key)
      ? moneyDrafts[key]
      : formatEditableRupees(paise)
  );

  // Calculations
  const calcLine = (item: LineItem) => {
    const lineTotal = item.quantity * item.unit_price;
    const discount = lineTotal * item.discount_percent / 100;
    const taxable = lineTotal - discount;
    const gst = isGstInvoice ? Math.round(taxable * item.gst_rate / 100) : 0;
    const cess = isGstInvoice ? Math.round(taxable * item.cess_rate / 100) : 0;
    return { lineTotal, discount, taxable, gst, cess, total: taxable + gst + cess };
  };

  const subtotal = items.reduce((s, i) => s + calcLine(i).taxable, 0);
  const totalTax = items.reduce((s, i) => s + calcLine(i).gst, 0);
  const totalCess = items.reduce((s, i) => s + calcLine(i).cess, 0);
  const grandTotal = subtotal + totalTax + totalCess;
  const balanceDue = grandTotal - amountPaid;

  const draftPreviewPayload = useMemo(
    () => ({
      invoice_type: isGstInvoice ? 'sale' : 'non_gst',
      is_gst_invoice: isGstInvoice,
      pdf_template: pdfTemplate,
      document_theme: documentTheme,
      party_id: partyId || undefined,
      party_name: partyName || undefined,
      godown_id: godownId || undefined,
      invoice_date: invoiceDate,
      due_date: dueDate || undefined,
      is_interstate: isInterstate,
      place_of_supply: placeOfSupply || undefined,
      shipping_address: shippingAddress.trim() || undefined,
      notes: notes || undefined,
      amount_paid: amountPaid,
      payment_mode: amountPaid > 0 ? paymentMode : undefined,
      payment_reference_number: amountPaid > 0 ? paymentReferenceNumber || undefined : undefined,
      company_bank_account_id: companyBankAccountId || undefined,
      items: items.map((i) => ({
        item_id: i.item_id,
        description: i.description,
        name: i.name,
        item_name: i.name,
        hsn_code: i.hsn_code,
        unit: i.unit || 'PCS',
        quantity: i.quantity,
        unit_price: i.unit_price,
        gst_rate: i.gst_rate,
        discount_percent: i.discount_percent,
        cess_rate: i.cess_rate,
      })),
    }),
    [partyId, partyName, godownId, invoiceDate, dueDate, isInterstate, placeOfSupply, shippingAddress, notes, amountPaid, paymentMode, paymentReferenceNumber, items, isGstInvoice, pdfTemplate, documentTheme, companyBankAccountId],
  );

  const handleSubmit = async () => {
    if (!partyId) { toast.error('Select a party'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    if (!editInvoiceId && amountPaid > grandTotal) { toast.error('Amount paid cannot exceed invoice total'); return; }

    const itemPayload = items.map((i) => ({
      item_id: i.item_id,
      description: i.description,
      name: i.name,
      item_name: i.name,
      hsn_code: i.hsn_code,
      unit: i.unit || 'PCS',
      quantity: i.quantity,
      unit_price: i.unit_price,
      gst_rate: isGstInvoice ? i.gst_rate : 0,
      discount_percent: i.discount_percent,
      cess_rate: isGstInvoice ? i.cess_rate : 0,
    }));

    if (editInvoiceId) {
      try {
        await updateMutation.mutateAsync({
          id: editInvoiceId,
          data: {
            invoice_type: isGstInvoice ? 'sale' : 'non_gst',
            is_gst_invoice: isGstInvoice,
            pdf_template: pdfTemplate,
            document_theme: documentTheme,
            party_id: partyId,
            godown_id: godownId || undefined,
            invoice_date: invoiceDate,
            due_date: dueDate || undefined,
            is_interstate: isInterstate,
            place_of_supply: placeOfSupply || undefined,
            shipping_address: shippingAddress.trim() || undefined,
            notes,
            company_bank_account_id: companyBankAccountId || undefined,
            items: itemPayload,
          },
        });
        toast.success('Invoice updated');
        navigate(`/sales/${editInvoiceId}`);
      } catch (e: any) {
        toast.error(e.response?.data?.error || 'Failed to update invoice');
      }
      return;
    }

    try {
      const res = await createMutation.mutateAsync({
        invoice_type: isGstInvoice ? 'sale' : 'non_gst',
        is_gst_invoice: isGstInvoice,
        pdf_template: pdfTemplate,
        document_theme: documentTheme,
        party_id: partyId, godown_id: godownId || undefined,
        invoice_date: invoiceDate, due_date: dueDate || undefined,
        is_interstate: isInterstate, place_of_supply: placeOfSupply || undefined,
        shipping_address: shippingAddress.trim() || undefined, notes,
        amount_paid: amountPaid,
        payment_mode: amountPaid > 0 ? paymentMode : undefined,
        payment_reference_number: amountPaid > 0 ? paymentReferenceNumber || undefined : undefined,
        company_bank_account_id: companyBankAccountId || undefined,
        items: itemPayload,
      });
      const inv = (res as any)?.data ?? res;
      toast.success(`Invoice created: ${inv?.invoice_number || ''}`);
      const newId = inv?.id;
      const skipPreview = readSkipInvoicePreview();
      if (newId) navigate(skipPreview ? `/sales/${newId}` : `/sales/${newId}?preview=1`);
      else navigate('/sales');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to create invoice'); }
  };

  if (editInvoiceId && editInvLoading) {
    return <div className="flex justify-center p-16 text-muted-foreground">Loading invoice…</div>;
  }
  if (editInvoiceId && editInvError) {
    return (
      <div className="flex flex-col items-center gap-4 p-16 max-w-md mx-auto text-center">
        <p className="text-muted-foreground">Could not load this invoice.</p>
        <Button onClick={() => navigate('/sales')}>Back to sales</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(editInvoiceId ? `/sales/${editInvoiceId}` : '/sales')}><ArrowLeft className="w-5 h-5" /></Button>
          <div><h1 className="text-2xl font-bold">{editInvoiceId ? 'Edit Sale Invoice' : 'New Sale Invoice'}</h1></div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={!!editInvoiceId} onClick={() => setOcrOpen(true)}>
          <ScanLine className="w-4 h-4" />
          Scan party bill
        </Button>
      </div>

      {/* Party & Details */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Party Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Label>Select party *</Label>
              {partyId ? (
                <div className="flex items-center justify-between mt-1 p-2 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm">{partyName}</span>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => clearPartySelection()}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="relative min-w-0 flex-1">
                      <Input
                        className="w-full"
                        placeholder="Search by name, phone, GSTIN..."
                        value={partySearch}
                        onChange={(e) => searchParties(e.target.value)}
                      />
                      {partyResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {partyResults.map((p) => (
                            <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => selectParty(p)}>
                              <span className="font-medium">{p.name}</span>
                              {p.phone && <span className="text-muted-foreground ml-2">{p.phone}</span>}
                              {p.gstin && <span className="text-muted-foreground ml-2 font-mono text-xs">{p.gstin}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1 sm:mt-0" onClick={() => openQuickAdd()}>
                      <UserPlus className="h-4 w-4" />
                      Add party
                    </Button>
                  </div>
                  {partySearch.length >= 2 && !partySearchLoading && partyResults.length === 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      No matches.{' '}
                      <button type="button" className="text-primary font-medium hover:underline" onClick={() => openQuickAdd(partySearch)}>
                        Add “{partySearch.trim()}” as party
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Invoice Info</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Invoice Date</Label><Input type="date" className="mt-1" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
              <div><Label>Due Date</Label><Input type="date" className="mt-1" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Godown</Label>
                <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                  <option value="">Default</option>
                  {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={isInterstate} onChange={e => setIsInterstate(e.target.checked)} disabled={!isGstInvoice} className="rounded border-input" />
                  Interstate (IGST)
                </label>
              </div>
            </div>
            <div>
              <Label>Place of Supply State</Label>
              <select className="mt-1 w-full h-10 rounded-md border bg-transparent px-3 text-sm" value={placeOfSupply} onChange={e => updatePlaceOfSupply(e.target.value)} disabled={!isGstInvoice}>
                <option value="">Same as party billing state</option>
                {GST_STATE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
              </select>
            </div>
            <div>
              <Label>Ship To / Place of Supply Address</Label>
              <textarea
                className="mt-1 w-full min-h-[76px] rounded-md border bg-background px-3 py-2 text-sm resize-y"
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                placeholder="Leave blank to use party shipping or billing address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border p-2">
                <input type="checkbox" checked={isGstInvoice} onChange={e => setIsGstInvoice(e.target.checked)} className="rounded border-input" />
                GST invoice
              </label>
              <select className="w-full h-10 rounded-md border bg-transparent px-3 text-sm" value={pdfTemplate} onChange={e => setPdfTemplate(e.target.value as InvoicePdfTemplateId)}>
                {INVOICE_PDF_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <select className="col-span-2 w-full h-10 rounded-md border bg-transparent px-3 text-sm" value={documentTheme} onChange={e => setDocumentTheme(e.target.value as DocumentThemeId)}>
                {DOCUMENT_THEME_OPTIONS.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
              </select>
            </div>
            <BankAccountPicker value={companyBankAccountId} onChange={setCompanyBankAccountId} className="pt-2 border-t" />
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search products to add..."
                value={itemSearch}
                onChange={(e) => searchItems(e.target.value)}
              />
              {itemResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {itemResults.map((it: any) => (
                    <button
                      key={it.id}
                      className="w-full text-left px-4 py-2 hover:bg-muted text-sm flex justify-between"
                      onClick={() => addItem(it)}
                    >
                      <span>
                        {it.name} <span className="text-muted-foreground">{it.sku}</span>
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(Number(it.unit_price || 0))}
                        {typeof it.available_stock === 'number' ? ` • Stock ${it.available_stock}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => openQuickAddItem()}>
              <PackagePlus className="h-4 w-4" />
              Add item
            </Button>
          </div>
          {itemSearch.length >= 2 && itemResults.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No matches.{' '}
              <button type="button" className="text-primary font-medium hover:underline" onClick={() => openQuickAddItem(itemSearch)}>
                Add “{itemSearch.trim()}” as item
              </button>
            </p>
          )}

          {items.length > 0 && (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/40 border-b">
                  <th className="p-2 text-left font-medium">Item</th>
                  <th className="p-2 text-left font-medium w-16">HSN</th>
                  <th className="p-2 text-right font-medium w-16">Qty</th>
                  <th className="p-2 text-left font-medium w-20">Unit</th>
                  <th className="p-2 text-right font-medium w-28">Price (Basic)</th>
                  <th className="p-2 text-right font-medium w-16">Disc%</th>
                  <th className="p-2 text-right font-medium w-16">GST%</th>
                  <th className="p-2 text-right font-medium w-24">Line Total</th>
                  <th className="w-10"></th>
                </tr></thead>
                <tbody>
                  {items.map((item, idx) => {
                    const c = calcLine(item);
                    return (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-medium min-w-[260px]">
                          <div>{item.name}</div>
                          <textarea
                            className="mt-1 w-full min-h-[44px] rounded-md border bg-background px-2 py-1 text-xs font-normal text-slate-700 resize-y"
                            placeholder="Optional printed description/details under this item..."
                            value={item.description || ''}
                            onChange={e => updateLine(idx, 'description', e.target.value)}
                          />
                        </td>
                        <td className="p-2"><Input className="w-16 text-xs h-7" value={item.hsn_code || ''} onChange={e => updateLine(idx, 'hsn_code', e.target.value)} /></td>
                        <td className="p-2"><Input type="number" className="w-16 text-center h-7 tabular-nums" min={1} value={item.quantity} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                        <td className="p-2"><Input className="w-20 h-7 text-xs uppercase" value={item.unit || ''} placeholder="PCS" onChange={e => updateLine(idx, 'unit', e.target.value.toUpperCase())} /></td>
                        <td className="p-2">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="w-28 text-right h-7 tabular-nums"
                            placeholder="0"
                            value={moneyValue(`line-${idx}-price`, item.unit_price)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => clearMoneyDraft(`line-${idx}-price`)}
                            onChange={e => setMoneyDraft(`line-${idx}-price`, e.target.value, (paise) => updateLine(idx, 'unit_price', paise))}
                          />
                        </td>
                        <td className="p-2"><Input type="number" className="w-16 text-center h-7 tabular-nums" min={0} max={100} value={item.discount_percent} onChange={e => updateLine(idx, 'discount_percent', parseFloat(e.target.value) || 0)} /></td>
                        <td className="p-2">
                          <select className="w-20 h-7 rounded border bg-transparent text-xs" value={item.gst_rate} onChange={e => updateLine(idx, 'gst_rate', parseInt(e.target.value, 10))}>
                            {GST_RATE_OPTIONS.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                          </select>
                        </td>
                        <td className="p-2 text-right tabular-nums font-medium">{formatMoney(c.total)}</td>
                        <td className="p-2"><button onClick={() => removeLine(idx)} className="p-1 rounded hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {items.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              Search above or use <strong>Add item</strong> to save a product to your catalog and add it here.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Totals */}
      {items.length > 0 && (
        <div className="flex justify-end">
          <div className="w-full max-w-sm space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums font-medium">{formatMoney(subtotal)}</span></div>
            {!isGstInvoice ? (
              <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span className="tabular-nums">Non-GST invoice</span></div>
            ) : isInterstate ? (
              <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatMoney(totalTax)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatMoney(Math.round(totalTax / 2))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatMoney(Math.round(totalTax / 2))}</span></div>
              </>
            )}
            {totalCess > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cess</span><span className="tabular-nums">{formatMoney(totalCess)}</span></div>}
            <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(grandTotal)}</span></div>
            {!editInvoiceId && (
              <>
                <div className="pt-2">
                  <Label>Amount Paid (₹)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    className="mt-1 tabular-nums"
                    placeholder="0"
                    value={moneyValue('amount-paid', amountPaid)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => clearMoneyDraft('amount-paid')}
                    onChange={e => setMoneyDraft('amount-paid', e.target.value, setAmountPaid)}
                  />
                </div>
                {balanceDue > 0 && <div className="flex justify-between text-red-500 font-semibold"><span>Balance Due</span><span className="tabular-nums">{formatMoney(balanceDue)}</span></div>}
                {amountPaid > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <Label>Payment Type</Label>
                      <select
                        className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value)}
                      >
                        <option value="cash">Cash</option>
                        <option value="upi">UPI / Online</option>
                        <option value="bank_transfer">NEFT / Bank Transfer</option>
                        <option value="cheque">Cheque</option>
                        <option value="card">Card</option>
                      </select>
                    </div>
                    <div>
                      <Label>{paymentMode === 'cheque' ? 'Cheque No.' : 'Reference No.'}</Label>
                      <Input className="mt-1" value={paymentReferenceNumber} onChange={(e) => setPaymentReferenceNumber(e.target.value)} placeholder="Optional" />
                    </div>
                  </div>
                )}
              </>
            )}

            <div><Label>Notes</Label><textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end pb-8 flex-wrap">
        <Button variant="outline" onClick={() => navigate(editInvoiceId ? `/sales/${editInvoiceId}` : '/sales')}>Cancel</Button>
        <Button
          variant="outline"
          disabled={!partyId || items.length === 0}
          onClick={() => setDraftPreviewOpen(true)}
          className="gap-2"
        >
          <Eye className="w-4 h-4" /> Live preview
        </Button>
        <Button
          disabled={!partyId || items.length === 0}
          loading={createMutation.isPending || updateMutation.isPending}
          onClick={handleSubmit}
        >
          {editInvoiceId ? 'Save changes' : 'Create Invoice'}
        </Button>
      </div>

      <InvoicePreviewWorkspace
        open={draftPreviewOpen}
        onClose={() => setDraftPreviewOpen(false)}
        mode="draft"
        draftPayload={draftPreviewPayload}
        shareContext={{
          invoiceNumber: 'PREVIEW',
          invoiceDate: invoiceDate,
          totalAmountPaise: grandTotal,
          partyName: partyName || 'Customer',
        }}
        partyPhone={partyPhone}
        companyName={company?.name}
      />

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName={quickAddDefaultName} onCreated={(row) => selectParty(row)} />

      <QuickAddItemSheet
        open={quickAddItemOpen}
        onOpenChange={setQuickAddItemOpen}
        defaultName={quickAddItemDefaultName}
        onCreated={(row) => {
          addItem({
            id: row.id,
            name: String(row.name ?? ''),
            hsn_code: String(row.hsn_code ?? ''),
            unit_price: Number(row.selling_price ?? 0),
            unit: String(row.unit || row.unit_abbr || row.unit_name || 'PCS'),
            gst_rate: Number(row.gst_rate ?? 18),
          });
        }}
      />

      <OcrBillSheet
        open={ocrOpen}
        onOpenChange={setOcrOpen}
        context="Customer Invoice / Purchase Order"
        onConfirm={handleOcrConfirm}
      />
    </div>
  );
}
