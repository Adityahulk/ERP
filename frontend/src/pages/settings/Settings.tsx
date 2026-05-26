import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Building2, MapPin, Users, FileText, Package, Database, AlertCircle, Upload, Power, Plus, Search, Trash2, UserRound, Download, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCompany, useUpdateCompany } from '@/hooks/useBusiness';
import api, { getApiBaseURL } from '@/lib/api';
import { normalizeRole, roleLabel } from '@/lib/roles';
import { normalizeCurrencyCode, SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/formatters';
import { DOCUMENT_THEME_OPTIONS } from '@/components/invoices/InvoicePreviewWorkspace';

type SalesCustomFieldDef = {
  id: string;
  label: string;
  scope: 'invoice' | 'item';
  type: 'text' | 'number' | 'date';
  required: boolean;
  enabled: boolean;
};

function normalizeFieldId(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function normalizeSalesCustomFields(value: unknown): SalesCustomFieldDef[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row: any) => ({
      id: normalizeFieldId(String(row?.id || row?.label || '')),
      label: String(row?.label || row?.id || '').trim(),
      scope: (row?.scope === 'item' ? 'item' : 'invoice') as SalesCustomFieldDef['scope'],
      type: (['number', 'date'].includes(String(row?.type)) ? row.type : 'text') as SalesCustomFieldDef['type'],
      required: Boolean(row?.required),
      enabled: row?.enabled !== false,
    }))
    .filter((row) => row.id && row.label);
}

function prepareSalesCustomFields(fields: SalesCustomFieldDef[]) {
  const seen = new Set<string>();
  return fields
    .map((field) => ({
      id: normalizeFieldId(field.id || field.label),
      label: String(field.label || field.id || '').trim(),
      scope: field.scope === 'item' ? 'item' : 'invoice',
      type: field.type === 'number' || field.type === 'date' ? field.type : 'text',
      required: Boolean(field.required),
      enabled: field.enabled !== false,
    }))
    .filter((field) => {
      if (!field.id || !field.label || seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });
}

export default function Settings() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = ['admin', 'super_admin'].includes(normalizeRole(user?.role));
  const { data: company, isLoading: companyLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const [einvEnabled, setEinvEnabled] = useState(false);
  const [einvTurnover, setEinvTurnover] = useState(false);
  const [einvSandbox, setEinvSandbox] = useState(true);
  const [einvUser, setEinvUser] = useState('');
  const [einvPass, setEinvPass] = useState('');
  const [ewayBillOnlyAbove50k, setEwayBillOnlyAbove50k] = useState(false);
  const [printerType, setPrinterType] = useState<'a4' | 'thermal80' | 'thermal58'>('a4');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [companyCity, setCompanyCity] = useState('');
  const [companyState, setCompanyState] = useState('');
  const [companyPincode, setCompanyPincode] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [gstinDetails, setGstinDetails] = useState<any>(null);
  const [gstinFetching, setGstinFetching] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [upiId, setUpiId] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');
  const [invoiceTerms, setInvoiceTerms] = useState('');
  const [invoiceTemplate, setInvoiceTemplate] = useState('monochrome');
  const [documentTheme, setDocumentTheme] = useState('executive');
  const [documentPrimaryColor, setDocumentPrimaryColor] = useState('#4F46E5');
  const [enabledCurrencies, setEnabledCurrencies] = useState<CurrencyCode[]>(['INR']);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>('INR');
  const [deliveryChallanShowPricing, setDeliveryChallanShowPricing] = useState(false);
  const [salesCustomFields, setSalesCustomFields] = useState<SalesCustomFieldDef[]>([]);
  const [itemTerminologySingular, setItemTerminologySingular] = useState('Item');
  const [itemTerminologyPlural, setItemTerminologyPlural] = useState('Items');
  const [defaultGstRate, setDefaultGstRate] = useState('18');
  const [newUser, setNewUser] = useState({ name: '', email: '', phone: '', role: 'staff', password: '' });
  const [newGodown, setNewGodown] = useState({ name: '', code: '', city: '', state: '', is_default: false });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingGodownId, setEditingGodownId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', email: '', phone: '', role: 'staff', is_active: true });
  const [editGodownForm, setEditGodownForm] = useState({ name: '', code: '', city: '', state: '', is_default: false, is_active: true });
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const tallyImportFileRef = useRef<HTMLInputElement | null>(null);
  const pendingImportFile = useRef<File | null>(null);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const signatureFileRef = useRef<HTMLInputElement | null>(null);
  const lastAutoFetchedGstin = useRef('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    preview?: { row: number; data: Record<string, unknown>; valid: boolean }[];
    errors?: { row: number; errors: string[]; data: unknown }[];
    total?: number;
    valid?: number;
    invalid?: number;
  } | null>(null);

  if (!isAdmin) {
     return <Navigate to="/dashboard" replace />;
  }

  const uploadsBase = () => getApiBaseURL().replace(/\/api$/, '');
  const logoSrc =
    company?.logo_url &&
    (String(company.logo_url).startsWith('http') ? company.logo_url : `${uploadsBase()}${company.logo_url}`);
  const signatureSrc =
    company?.signature_url &&
    (String(company.signature_url).startsWith('http')
      ? company.signature_url
      : `${uploadsBase()}${company.signature_url}`);

  const [tab, setTab] = useState('company');

  const [deleteConf, setDeleteConf] = useState('');
  const [dataDumping, setDataDumping] = useState(false);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  const [testPrintRunning, setTestPrintRunning] = useState(false);
  const [tallyExporting, setTallyExporting] = useState(false);
  const [tallyImporting, setTallyImporting] = useState(false);

  const { data: usersPage, isLoading: usersLoading } = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => api.get('/users', { params: { page: 1, limit: 50 } }).then((r) => r.data?.data ?? r.data),
  });
  const users = (usersPage as any)?.data ?? [];

  const { data: godownsData, isLoading: godownsLoading } = useQuery({
    queryKey: ['settings-godowns'],
    queryFn: () => api.get('/godowns').then((r) => r.data?.data ?? r.data),
  });
  const godownRows = (godownsData as any) ?? [];

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['company-bank-accounts'],
    queryFn: () => api.get('/company/bank-accounts').then((r) => r.data?.data ?? r.data),
  });
  const [bankForm, setBankForm] = useState({
    account_label: '',
    bank_name: '',
    account_number: '',
    ifsc: '',
    branch: '',
    upi_id: '',
    is_primary: false,
  });

  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editBankForm, setEditBankForm] = useState({
    account_label: '',
    bank_name: '',
    account_number: '',
    ifsc: '',
    branch: '',
    upi_id: '',
    is_primary: false,
  });

  const saveBankAccount = useMutation({
    mutationFn: () => api.post('/company/bank-accounts', bankForm),
    onSuccess: () => {
      toast.success('Bank account added');
      setBankForm({ account_label: '', bank_name: '', account_number: '', ifsc: '', branch: '', upi_id: '', is_primary: false });
      qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Bank save failed'),
  });

  const updateBankAccount = useMutation({
    mutationFn: (payload: {
      id: string;
      account_label: string | null;
      bank_name: string;
      account_number: string | null;
      ifsc: string | null;
      branch: string | null;
      upi_id: string | null;
      is_primary: boolean;
    }) => {
      const { id, ...body } = payload;
      return api.patch(`/company/bank-accounts/${id}`, body);
    },
    onSuccess: () => {
      toast.success('Bank account updated');
      setEditingBankId(null);
      qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const removeBankAccount = useMutation({
    mutationFn: (id: string) => api.delete(`/company/bank-accounts/${id}`),
    onSuccess: (_data, deletedId) => {
      toast.success('Bank account removed');
      setEditingBankId((cur) => (cur === deletedId ? null : cur));
      qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Remove failed'),
  });

  const createUser = useMutation({
    mutationFn: () => api.post('/users', newUser),
    onSuccess: () => {
      toast.success('User invited');
      setNewUser({ name: '', email: '', phone: '', role: 'staff', password: '' });
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Invite failed'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/users/${id}`, data),
    onSuccess: () => {
      toast.success('User updated');
      setEditingUserId(null);
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const createGodown = useMutation({
    mutationFn: () => api.post('/godowns', newGodown),
    onSuccess: () => {
      toast.success('Godown added');
      setNewGodown({ name: '', code: '', city: '', state: '', is_default: false });
      qc.invalidateQueries({ queryKey: ['settings-godowns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Add failed'),
  });

  const updateGodown = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/godowns/${id}`, data),
    onSuccess: () => {
      toast.success('Godown updated');
      setEditingGodownId(null);
      qc.invalidateQueries({ queryKey: ['settings-godowns'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const openEditGodown = (g: any) => {
    setEditingGodownId(g.id);
    setEditGodownForm({
      name: g.name || '',
      code: g.code || '',
      city: g.city || '',
      state: g.state || '',
      is_default: !!g.is_default,
      is_active: !!g.is_active,
    });
  };

  const downloadItemsTemplate = async () => {
    setTemplateDownloading(true);
    const t = toast.loading('Preparing template…');
    try {
      const res = await api.get('/items/import-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'microtechnique_item_import_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Template downloaded', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Template download failed', { id: t });
    } finally {
      setTemplateDownloading(false);
    }
  };

  const previewImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setImporting(true);
      pendingImportFile.current = file;
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/items/bulk-import', fd);
      const d = res.data?.data ?? res.data;
      setImportPreview(d);
      if (!d.preview?.length && (d.errors?.length || 0) > 0) {
        toast.error('No valid rows — fix errors and try again.');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Preview failed');
      pendingImportFile.current = null;
      setImportPreview(null);
    } finally {
      setImporting(false);
    }
  };

  const confirmImportFile = async () => {
    const file = pendingImportFile.current;
    if (!file) {
      toast.error('Choose a file first');
      return;
    }
    try {
      setImporting(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/items/bulk-import?action=confirm', fd);
      const d = res.data?.data ?? res.data;
      toast.success(`Import complete. Inserted ${d.inserted || 0} items`);
      setImportPreview(null);
      pendingImportFile.current = null;
      qc.invalidateQueries({ queryKey: ['items'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const uploadAsset = async (file: File | undefined, kind: 'logo' | 'signature') => {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append(kind, file);
      await api.post(kind === 'logo' ? '/company/logo' : '/company/signature', fd);
      toast.success(kind === 'logo' ? 'Logo updated' : 'Signature / stamp updated');
      qc.invalidateQueries({ queryKey: ['company'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Upload failed');
    } finally {
      if (kind === 'logo' && logoFileRef.current) logoFileRef.current.value = '';
      if (kind === 'signature' && signatureFileRef.current) signatureFileRef.current.value = '';
    }
  };

  const deleteWorkspace = useMutation({
    mutationFn: () => api.post('/company/delete-workspace', { confirm: 'DELETE-MY-COMPANY' as const }),
    onSuccess: () => {
      toast.success('Workspace closed');
      logout();
      window.location.href = '/login';
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Request failed'),
  });

  const dumpData = async () => {
    setDataDumping(true);
    const t = toast.loading('Gathering export…');
    try {
      const [companyRes, itemsRes, partiesRes, invoicesRes, godownsRes, usersRes] = await Promise.all([
        api.get('/company'),
        api.get('/items', { params: { page: 1, limit: 5000 } }),
        api.get('/parties', { params: { page: 1, limit: 5000 } }),
        api.get('/invoices', { params: { page: 1, limit: 5000 } }),
        api.get('/godowns'),
        api.get('/users', { params: { page: 1, limit: 5000 } }),
      ]);
      const dump = {
        generated_at: new Date().toISOString(),
        company: companyRes.data?.data ?? companyRes.data,
        items: (itemsRes.data?.data ?? itemsRes.data)?.data ?? [],
        parties: (partiesRes.data?.data ?? partiesRes.data)?.data ?? [],
        invoices: (invoicesRes.data?.data ?? invoicesRes.data)?.data ?? [],
        godowns: godownsRes.data?.data ?? godownsRes.data,
        users: (usersRes.data?.data ?? usersRes.data)?.data ?? [],
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bizflow-data-dump-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Data dump downloaded', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Export failed', { id: t });
    } finally {
      setDataDumping(false);
    }
  };

  useEffect(() => {
    if (!company) return;
    setEinvEnabled(!!company.einvoice_enabled);
    setEinvTurnover(!!company.einvoice_turnover_above_5cr);
    setEinvSandbox(company.einvoice_sandbox !== false);
    setEinvUser(company.einvoice_gsp_username || '');
    setEwayBillOnlyAbove50k(!!company.eway_bill_only_above_50k);
    const saved = localStorage.getItem('bizflow_printer_type') as 'a4' | 'thermal80' | 'thermal58' | null;
    if (saved === 'thermal80' || saved === 'thermal58' || saved === 'a4') setPrinterType(saved);
    setLegalName(company.legal_name || company.name || '');
    setGstin(company.gstin || '');
    setRegisteredAddress(company.registered_address || '');
    setCompanyCity(company.city || '');
    setCompanyState(company.state || '');
    setCompanyPincode(company.pincode || '');
    setCompanyPhone(company.phone || '');
    setCompanyEmail(company.email || '');
    setBusinessType(company.business_type || '');
    setBusinessCategory(company.business_category || '');
    setGstinDetails(company.gstin ? {
      legal_name: company.gstin_legal_name,
      trade_name: company.gstin_trade_name,
      status: company.gstin_status,
      taxpayer_type: company.gstin_taxpayer_type,
      address: company.gstin_address,
      state_code: company.state_code,
      state: company.state,
      source: company.gstin_lookup_payload ? 'saved' : undefined,
    } : null);
    setBankName(company.bank_name || '');
    setBankAccountNumber(company.bank_account_number || '');
    setBankIfsc(company.bank_ifsc || '');
    setUpiId(company.upi_id || '');
    setInvoicePrefix(company.invoice_prefix || 'INV');
    setInvoiceTerms(company.terms_and_conditions || '');
    setInvoiceTemplate(company.invoice_pdf_template || 'monochrome');
    setDocumentTheme(company.document_theme || 'executive');
    setDocumentPrimaryColor(company.document_primary_color || '#4F46E5');
    const currencies = Array.isArray(company.enabled_currencies)
      ? company.enabled_currencies
          .map((c: unknown) => normalizeCurrencyCode(c))
          .filter((c: CurrencyCode, idx: number, arr: CurrencyCode[]) => arr.indexOf(c) === idx)
      : ['INR'];
    setEnabledCurrencies(currencies.length ? currencies : ['INR']);
    setDefaultCurrency(normalizeCurrencyCode(company.default_currency || company.currency || 'INR'));
    setDeliveryChallanShowPricing(!!company.delivery_challan_show_pricing);
    setSalesCustomFields(normalizeSalesCustomFields(company.sales_invoice_custom_fields));
    setItemTerminologySingular(company.item_terminology || 'Item');
    setItemTerminologyPlural(company.item_terminology_plural || 'Items');
    setDefaultGstRate(String(company.default_gst_rate ?? 18));
  }, [company]);

  const saveProfile = async () => {
    try {
      await updateCompany.mutateAsync({
        legal_name: legalName.trim() || null,
        gstin: gstin.trim().toUpperCase() || null,
        registered_address: registeredAddress.trim() || null,
        city: companyCity.trim() || null,
        pincode: companyPincode.trim() || null,
        phone: companyPhone.trim() || null,
        email: companyEmail.trim() || null,
        business_type: businessType || null,
        business_category: businessCategory.trim() || null,
        gstin_legal_name: gstinDetails?.legal_name || null,
        gstin_trade_name: gstinDetails?.trade_name || null,
        gstin_status: gstinDetails?.status || null,
        gstin_taxpayer_type: gstinDetails?.taxpayer_type || null,
        gstin_address: gstinDetails?.address || null,
        state_code: gstinDetails?.state_code || company?.state_code || null,
        state: companyState.trim() || gstinDetails?.state || company?.state || null,
        gstin_last_fetched_at: gstinDetails?.source ? new Date().toISOString() : company?.gstin_last_fetched_at || null,
        gstin_lookup_payload: gstinDetails?.raw || company?.gstin_lookup_payload || null,
        bank_name: bankName.trim() || null,
        bank_account_number: bankAccountNumber.trim() || null,
        bank_ifsc: bankIfsc.trim().toUpperCase() || null,
        upi_id: upiId.trim() || null,
      });
      toast.success('Company profile updated');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const fetchGstin = async (options?: { silent?: boolean }) => {
    const silent = !!options?.silent;
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15) {
      if (!silent) toast.error('Enter a 15-character GSTIN first');
      return;
    }
    setGstinFetching(true);
    const t = silent ? null : toast.loading('Fetching GSTIN details…');
    try {
      const res = await api.get(`/company/gstin/${g}`);
      const details = res.data?.data ?? res.data;
      setGstinDetails(details);
      if (details.legal_name || details.trade_name) setLegalName(details.legal_name || details.trade_name);
      if (details.address) setRegisteredAddress(details.address);
      if (details.city) setCompanyCity(details.city);
      if (details.pincode) setCompanyPincode(details.pincode);
      if (details.state) setCompanyState(details.state);
      if (!silent) {
        toast.success(details.source === 'provider' ? 'GSTIN details fetched' : 'GSTIN verified locally', { id: t ?? undefined });
      }
    } catch (e: any) {
      if (!silent) toast.error(e.response?.data?.error || 'GSTIN lookup failed', { id: t ?? undefined });
    } finally {
      setGstinFetching(false);
    }
  };

  useEffect(() => {
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15 || g === lastAutoFetchedGstin.current) return;
    const timer = window.setTimeout(() => {
      lastAutoFetchedGstin.current = g;
      fetchGstin({ silent: true });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [gstin]);

  const saveInvoicePreferences = async () => {
    try {
      await updateCompany.mutateAsync({
        invoice_prefix: invoicePrefix.trim() || 'INV',
        terms_and_conditions: invoiceTerms.trim() || null,
        invoice_pdf_template: invoiceTemplate,
        document_theme: documentTheme,
        document_primary_color: documentPrimaryColor || '#4F46E5',
        enabled_currencies: enabledCurrencies,
        default_currency: enabledCurrencies.includes(defaultCurrency) ? defaultCurrency : enabledCurrencies[0],
        currency: enabledCurrencies.includes(defaultCurrency) ? defaultCurrency : enabledCurrencies[0],
        delivery_challan_show_pricing: deliveryChallanShowPricing,
        sales_invoice_custom_fields: prepareSalesCustomFields(salesCustomFields),
      });
      toast.success('Invoice preferences saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const addSalesCustomField = () => {
    const base = `field_${salesCustomFields.length + 1}`;
    setSalesCustomFields((prev) => [
      ...prev,
      { id: base, label: 'New Field', scope: 'invoice', type: 'text', required: false, enabled: true },
    ]);
  };

  const updateSalesCustomField = (idx: number, patch: Partial<SalesCustomFieldDef>) => {
    setSalesCustomFields((prev) => prev.map((field, i) => {
      if (i !== idx) return field;
      const next = { ...field, ...patch };
      if (patch.label !== undefined && (!field.id || field.id.startsWith('field_'))) {
        next.id = normalizeFieldId(String(patch.label)) || field.id;
      }
      if (patch.id !== undefined) next.id = normalizeFieldId(String(patch.id));
      return next;
    }));
  };

  const removeSalesCustomField = (idx: number) => {
    setSalesCustomFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleCurrency = (code: CurrencyCode, enabled: boolean) => {
    setEnabledCurrencies((prev) => {
      if (code === 'INR') return ['INR', ...prev.filter((c) => c !== 'INR')];
      const next = enabled ? Array.from(new Set([...prev, code])) : prev.filter((c) => c !== code);
      if (!next.length) return ['INR'];
      if (!next.includes(defaultCurrency)) setDefaultCurrency(next[0]);
      return next;
    });
  };

  const applyItemSchema = async () => {
    try {
      await updateCompany.mutateAsync({
        item_terminology: itemTerminologySingular.trim() || 'Item',
        item_terminology_plural: itemTerminologyPlural,
        default_gst_rate: Math.round(Math.min(100, Math.max(0, Number(defaultGstRate) || 0))),
      });
      toast.success('Item schema applied');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Apply failed');
    }
  };

  const saveEinvoice = async () => {
    try {
      await updateCompany.mutateAsync({
        einvoice_enabled: einvEnabled,
        einvoice_turnover_above_5cr: einvTurnover,
        einvoice_sandbox: einvSandbox,
        einvoice_gsp_username: einvUser || null,
        eway_bill_only_above_50k: ewayBillOnlyAbove50k,
        ...(einvPass ? { einvoice_gsp_password: einvPass } : {}),
      });
      setEinvPass('');
      toast.success('e-Invoice settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const savePrinter = () => {
    localStorage.setItem('bizflow_printer_type', printerType);
    toast.success('Printer preference saved');
  };

  const syncEmployeesToHr = async () => {
    try {
      const r = await api.post('/users/sync-employee-profiles');
      const msg = r.data?.data?.message ?? 'Sync done';
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ['settings-users'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Sync failed');
    }
  };

  const testPrint = async () => {
    setTestPrintRunning(true);
    const t = toast.loading('Preparing sample print…');
    try {
      const res = await api.get('/invoices', { params: { page: 1, limit: 1 } });
      const page = res.data?.data;
      const first = page?.data?.[0];
      if (!first?.id) {
        toast.error('No invoice found for sample print', { id: t });
        return;
      }
      const w = printerType === 'thermal58' ? '58' : '80';
      const pdfRes = await api.get(`/print/receipt/${first.id}`, { params: { width: w }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      toast.success('Opening sample receipt…', { id: t });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Test print failed', { id: t });
    } finally {
      setTestPrintRunning(false);
    }
  };

  const exportTally = async (format: 'json' | 'xml') => {
    setTallyExporting(true);
    try {
      const res = await api.get('/reports/tally-export', { params: { format }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tally-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Tally ${format.toUpperCase()} exported`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Tally export failed');
    } finally {
      setTallyExporting(false);
    }
  };

  const importTally = async (file?: File) => {
    if (!file) return;
    setTallyImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/reports/tally-import', fd);
      const d = res.data?.data ?? res.data;
      toast.success(`Imported from Tally: ${d.created_items || 0} items, ${d.created_parties || 0} parties, ${d.created_units || 0} units`);
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['item-units'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Tally import failed');
    } finally {
      setTallyImporting(false);
      if (tallyImportFileRef.current) tallyImportFileRef.current.value = '';
    }
  };

  const TABS = [
     { id: 'company', label: 'Company Profile', icon: Building2 },
     { id: 'godowns', label: 'Locations / Godowns', icon: MapPin },
     { id: 'users', label: 'Users & Roles', icon: Users },
     { id: 'invoices', label: 'Invoice Settings', icon: FileText },
     { id: 'items', label: 'Item Configuration', icon: Package },
     { id: 'data', label: 'Data Management', icon: Database },
     { id: 'danger', label: 'Danger Zone', icon: AlertCircle, error: true },
  ];

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
         <h1 className="text-2xl font-bold text-slate-900">Platform Settings</h1>
         <p className="text-slate-500 text-sm">Manage enterprise parameters, users, and core configurations.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
         {/* Navigation Sidebar */}
         <div className="md:w-64 shrink-0 flex flex-col gap-1">
            {TABS.map(t => (
               <button 
                  key={t.id} 
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                     tab === t.id 
                       ? t.error ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700' 
                       : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
               >
                  <t.icon className={`w-4 h-4 ${tab === t.id && t.error ? 'text-red-600' : tab === t.id ? 'text-indigo-600' : 'text-slate-400'}`} /> 
                  {t.label}
               </button>
            ))}
         </div>

         {/* Content Area */}
         <div className="flex-1">
            <Card className="min-h-[500px]">
               {tab === 'company' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold mb-4">Company Profile</h2>
                     {companyLoading && <p className="text-sm text-muted-foreground">Loading company…</p>}
                     <div className="grid md:grid-cols-2 gap-6 border-b pb-6">
                        <div>
                           <label className="text-sm font-medium text-slate-700 block mb-2">Branding (PDFs & prints)</label>
                           <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAsset(e.target.files?.[0], 'logo')} />
                           <input ref={signatureFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAsset(e.target.files?.[0], 'signature')} />
                           <div className="flex items-center gap-4">
                              <button
                                type="button"
                                onClick={() => logoFileRef.current?.click()}
                                className="w-24 h-24 bg-slate-100 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-slate-500 cursor-pointer hover:bg-slate-50 overflow-hidden relative"
                              >
                                 {logoSrc ? (
                                   <img src={logoSrc} alt="Logo" className="absolute inset-0 w-full h-full object-contain p-1" />
                                 ) : (
                                   <>
                                     <Upload className="w-6 h-6 mb-1" /> <span className="text-[10px] uppercase">Logo</span>
                                   </>
                                 )}
                              </button>
                              <button
                                type="button"
                                onClick={() => signatureFileRef.current?.click()}
                                className="w-32 h-24 bg-slate-100 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-slate-500 cursor-pointer hover:bg-slate-50 overflow-hidden relative"
                              >
                                 {signatureSrc ? (
                                   <img src={signatureSrc} alt="Signature" className="absolute inset-0 w-full h-full object-contain p-1" />
                                 ) : (
                                   <>
                                     <Upload className="w-6 h-6 mb-1" /> <span className="text-[10px] uppercase text-center px-1">Stamp / sign</span>
                                   </>
                                 )}
                              </button>
                           </div>
                           <p className="text-xs text-slate-500 mt-2">Uploads are stored on the server and used on invoices and quotations.</p>
                        </div>
                        <div className="space-y-4">
                           <div>
                              <label className="text-sm font-medium text-slate-700">Legal Name</label>
                             <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="mt-1" />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSTIN</label>
                             <div className="mt-1 flex gap-2">
                               <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="uppercase font-mono" maxLength={15} />
                               <Button type="button" variant="outline" size="icon" onClick={() => fetchGstin()} loading={gstinFetching} aria-label="Fetch GSTIN details">
                                 <Search className="h-4 w-4" />
                               </Button>
                             </div>
                             {gstinDetails && (
                               <div className="mt-2 rounded-md border bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                                 <p><span className="font-semibold">Legal:</span> {gstinDetails.legal_name || 'Verified GSTIN format only'}</p>
                                 {gstinDetails.trade_name && <p><span className="font-semibold">Trade:</span> {gstinDetails.trade_name}</p>}
                                 {gstinDetails.address && <p><span className="font-semibold">Address:</span> {gstinDetails.address}</p>}
                                 {(gstinDetails.city || gstinDetails.pincode) && <p><span className="font-semibold">City/PIN:</span> {[gstinDetails.city, gstinDetails.pincode].filter(Boolean).join(' - ')}</p>}
                                 <p><span className="font-semibold">State:</span> {[gstinDetails.state_code, gstinDetails.state].filter(Boolean).join(' - ') || '—'}</p>
                                 {gstinDetails.status && <p><span className="font-semibold">Status:</span> {gstinDetails.status}</p>}
                               </div>
                             )}
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Registered Address</label>
                             <textarea
                               className="mt-1 w-full min-h-[92px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                               value={registeredAddress}
                               onChange={(e) => setRegisteredAddress(e.target.value)}
                               placeholder="Building, street, area"
                             />
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                             <div>
                                <label className="text-sm font-medium text-slate-700">City</label>
                               <Input value={companyCity} onChange={(e) => setCompanyCity(e.target.value)} className="mt-1" />
                             </div>
                             <div>
                                <label className="text-sm font-medium text-slate-700">State</label>
                               <Input value={companyState} onChange={(e) => setCompanyState(e.target.value)} className="mt-1" />
                             </div>
                             <div>
                                <label className="text-sm font-medium text-slate-700">Pincode</label>
                               <Input value={companyPincode} onChange={(e) => setCompanyPincode(e.target.value)} className="mt-1" maxLength={10} />
                             </div>
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                             <div>
                                <label className="text-sm font-medium text-slate-700">Phone No.</label>
                               <Input value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} className="mt-1" inputMode="tel" placeholder="Company phone number" />
                             </div>
                             <div>
                                <label className="text-sm font-medium text-slate-700">Email ID</label>
                               <Input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} className="mt-1" type="email" />
                             </div>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Business Type</label>
                             <select className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                               <option value="">Select business type</option>
                               <option value="retail">Retail</option>
                               <option value="wholesaler">Wholesaler</option>
                               <option value="manufacturing">Manufacturing</option>
                               <option value="distributor">Distributor</option>
                               <option value="service">Service</option>
                               <option value="others">Others</option>
                             </select>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Business Category</label>
                             <Input list="business-category-suggestions" value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} className="mt-1" placeholder="e.g. Accounting CA, Salon, Shop" />
                             <datalist id="business-category-suggestions">
                               <option value="Accounting / CA Firm" />
                               <option value="Salon / Beauty Studio" />
                               <option value="Retail Shop" />
                               <option value="Manufacturing Unit" />
                               <option value="Distributor / Trader" />
                               <option value="Professional Services" />
                               <option value="Restaurant / Cafe" />
                               <option value="Healthcare / Clinic" />
                             </datalist>
                           </div>
                        </div>
                     </div>

                     <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">Banking Details</h3>
                          <Input placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                          <Input placeholder="Account Number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
                          <Input placeholder="IFSC Code" className="uppercase" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} />
                        </div>
                        <div className="space-y-4">
                           <h3 className="font-semibold text-slate-900">UPI Context</h3>
                          <Input placeholder="UPI ID (e.g. upi@hdfcbank)" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
                           <p className="text-xs text-slate-500">QR Code will be dynamically generated on the invoice PDF based on total payload requirements automatically.</p>
                        </div>
                     </div>
                     <div className="border-t pt-6 space-y-4">
                       <div className="flex items-center justify-between">
                         <h3 className="font-semibold text-slate-900">Multiple Bank Accounts</h3>
                         <span className="text-xs text-slate-500">Primary account is used first on PDFs.</span>
                       </div>
                       <div className="grid gap-3">
                         {(bankAccounts as any[]).map((b: any) => (
                           <div key={b.id} className="rounded-lg border bg-slate-50 overflow-hidden">
                             <div className="flex items-center justify-between gap-2 p-3">
                               <div className="min-w-0 flex-1">
                                 <p className="font-medium text-sm">
                                   {b.account_label || b.bank_name}{' '}
                                   {b.is_primary ? <span className="text-xs text-indigo-600">(Primary)</span> : null}
                                 </p>
                                 <p className="text-xs text-slate-500 break-words">
                                   {b.bank_name || '—'} • {b.account_number || '—'} • {b.ifsc || '—'}
                                   {b.branch ? ` • ${b.branch}` : ''}
                                   {b.upi_id ? ` • ${b.upi_id}` : ''}
                                 </p>
                               </div>
                               <div className="flex shrink-0 items-center gap-1">
                                 <Button
                                   type="button"
                                   variant="ghost"
                                   size="sm"
                                   className="h-8 gap-1 text-xs"
                                   onClick={() => {
                                     if (editingBankId === b.id) {
                                       setEditingBankId(null);
                                       return;
                                     }
                                     setEditingBankId(b.id);
                                     setEditBankForm({
                                       account_label: b.account_label || '',
                                       bank_name: b.bank_name || '',
                                       account_number: b.account_number || '',
                                       ifsc: b.ifsc || '',
                                       branch: b.branch || '',
                                       upi_id: b.upi_id || '',
                                       is_primary: !!b.is_primary,
                                     });
                                   }}
                                 >
                                   <Pencil className="h-3.5 w-3.5" />
                                   {editingBankId === b.id ? 'Close' : 'Edit'}
                                 </Button>
                                 <Button
                                   variant="ghost"
                                   size="icon"
                                   className="h-8 w-8"
                                   onClick={() => removeBankAccount.mutate(b.id)}
                                   aria-label="Remove bank"
                                 >
                                   <Trash2 className="h-4 w-4 text-red-600" />
                                 </Button>
                               </div>
                             </div>
                             {editingBankId === b.id && (
                               <div className="border-t bg-white p-4 space-y-3">
                                 <div className="grid sm:grid-cols-2 gap-3">
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">Display label</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.account_label}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, account_label: e.target.value }))}
                                       placeholder="e.g. Main current"
                                     />
                                   </div>
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">Bank name</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.bank_name}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, bank_name: e.target.value }))}
                                     />
                                   </div>
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">Account number</label>
                                     <Input
                                       className="mt-1 h-9 font-mono text-sm"
                                       value={editBankForm.account_number}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, account_number: e.target.value }))}
                                     />
                                   </div>
                                   <div>
                                     <label className="text-xs font-medium text-slate-600">IFSC</label>
                                     <Input
                                       className="mt-1 h-9 font-mono text-sm uppercase"
                                       value={editBankForm.ifsc}
                                       onChange={(e) =>
                                         setEditBankForm((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))
                                       }
                                     />
                                   </div>
                                   <div className="sm:col-span-2">
                                     <label className="text-xs font-medium text-slate-600">Branch</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.branch}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, branch: e.target.value }))}
                                     />
                                   </div>
                                   <div className="sm:col-span-2">
                                     <label className="text-xs font-medium text-slate-600">UPI ID</label>
                                     <Input
                                       className="mt-1 h-9"
                                       value={editBankForm.upi_id}
                                       onChange={(e) => setEditBankForm((s) => ({ ...s, upi_id: e.target.value }))}
                                       placeholder="name@upi"
                                     />
                                   </div>
                                 </div>
                                 <label className="flex items-center gap-2 text-sm">
                                   <input
                                     type="checkbox"
                                     checked={editBankForm.is_primary}
                                     onChange={(e) =>
                                       setEditBankForm((s) => ({ ...s, is_primary: e.target.checked }))
                                     }
                                   />
                                   Primary (shown first on invoices when none is selected)
                                 </label>
                                 <div className="flex flex-wrap gap-2 pt-1">
                                   <Button
                                     type="button"
                                     size="sm"
                                     loading={updateBankAccount.isPending}
                                     disabled={
                                       !editBankForm.bank_name.trim() && !editBankForm.account_label.trim()
                                     }
                                     onClick={() =>
                                       updateBankAccount.mutate({
                                         id: b.id,
                                         account_label: editBankForm.account_label.trim() || null,
                                         bank_name:
                                           editBankForm.bank_name.trim() ||
                                           editBankForm.account_label.trim() ||
                                           'Bank account',
                                         account_number: editBankForm.account_number.trim() || null,
                                         ifsc: editBankForm.ifsc.trim() || null,
                                         branch: editBankForm.branch.trim() || null,
                                         upi_id: editBankForm.upi_id.trim() || null,
                                         is_primary: editBankForm.is_primary,
                                       })
                                     }
                                   >
                                     Save changes
                                   </Button>
                                   <Button
                                     type="button"
                                     variant="outline"
                                     size="sm"
                                     onClick={() => setEditingBankId(null)}
                                   >
                                     Cancel
                                   </Button>
                                 </div>
                               </div>
                             )}
                           </div>
                         ))}
                       </div>
                       <div className="grid md:grid-cols-4 gap-3 rounded-lg border p-4">
                         <Input placeholder="Label" value={bankForm.account_label} onChange={(e) => setBankForm((s) => ({ ...s, account_label: e.target.value }))} />
                         <Input placeholder="Bank name" value={bankForm.bank_name} onChange={(e) => setBankForm((s) => ({ ...s, bank_name: e.target.value }))} />
                         <Input placeholder="Account number" value={bankForm.account_number} onChange={(e) => setBankForm((s) => ({ ...s, account_number: e.target.value }))} />
                         <Input placeholder="IFSC" className="uppercase" value={bankForm.ifsc} onChange={(e) => setBankForm((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))} />
                         <Input placeholder="Branch" value={bankForm.branch} onChange={(e) => setBankForm((s) => ({ ...s, branch: e.target.value }))} />
                         <Input placeholder="UPI ID" value={bankForm.upi_id} onChange={(e) => setBankForm((s) => ({ ...s, upi_id: e.target.value }))} />
                         <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={bankForm.is_primary} onChange={(e) => setBankForm((s) => ({ ...s, is_primary: e.target.checked }))} />Primary</label>
                         <Button type="button" onClick={() => saveBankAccount.mutate()} disabled={!bankForm.bank_name.trim() && !bankForm.account_label.trim()} loading={saveBankAccount.isPending} className="gap-1">
                           <Plus className="h-4 w-4" /> Add bank
                         </Button>
                       </div>
                     </div>
                    <div className="pt-4"><Button onClick={saveProfile} loading={updateCompany.isPending}>Save Profile</Button></div>
                    <div className="border-t pt-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={syncEmployeesToHr}
                        >
                          Sync Employees to HR
                        </Button>
                        <Button
                          className="gap-2"
                          onClick={() => {
                            setTab('users');
                            setEditingUserId('new');
                          }}
                        >
                          <Users className="w-4 h-4" /> Invite User
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => navigate('/hr/employees')}
                        >
                          <UserRound className="w-4 h-4" /> Add Employees
                        </Button>
                      </div>
                    </div>

                     <div className="border-t pt-8 space-y-4">
                        <h3 className="font-semibold text-slate-900">e-Invoice (GST / NIC)</h3>
                        <p className="text-xs text-slate-500">GSP password is encrypted at rest. Leave password blank to keep the current secret.</p>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Enable e-Invoice</span>
                           <Switch checked={einvEnabled} onCheckedChange={setEinvEnabled} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Turnover above ₹5 Cr (statutory / reporting flag)</span>
                           <Switch checked={einvTurnover} onCheckedChange={setEinvTurnover} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-md">
                           <span className="text-sm">Sandbox mode</span>
                           <Switch checked={einvSandbox} onCheckedChange={setEinvSandbox} />
                        </div>
                        <div className="flex items-center justify-between gap-4 max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                           <div>
                              <p className="text-sm font-medium text-slate-900">Allow E-Way Bill only above ₹50,000</p>
                              <p className="text-xs text-slate-600">When enabled, users cannot generate E-Way Bills for smaller invoices.</p>
                           </div>
                           <Switch checked={ewayBillOnlyAbove50k} onCheckedChange={setEwayBillOnlyAbove50k} />
                        </div>
                        <div className="grid md:grid-cols-2 gap-4 max-w-xl">
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSP username</label>
                              <Input className="mt-1" value={einvUser} onChange={(e) => setEinvUser(e.target.value)} />
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">GSP password</label>
                              <Input type="password" className="mt-1" value={einvPass} onChange={(e) => setEinvPass(e.target.value)} placeholder={company?.has_einvoice_gsp_password ? '••••••••' : ''} />
                           </div>
                        </div>
                        <Button onClick={saveEinvoice} loading={updateCompany.isPending}>Save e-Invoice settings</Button>
                     </div>
                  </CardContent>
               )}

               {tab === 'users' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Users & Roles</h2>
                        <Button className="gap-2" onClick={() => setEditingUserId('new')}><Users className="w-4 h-4"/> Invite User</Button>
                     </div>
                     {editingUserId === 'new' && (
                        <div className="mb-4 rounded-lg border p-4 grid md:grid-cols-5 gap-3">
                           <Input placeholder="Name" value={newUser.name} onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))} />
                           <Input placeholder="Email" value={newUser.email} onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))} />
                           <Input placeholder="Phone" value={newUser.phone} onChange={(e) => setNewUser((s) => ({ ...s, phone: e.target.value }))} />
                           <select className="h-10 rounded-md border bg-white px-3 text-sm" value={newUser.role} onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}>
                              <option value="staff">Staff</option>
                              <option value="manager">Cashier / Manager</option>
                              <option value="admin">Admin</option>
                           </select>
                           <Input type="password" placeholder="Password" value={newUser.password} onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))} />
                           <div className="md:col-span-5 flex gap-2">
                              <Button onClick={() => createUser.mutate()} disabled={!newUser.name || !newUser.password} loading={createUser.isPending}>Create User</Button>
                              <Button variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                           </div>
                        </div>
                     )}
                     <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm text-left">
                           <thead className="bg-slate-50 border-b">
                              <tr>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Employee</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Role</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Location</th>
                                 <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                                 <th className="px-4 py-3 font-semibold text-right">Actions</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y">
                              {usersLoading && (
                                <tr><td className="px-4 py-3 text-muted-foreground" colSpan={5}>Loading users…</td></tr>
                              )}
                              {users.map((u: any) => (
                                <tr key={u.id} className="hover:bg-slate-50/50">
                                  <td className="px-4 py-3"><p className="font-semibold text-slate-900">{u.name}</p><p className="text-xs text-slate-500">{u.email || '—'}</p></td>
                                  <td className="px-4 py-3"><span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold uppercase">{roleLabel(u.role)}</span></td>
                                  <td className="px-4 py-3">{u.godown_name || '—'}</td>
                                  <td className="px-4 py-3"><span className={`font-medium text-xs ${u.is_active ? 'text-emerald-600' : 'text-slate-500'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                                  <td className="px-4 py-3 text-right space-x-2">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Open employee profile"
                                      onClick={() => navigate(`/hr/employees/${u.id}`)}
                                    >
                                      <UserRound className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      loading={updateUser.isPending && updateUser.variables?.id === u.id}
                                      onClick={() => updateUser.mutate({ id: u.id, data: { is_active: !u.is_active } })}
                                    >
                                      {u.is_active ? 'Disable' : 'Enable'}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                     {editingUserId && editingUserId !== 'new' && (
                       <div className="mt-4 rounded-lg border p-4 grid md:grid-cols-5 gap-3">
                         <Input placeholder="Name" value={editUserForm.name} onChange={(e) => setEditUserForm((s) => ({ ...s, name: e.target.value }))} />
                         <Input placeholder="Email" value={editUserForm.email} onChange={(e) => setEditUserForm((s) => ({ ...s, email: e.target.value }))} />
                         <Input placeholder="Phone" value={editUserForm.phone} onChange={(e) => setEditUserForm((s) => ({ ...s, phone: e.target.value }))} />
                         <select className="h-10 rounded-md border bg-white px-3 text-sm" value={editUserForm.role} onChange={(e) => setEditUserForm((s) => ({ ...s, role: e.target.value }))}>
                           <option value="staff">Staff</option>
                           <option value="manager">Cashier / Manager</option>
                           <option value="admin">Admin</option>
                         </select>
                         <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={editUserForm.is_active} onChange={(e) => setEditUserForm((s) => ({ ...s, is_active: e.target.checked }))} />Active</label>
                         <div className="md:col-span-5 flex gap-2">
                           <Button onClick={() => updateUser.mutate({ id: editingUserId!, data: editUserForm })} disabled={!editUserForm.name} loading={updateUser.isPending}>Save changes</Button>
                           <Button variant="outline" onClick={() => setEditingUserId(null)}>Cancel</Button>
                         </div>
                       </div>
                     )}
                  </CardContent>
               )}

               {tab === 'godowns' && (
                  <CardContent className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold">Godowns & Warehouses</h2>
                        <Button variant="outline" className="gap-2" onClick={() => setEditingGodownId('new')}><MapPin className="w-4 h-4"/> Add Godown</Button>
                     </div>
                     {editingGodownId === 'new' && (
                        <div className="mb-4 rounded-lg border p-4 grid md:grid-cols-4 gap-3">
                           <Input placeholder="Name" value={newGodown.name} onChange={(e) => setNewGodown((s) => ({ ...s, name: e.target.value }))} />
                           <Input placeholder="Code" value={newGodown.code} onChange={(e) => setNewGodown((s) => ({ ...s, code: e.target.value }))} />
                           <Input placeholder="City" value={newGodown.city} onChange={(e) => setNewGodown((s) => ({ ...s, city: e.target.value }))} />
                           <Input placeholder="State" value={newGodown.state} onChange={(e) => setNewGodown((s) => ({ ...s, state: e.target.value }))} />
                           <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={newGodown.is_default} onChange={(e) => setNewGodown((s) => ({ ...s, is_default: e.target.checked }))} />Set as default</label>
                           <div className="md:col-span-4 flex gap-2">
                              <Button onClick={() => createGodown.mutate()} disabled={!newGodown.name} loading={createGodown.isPending}>Create Godown</Button>
                              <Button variant="outline" onClick={() => setEditingGodownId(null)}>Cancel</Button>
                           </div>
                        </div>
                     )}
                     <div className="grid gap-4">
                        {godownsLoading && <div className="text-sm text-muted-foreground">Loading godowns…</div>}
                        {godownRows.map((g: any) => (
                          <div key={g.id} className="p-4 border rounded-lg flex items-center justify-between hover:border-indigo-300 transition-colors bg-slate-50/50">
                            <div className="flex gap-4 items-center">
                              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold">{(g.code || g.name || 'G').slice(0, 2).toUpperCase()}</div>
                              <div>
                                <p className="font-semibold text-slate-900">{g.name} {g.is_default ? <span className="text-xs text-indigo-600">(Default)</span> : null}</p>
                                <p className="text-xs text-slate-500">{[g.city, g.state].filter(Boolean).join(', ') || '—'} • {g.manager_name || 'No manager'}</p>
                              </div>
                            </div>
                            <div className="space-x-2">
                              <Button variant="ghost" size="sm" onClick={() => openEditGodown(g)}>Edit</Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={updateGodown.isPending && updateGodown.variables?.id === g.id}
                                onClick={() => updateGodown.mutate({ id: g.id, data: { is_active: !g.is_active } })}
                              >
                                {g.is_active ? 'Disable' : 'Enable'}
                              </Button>
                            </div>
                          </div>
                        ))}
                     </div>
                     {editingGodownId && editingGodownId !== 'new' && (
                       <div className="mt-4 rounded-lg border p-4 grid md:grid-cols-4 gap-3">
                         <Input placeholder="Name" value={editGodownForm.name} onChange={(e) => setEditGodownForm((s) => ({ ...s, name: e.target.value }))} />
                         <Input placeholder="Code" value={editGodownForm.code} onChange={(e) => setEditGodownForm((s) => ({ ...s, code: e.target.value }))} />
                         <Input placeholder="City" value={editGodownForm.city} onChange={(e) => setEditGodownForm((s) => ({ ...s, city: e.target.value }))} />
                         <Input placeholder="State" value={editGodownForm.state} onChange={(e) => setEditGodownForm((s) => ({ ...s, state: e.target.value }))} />
                         <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={editGodownForm.is_default} onChange={(e) => setEditGodownForm((s) => ({ ...s, is_default: e.target.checked }))} />Set as default</label>
                         <label className="md:col-span-4 text-sm flex items-center gap-2"><input type="checkbox" checked={editGodownForm.is_active} onChange={(e) => setEditGodownForm((s) => ({ ...s, is_active: e.target.checked }))} />Active</label>
                         <div className="md:col-span-4 flex gap-2">
                           <Button onClick={() => updateGodown.mutate({ id: editingGodownId!, data: editGodownForm })} disabled={!editGodownForm.name} loading={updateGodown.isPending}>Save changes</Button>
                           <Button variant="outline" onClick={() => setEditingGodownId(null)}>Cancel</Button>
                         </div>
                       </div>
                     )}
                  </CardContent>
               )}

               {tab === 'invoices' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Invoice Configuration</h2>
                     <div className="space-y-4">
                        <div>
                           <label className="text-sm font-medium text-slate-700">Invoice Prefix Sequence</label>
                          <Input value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} className="mt-1 max-w-xs font-mono" />
                           <p className="text-xs text-slate-500 mt-1">Example output: INV/MUM/25-26/0001</p>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Default Terms & Conditions</label>
                          <textarea className="w-full mt-1 border rounded-md p-3 h-32 text-sm" value={invoiceTerms} onChange={(e) => setInvoiceTerms(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
                           <div>
                              <label className="text-sm font-medium text-slate-700">Default invoice layout</label>
                              <select className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm" value={invoiceTemplate} onChange={(e) => setInvoiceTemplate(e.target.value)}>
                                 <option value="standard">Detailed Tax Invoice</option>
                                 <option value="simple">Professional Header</option>
                                 <option value="performa">Centered Proforma</option>
                                 <option value="monochrome">Black & White Standard</option>
                              </select>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Invoice color style</label>
                              <select className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm" value={documentTheme} onChange={(e) => setDocumentTheme(e.target.value)}>
                                {DOCUMENT_THEME_OPTIONS.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                              </select>
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Brand color</label>
                              <div className="mt-1 flex gap-2">
                                 <input type="color" className="h-10 w-12 rounded border bg-white p-1" value={documentPrimaryColor} onChange={(e) => setDocumentPrimaryColor(e.target.value)} />
                                 <Input value={documentPrimaryColor} onChange={(e) => setDocumentPrimaryColor(e.target.value)} className="font-mono" />
                              </div>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-2xl">
                           <div>
                              <h3 className="font-semibold">Currencies</h3>
                              <p className="text-xs text-slate-500">Enable the currencies users can select while entering prices. Existing records remain in their saved currency.</p>
                           </div>
                           <div className="grid gap-3 sm:grid-cols-2">
                              {SUPPORTED_CURRENCIES.map((currency) => (
                                 <div key={currency.code} className="rounded-lg border bg-slate-50 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                       <div>
                                          <p className="text-sm font-medium text-slate-800">{currency.label}</p>
                                          <p className="mt-1 text-xs text-slate-500">Symbol: {currency.symbol}</p>
                                       </div>
                                       <Switch
                                          checked={enabledCurrencies.includes(currency.code)}
                                          disabled={currency.code === 'INR'}
                                          onCheckedChange={(checked) => toggleCurrency(currency.code, checked)}
                                       />
                                    </div>
                                 </div>
                              ))}
                           </div>
                           <div>
                              <label className="text-sm font-medium text-slate-700">Default currency for new transactions</label>
                              <select
                                 className="mt-1 h-10 w-full max-w-xs rounded-md border bg-white px-3 text-sm"
                                 value={defaultCurrency}
                                 onChange={(e) => setDefaultCurrency(normalizeCurrencyCode(e.target.value))}
                              >
                                 {SUPPORTED_CURRENCIES.filter((c) => enabledCurrencies.includes(c.code)).map((currency) => (
                                    <option key={currency.code} value={currency.code}>{currency.label}</option>
                                 ))}
                              </select>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-md">
                           <h3 className="font-semibold">Delivery Challan</h3>
                           <div className="rounded-lg border bg-slate-50 p-4">
                              <div className="flex items-start justify-between gap-4">
                                 <div>
                                    <p className="text-sm font-medium text-slate-800">Show pricing details</p>
                                    <p className="mt-1 text-xs text-slate-500">When enabled, delivery challans include reference rate, discount and amount only. GST/tax is never shown on challans.</p>
                                 </div>
                                 <Switch checked={deliveryChallanShowPricing} onCheckedChange={setDeliveryChallanShowPricing} />
                              </div>
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3">
                           <div className="flex items-center justify-between gap-3">
                              <div>
                                 <h3 className="font-semibold">Sales Invoice Custom Fields</h3>
                                 <p className="text-xs text-slate-500">Add fields once here. They appear while creating sales invoices and can be selected in Bulk Invoice columns.</p>
                              </div>
                              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addSalesCustomField}>
                                 <Plus className="w-4 h-4" /> Add field
                              </Button>
                           </div>
                           <div className="space-y-2">
                              {salesCustomFields.length === 0 && (
                                 <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                    No custom invoice fields yet.
                                 </div>
                              )}
                              {salesCustomFields.map((field, idx) => (
                                 <div key={idx} className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.4fr_1fr_120px_90px_90px_44px]">
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Label</label>
                                       <Input className="mt-1" value={field.label} onChange={(e) => updateSalesCustomField(idx, { label: e.target.value })} />
                                    </div>
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Field key</label>
                                       <Input className="mt-1 font-mono text-xs" value={field.id} onChange={(e) => updateSalesCustomField(idx, { id: e.target.value })} />
                                    </div>
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Where</label>
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" value={field.scope} onChange={(e) => updateSalesCustomField(idx, { scope: e.target.value as SalesCustomFieldDef['scope'] })}>
                                          <option value="invoice">Invoice</option>
                                          <option value="item">Item row</option>
                                       </select>
                                    </div>
                                    <div>
                                       <label className="text-xs font-medium text-slate-600">Type</label>
                                       <select className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" value={field.type} onChange={(e) => updateSalesCustomField(idx, { type: e.target.value as SalesCustomFieldDef['type'] })}>
                                          <option value="text">Text</option>
                                          <option value="number">Number</option>
                                          <option value="date">Date</option>
                                       </select>
                                    </div>
                                    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs text-slate-600 lg:mt-5">
                                       Required
                                       <Switch checked={field.required} onCheckedChange={(v) => updateSalesCustomField(idx, { required: v })} />
                                    </label>
                                    <Button type="button" variant="ghost" size="icon" className="text-red-600 hover:text-red-700 lg:mt-5" onClick={() => removeSalesCustomField(idx)}>
                                       <Trash2 className="w-4 h-4" />
                                    </Button>
                                 </div>
                              ))}
                           </div>
                        </div>
                        <div className="border-t pt-6 space-y-3 max-w-md">
                           <h3 className="font-semibold">Printer</h3>
                           <label className="text-sm font-medium text-slate-700">Printer type</label>
                           <select
                              className="mt-1 w-full h-10 rounded-md border bg-white px-3 text-sm"
                              value={printerType}
                              onChange={(e) => setPrinterType(e.target.value as typeof printerType)}
                           >
                              <option value="a4">A4 Laser</option>
                              <option value="thermal80">80mm Thermal</option>
                              <option value="thermal58">58mm Thermal</option>
                           </select>
                           <div className="flex gap-2">
                              <Button type="button" variant="outline" onClick={savePrinter}>Save printer preference</Button>
                              <Button type="button" variant="secondary" onClick={testPrint} loading={testPrintRunning}>Test print</Button>
                           </div>
                           <p className="text-xs text-slate-500">Saved in this browser (localStorage). POS uses it after checkout.</p>
                        </div>
                       <Button onClick={saveInvoicePreferences} loading={updateCompany.isPending}>Save Preferences</Button>
                     </div>
                  </CardContent>
               )}

               {tab === 'items' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Item & Vocabulary Schema</h2>
                     <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-blue-800 text-sm">
                        <p className="font-semibold mb-1">Domain Translation Active</p>
                        Microtechnique Accounts automatically translates UI text based on your domain setup.
                     </div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                        <div>
                           <label className="text-sm font-medium text-slate-700">Default Item Name</label>
                          <Input
                            className="mt-1"
                            list="item-terminology-suggestions"
                            value={itemTerminologySingular}
                            onChange={(e) => setItemTerminologySingular(e.target.value)}
                            placeholder="e.g. Item, Product, Service"
                          />
                          <datalist id="item-terminology-suggestions">
                            <option value="Item" />
                            <option value="Product" />
                            <option value="Part" />
                            <option value="Medicine" />
                            <option value="Service" />
                            <option value="SKU" />
                          </datalist>
                          <p className="text-xs text-slate-500 mt-1">Type any word or pick a suggestion from the dropdown.</p>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-slate-700">Primary Default GST %</label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className="mt-1"
                            list="default-gst-suggestions"
                            value={defaultGstRate}
                            onChange={(e) => setDefaultGstRate(e.target.value)}
                            placeholder="18"
                          />
                          <datalist id="default-gst-suggestions">
                            <option value="0" />
                            <option value="5" />
                            <option value="12" />
                            <option value="18" />
                            <option value="28" />
                          </datalist>
                          <p className="text-xs text-slate-500 mt-1">Enter any whole number 0–100 or pick a suggestion (stored as integer).</p>
                        </div>
                     </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-slate-700">Plural label</label>
                        <Input value={itemTerminologyPlural} onChange={(e) => setItemTerminologyPlural(e.target.value)} className="mt-1 max-w-xs" />
                      </div>
                      <Button className="mt-1" onClick={applyItemSchema} loading={updateCompany.isPending}>Apply Schema</Button>
                    </div>
                  </CardContent>
               )}

               {tab === 'data' && (
                  <CardContent className="p-6 space-y-6">
                     <h2 className="text-xl font-bold">Data Management Flow</h2>
                     <input
                       ref={importFileRef}
                       type="file"
                       accept=".csv,.xlsx,.xls,.json"
                       className="hidden"
                       onChange={(e) => previewImportFile(e.target.files?.[0])}
                     />
                    <input
                      ref={tallyImportFileRef}
                      type="file"
                      accept=".json,.xml"
                      className="hidden"
                      onChange={(e) => importTally(e.target.files?.[0])}
                    />
                     <div className="grid md:grid-cols-2 gap-6">
                        <Card className="border-indigo-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-3"><Upload className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Import Legacy Data</h3>
                              <p className="text-sm text-slate-500 mb-4">Upload Item Masters or Customer ledgers via structured CSV.</p>
                              <div className="w-full space-y-2">
                                <Button variant="outline" className="w-full" onClick={downloadItemsTemplate} loading={templateDownloading}>Download item template</Button>
                                <Button variant="outline" className="w-full" onClick={() => importFileRef.current?.click()} disabled={importing}>
                                  {importing && !importPreview ? 'Reading file…' : 'Choose file to preview'}
                                </Button>
                              </div>
                              {importPreview?.preview && importPreview.preview.length > 0 && (
                                <div className="mt-4 text-left w-full rounded-lg border bg-white p-3 max-h-56 overflow-y-auto">
                                  <p className="text-xs font-semibold text-slate-700 mb-2">
                                    Preview: {importPreview.valid ?? importPreview.preview.length} valid row(s)
                                    {importPreview.invalid ? `, ${importPreview.invalid} invalid` : ''}
                                  </p>
                                  <ul className="text-xs text-slate-600 space-y-1">
                                    {importPreview.preview.slice(0, 12).map((p) => (
                                      <li key={p.row}>
                                        Row {p.row}: {(p.data as { name?: string })?.name || '—'}
                                      </li>
                                    ))}
                                  </ul>
                                  {importPreview.preview.length > 12 && (
                                    <p className="text-xs text-slate-400 mt-1">Showing first 12 rows…</p>
                                  )}
                                  <div className="flex gap-2 mt-3">
                                    <Button size="sm" onClick={confirmImportFile} loading={importing}>
                                      Import valid rows
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => { setImportPreview(null); pendingImportFile.current = null; }}>
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              )}
                           </CardContent>
                        </Card>
                        <Card className="border-emerald-100 shadow-sm">
                           <CardContent className="p-6 flex flex-col items-center text-center">
                              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-3"><Database className="w-6 h-6"/></div>
                              <h3 className="font-bold text-slate-900 mb-1">Export JSON / Tally DB</h3>
                              <p className="text-sm text-slate-500 mb-4">Push localized records to universal schemas.</p>
                              <Button variant="outline" className="w-full border-emerald-600 text-emerald-700" onClick={dumpData} loading={dataDumping}>Dump Data</Button>
                           </CardContent>
                        </Card>
                        <Card className="border-violet-100 shadow-sm">
                          <CardContent className="p-6 flex flex-col items-center text-center">
                            <div className="w-12 h-12 bg-violet-50 rounded-full flex items-center justify-center text-violet-600 mb-3"><FileText className="w-6 h-6"/></div>
                            <h3 className="font-bold text-slate-900 mb-1">Tally Data Bridge</h3>
                            <p className="text-sm text-slate-500 mb-4">Export entire company data for Tally and import Tally JSON/XML back.</p>
                            <div className="w-full space-y-2">
                              <Button variant="outline" className="w-full" onClick={() => exportTally('json')} loading={tallyExporting}>
                                <Download className="w-4 h-4 mr-2" /> Export Tally JSON
                              </Button>
                              <Button variant="outline" className="w-full" onClick={() => exportTally('xml')} loading={tallyExporting}>
                                <Download className="w-4 h-4 mr-2" /> Export Tally XML
                              </Button>
                              <Button variant="outline" className="w-full" onClick={() => tallyImportFileRef.current?.click()} disabled={tallyImporting}>
                                <Upload className="w-4 h-4 mr-2" /> {tallyImporting ? 'Importing...' : 'Import from Tally'}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                     </div>
                  </CardContent>
               )}

               {tab === 'danger' && (
                  <CardContent className="p-6 space-y-6">
                     <div className="flex items-center gap-2 text-red-600 mb-2">
                        <AlertCircle className="w-6 h-6"/>
                        <h2 className="text-xl font-bold">Danger Zone</h2>
                     </div>
                     <p className="text-slate-600 text-sm max-w-xl">
                        This marks the company as closed. Users will not be able to sign in to this workspace again. Operational data remains in the database for compliance backups — confirm with your IT policy before proceeding.
                     </p>
                     
                     <div className="bg-red-50 p-6 rounded-lg border border-red-200 mt-6 max-w-xl">
                        <h3 className="font-semibold text-red-900 mb-2">Are you fully sure?</h3>
                        <p className="text-sm text-red-700 mb-4">Type <strong>DELETE-MY-COMPANY</strong> exactly to confirm.</p>
                        <Input value={deleteConf} onChange={e => setDeleteConf(e.target.value)} className="border-red-300 focus-visible:ring-red-500 mb-4 bg-white" />
                        <Button
                           variant="destructive"
                           disabled={deleteConf !== 'DELETE-MY-COMPANY'}
                           loading={deleteWorkspace.isPending}
                           className="w-full gap-2"
                           onClick={() => deleteWorkspace.mutate()}
                        >
                           <Power className="w-4 h-4"/> Close workspace
                        </Button>
                     </div>
                  </CardContent>
               )}
            </Card>
         </div>
      </div>
    </div>
  );
}
