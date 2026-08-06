import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useCreateInvoice, useCompany, useInvoice, useUpdateInvoice } from '@/hooks/useBusiness';
import { useGodowns } from '@/hooks/useStock';
import { formatMoney, normalizeCurrencyCode, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, ScanLine, UserPlus, Paperclip, Printer, Settings2 } from 'lucide-react';
import {
  InvoicePreviewWorkspace,
  normalizeInvoiceThemeId,
  readSkipInvoicePreview,
} from '@/components/invoices/InvoicePreviewWorkspace';
import ThermalReceipt from '@/components/shared/ThermalReceipt';
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
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, STORAGE_KEYS } from '@/lib/storageKeys';
import toast from 'react-hot-toast';
import {
  DEFAULT_PRINT_LAYOUT_COLORS,
  PRINT_COLOR_PALETTE,
  PRINT_LAYOUT_BY_ID,
  PRINT_LAYOUT_LEGACY_ID_MAP,
  PrintLayoutPicker,
  type PrintLayoutId,
} from '@/components/settings/PrintLayoutPreview';

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

const REFERENCE_INVOICE_FIELDS = [
  ['eway_bill_no', 'e-Way Bill No.'],
  ['delivery_note', 'Delivery Note'],
  ['mode_terms_payment', 'Mode/Terms of Payment'],
  ['reference_no_date', 'Reference No. & Date'],
  ['other_references', 'Other References'],
  ['buyer_order_no', "Buyer's Order No."],
  ['buyer_order_date', "Buyer's Order Date"],
  ['dispatch_doc_no', 'Dispatch Doc No.'],
  ['delivery_note_date', 'Delivery Note Date'],
  ['dispatched_through', 'Dispatched through'],
  ['destination', 'Destination'],
  ['vessel_flight_no', 'Vessel/Flight No.'],
  ['receipt_by_shipper', 'Place of receipt by shipper'],
  ['port_loading', 'City/Port of Loading'],
  ['port_discharge', 'City/Port of Discharge'],
  ['terms_delivery', 'Terms of Delivery'],
] as const;

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
        .filter((d: any) => d?.enabled === true)
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

function companyPrintSettings(company: any) {
  return company?.print_settings && typeof company.print_settings === 'object' ? company.print_settings : {};
}

function defaultInvoiceLayout(company: any): PrintLayoutId {
  const settings = companyPrintSettings(company);
  const raw = settings.invoiceTheme || settings.invoice_theme || settings.regular?.layout || company?.invoice_pdf_template || company?.document_theme;
  return normalizeInvoiceThemeId(raw) as PrintLayoutId;
}

function defaultLayoutColor(company: any, layoutId: string) {
  const settings = companyPrintSettings(company);
  return String(
    settings.layout_colors?.[layoutId] ||
    company?.document_primary_color ||
    DEFAULT_PRINT_LAYOUT_COLORS[layoutId as PrintLayoutId] ||
    '#4F46E5',
  );
}

function referenceInvoiceSettings(company: any) {
  const settings = companyPrintSettings(company);
  const reference = settings.reference_invoice && typeof settings.reference_invoice === 'object' ? settings.reference_invoice : {};
  const fields = reference.fields && typeof reference.fields === 'object' ? reference.fields : {};
  return {
    fields,
    enabledKeys: REFERENCE_INVOICE_FIELDS.map(([key]) => key).filter((key) => fields[key] !== false),
  };
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const { id: routeParamId } = useParams();
  const location = useLocation();
  const [completedInvoice, setCompletedInvoice] = useState<any>(null);
  const { pathname, search: locationSearch } = location;
  const editInvoiceId = pathname.endsWith('/edit') && routeParamId ? routeParamId : undefined;
  const duplicateInvoiceId = !editInvoiceId ? new URLSearchParams(locationSearch).get('duplicate_from') || undefined : undefined;

  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();
  const { data: existingInv, isLoading: editInvLoading, isError: editInvError } = useInvoice(editInvoiceId || duplicateInvoiceId);
  const { data: company } = useCompany();
  const { data: godownData } = useGodowns();
  const godowns = godownData?.data || [];
  const { data: transactionConfig } = useQuery({
    queryKey: ['settings', 'transaction', 'invoice-create'],
    queryFn: async () => {
      const response = await api.get('/settings/transaction');
      return response.data?.data || response.data;
    },
    staleTime: 60_000,
  });
  const transactionSettings = transactionConfig?.settings || {};
  const isLiteSale = transactionSettings.billingType === 'LITE_SALE';
  const transactionAdditionalFields = transactionConfig?.additionalFields || {};
  const transportationSettings = transactionConfig?.transportation || {};

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
  const [pdfTemplate, setPdfTemplate] = useState<PrintLayoutId>('business-theme-1');
  const [documentTheme, setDocumentTheme] = useState<PrintLayoutId>('business-theme-1');
  const [invoiceLayoutColor, setInvoiceLayoutColor] = useState('#4F46E5');
  const [companyBankAccountId, setCompanyBankAccountId] = useState('');
  const [pricingMode, setPricingMode] = useState<'inclusive' | 'exclusive'>('exclusive');
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'percent' | 'flat' | 'none'>('none');
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState(0);

  const handleItemsChange = (newItems: VyaparLineItem[]) => {
    // pricingMode is user-controlled via the dropdown;
    // price_includes_tax is stored per-item and drives per-line conversion.
    setItems(newItems);
  };

  const [notes, setNotes] = useState('');
  const [selectedTermsId, setSelectedTermsId] = useState('');
  const [externalDescription, setExternalDescription] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [paymentRows, setPaymentRows] = useState<PaymentEditorRow[]>([newPaymentEditorRow()]);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [items, setItems] = useState<VyaparLineItem[]>([]);
  const [draftPreviewOpen, setDraftPreviewOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const transactionDefaultsHydratedRef = useRef(false);
  const saleTerms = useMemo(
    () => (Array.isArray(transactionConfig?.terms?.SALE) ? transactionConfig.terms.SALE : []),
    [transactionConfig],
  );

  const invoiceCustomFieldDefs = useMemo(() => salesCustomFieldDefs(company, 'invoice'), [company]);
  const itemCustomFieldDefs = useMemo(() => salesCustomFieldDefs(company, 'item'), [company]);
  const visibleItemFieldDefs = useMemo(() => {
    const fields = [...itemCustomFieldDefs];
    if (transactionSettings.showCountColumn === true && !fields.some((field) => field.id === '__transaction_count')) {
      fields.push({
        id: '__transaction_count',
        label: String(transactionSettings.countColumnLabel || 'Count'),
        scope: 'item',
        type: 'number',
        required: false,
        enabled: true,
      });
    }
    return fields;
  }, [itemCustomFieldDefs, transactionSettings.countColumnLabel, transactionSettings.showCountColumn]);
  const referenceSettings = useMemo(() => referenceInvoiceSettings(company), [company]);
  const itemSettings = (company as any)?.item_settings || {};
  const taxSettings = (company as any)?.tax_settings || {};
  const selectedReferenceValues = (customFields.reference_invoice && typeof customFields.reference_invoice === 'object' ? customFields.reference_invoice : {}) as Record<string, string>;
  const referenceTemplateSelected = pdfTemplate === 'reference-tax-eway-theme';
  const enabledTransactionFields = useMemo(() => {
    const fields = [
      ['billingName', transactionSettings.showBillingNameOfParties === true, 'Billing Name', 'text'],
      ['customerPoNumber', transactionSettings.showCustomerPODetails === true, "Customer P.O. No.", 'text'],
      ['customerPoDate', transactionSettings.showCustomerPODetails === true, "Customer P.O. Date", 'date'],
      ['transactionTime', transactionSettings.addTimeOnTransactions === true, 'Transaction Time', 'time'],
      ['ewayBillNumber', transactionSettings.enableEwayBill === true, 'e-Way Bill No.', 'text'],
      ['txnField1', transactionAdditionalFields.showOnSales && transactionAdditionalFields.txnField1Enabled, transactionAdditionalFields.txnField1Label, 'text'],
      ['txnField2', transactionAdditionalFields.showOnSales && transactionAdditionalFields.txnField2Enabled, transactionAdditionalFields.txnField2Label, 'text'],
      ['txnField3', transactionAdditionalFields.showOnSales && transactionAdditionalFields.txnField3Enabled, transactionAdditionalFields.txnField3Label, 'text'],
      ['txnDateField', transactionAdditionalFields.showOnSales && transactionAdditionalFields.txnDateFieldEnabled, transactionAdditionalFields.txnDateFieldLabel, 'date'],
    ];
    return fields
      .filter(([, enabled, label]) => enabled && String(label || '').trim())
      .map(([key, , label, type]) => ({ key: String(key), label: String(label), type: String(type) }));
  }, [
    transactionAdditionalFields,
    transactionSettings.addTimeOnTransactions,
    transactionSettings.enableEwayBill,
    transactionSettings.showBillingNameOfParties,
    transactionSettings.showCustomerPODetails,
  ]);
  const enabledTransportationFields = useMemo(() => {
    const fields = [];
    for (let index = 1; index <= 6; index += 1) {
      if (transportationSettings[`field${index}Enabled`]) {
        fields.push({
          key: `field${index}`,
          label: String(transportationSettings[`field${index}Label`] || `Field ${index}`),
          showInPrint: transportationSettings[`field${index}ShowInPrint`] !== false,
        });
      }
    }
    return fields;
  }, [transportationSettings]);
  const customFieldsForPayload = useMemo(() => {
    const transactionValues = customFields.transaction_settings && typeof customFields.transaction_settings === 'object'
      ? customFields.transaction_settings
      : {};
    const transportationValues = customFields.transportation_details && typeof customFields.transportation_details === 'object'
      ? customFields.transportation_details
      : {};

    return {
      ...customFields,
      __print_layout: pdfTemplate,
      __print_layout_color: invoiceLayoutColor,
      ...(enabledTransactionFields.length > 0 || Object.keys(transactionValues).length > 0
        ? {
            transaction_settings: {
              ...transactionValues,
              __fields: enabledTransactionFields.map((field) => ({
                key: field.key,
                label: field.label,
                type: field.type,
              })),
            },
          }
        : {}),
      ...(enabledTransportationFields.length > 0 || Object.keys(transportationValues).length > 0
        ? {
            transportation_details: {
              ...transportationValues,
              __fields: enabledTransportationFields.map((field) => ({
                key: field.key,
                label: field.label,
                showInPrint: field.showInPrint,
              })),
            },
          }
        : {}),
    };
  }, [
    customFields,
    enabledTransactionFields,
    enabledTransportationFields,
    invoiceLayoutColor,
    pdfTemplate,
  ]);
  const updateReferenceValue = (key: string, value: string) => {
    setCustomFields((prev) => ({
      ...prev,
      reference_invoice: {
        ...(prev.reference_invoice && typeof prev.reference_invoice === 'object' ? prev.reference_invoice : {}),
        [key]: value,
      },
    }));
  };
  const enabledCurrencies = useMemo(() => {
    const raw = Array.isArray((company as any)?.enabled_currencies) ? (company as any).enabled_currencies : ['INR'];
    const normalized = raw.map((c: unknown) => normalizeCurrencyCode(c)).filter((c: CurrencyCode, idx: number, arr: CurrencyCode[]) => arr.indexOf(c) === idx);
    return normalized.length ? normalized : ['INR'];
  }, [company]);

  useEffect(() => {
    if (editInvoiceId || !company) return;
    const preferred = normalizeCurrencyCode((company as any).default_currency || (company as any).currency || 'INR');
    setCurrencyCode(enabledCurrencies.includes(preferred) ? preferred : enabledCurrencies[0]);
    setIsGstInvoice(taxSettings.enable_gst !== false);
  }, [company, editInvoiceId, enabledCurrencies]);

  useEffect(() => {
    if (!transactionConfig || editInvoiceId || duplicateInvoiceId || transactionDefaultsHydratedRef.current) return;
    setRoundOffEnabled(transactionSettings.roundOffTotal !== false);
    const defaultSaleTerms = (transactionConfig.terms?.SALE || []).find((term: any) => term.isDefault);
    if (transactionSettings.enableTermsAndConditions !== false && defaultSaleTerms?.content) {
      setNotes((current) => current || String(defaultSaleTerms.content));
      setSelectedTermsId(String(defaultSaleTerms.id || ''));
    }
    setPaymentRows((current) => {
      const first = current[0] || newPaymentEditorRow();
      return [{
        ...first,
        payment_mode: transactionSettings.cashSaleByDefault === true ? 'cash' : 'credit',
        amount: 0,
      }, ...current.slice(1)];
    });
    transactionDefaultsHydratedRef.current = true;
  }, [duplicateInvoiceId, editInvoiceId, transactionConfig, transactionSettings]);

  useEffect(() => {
    if (!notes || saleTerms.length === 0) return;
    const matchingTerms = saleTerms.find((term: any) => String(term.content || '').trim() === notes.trim());
    if (matchingTerms) setSelectedTermsId(String(matchingTerms.id));
  }, [notes, saleTerms]);

  useEffect(() => {
    if (!company || editInvoiceId || duplicateInvoiceId || defaultLayoutHydratedRef.current) return;
    const layout = defaultInvoiceLayout(company);
    setPdfTemplate(layout);
    setDocumentTheme(layout);
    setInvoiceLayoutColor(defaultLayoutColor(company, layout));
    defaultLayoutHydratedRef.current = true;
  }, [company, duplicateInvoiceId, editInvoiceId]);

  const hydratedIdRef = useRef<string | null>(null);
  const duplicateHydratedIdRef = useRef<string | null>(null);
  const advancedAutoOpenedRef = useRef(false);
  const defaultLayoutHydratedRef = useRef(false);

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
    setCustomFields((inv.custom_fields && typeof inv.custom_fields === 'object' ? inv.custom_fields : {}) as Record<string, any>);
    setPaymentRows([newPaymentEditorRow()]);
    setInvoiceFiles([]);
    setPdfTemplate(normalizeInvoiceThemeId(inv.pdf_template));
    setDocumentTheme(normalizeInvoiceThemeId(inv.document_theme));
    setInvoiceLayoutColor(String((inv.custom_fields as any)?.__print_layout_color || defaultLayoutColor(company, normalizeInvoiceThemeId(inv.document_theme || inv.pdf_template))));
    setCompanyBankAccountId(inv.company_bank_account_id ? String(inv.company_bank_account_id) : '');
    setPricingMode(inv.pricing_mode === 'inclusive' ? 'inclusive' : 'exclusive');
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
      tax_option_id: it.tax_option_id ? String(it.tax_option_id) : undefined,
      tax_components: Array.isArray(it.tax_components) ? it.tax_components : [],
      cess_rate: Number(it.cess_rate) || 0,
      custom_fields: (it.custom_fields && typeof it.custom_fields === 'object' ? it.custom_fields : {}) as Record<string, string>,
      selling_price_includes_tax: it.price_includes_tax,
      price_includes_tax: it.price_includes_tax === true,
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
    setCustomFields((inv.custom_fields && typeof inv.custom_fields === 'object' ? inv.custom_fields : {}) as Record<string, any>);
    setPaymentRows([newPaymentEditorRow()]);
    setInvoiceFiles([]);
    setPdfTemplate(normalizeInvoiceThemeId(inv.pdf_template));
    setDocumentTheme(normalizeInvoiceThemeId(inv.document_theme));
    setInvoiceLayoutColor(String((inv.custom_fields as any)?.__print_layout_color || defaultLayoutColor(company, normalizeInvoiceThemeId(inv.document_theme || inv.pdf_template))));
    setCompanyBankAccountId(inv.company_bank_account_id ? String(inv.company_bank_account_id) : '');
    setPricingMode(inv.pricing_mode === 'inclusive' ? 'inclusive' : 'exclusive');
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
      tax_option_id: it.tax_option_id ? String(it.tax_option_id) : undefined,
      tax_components: Array.isArray(it.tax_components) ? it.tax_components : [],
      cess_rate: Number(it.cess_rate) || 0,
      custom_fields: (it.custom_fields && typeof it.custom_fields === 'object' ? it.custom_fields : {}) as Record<string, string>,
      selling_price_includes_tax: it.price_includes_tax,
      price_includes_tax: it.price_includes_tax === true,
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
    if (data.due_date) setDueDate(data.due_date);
    if (data.party_phone) setPartyPhone(String(data.party_phone));
    if (data.shipping_address || data.party_address) {
      setShippingAddress(String(data.shipping_address || data.party_address || ''));
    }
    if (data.place_of_supply) {
      const detectedSupply = String(data.place_of_supply);
      const stateCode = detectedSupply.match(/\b(?:code\s*[:\-]?)?(\d{2})\b/i)?.[1]
        || GST_STATE_OPTIONS.find(([, name]) => name.toLowerCase() === detectedSupply.trim().toLowerCase())?.[0]
        || '';
      if (stateCode) updatePlaceOfSupply(stateCode);
    }
    if (data.reference_invoice && typeof data.reference_invoice === 'object') {
      setCustomFields((previous) => ({
        ...previous,
        reference_invoice: {
          ...(previous.reference_invoice && typeof previous.reference_invoice === 'object' ? previous.reference_invoice : {}),
          ...Object.fromEntries(Object.entries(data.reference_invoice || {}).filter(([, value]) => Boolean(value))),
        },
      }));
    }
    if (data.invoice_number) {
      setInvoiceNumberEdited(true);
      setInvoiceNumber(String(data.invoice_number).trim().toUpperCase().slice(0, 16));
    }
    if (data.items && data.items.length > 0) {
      const mapped = data.items.map((item) => {
        const rate = item.rate_paise != null
          ? Number(item.rate_paise)
          : (item.amount_paise != null && item.quantity ? Math.round(Number(item.amount_paise) / Number(item.quantity)) : Number(item.amount_paise || 0));
        return {
          name: String(item.description || ''),
          description: String(item.description || ''),
          hsn_code: item.hsn_code ? String(item.hsn_code) : '',
          unit: String(item.unit || 'PCS'),
          quantity: Number(item.quantity) || 1,
          unit_price: rate,
          discount_amount: 0,
          gst_rate: Number(item.gst_rate ?? data.tax_summary?.gst_rate ?? 0) || 0,
          cess_rate: Number(item.cess_rate ?? 0) || 0,
          custom_fields: {},
        };
      });
      setItems((prev) => {
        const isEmpty = prev.length === 0 || (prev.length === 1 && !prev[0].name && !prev[0].unit_price);
        return isEmpty ? mapped : [...prev, ...mapped];
      });
      toast.success(`Imported ${data.items.length} item(s) from scan`);
    }
    if (data.matched_party_id && data.matched_party) {
      selectParty(data.matched_party);
      toast.success('Matched party from OCR and applied it');
    } else if (data.party_name) {
      setPartySearch(data.party_name);
      searchParties(data.party_name);
      toast.success('Invoice details applied — select the party and verify');
    } else {
      toast.success('Invoice details applied — verify items and values');
    }
  };

  useEffect(() => {
    if (location.state?.ocrData) {
      handleOcrConfirm(location.state.ocrData);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

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
    if (enabled && taxSettings.enable_gst === false) {
      toast.error('GST is disabled in Settings > Taxes & GST');
      return;
    }
    setIsGstInvoice(enabled);
    if (!enabled) {
      setIsInterstate(false);
      setPlaceOfSupply('');
    }
  };

  const totals = useMemo(
    () => computeTotals(
      items,
      isGstInvoice,
      roundOffEnabled,
      pricingMode,
      invoiceDiscountType,
      invoiceDiscountValue,
      isInterstate,
      transactionSettings.roundOffType === 'FLOOR' || transactionSettings.roundOffType === 'CEIL'
        ? transactionSettings.roundOffType
        : 'NEAREST',
      transactionSettings.roundOffTo === 10 || transactionSettings.roundOffTo === 100
        ? transactionSettings.roundOffTo
        : 1,
    ),
    [
      items,
      isGstInvoice,
      roundOffEnabled,
      pricingMode,
      invoiceDiscountType,
      invoiceDiscountValue,
      isInterstate,
      transactionSettings.roundOffType,
      transactionSettings.roundOffTo,
    ],
  );
  const cgstDisplay = totals.cgst;
  const sgstDisplay = totals.sgst;
  const igstDisplay = totals.igst;
  const effectivePartyName = partyId ? partyName.trim() : (partySearch.trim() || partyName.trim());
  const amountPaid = paymentRows
    .filter((row) => row.payment_mode !== 'credit')
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const balanceDue = totals.total - amountPaid;
  const quickPaymentMode = paymentRows[0]?.payment_mode === 'credit' ? 'credit' : 'cash';
  const setQuickPaymentMode = (mode: 'credit' | 'cash') => {
    const first = paymentRows[0] || newPaymentEditorRow();
    const nextFirst = {
      ...first,
      payment_mode: mode,
      amount: mode === 'credit' ? 0 : totals.total,
    };
    setPaymentRows([nextFirst, ...paymentRows.slice(1)]);
  };

  const itemPayload = () => items.map((i) => ({
    item_id: i.item_id || null,
    description: i.description || null,
    name: i.name || '',
    item_name: i.name || '',
    hsn_code: i.hsn_code || null,
    unit: i.unit || 'PCS',
    quantity: Number(i.quantity) || 0,
    unit_price: Number(i.unit_price) || 0,
    gst_rate: isGstInvoice ? Number(i.gst_rate) || 0 : 0,
    tax_option_id: isGstInvoice ? i.tax_option_id || null : null,
    tax_components: isGstInvoice && Array.isArray(i.tax_components) ? i.tax_components : [],
    discount_amount: Number(i.discount_amount) || 0,
    cess_rate: isGstInvoice ? Number(i.cess_rate) || 0 : 0,
    currency_code: currencyCode,
    custom_fields: i.custom_fields || {},
    price_includes_tax: i.price_includes_tax === true,
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
      custom_fields: customFieldsForPayload,
      amount_paid: amountPaid,
      payments: paymentRows,
      company_bank_account_id: companyBankAccountId || undefined,
      items: itemPayload(),
      pricing_mode: pricingMode,
      discount_amount: totals.invoiceDiscount || undefined,
    }),
    [partyId, effectivePartyName, partyPhone, godownId, invoiceNumber, invoiceDate, dueDate, currencyCode, isInterstate, placeOfSupply, shippingAddress, notes, externalDescription, customFieldsForPayload, amountPaid, paymentRows, items, isGstInvoice, roundOffEnabled, pdfTemplate, documentTheme, companyBankAccountId, pricingMode, totals.invoiceDiscount],
  );

  const draftState = useMemo(() => ({
    partyId, partyName, partySearch, partyPhone, godownId, invoiceNumber, invoiceDate, dueDate, currencyCode,
    isInterstate, placeOfSupply, shippingAddress, isGstInvoice, roundOffEnabled, pdfTemplate, invoiceLayoutColor,
    documentTheme, companyBankAccountId, notes, externalDescription, customFields, paymentRows, items,
    pricingMode, invoiceDiscountType, invoiceDiscountValue,
  }), [partyId, partyName, partySearch, partyPhone, godownId, invoiceNumber, invoiceDate, dueDate, currencyCode, isInterstate, placeOfSupply, shippingAddress, isGstInvoice, roundOffEnabled, pdfTemplate, invoiceLayoutColor, documentTheme, companyBankAccountId, notes, externalDescription, customFields, paymentRows, items, pricingMode, invoiceDiscountType, invoiceDiscountValue]);

  const { clearDraft, saveDraft, loadDraft, hasDraft } = useTransactionDraft(
    STORAGE_KEYS.drafts.salesInvoice,
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
      setInvoiceLayoutColor(String(draft.invoiceLayoutColor || defaultLayoutColor(company, normalizeInvoiceThemeId(draft.pdfTemplate || draft.documentTheme))));
      setCompanyBankAccountId(String(draft.companyBankAccountId || ''));
      setNotes(String(draft.notes || ''));
      setExternalDescription(String(draft.externalDescription || ''));
      setCustomFields(draft.customFields && typeof draft.customFields === 'object' ? draft.customFields : {});
      setPaymentRows(Array.isArray(draft.paymentRows) && draft.paymentRows.length ? draft.paymentRows : [newPaymentEditorRow()]);
      setItems(Array.isArray(draft.items) ? draft.items : []);
      setPricingMode(draft.pricingMode === 'inclusive' ? 'inclusive' : 'exclusive');
      setInvoiceDiscountType(draft.invoiceDiscountType === 'percent' ? 'percent' : draft.invoiceDiscountType === 'flat' ? 'flat' : 'none');
      setInvoiceDiscountValue(Number(draft.invoiceDiscountValue) || 0);
    },
    {
      enabled: !editInvoiceId && !duplicateInvoiceId,
      legacyKey: LEGACY_STORAGE_KEYS.drafts.salesInvoice,
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

  const handlePrintReceipt = async (id: string) => {
    const printer = readStorageWithLegacy(STORAGE_KEYS.printerType, LEGACY_STORAGE_KEYS.printerType) || 'a4';
    let pdfUrl = '';
    try {
      const w = (printer === 'thermal58' || printer === 'thermal_58') ? '58' : '80';
      const pdfRes = await api.get(`/print/receipt/${id}`, { params: { width: w }, responseType: 'blob' });
      pdfUrl = window.URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' }));

      if (pdfUrl) {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';
        iframe.src = pdfUrl;

        iframe.onload = () => {
          iframe.focus();
          try {
            iframe.contentWindow?.print();
          } catch (e) {
            console.error("Direct printing failed, opening in new tab:", e);
            window.open(pdfUrl, '_blank');
          }
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
            window.URL.revokeObjectURL(pdfUrl);
          }, 60000);
        };

        document.body.appendChild(iframe);
      }
    } catch (err) {
      console.error(err);
      toast.error('Receipt/Invoice PDF could not be generated');
    }
  };

  const handleSubmit = async (shouldPrintReceipt: boolean | unknown = false) => {
    if (!validate()) return;
    const printRequested = shouldPrintReceipt === true;
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
      custom_fields: customFieldsForPayload,
      round_off_enabled: roundOffEnabled,
      company_bank_account_id: companyBankAccountId || undefined,
      items: itemPayload(),
      pricing_mode: pricingMode,
      discount_amount: totals.invoiceDiscount || undefined,
    };

    if (editInvoiceId) {
      try {
        const res = await updateMutation.mutateAsync({ id: editInvoiceId, data: commonPayload });
        const inv = (res as any)?.data ?? res;
        toast.success('Invoice updated');
        if (printRequested) {
          const itemsSnapshot = items.map((i) => ({
            item_name: i.name,
            name: i.name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total_amount: i.unit_price * i.quantity,
            total: i.unit_price * i.quantity,
            gst_rate: i.gst_rate,
            hsn_code: i.hsn_code,
          }));
          setCompletedInvoice({
            ...inv,
            id: editInvoiceId,
            invoice_number: inv.invoice_number || normalizedInvoiceNumber,
            invoice_date: invoiceDate,
            subtotal: totals.taxable,
            total_amount: totals.total,
            paid_amount: amountPaid,
            payment_mode: paymentRows[0]?.payment_mode || 'cash',
            party_name_snapshot: effectivePartyName,
            items: itemsSnapshot,
            cgst_amount: cgstDisplay,
            sgst_amount: sgstDisplay,
            igst_amount: igstDisplay,
          });
        } else {
          navigate(`/sales/${editInvoiceId}`);
        }
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
      if (printRequested) {
        const itemsSnapshot = items.map((i) => ({
          item_name: i.name,
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total_amount: i.unit_price * i.quantity,
          total: i.unit_price * i.quantity,
          gst_rate: i.gst_rate,
          hsn_code: i.hsn_code,
        }));
        setCompletedInvoice({
          ...inv,
          id: newId,
          invoice_number: inv.invoice_number || normalizedInvoiceNumber,
          invoice_date: invoiceDate,
          subtotal: totals.taxable,
          total_amount: totals.total,
          paid_amount: amountPaid,
          payment_mode: paymentRows[0]?.payment_mode || 'cash',
          party_name_snapshot: effectivePartyName,
          items: itemsSnapshot,
          cgst_amount: cgstDisplay,
          sgst_amount: sgstDisplay,
          igst_amount: igstDisplay,
        });
      } else {
        const skipPreview = readSkipInvoicePreview();
        if (newId) navigate(skipPreview ? `/sales/${newId}` : `/sales/${newId}?preview=1`);
        else navigate('/sales');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to create invoice');
    }
  };

  const handlePreview = () => {
    if (!Number.isFinite(totals.total) || totals.total < 0) {
      toast.error('Invalid invoice total. Please check prices and quantities.');
      return;
    }
    setDraftPreviewOpen(true);
  };

  const canSave = !!effectivePartyName && items.some((item) => String(item.name || '').trim());
  const saving = createMutation.isPending || updateMutation.isPending;
  const cancelTo = editInvoiceId ? `/sales/${editInvoiceId}` : '/sales';
  const selectedPrintLayoutId = (PRINT_LAYOUT_BY_ID[pdfTemplate as PrintLayoutId]?.id || PRINT_LAYOUT_LEGACY_ID_MAP[pdfTemplate] || 'business-theme-1') as PrintLayoutId;
  const selectedLayoutColorName = PRINT_COLOR_PALETTE.find((color) => color.value.toLowerCase() === invoiceLayoutColor.toLowerCase())?.name || 'Custom';
  const changeInvoiceLayout = (layoutId: PrintLayoutId) => {
    setPdfTemplate(layoutId);
    setDocumentTheme(layoutId);
    setInvoiceLayoutColor(defaultLayoutColor(company, layoutId));
  };
  const advancedHasCustom = Boolean(
    godownId ||
    placeOfSupply ||
    isInterstate ||
    pdfTemplate !== defaultInvoiceLayout(company) ||
    documentTheme !== defaultInvoiceLayout(company) ||
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
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoice Summary</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">{formatMoney(totals.total, currencyCode)}</p>
        </div>
        <div className="space-y-1.5 border-t pt-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{isGstInvoice ? 'Subtotal (taxable)' : 'Subtotal'}</span><span className="tabular-nums">{formatMoney(totals.taxable + totals.invoiceDiscount, currencyCode)}</span></div>

          {/* Invoice-level discount control */}
          {transactionSettings.enableTransactionWiseDiscount === true && (
          <div className="rounded-lg border bg-background/60 p-2.5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Invoice Discount</p>
            <div className="flex items-center gap-1.5">
              {/* Type toggle: % / ₹ */}
              <div className="flex rounded-md border overflow-hidden text-xs shrink-0">
                <button
                  type="button"
                  className={`px-2.5 py-1 font-medium transition-colors ${
                    invoiceDiscountType === 'percent'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setInvoiceDiscountType(invoiceDiscountType === 'percent' ? 'none' : 'percent')}
                >%</button>
                <button
                  type="button"
                  className={`px-2.5 py-1 font-medium border-l transition-colors ${
                    invoiceDiscountType === 'flat'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setInvoiceDiscountType(invoiceDiscountType === 'flat' ? 'none' : 'flat')}
                >₹</button>
              </div>
              <Input
                type="number"
                className="h-7 flex-1 text-right text-xs tabular-nums"
                min={0}
                max={invoiceDiscountType === 'percent' ? 100 : undefined}
                step={invoiceDiscountType === 'percent' ? '0.01' : '1'}
                placeholder={invoiceDiscountType === 'none' ? 'Select % or ₹' : '0'}
                disabled={invoiceDiscountType === 'none'}
                value={invoiceDiscountValue || ''}
                onChange={(e) => setInvoiceDiscountValue(parseFloat(e.target.value) || 0)}
              />
            </div>
            {totals.invoiceDiscount > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs font-medium">
                <span>Discount {invoiceDiscountType === 'percent' ? `(${invoiceDiscountValue}%)` : '(Coupon)'} applied</span>
                <span className="tabular-nums">-{formatMoney(totals.invoiceDiscount, currencyCode)}</span>
              </div>
            )}
          </div>
          )}

          {totals.lineDiscount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Item Discounts</span><span className="tabular-nums text-muted-foreground">-{formatMoney(totals.lineDiscount, currencyCode)}</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground">{isGstInvoice ? 'Taxable' : 'After Discount'}</span><span className="tabular-nums font-medium">{formatMoney(totals.taxable, currencyCode)}</span></div>
          {isGstInvoice && (isInterstate ? (
            <div className="flex justify-between"><span className="text-muted-foreground">Tax (IGST)</span><span className="tabular-nums">{formatMoney(igstDisplay, currencyCode)}</span></div>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax (CGST)</span><span className="tabular-nums">{formatMoney(cgstDisplay, currencyCode)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax (SGST)</span><span className="tabular-nums">{formatMoney(sgstDisplay, currencyCode)}</span></div>
            </>
          ))}
          {totals.cess > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cess</span><span className="tabular-nums">{formatMoney(totals.cess, currencyCode)}</span></div>}
          <div className="flex items-center justify-between border-t pt-2.5">
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
        <div className="hidden xl:block border-t pt-3">
          <DocumentActionsBar
            onCancel={() => navigate(cancelTo)}
            onPreview={handlePreview}
            onSave={handleSubmit}
            canPreview={canSave && transactionSettings.doNotShowInvoicePreview !== true}
            canSave={canSave}
            saving={saving}
            saveLabel={editInvoiceId ? 'Save changes' : 'Create Invoice'}
            extra={
              <Button
                type="button"
                variant="outline"
                className="border-indigo-600 text-indigo-600 hover:bg-indigo-50 gap-1.5"
                disabled={!canSave || saving}
                onClick={() => handleSubmit(true)}
              >
                <Printer className="h-4 w-4" />
                {editInvoiceId ? 'Save & Print Receipt' : 'Create & Print Receipt'}
              </Button>
            }
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

      <TransactionGrid>
        <section className="overflow-visible rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="text-lg font-semibold text-slate-950">Sale</h2>
              {!editInvoiceId && (
                <div className="inline-flex items-center rounded-md border bg-white p-0.5">
                  <button
                    type="button"
                    className={`h-8 rounded px-3 text-sm font-medium transition-colors ${quickPaymentMode === 'credit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setQuickPaymentMode('credit')}
                  >
                    Credit
                  </button>
                  <button
                    type="button"
                    className={`h-8 rounded px-3 text-sm font-medium transition-colors ${quickPaymentMode === 'cash' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setQuickPaymentMode('cash')}
                  >
                    Cash
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border bg-white p-0.5">
                <button
                  type="button"
                  disabled={taxSettings.enable_gst === false}
                  title={taxSettings.enable_gst === false ? 'Enable GST in Settings > Taxes & GST' : 'Create a GST invoice'}
                  className={`h-8 rounded px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isGstInvoice ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setGstEnabled(true)}
                >
                  GST Bill
                </button>
                <button
                  type="button"
                  className={`h-8 rounded px-3 text-xs font-semibold transition-colors ${!isGstInvoice ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setGstEnabled(false)}
                >
                  Non-GST Bill
                </button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                title="Configure item columns"
                onClick={() => navigate('/settings?section=items')}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className={`grid bg-slate-50/40 ${isLiteSale ? 'lg:grid-cols-1' : 'lg:grid-cols-2'}`}>
          <TransactionSection title="Customer" compact className={`rounded-none border-0 border-b ${isLiteSale ? '' : 'lg:border-r'}`}>
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

          {!isLiteSale && <TransactionSection title="Invoice Details" compact className="rounded-none border-0 border-b">
            <div className="grid grid-cols-2 gap-4">
              {transactionSettings.showInvoiceNumber !== false && (
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
              )}
              <div><Label className="text-xs">Invoice Date</Label><Input type="date" className="mt-1 h-9" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
              {transactionSettings.enableDueDatesAndPaymentTerms === true && (
                <div><Label className="text-xs">Due Date</Label><Input type="date" className="mt-1 h-9" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              )}
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
          </TransactionSection>}
          </div>



        <TransactionSection title="Items" compact className="rounded-none border-x-0 border-t-0">
          <VyaparLineItems
            items={items}
            onChange={handleItemsChange}
            isGst={isGstInvoice}
            isInterstate={isInterstate}
            searchMode="invoice"
            defaultRateFrom="selling"
            godownId={godownId}
            partyId={partyId}
            showHsn={isGstInvoice && taxSettings.enable_hsn_sac !== false}
            showUnit={itemSettings.items_unit !== false}
            showDescription={itemSettings.description === true}
            showCess={isGstInvoice && taxSettings.additional_cess_on_item === true}
            showDiscount={itemSettings.item_wise_discount !== false}
            showTax={itemSettings.item_wise_tax !== false}
            showPurchasePrice={transactionSettings.showPurchasePriceInItems === true}
            showLastSalePrices={transactionSettings.showLast5SalePrice === true}
            showLastPurchasePrices={transactionSettings.showLast5PurchasePrice === true}
            showFreeQuantity={transactionSettings.showFreeItemQuantity === true}
            showProfit={transactionSettings.showProfitWhileMakingSaleInvoice === true}
            showLowStockDialog={itemSettings.show_low_stock_dialog === true}
            usePartyWiseRate={itemSettings.party_wise_item_rate === true}
            quantityDecimalPlaces={Math.max(0, Math.min(4, Number(itemSettings.quantity_decimal_places ?? 2) || 0))}
            currencyCode={currencyCode}
            customFields={visibleItemFieldDefs}
            pricingMode={pricingMode}
            showTotals={false}
          />
        </TransactionSection>

        {invoiceCustomFieldDefs.length > 0 && (
          <TransactionSection title="Additional Fields" compact className="rounded-none border-x-0 border-t-0">
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

        {(enabledTransactionFields.length > 0 || enabledTransportationFields.length > 0) && (
          <TransactionSection
            title="Transaction Details"
            compact
            className="rounded-none border-x-0 border-t-0"
          >
            <div className="grid gap-3 md:grid-cols-3">
              {enabledTransactionFields.map((field) => {
                const values = customFields.transaction_settings && typeof customFields.transaction_settings === 'object'
                  ? customFields.transaction_settings
                  : {};
                return (
                  <div key={field.key}>
                    <Label className="text-xs">{field.label}</Label>
                    <Input
                      type={field.type}
                      className="mt-1 h-9"
                      value={values[field.key] || ''}
                      onChange={(event) => setCustomFields((previous) => ({
                        ...previous,
                        transaction_settings: {
                          ...(previous.transaction_settings && typeof previous.transaction_settings === 'object'
                            ? previous.transaction_settings
                            : {}),
                          [field.key]: event.target.value,
                        },
                      }))}
                    />
                  </div>
                );
              })}
              {enabledTransportationFields.map((field) => {
                const values = customFields.transportation_details && typeof customFields.transportation_details === 'object'
                  ? customFields.transportation_details
                  : {};
                return (
                  <div key={field.key}>
                    <Label className="text-xs">
                      {field.label}
                      {field.showInPrint && <span className="ml-1 text-[10px] text-muted-foreground">(prints)</span>}
                    </Label>
                    <Input
                      className="mt-1 h-9"
                      value={values[field.key] || ''}
                      onChange={(event) => setCustomFields((previous) => ({
                        ...previous,
                        transportation_details: {
                          ...(previous.transportation_details && typeof previous.transportation_details === 'object'
                            ? previous.transportation_details
                            : {}),
                          [field.key]: event.target.value,
                        },
                      }))}
                    />
                  </div>
                );
              })}
            </div>
          </TransactionSection>
        )}

        {referenceTemplateSelected && referenceSettings.enabledKeys.length > 0 && (
          <TransactionSection
            title="Reference Invoice Details"
            compact
            className="rounded-none border-x-0 border-t-0"
          >
            <div className="grid gap-3 md:grid-cols-3">
              {REFERENCE_INVOICE_FIELDS.filter(([key]) => referenceSettings.enabledKeys.includes(key)).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    className="mt-1 h-9"
                    value={selectedReferenceValues[key] || ''}
                    onChange={(e) => updateReferenceValue(key, e.target.value)}
                    placeholder={label}
                  />
                </div>
              ))}
            </div>
          </TransactionSection>
        )}

          <div className={`grid border-t ${isLiteSale ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_380px]'}`}>
            {!isLiteSale && <div className="min-w-0">
              {!editInvoiceId && (
                <TransactionSection title="Payment" compact className="rounded-none border-x-0 border-t-0">
                  <PaymentRowsEditor
                    rows={paymentRows}
                    onChange={setPaymentRows}
                    defaultBankAccountId={companyBankAccountId}
                    currencyCode={currencyCode}
                    showHeader={false}
                  />
                </TransactionSection>
              )}

              <TransactionSection title="Terms, Description & Attachments" compact className="rounded-none border-x-0 border-b-0">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">Description / Work Details</Label>
                    <textarea className="mt-1 min-h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm" value={externalDescription} onChange={e => setExternalDescription(e.target.value)} placeholder="Printed description or work details" />
                  </div>
                  {transactionSettings.enableTermsAndConditions !== false && <div>
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">Terms & Conditions</Label>
                      {transactionSettings.enableTermsAndConditions !== false && saleTerms.length > 0 && (
                        <select
                          className="h-7 max-w-[190px] rounded-md border bg-background px-2 text-xs"
                          value={selectedTermsId || 'custom'}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            setSelectedTermsId(nextId === 'custom' ? '' : nextId);
                            const selected = saleTerms.find((term: any) => String(term.id) === nextId);
                            if (selected) setNotes(String(selected.content || ''));
                          }}
                        >
                          {saleTerms.map((term: any) => (
                            <option key={term.id} value={term.id}>{term.title || 'Saved terms'}</option>
                          ))}
                          <option value="custom">Custom terms</option>
                        </select>
                      )}
                    </div>
                    <textarea
                      className="mt-1 min-h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm"
                      value={notes}
                      onChange={(event) => {
                        setNotes(event.target.value);
                        setSelectedTermsId('');
                      }}
                      placeholder={(company as any)?.terms_and_conditions || 'Terms and conditions printed on this invoice'}
                    />
                  </div>}
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
            </div>}
            <aside className={`bg-slate-50 p-3 ${isLiteSale ? '' : 'border-t lg:border-l lg:border-t-0'}`}>
              {summary}
            </aside>
          </div>
        </section>

        {!isLiteSale && <CollapsibleTransactionSection title={`Advanced invoice settings${advancedHasCustom ? ' •' : ''}`} open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="text-xs">Godown</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={godownId} onChange={e => setGodownId(e.target.value)}>
                <option value="">Default</option>
                {godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            {isGstInvoice && (
              <>
                {taxSettings.enable_place_of_supply !== false && <div>
                  <Label className="text-xs">Place of Supply State</Label>
                  <select className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={placeOfSupply} onChange={e => updatePlaceOfSupply(e.target.value)}>
                    <option value="">Same as party billing state</option>
                    {GST_STATE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
                  </select>
                </div>}
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
            {transactionSettings.showInclusiveExclusiveTax !== false && (
              <div>
                <Label className="text-xs">Tax on item rate</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={pricingMode}
                  onChange={(event) => setPricingMode(event.target.value === 'inclusive' ? 'inclusive' : 'exclusive')}
                >
                  <option value="exclusive">Tax exclusive</option>
                  <option value="inclusive">Tax inclusive</option>
                </select>
              </div>
            )}
            <div className="md:col-span-3">
              <Label className="text-xs">Invoice layout</Label>
              <div className="mt-1">
                <PrintLayoutPicker value={selectedPrintLayoutId} onChange={changeInvoiceLayout} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Default from invoice settings is preselected. You can override it for this invoice.
              </p>
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Invoice color</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRINT_COLOR_PALETTE.map((color) => {
                  const checked = invoiceLayoutColor.toLowerCase() === color.value.toLowerCase();
                  return (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setInvoiceLayoutColor(color.value)}
                      className={`flex h-8 items-center gap-2 rounded-md border px-2 text-xs font-medium ${checked ? 'border-primary bg-primary/5 text-primary' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                      title={color.name}
                    >
                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: color.value }} />
                      {color.name}
                    </button>
                  );
                })}
                <div className="flex h-8 items-center gap-2">
                  <input
                    type="color"
                    className="h-8 w-10 rounded border bg-background p-1"
                    value={invoiceLayoutColor}
                    onChange={(e) => setInvoiceLayoutColor(e.target.value)}
                    aria-label="Custom invoice color"
                  />
                  <span className="text-xs text-muted-foreground">{selectedLayoutColorName}</span>
                </div>
              </div>
            </div>
            <div className="md:col-span-3">
              <BankAccountPicker value={companyBankAccountId} onChange={setCompanyBankAccountId} />
            </div>
          </div>
        </CollapsibleTransactionSection>}

        <MobileActionBar>
          <DocumentActionsBar
            onCancel={() => navigate(cancelTo)}
            onPreview={handlePreview}
            onSave={handleSubmit}
            canPreview={canSave && transactionSettings.doNotShowInvoicePreview !== true}
            canSave={canSave}
            saving={saving}
            saveLabel={editInvoiceId ? 'Save changes' : 'Create Invoice'}
            extra={
              <Button
                type="button"
                variant="outline"
                className="border-indigo-600 text-indigo-600 hover:bg-indigo-50 gap-1.5"
                disabled={!canSave || saving}
                onClick={() => handleSubmit(true)}
              >
                <Printer className="h-4 w-4" />
                {editInvoiceId ? 'Save & Print Receipt' : 'Create & Print Receipt'}
              </Button>
            }
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

      {completedInvoice && (
        <ThermalReceipt
          invoice={completedInvoice}
          company={company || { name: 'My Company' }}
          items={completedInvoice.items}
          widthMm={readStorageWithLegacy(STORAGE_KEYS.printerType, LEGACY_STORAGE_KEYS.printerType) === 'thermal58' ? 58 : 80}
          onClose={() => {
            const nextId = completedInvoice.id;
            setCompletedInvoice(null);
            const skipPreview = readSkipInvoicePreview();
            if (nextId) navigate(skipPreview ? `/sales/${nextId}` : `/sales/${nextId}?preview=1`);
            else navigate('/sales');
          }}
          onPrint={() => handlePrintReceipt(completedInvoice.id)}
        />
      )}
    </TransactionPageShell>
  );
}
