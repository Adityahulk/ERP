import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useCreateInvoice, useCompany, useInvoice, useUpdateInvoice } from '@/hooks/useBusiness';
import { useGodowns } from '@/hooks/useStock';
import { formatMoney, normalizeCurrencyCode, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, ChevronDown, ScanLine, UserPlus, Paperclip } from 'lucide-react';
import {
  DOCUMENT_THEME_OPTIONS,
  InvoicePreviewWorkspace,
  normalizeInvoiceThemeId,
  readSkipInvoicePreview,
  type DocumentThemeId,
  INVOICE_PDF_TEMPLATES,
  type InvoicePdfTemplateId,
} from '@/components/invoices/InvoicePreviewWorkspace';
import { QuickAddPartySheet } from '@/components/parties/QuickAddPartySheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import OcrBillSheet, { type OcrResult } from '@/components/shared/OcrBillSheet';
import VyaparLineItems, { computeTotals, type VyaparLineItem } from '@/components/shared/VyaparLineItems';
import {
  CollapsibleTransactionSection,
  MobileActionBar,
  StickySummaryCard,
  TransactionGrid,
  TransactionHeader,
  TransactionPageShell,
  TransactionSection,
} from '@/components/transactions/TransactionLayout';
import DocumentActionsBar from '@/components/transactions/DocumentActionsBar';
import PaymentRowsEditor, { newPaymentEditorRow, type PaymentEditorRow } from '@/components/transactions/PaymentRowsEditor';
import { useTransactionDraft } from '@/hooks/useTransactionDraft';
import api from '@/lib/api';
import toast from 'react-hot-toast';

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

const INVOICE_NUMBER_PATTERN = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const INVOICE_NUMBER_HELP = 'Use 1-16 characters: A-Z, 0-9, / or -. First character cannot be 0.';

type SalesCustomFieldDef = {
  id: string;
  label: string;
  scope: 'invoice' | 'item';
  type?: 'text' | 'number' | 'date';
  required?: boolean;
  enabled?: boolean;
};

function salesCustomFieldDefs(company: any, scope: 'invoice' | 'item'): SalesCustomFieldDef[] {
  const defs = Array.isArray(company?.sales_invoice_custom_fields) ? company.sales_invoice_custom_fields : [];
  const itemDefs = scope === 'item' && Array.isArray(company?.item_custom_fields)
    ? company.item_custom_fields
        .filter((d: any) => d?.enabled === true && d?.show_in_print === true)
        .map((d: any) => ({
          id: String(d?.id || d?.key || '').trim(),
          label: String(d?.label || d?.id || d?.key || '').trim(),
          scope: 'item' as const,
          type: ['number', 'date'].includes(String(d?.type)) ? d.type : 'text',
          required: false,
          enabled: true,
        }))
    : [];
  const seen = new Set<string>();
  return [...defs, ...itemDefs]
    .map((d: any) => ({
      id: String(d?.id || '').trim(),
      label: String(d?.label || d?.id || '').trim(),
      scope: (d?.scope === 'invoice' ? 'invoice' : 'item') as SalesCustomFieldDef['scope'],
      type: (['number', 'date'].includes(String(d?.type)) ? d.type : 'text') as SalesCustomFieldDef['type'],
      required: Boolean(d?.required),
      enabled: d?.enabled !== false,
    }))
    .filter((d: SalesCustomFieldDef) => {
      if (!d.id || !d.label || d.scope !== scope || !d.enabled || seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
}

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

function gstStateFromGstin(value?: string | null) {
  const gstin = String(value || '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(gstin) ? gstin.slice(0, 2) : '';
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const { id: routeParamId } = useParams();
  const { pathname, search: locationSearch } = useLocation();
  const editInvoiceId = pathname.endsWith('/edit') && routeParamId ? routeParamId : undefined;
  const duplicateInvoiceId = !editInvoiceId ? new URLSearchParams(locationSearch).get('duplicate_from') || undefined : undefined;

  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();
  const { data: existingInv, isLoading: editInvLoading, isError: editInvError } = useInvoice(editInvoiceId || duplicateInvoiceId);
  const { data: company } = useCompany();
  const { data: godownData } = useGodowns();
  const godowns = godownData?.data || [];

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<any[]>([]);
  const [partySearchLoading, setPartySearchLoading] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDefaultName, setQuickAddDefaultName] = useState('');

  const [godownId, setGodownId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [autoInvoiceNumber, setAutoInvoiceNumber] = useState('');
  const [invoiceNumberEdited, setInvoiceNumberEdited] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('INR');
  const [isInterstate, setIsInterstate] = useState(false);
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [isGstInvoice, setIsGstInvoice] = useState(true);
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const [pdfTemplate, setPdfTemplate] = useState<InvoicePdfTemplateId>('business-theme-1');
  const [documentTheme, setDocumentTheme] = useState<DocumentThemeId>('business-theme-1');
  const [companyBankAccountId, setCompanyBankAccountId] = useState('');

  const [notes, setNotes] = useState('');
  const [externalDescription, setExternalDescription] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [paymentRows, setPaymentRows] = useState<PaymentEditorRow[]>([newPaymentEditorRow()]);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [items, setItems] = useState<VyaparLineItem[]>([]);
  const [draftPreviewOpen, setDraftPreviewOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const invoiceCustomFieldDefs = useMemo(() => salesCustomFieldDefs(company, 'invoice'), [company]);
  const itemCustomFieldDefs = useMemo(() => salesCustomFieldDefs(company, 'item'), [company]);
  const enabledCurrencies = useMemo(() => {
    const raw = Array.isArray((company as any)?.enabled_currencies) ? (company as any).enabled_currencies : ['INR'];
    const normalized = raw.map((c: unknown) => normalizeCurrencyCode(c)).filter((c: CurrencyCode, idx: number, arr: CurrencyCode[]) => arr.indexOf(c) === idx);
    return normalized.length ? normalized : ['INR'];
  }, [company]);

  useEffect(() => {
    if (editInvoiceId || !company) return;
    const preferred = normalizeCurrencyCode((company as any).default_currency || (company as any).currency || 'INR');
    setCurrencyCode(enabledCurrencies.includes(preferred) ? preferred : enabledCurrencies[0]);
  }, [company, editInvoiceId, enabledCurrencies]);

  const hydratedIdRef = useRef<string | null>(null);
  const duplicateHydratedIdRef = useRef<string | null>(null);
  const advancedAutoOpenedRef = useRef(false);

  useEffect(() => {
    if (!editInvoiceId) {
      hydratedIdRef.current = null;
      return;
    }
    if (!existingInv) return;
    const inv = existingInv as Record<string, unknown>;
    if (String(inv.id) !== editInvoiceId || hydratedIdRef.current === editInvoiceId) return;

    if (inv.irn && inv.einvoice_status === 'generated') {
      toast.error('This invoice cannot be edited because active e-invoice IRN is generated.');
      navigate(`/sales/${editInvoiceId}`);
      return;
    }

    const nonGst = inv.invoice_type === 'non_gst' || inv.is_gst_invoice === false;
    setIsGstInvoice(!nonGst);
    setRoundOffEnabled(Boolean(inv.round_off_enabled) || Number(inv.round_off || 0) !== 0);
    setPartyId(String(inv.party_id || ''));
    setPartyName(String(inv.party_display_name || inv.party_name_snapshot || inv.party_name || ''));
    setPartyPhone(String(inv.party_phone || ''));
    setGodownId(inv.godown_id ? String(inv.godown_id) : '');
    setInvoiceNumber(String(inv.invoice_number || ''));
    setAutoInvoiceNumber('');
    setInvoiceNumberEdited(true);
    setCurrencyCode(normalizeCurrencyCode(inv.currency_code || (company as any)?.default_currency || (company as any)?.currency || 'INR'));
    setInvoiceDate(inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : new Date().toISOString().split('T')[0]);
    setDueDate(inv.due_date ? String(inv.due_date).slice(0, 10) : '');
    setIsInterstate(Boolean(inv.is_interstate));
    setPlaceOfSupply(inv.place_of_supply ? String(inv.place_of_supply) : '');
    setShippingAddress(String(inv.shipping_address_snapshot || ''));
    setNotes(String(inv.notes || ''));
    setExternalDescription(String(inv.external_description || ''));
    setCustomFields((inv.custom_fields && typeof inv.custom_fields === 'object' ? inv.custom_fields : {}) as Record<string, string>);
    setPaymentRows([newPaymentEditorRow()]);
    setInvoiceFiles([]);
    setPdfTemplate(normalizeInvoiceThemeId(inv.pdf_template));
    setDocumentTheme(normalizeInvoiceThemeId(inv.document_theme));
    setCompanyBankAccountId(inv.company_bank_account_id ? String(inv.company_bank_account_id) : '');
    setItems(((inv.items as any[]) || []).map((it: any) => ({
      item_id: it.item_id ? String(it.item_id) : undefined,
      name: String(it.item_name || ''),
      description: String(it.item_description || ''),
      hsn_code: it.hsn_code ? String(it.hsn_code) : '',
      item_type: it.item_type,
      track_inventory: it.track_inventory,
      unit: String(it.unit || it.unit_abbr || 'PCS'),
      quantity: Number(it.quantity) || 1,
      unit_price: Number(it.unit_price) || 0,
      discount_amount: Number(it.discount_amount || 0),
      gst_rate: Number(it.gst_rate) || 0,
      cess_rate: Number(it.cess_rate) || 0,
      custom_fields: (it.custom_fields && typeof it.custom_fields === 'object' ? it.custom_fields : {}) as Record<string, string>,
    })));
    hydratedIdRef.current = editInvoiceId;
  }, [editInvoiceId, existingInv, navigate]);

  useEffect(() => {
    if (!duplicateInvoiceId || editInvoiceId) {
      duplicateHydratedIdRef.current = null;
      return;
    }
    if (!existingInv) return;
    const inv = existingInv as Record<string, unknown>;
    if (String(inv.id) !== duplicateInvoiceId || duplicateHydratedIdRef.current === duplicateInvoiceId) return;

    const today = new Date().toISOString().split('T')[0];
    const nonGst = inv.invoice_type === 'non_gst' || inv.is_gst_invoice === false;
    setIsGstInvoice(!nonGst);
    setRoundOffEnabled(Boolean(inv.round_off_enabled) || Number(inv.round_off || 0) !== 0);
    setPartyId(String(inv.party_id || ''));
    setPartyName(String(inv.party_display_name || inv.party_name_snapshot || inv.party_name || ''));
    setPartyPhone(String(inv.party_phone || ''));
    setGodownId(inv.godown_id ? String(inv.godown_id) : '');
    setInvoiceNumberEdited(false);
    setCurrencyCode(normalizeCurrencyCode(inv.currency_code || (company as any)?.default_currency || (company as any)?.currency || 'INR'));
    setInvoiceDate(today);
    setDueDate('');
    setIsInterstate(Boolean(inv.is_interstate));
    setPlaceOfSupply(inv.place_of_supply ? String(inv.place_of_supply) : '');
    setShippingAddress(String(inv.shipping_address_snapshot || ''));
    setNotes(String(inv.notes || ''));
    setExternalDescription(String(inv.external_description || ''));
    setCustomFields((inv.custom_fields && typeof inv.custom_fields === 'object' ? inv.custom_fields : {}) as Record<string, string>);
    setPaymentRows([newPaymentEditorRow()]);
    setInvoiceFiles([]);
    setPdfTemplate(normalizeInvoiceThemeId(inv.pdf_template));
    setDocumentTheme(normalizeInvoiceThemeId(inv.document_theme));
    setCompanyBankAccountId(inv.company_bank_account_id ? String(inv.company_bank_account_id) : '');
    setItems(((inv.items as any[]) || []).map((it: any) => ({
      item_id: it.item_id ? String(it.item_id) : undefined,
      name: String(it.item_name || ''),
      description: String(it.item_description || ''),
      hsn_code: it.hsn_code ? String(it.hsn_code) : '',
      item_type: it.item_type,
      track_inventory: it.track_inventory,
      unit: String(it.unit || it.unit_abbr || 'PCS'),
      quantity: Number(it.quantity) || 1,
      unit_price: Number(it.unit_price) || 0,
      discount_amount: Number(it.discount_amount || 0),
      gst_rate: Number(it.gst_rate) || 0,
      cess_rate: Number(it.cess_rate) || 0,
      custom_fields: (it.custom_fields && typeof it.custom_fields === 'object' ? it.custom_fields : {}) as Record<string, string>,
    })));
    duplicateHydratedIdRef.current = duplicateInvoiceId;
    toast.success('Invoice copied into a new editable draft');
  }, [company, duplicateInvoiceId, editInvoiceId, existingInv]);

  useEffect(() => {
    if (editInvoiceId) return;
    let cancelled = false;
    setInvoiceNumberLoading(true);
    api.get('/invoices/next-number', {
      params: {
        invoice_type: isGstInvoice ? 'sale' : 'non_gst',
        godown_id: godownId || undefined,
      },
    })
      .then(({ data: res }) => {
        if (cancelled) return;
        const nextNumber = String(res?.data?.invoice_number || '').trim();
        if (!nextNumber) return;
        setAutoInvoiceNumber(nextNumber);
        setInvoiceNumber((current) => {
          if (invoiceNumberEdited && current.trim()) return current;
          return nextNumber;
        });
      })
      .catch(() => {
        if (!cancelled) setAutoInvoiceNumber('');
      })
      .finally(() => {
        if (!cancelled) setInvoiceNumberLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editInvoiceId, godownId, isGstInvoice, invoiceNumberEdited]);

  const handleOcrConfirm = (data: OcrResult & { overrides: any }) => {
    if (data.bill_date) setInvoiceDate(data.bill_date);
    if (data.invoice_number) {
      setInvoiceNumberEdited(true);
      setInvoiceNumber(String(data.invoice_number).trim().toUpperCase().slice(0, 16));
    }
    if (data.matched_party_id && data.matched_party) {
      selectParty(data.matched_party);
      toast.success('Matched party from OCR and applied it');
      return;
    }
    if (data.party_name) {
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
    const id = rawId != null && rawId !== '' && String(rawId) !== 'undefined' ? String(rawId) : '';
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
    const companyStateCode = gstStateFromGstin((company as any)?.gstin) || String((company as any)?.state_code || '').trim();
    const partyStateCode = gstStateFromGstin(p.gstin) || String(p.billing_state_code || p.state_code || '').trim();
    if (isGstInvoice && !placeOfSupply && companyStateCode && partyStateCode) setIsInterstate(companyStateCode !== partyStateCode);
  };

  const updatePlaceOfSupply = (value: string) => {
    setPlaceOfSupply(value);
    const companyStateCode = gstStateFromGstin((company as any)?.gstin) || String((company as any)?.state_code || '').trim();
    if (value && companyStateCode) setIsInterstate(companyStateCode !== value);
  };

  const setGstEnabled = (enabled: boolean) => {
    setIsGstInvoice(enabled);
    if (!enabled) {
      setIsInterstate(false);
      setPlaceOfSupply('');
    }
  };

  const totals = useMemo(() => computeTotals(items, isGstInvoice, roundOffEnabled), [items, isGstInvoice, roundOffEnabled]);
  const taxBreakdown = useMemo(() => {
    return items.reduce((acc, item) => {
      if (!isGstInvoice) return acc;
      const gross = Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
      const taxable = Math.max(0, gross - (Number(item.discount_amount) || 0));
      const rate = Number(item.gst_rate) || 0;
      const components = Array.isArray(item.tax_components) ? item.tax_components : [];
      if (isInterstate) {
        const igstRate = Number(components.find((part) => String(part.type).toUpperCase() === 'IGST')?.rate ?? rate) || 0;
        acc.igst += Math.round(taxable * igstRate / 100);
        return acc;
      }
      const cgstRate = Number(components.find((part) => String(part.type).toUpperCase() === 'CGST')?.rate ?? rate / 2) || 0;
      const sgstRate = Number(components.find((part) => String(part.type).toUpperCase() === 'SGST')?.rate ?? rate / 2) || 0;
      const cessRate = Number(components.find((part) => ['CESS', 'OTHER'].includes(String(part.type).toUpperCase()))?.rate ?? 0) || 0;
      acc.cgst += Math.round(taxable * cgstRate / 100);
      acc.sgst += Math.round(taxable * sgstRate / 100);
      acc.componentCess += Math.round(taxable * cessRate / 100);
      return acc;
    }, { cgst: 0, sgst: 0, igst: 0, componentCess: 0 });
  }, [items, isGstInvoice, isInterstate]);
  const cgstDisplay = taxBreakdown.cgst || Math.round(totals.tax / 2);
  const sgstDisplay = taxBreakdown.sgst || (totals.tax - cgstDisplay);
  const igstDisplay = taxBreakdown.igst || totals.tax;
  const effectivePartyName = partyId ? partyName.trim() : (partySearch.trim() || partyName.trim());
  const amountPaid = paymentRows
    .filter((row) => row.payment_mode !== 'credit')
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const balanceDue = totals.total - amountPaid;

  const itemPayload = () => items.map((i) => ({
    item_id: i.item_id,
    description: i.description,
    name: i.name,
    item_name: i.name,
    hsn_code: i.hsn_code,
    unit: i.unit || 'PCS',
    quantity: i.quantity,
    unit_price: i.unit_price,
    gst_rate: isGstInvoice ? i.gst_rate : 0,
    discount_amount: i.discount_amount,
    cess_rate: isGstInvoice ? i.cess_rate || 0 : 0,
    currency_code: currencyCode,
    custom_fields: i.custom_fields || {},
  }));

  const paymentPayload = () => paymentRows
    .filter((row) => row.payment_mode !== 'credit' && Number(row.amount) > 0)
    .map((row) => ({
      payment_mode: row.payment_mode,
      amount: row.amount,
      currency_code: currencyCode,
      company_bank_account_id: row.company_bank_account_id || companyBankAccountId || undefined,
      reference_number: row.reference_number || undefined,
      cheque_number: row.cheque_number || undefined,
      instrument_date: row.instrument_date || undefined,
    }));

  const draftPreviewPayload = useMemo(
    () => ({
      invoice_type: isGstInvoice ? 'sale' : 'non_gst',
      is_gst_invoice: isGstInvoice,
      round_off_enabled: roundOffEnabled,
      pdf_template: pdfTemplate,
      document_theme: documentTheme,
      party_id: partyId || undefined,
      party_name: effectivePartyName || undefined,
      godown_id: godownId || undefined,
      invoice_number: invoiceNumber.trim() || undefined,
      invoice_date: invoiceDate,
      due_date: dueDate || undefined,
      is_interstate: isInterstate,
      place_of_supply: placeOfSupply || undefined,
      shipping_address: shippingAddress.trim() || undefined,
      party_phone: partyPhone || undefined,
      currency_code: currencyCode,
      notes: notes || undefined,
      external_description: externalDescription || undefined,
      custom_fields: customFields,
      amount_paid: amountPaid,
      payments: paymentRows,
      company_bank_account_id: companyBankAccountId || undefined,
      items: itemPayload(),
    }),
    [partyId, effectivePartyName, partyPhone, godownId, invoiceNumber, invoiceDate, dueDate, currencyCode, isInterstate, placeOfSupply, shippingAddress, notes, externalDescription, customFields, amountPaid, paymentRows, items, isGstInvoice, roundOffEnabled, pdfTemplate, documentTheme, companyBankAccountId],
  );

  const draftState = useMemo(() => ({
    partyId, partyName, partySearch, partyPhone, godownId, invoiceNumber, invoiceDate, dueDate, currencyCode,
    isInterstate, placeOfSupply, shippingAddress, isGstInvoice, roundOffEnabled, pdfTemplate,
    documentTheme, companyBankAccountId, notes, externalDescription, customFields, paymentRows, items,
  }), [partyId, partyName, partySearch, partyPhone, godownId, invoiceNumber, invoiceDate, dueDate, currencyCode, isInterstate, placeOfSupply, shippingAddress, isGstInvoice, roundOffEnabled, pdfTemplate, documentTheme, companyBankAccountId, notes, externalDescription, customFields, paymentRows, items]);

  const { clearDraft, saveDraft, loadDraft, hasDraft } = useTransactionDraft(
    'bizflow:draft:sales-invoice',
    draftState,
    (draft: any) => {
      setPartyId(String(draft.partyId || ''));
      setPartyName(String(draft.partyName || ''));
      setPartySearch(String(draft.partySearch || ''));
      setPartyPhone(String(draft.partyPhone || ''));
      setGodownId(String(draft.godownId || ''));
      setInvoiceNumber(String(draft.invoiceNumber || ''));
      setInvoiceNumberEdited(Boolean(String(draft.invoiceNumber || '').trim()));
      setInvoiceDate(String(draft.invoiceDate || new Date().toISOString().split('T')[0]));
      setDueDate(String(draft.dueDate || ''));
      setCurrencyCode(normalizeCurrencyCode(draft.currencyCode || (company as any)?.default_currency || (company as any)?.currency || 'INR'));
      setIsInterstate(Boolean(draft.isInterstate));
      setPlaceOfSupply(String(draft.placeOfSupply || ''));
      setShippingAddress(String(draft.shippingAddress || ''));
      setIsGstInvoice(draft.isGstInvoice !== false);
      setRoundOffEnabled(Boolean(draft.roundOffEnabled));
      setPdfTemplate(normalizeInvoiceThemeId(draft.pdfTemplate));
      setDocumentTheme(normalizeInvoiceThemeId(draft.documentTheme));
      setCompanyBankAccountId(String(draft.companyBankAccountId || ''));
      setNotes(String(draft.notes || ''));
      setExternalDescription(String(draft.externalDescription || ''));
      setCustomFields(draft.customFields && typeof draft.customFields === 'object' ? draft.customFields : {});
      setPaymentRows(Array.isArray(draft.paymentRows) && draft.paymentRows.length ? draft.paymentRows : [newPaymentEditorRow()]);
      setItems(Array.isArray(draft.items) ? draft.items : []);
    },
    {
      enabled: !editInvoiceId && !duplicateInvoiceId,
      shouldSave: (draft) => Boolean(
        draft.partyId || draft.partyName || draft.partySearch || draft.invoiceNumber || draft.dueDate ||
        draft.shippingAddress || draft.notes || draft.externalDescription || draft.items.length ||
        draft.paymentRows.some((row) => row.amount > 0 || row.payment_mode !== 'cash')
      ),
    },
  );

  const saveCurrentDraft = () => {
    const ok = saveDraft();
    if (ok) toast.success('Draft saved');
    else toast.error('Add some details before saving a draft');
  };

  const loadSavedDraft = () => {
    if (loadDraft()) toast.success('Draft loaded');
    else toast.error('No saved draft found');
  };

  const clearSavedDraft = () => {
    clearDraft();
    toast.success('Draft cleared');
  };

  const validate = () => {
    if (!effectivePartyName) { toast.error('Enter or select a party name'); return false; }
    if (items.length === 0) { toast.error('Add at least one item'); return false; }
    if (items.some((item) => !String(item.name || '').trim())) { toast.error('Every line needs an item name'); return false; }
    for (const field of invoiceCustomFieldDefs) {
      if (field.required && !String(customFields[field.id] || '').trim()) {
        toast.error(`${field.label} is required`);
        return false;
      }
    }
    for (const field of itemCustomFieldDefs) {
      if (field.required && items.some((item) => !String(item.custom_fields?.[field.id] || '').trim())) {
        toast.error(`${field.label} is required on every item line`);
        return false;
      }
    }
    if (!editInvoiceId && amountPaid > totals.total) { toast.error('Amount paid cannot exceed invoice total'); return false; }
    const normalizedInvoiceNumber = invoiceNumber.trim();
    if (editInvoiceId && !normalizedInvoiceNumber) { toast.error('Invoice number is required while editing'); return false; }
    if (normalizedInvoiceNumber && !INVOICE_NUMBER_PATTERN.test(normalizedInvoiceNumber)) {
      toast.error(INVOICE_NUMBER_HELP);
      return false;
    }
    if (!editInvoiceId && paymentPayload().some((row) => row.payment_mode === 'cheque' && !row.cheque_number && !row.reference_number)) {
      toast.error('Enter cheque number for cheque payment');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    const normalizedInvoiceNumber = invoiceNumber.trim();
    const commonPayload = {
      invoice_type: isGstInvoice ? 'sale' : 'non_gst',
      is_gst_invoice: isGstInvoice,
      pdf_template: pdfTemplate,
      document_theme: documentTheme,
      currency_code: currencyCode,
      invoice_number: normalizedInvoiceNumber || undefined,
      invoice_number_auto: !editInvoiceId && Boolean(normalizedInvoiceNumber) && !invoiceNumberEdited && normalizedInvoiceNumber === autoInvoiceNumber,
      party_id: partyId || undefined,
      party_name: effectivePartyName,
      godown_id: godownId || undefined,
      invoice_date: invoiceDate,
      due_date: dueDate || undefined,
      is_interstate: isInterstate,
      place_of_supply: placeOfSupply || undefined,
      shipping_address: shippingAddress.trim() || undefined,
      party_phone: partyPhone || undefined,
      notes,
      external_description: externalDescription || undefined,
      custom_fields: customFields,
      round_off_enabled: roundOffEnabled,
      company_bank_account_id: companyBankAccountId || undefined,
      items: itemPayload(),
    };

    if (editInvoiceId) {
      try {
        await updateMutation.mutateAsync({ id: editInvoiceId, data: commonPayload });
        toast.success('Invoice updated');
        navigate(`/sales/${editInvoiceId}`);
      } catch (e: any) {
        toast.error(e.response?.data?.error || 'Failed to update invoice');
      }
      return;
    }

    try {
      const res = await createMutation.mutateAsync({
        ...commonPayload,
        amount_paid: amountPaid,
        payments: paymentPayload(),
      });
      const inv = (res as any)?.data ?? res;
      const newId = inv?.id;
      if (newId) {
        const uploads: Promise<any>[] = [];
        if (externalDescription.trim()) {
          const fd = new FormData();
          fd.append('attachment_type', 'description');
          fd.append('description', externalDescription.trim());
          uploads.push(api.post(`/invoices/${newId}/attachments`, fd));
        }
        invoiceFiles.forEach((file) => {
          const fd = new FormData();
          fd.append('attachment_type', file.type.startsWith('image/') ? 'image' : 'document');
          fd.append('file', file);
          uploads.push(api.post(`/invoices/${newId}/attachments`, fd));
        });
        if (uploads.length) await Promise.allSettled(uploads);
      }
      toast.success(`Invoice created: ${inv?.invoice_number || ''}`);
      clearDraft();
      const skipPreview = readSkipInvoicePreview();
      if (newId) navigate(skipPreview ? `/sales/${newId}` : `/sales/${newId}?preview=1`);
      else navigate('/sales');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to create invoice');
    }
  };

  const canSave = !!effectivePartyName && items.some((item) => String(item.name || '').trim());
  const saving = createMutation.isPending || updateMutation.isPending;
  const cancelTo = editInvoiceId ? `/sales/${editInvoiceId}` : '/sales';
  const advancedHasCustom = Boolean(
    godownId ||
    placeOfSupply ||
    isInterstate ||
    pdfTemplate !== 'business-theme-1' ||
    documentTheme !== 'business-theme-1' ||
    companyBankAccountId
  );

  useEffect(() => {
    if (advancedAutoOpenedRef.current || !advancedHasCustom || (!editInvoiceId && !duplicateInvoiceId)) return;
    setAdvancedOpen(true);
    advancedAutoOpenedRef.current = true;
  }, [advancedHasCustom, editInvoiceId, duplicateInvoiceId]);

  if ((editInvoiceId || duplicateInvoiceId) && editInvLoading) {
    return <div className="flex justify-center p-16 text-muted-foreground">Loading invoice…</div>;
  }
  if ((editInvoiceId || duplicateInvoiceId) && editInvError) {
    return (
      <div className="flex flex-col items-center gap-4 p-16 max-w-md mx-auto text-center">
        <p className="text-muted-foreground">Could not load this invoice.</p>
        <Button onClick={() => navigate('/sales')}>Back to sales</Button>
      </div>
    );
  }

  const summary = (
    <StickySummaryCard>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Invoice Summary</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(totals.total, currencyCode)}</p>
        </div>
        <div className="space-y-1.5 border-t pt-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{isGstInvoice ? 'Taxable' : 'Subtotal'}</span><span className="tabular-nums">{formatMoney(totals.taxable, currencyCode)}</span></div>
          {totals.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">-{formatMoney(totals.discount, currencyCode)}</span></div>}
          {isGstInvoice && (isInterstate ? (
            <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatMoney(igstDisplay, currencyCode)}</span></div>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatMoney(cgstDisplay, currencyCode)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatMoney(sgstDisplay, currencyCode)}</span></div>
            </>
          ))}
          {totals.cess > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cess</span><span className="tabular-nums">{formatMoney(totals.cess, currencyCode)}</span></div>}
          <div className="flex items-center justify-between border-t pt-2">
            <label className="flex items-center gap-2 text-muted-foreground">
              <Switch checked={roundOffEnabled} onCheckedChange={setRoundOffEnabled} />
              <span>Round Off</span>
            </label>
            <span className="min-w-20 rounded-md border bg-background px-2 py-1 text-right tabular-nums">
              {formatMoney(totals.roundOff, currencyCode)}
            </span>
          </div>
          {!editInvoiceId && <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Received</span><span className="tabular-nums">{formatMoney(amountPaid, currencyCode)}</span></div>}
          {!editInvoiceId && <div className={`flex justify-between font-semibold ${balanceDue > 0 ? 'text-red-600' : 'text-emerald-600'}`}><span>Balance Due</span><span className="tabular-nums">{formatMoney(Math.max(balanceDue, 0), currencyCode)}</span></div>}
        </div>
        <div className="border-t pt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-sm font-medium hover:bg-muted/50"
            onClick={() => setTermsOpen((open) => !open)}
          >
            <span>Terms & Conditions</span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${termsOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className="mt-2">
            <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value="sale_invoice" onChange={() => undefined}>
              <option value="sale_invoice">Sale Invoice</option>
            </select>
          </div>
          {termsOpen && (
            <textarea
              className="mt-2 min-h-[74px] w-full resize-y rounded-md border bg-background px-3 py-2 text-xs leading-5 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={(company as any)?.terms_and_conditions || 'Thanks for doing business with us.'}
            />
          )}
        </div>
        <div className="hidden xl:block border-t pt-3">
          <DocumentActionsBar
            onCancel={() => navigate(cancelTo)}
            onPreview={() => setDraftPreviewOpen(true)}
            onSave={handleSubmit}
            canPreview={canSave}
            canSave={canSave}
            saving={saving}
            saveLabel={editInvoiceId ? 'Save changes' : 'Create Invoice'}
          />
        </div>
      </div>
    </StickySummaryCard>
  );

  return (
    <TransactionPageShell>
      <TransactionHeader
        title={editInvoiceId ? 'Edit Sale Invoice' : duplicateInvoiceId ? 'Duplicate Sale Invoice' : 'New Sale Invoice'}
        description="Create a sale with customer, items, payment and printable invoice details."
        left={<Button variant="ghost" size="icon" onClick={() => navigate(cancelTo)}><ArrowLeft className="h-5 w-5" /></Button>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!editInvoiceId && (
              <>
                <Button variant="outline" size="sm" onClick={saveCurrentDraft}>Save draft</Button>
                <Button variant="outline" size="sm" disabled={!hasDraft} onClick={loadSavedDraft}>Load draft</Button>
                {hasDraft && <Button variant="ghost" size="sm" onClick={clearSavedDraft}>Clear draft</Button>}
              </>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!!editInvoiceId} onClick={() => setOcrOpen(true)}>
              <ScanLine className="h-4 w-4" /> Scan
            </Button>
          </div>
        }
      />

      <div className="rounded-lg border bg-card p-2 shadow-sm">
        <div className="inline-flex rounded-md bg-muted p-1">
          <button
            type="button"
            className={`h-8 rounded px-4 text-sm font-medium transition-colors ${isGstInvoice ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setGstEnabled(true)}
          >
            GST Bill
          </button>
          <button
            type="button"
            className={`h-8 rounded px-4 text-sm font-medium transition-colors ${!isGstInvoice ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setGstEnabled(false)}
          >
            Non-GST Bill
          </button>
        </div>
      </div>

      <TransactionGrid sidebar={summary}>
        <div className="grid gap-3 lg:grid-cols-2">
          <TransactionSection title="Customer" compact>
            <div className="space-y-3">
              {partyId ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                  <span className="text-sm font-medium">{partyName}</span>
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={clearPartySelection}>Change</button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input className="h-9" placeholder="Search by name, phone, GSTIN..." value={partySearch} onChange={(e) => searchParties(e.target.value)} />
                      {partyResults.length > 0 && (
                        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-card shadow-lg">
                          {partyResults.map((p) => (
                            <button key={p.id} type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => selectParty(p)}>
                              <span className="font-medium">{p.name}</span>
                              {p.phone && <span className="ml-2 text-muted-foreground">{p.phone}</span>}
                              {p.gstin && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.gstin}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => { setQuickAddDefaultName(partySearch.trim()); setQuickAddOpen(true); }}>
                      <UserPlus className="h-4 w-4" /> Add
                    </Button>
                  </div>
                  {partySearch.length >= 2 && !partySearchLoading && partyResults.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No matches. This name can still be used on the invoice, or <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setQuickAddDefaultName(partySearch.trim()); setQuickAddOpen(true); }}>save “{partySearch.trim()}” as party</button>.
                    </p>
                  )}
                </>
              )}
              <div>
                <Label className="text-xs">Phone No. on this invoice</Label>
                <Input className="mt-1 h-9" value={partyPhone} inputMode="tel" onChange={(e) => setPartyPhone(e.target.value)} placeholder="Mobile number for this invoice" />
              </div>
            </div>
          </TransactionSection>

          <TransactionSection title="Invoice Details" compact>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Invoice Number</Label>
                <Input
                  className="mt-1 h-9 font-mono"
                  value={invoiceNumber}
                  maxLength={16}
                  placeholder={invoiceNumberLoading ? 'Fetching next number...' : 'Auto generated'}
                  onChange={(e) => {
                    setInvoiceNumberEdited(true);
                    setInvoiceNumber(e.target.value.trim().toUpperCase());
                  }}
                />
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{INVOICE_NUMBER_HELP}</span>
                  {!editInvoiceId && autoInvoiceNumber && (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => {
                        setInvoiceNumber(autoInvoiceNumber);
                        setInvoiceNumberEdited(false);
                      }}
                    >
                      Use next: {autoInvoiceNumber}
                    </button>
                  )}
                </div>
              </div>
              <div><Label className="text-xs">Invoice Date</Label><Input type="date" className="mt-1 h-9" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
              <div><Label className="text-xs">Due Date</Label><Input type="date" className="mt-1 h-9" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div className="col-span-2">
                <Label className="text-xs">Currency</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(normalizeCurrencyCode(e.target.value))}
                >
                  {SUPPORTED_CURRENCIES.filter((c) => enabledCurrencies.includes(c.code)).map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
                {currencyCode !== 'INR' && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    USD invoices can be printed and tracked, but GST IRN/E-Way Bill generation remains INR-only.
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Ship To / Place of Supply Address</Label>
                <Input className="mt-1 h-9" value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} placeholder="Leave blank to use party shipping or billing address" />
              </div>
            </div>
          </TransactionSection>
        </div>

        <TransactionSection title="Items" description="Search catalog items, add services, and expand a row only when extra details are needed." compact>
          <VyaparLineItems
            items={items}
            onChange={setItems}
            isGst={isGstInvoice}
            isInterstate={isInterstate}
            searchMode="invoice"
            defaultRateFrom="selling"
            godownId={godownId}
            showHsn={isGstInvoice}
            showUnit
            showDescription
            showCess={isGstInvoice}
            currencyCode={currencyCode}
            customFields={itemCustomFieldDefs}
          />
        </TransactionSection>

        {invoiceCustomFieldDefs.length > 0 && (
          <TransactionSection title="Additional Fields" compact>
            <div className="grid gap-3 md:grid-cols-3">
              {invoiceCustomFieldDefs.map((field) => (
                <div key={field.id}>
                  <Label className="text-xs">
                    {field.label}{field.required ? ' *' : ''}
                  </Label>
                  <Input
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    className="mt-1"
                    value={customFields[field.id] || ''}
                    onChange={(e) => setCustomFields((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </TransactionSection>
        )}

        <div className={`grid gap-3 ${editInvoiceId ? '' : 'lg:grid-cols-2'}`}>
          {!editInvoiceId && (
            <TransactionSection title="Payment" compact>
              <PaymentRowsEditor
                rows={paymentRows}
                onChange={setPaymentRows}
                defaultBankAccountId={companyBankAccountId}
                currencyCode={currencyCode}
              />
            </TransactionSection>
          )}

          <TransactionSection title="Notes & Attachments" compact>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Description / Work Details</Label>
                <textarea className="mt-1 min-h-9 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm focus:min-h-[76px]" value={externalDescription} onChange={e => setExternalDescription(e.target.value)} placeholder="Optional printed description saved with this invoice" />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <textarea className="mt-1 min-h-9 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm focus:min-h-[76px]" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Terms, notes, or internal comments" />
              </div>
              {!editInvoiceId && (
                <div className="md:col-span-2">
                  <Label className="text-xs">Images / Documents</Label>
                  <label className="mt-1 flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-muted/40">
                    <Paperclip className="h-4 w-4" />
                    <span>{invoiceFiles.length ? `${invoiceFiles.length} file(s) selected` : 'Attach files'}</span>
                    <input type="file" multiple className="hidden" onChange={(e) => setInvoiceFiles(Array.from(e.target.files || []))} />
                  </label>
                </div>
              )}
            </div>
          </TransactionSection>
        </div>

        <CollapsibleTransactionSection title={`Advanced invoice settings${advancedHasCustom ? ' •' : ''}`} open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs">Godown</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                <option value="">Default</option>
                {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            {isGstInvoice && (
              <>
                <div>
                  <Label className="text-xs">Place of Supply State</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={placeOfSupply} onChange={e => updatePlaceOfSupply(e.target.value)}>
                    <option value="">Same as party billing state</option>
                    {GST_STATE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
                  </select>
                </div>
                <label className="mt-5 flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                  <input type="checkbox" checked={isGstInvoice} onChange={e => setGstEnabled(e.target.checked)} className="rounded border-input" />
                  GST invoice
                </label>
                <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                  <input type="checkbox" checked={isInterstate} onChange={e => setIsInterstate(e.target.checked)} className="rounded border-input" />
                  Interstate (IGST)
                </label>
              </>
            )}
            <div>
              <Label className="text-xs">PDF Template</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={pdfTemplate} onChange={e => setPdfTemplate(e.target.value as InvoicePdfTemplateId)}>
                {INVOICE_PDF_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Theme</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={documentTheme} onChange={e => setDocumentTheme(e.target.value as DocumentThemeId)}>
                {DOCUMENT_THEME_OPTIONS.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <BankAccountPicker value={companyBankAccountId} onChange={setCompanyBankAccountId} />
            </div>
          </div>
        </CollapsibleTransactionSection>

        <MobileActionBar>
          <DocumentActionsBar
            onCancel={() => navigate(cancelTo)}
            onPreview={() => setDraftPreviewOpen(true)}
            onSave={handleSubmit}
            canPreview={canSave}
            canSave={canSave}
            saving={saving}
            saveLabel={editInvoiceId ? 'Save changes' : 'Create Invoice'}
          />
        </MobileActionBar>
      </TransactionGrid>

      <InvoicePreviewWorkspace
        open={draftPreviewOpen}
        onClose={() => setDraftPreviewOpen(false)}
        mode="draft"
        draftPayload={draftPreviewPayload}
        shareContext={{
          invoiceNumber: invoiceNumber || 'PREVIEW',
          invoiceDate,
          totalAmountPaise: totals.total,
          partyName: effectivePartyName || 'Customer',
        }}
        partyPhone={partyPhone}
        companyName={company?.name}
      />

      <QuickAddPartySheet open={quickAddOpen} onOpenChange={setQuickAddOpen} defaultName={quickAddDefaultName} onCreated={(row) => selectParty(row)} />
      <OcrBillSheet open={ocrOpen} onOpenChange={setOcrOpen} context="Customer Invoice / Purchase Order" onConfirm={handleOcrConfirm} />
    </TransactionPageShell>
  );
}
