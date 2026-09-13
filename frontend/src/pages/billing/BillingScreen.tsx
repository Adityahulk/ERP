import { useState, useRef, useEffect, useMemo, useCallback, CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getApiBaseURL } from '@/lib/api';
import toast from 'react-hot-toast';
import { BarcodeScanner } from '@/components/shared/BarcodeScanner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Search, Loader2, Camera, Smartphone, Plus, Minus, Trash2, User, FileText, QrCode, PackagePlus, X, Check } from 'lucide-react';
import { QuickAddItemSheet } from '@/components/items/QuickAddItemSheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import { formatMoney } from '@/lib/formatters';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, STORAGE_KEYS } from '@/lib/storageKeys';
import { useCompany } from '@/hooks/useBusiness';
import { useAuthStore } from '@/store/authStore';
import ThermalReceipt from '@/components/shared/ThermalReceipt';
import { QRCodeSVG } from 'qrcode.react';
import { FixedSizeList as List } from 'react-window';
import { useGodowns } from '@/hooks/useStock';
import { printPdfBlob } from '@/lib/printPdf';
import { normalizeThermalSettings, thermalWidthMm } from '@/lib/thermalSettings';
import { calculatePosTotals, itemDiscountAmount, PosDiscountMode } from '@/lib/posBilling';

interface BillItem {
  item_id: string;
  name: string;
  sku: string;
  hsn_code: string;
  item_type?: string;
  track_inventory?: boolean;
  unit?: string;
  available_stock?: number;
  quantity: number;
  unit_price: number;
  gst_rate: number;
  cess_rate: number;
  price_includes_tax: boolean;
  discount_mode: PosDiscountMode;
  discount_value: number;
  discount_amount: number;
  // Computed for display
  taxable: number;
  tax: number;
  cess: number;
  total: number;
}

export default function BillingScreen() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // States
  const [searchQuery, setSearchQuery] = useState('');
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [billItems, setBillItems] = useState<BillItem[]>([]);
  const [customerInfo, setCustomerInfo] = useState<{ id?: string, name: string, phone?: string }>({ name: 'Walk-in Customer' });
  const [billDiscountMode, setBillDiscountMode] = useState<PosDiscountMode>('amount');
  const [billDiscountValue, setBillDiscountValue] = useState(0);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [amountTendered, setAmountTendered] = useState<number | ''>('');
  const [quickAddItemOpen, setQuickAddItemOpen] = useState(false);
  const [quickAddItemDefaultName, setQuickAddItemDefaultName] = useState('');
  const [companyBankAccountId, setCompanyBankAccountId] = useState('');
  const [lastCreatedInvoiceId, setLastCreatedInvoiceId] = useState<string | null>(null);
  const [completedInvoice, setCompletedInvoice] = useState<any>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const qc = useQueryClient();
  const [modalUpiId, setModalUpiId] = useState('');
  const [customUpiQr, setCustomUpiQr] = useState<string>(() => {
    return readStorageWithLegacy(STORAGE_KEYS.customUpiQr, LEGACY_STORAGE_KEYS.customUpiQr) || '';
  });

  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [mobileSessionId] = useState(() => 'pos-sess-' + Math.random().toString(36).substring(2, 15));
  const [isMobileConnected, setIsMobileConnected] = useState(false);
  const [showMobileConnectModal, setShowMobileConnectModal] = useState(false);
  const [serverIps, setServerIps] = useState<string[]>([]);
  const [selectedIp, setSelectedIp] = useState<string>('');
  const [selectedGodownId, setSelectedGodownId] = useState('');
  const lastProcessedScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const lookupBarcodeRef = useRef<(code: string, source?: string) => Promise<void>>(async () => undefined);
  const checkoutActionRef = useRef<() => void>(() => undefined);
  const confirmUpiActionRef = useRef<() => void>(() => undefined);
  
  const getQrUrl = () => {
    const hostname = window.location.hostname;
    // If not localhost or local IP, use origin as-is (e.g. cloud / dns production environment)
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.');
    if (!isLocal) {
      return `${window.location.origin}/pos-scan?session=${mobileSessionId}`;
    }
    
    // Otherwise construct local IP url
    const ip = selectedIp || hostname;
    const portStr = window.location.port ? `:${window.location.port}` : '';
    const protocol = window.location.protocol;
    return `${protocol}//${ip}${portStr}/pos-scan?session=${mobileSessionId}`;
  };

  const [editCustomerInfo, setEditCustomerInfo] = useState<{ id?: string; name: string; phone?: string }>({ name: '' });
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [partySearchResults, setPartySearchResults] = useState<any[]>([]);
  const [partySearchLoading, setPartySearchLoading] = useState(false);

  const searchParties = async (q: string) => {
    setPartySearchQuery(q);
    setEditCustomerInfo(prev => ({ ...prev, name: q }));
    if (q.length < 2) {
      setPartySearchResults([]);
      return;
    }
    setPartySearchLoading(true);
    try {
      const res = await api.get('/parties/search', { params: { q } });
      setPartySearchResults(res.data?.data || res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setPartySearchLoading(false);
    }
  };

  const selectParty = (p: any) => {
    setEditCustomerInfo({
      id: p.id,
      name: p.name,
      phone: p.phone || '',
    });
    setPartySearchResults([]);
    setPartySearchQuery(p.name);
  };

  const startEditingCustomer = () => {
    setEditCustomerInfo({
      id: customerInfo.id,
      name: customerInfo.name === 'Walk-in Customer' ? '' : customerInfo.name,
      phone: customerInfo.phone || '',
    });
    setPartySearchQuery(customerInfo.name === 'Walk-in Customer' ? '' : customerInfo.name);
    setPartySearchResults([]);
    setIsEditingCustomer(true);
  };

  const saveCustomerEdit = () => {
    const finalName = editCustomerInfo.name.trim() || 'Walk-in Customer';
    setCustomerInfo({
      id: editCustomerInfo.id,
      name: finalName,
      phone: editCustomerInfo.phone?.trim() || undefined,
    });
    setIsEditingCustomer(false);
  };

  const { data: companyData } = useCompany();
  const thermalSettings = useMemo(
    () => normalizeThermalSettings(companyData?.print_settings?.thermal),
    [companyData?.print_settings?.thermal],
  );
  const receiptWidthMm = thermalWidthMm(companyData?.print_settings?.thermal);
  const cartGridColumns = useMemo(() => [
    'minmax(10rem,1fr)',
    '8rem',
    thermalSettings.cashier_show_rate ? '6rem' : '',
    thermalSettings.cashier_show_discount ? '9rem' : '',
    thermalSettings.cashier_show_line_total ? '8rem' : '',
    '3rem',
  ].filter(Boolean).join(' '), [
    thermalSettings.cashier_show_discount,
    thermalSettings.cashier_show_line_total,
    thermalSettings.cashier_show_rate,
  ]);
  const { data: godownResponse } = useGodowns();
  const godowns = useMemo(() => godownResponse?.data ?? [], [godownResponse?.data]);

  useEffect(() => {
    if (selectedGodownId || !godowns.length) return;
    const preferred = godowns.find((g: any) => g.is_default) || godowns[0];
    if (preferred?.id) setSelectedGodownId(preferred.id);
  }, [godowns, selectedGodownId]);

  // Transaction Settings Fetching
  const { data: transactionConfig } = useQuery({
    queryKey: ['transaction-settings'],
    queryFn: () => api.get('/settings/transaction').then((r) => r.data?.data ?? r.data),
  });

  useEffect(() => {
    if (showQrModal) {
      const defaultUpi = transactionConfig?.settings?.defaultUpiId || companyData?.upi_id || '';
      setModalUpiId(defaultUpi);
      setCustomUpiQr(readStorageWithLegacy(STORAGE_KEYS.customUpiQr, LEGACY_STORAGE_KEYS.customUpiQr) || '');
    }
  }, [showQrModal, transactionConfig, companyData]);

  // Dynamic Height Observer for Virtualized Table
  const cartContainerRef = useRef<HTMLDivElement>(null);
  const [cartHeight, setCartHeight] = useState(400);

  useEffect(() => {
    if (!cartContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCartHeight(entry.contentRect.height);
      }
    });
    observer.observe(cartContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // Highlight Index for Search Dropdown Keyboard Navigation
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Search Results
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['billingSearch', searchQuery, selectedGodownId],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await api.post('/invoices/search-items', {
        q: searchQuery,
        godown_id: selectedGodownId || undefined,
      });
      return res.data?.data || [];
    },
    enabled: searchQuery.length >= 2 && Boolean(selectedGodownId),
    staleTime: 0,
  });

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchResults]);

  const handlePrintReceipt = useCallback(async (id: string) => {
    try {
      // Always print the receipt preview (thermal) in POS Billing rather than the standard A4 invoice
      const pdfRes = await api.get(`/print/receipt/${id}`, { params: { width: receiptWidthMm }, responseType: 'blob' });
      const receipt = new Blob([pdfRes.data], { type: 'application/pdf' });
      try {
        const mode = await printPdfBlob(receipt, {
          copies: thermalSettings.number_of_copies,
          autoCut: thermalSettings.auto_cut_paper,
          openCashDrawer: thermalSettings.open_cash_drawer,
        });
        toast.success(mode === 'direct' ? 'Receipt sent to thermal printer' : 'Receipt opened in print dialog');
      } catch (directError: any) {
        console.error('Direct receipt print failed, using browser print:', directError);
        await printPdfBlob(receipt, { direct: false });
        toast.error('Direct printer was unavailable. Receipt opened in the browser print dialog.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.error || 'Receipt PDF could not be generated');
    }
  }, [receiptWidthMm, thermalSettings.auto_cut_paper, thermalSettings.number_of_copies, thermalSettings.open_cash_drawer]);

  const handleConfirmUpiPayment = async () => {
    setShowQrModal(false);
    const dbDefault = transactionConfig?.settings?.defaultUpiId || companyData?.upi_id || '';
    if (modalUpiId.trim() && modalUpiId.trim() !== dbDefault) {
      try {
        await api.put('/settings/transaction', {
          ...transactionConfig?.settings,
          defaultUpiId: modalUpiId.trim()
        });
        qc.invalidateQueries({ queryKey: ['transaction-settings'] });
      } catch (err) {
        console.error("Failed to auto-save UPI ID to settings:", err);
      }
    }
    createInvoiceMut.mutate();
  };
  confirmUpiActionRef.current = () => { void handleConfirmUpiPayment(); };

  // Hotkeys & Scan Interception
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F2 to focus search
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      
      // Enter to simulate success when QR Modal is open
      if (e.key === 'Enter' && showQrModal) {
        e.preventDefault();
        confirmUpiActionRef.current();
        return;
      }
      
      // Ctrl + Enter or F10 to Checkout
      if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F10') {
        e.preventDefault();
        checkoutActionRef.current();
        return;
      }
      
      // Esc to Clear Cart / Close modals
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showQrModal) {
          setShowQrModal(false);
        } else if (completedInvoice) {
          setCompletedInvoice(null);
        } else {
          setBillItems([]);
          setSearchQuery('');
          setAmountTendered('');
          setBillDiscountMode('amount');
          setBillDiscountValue(0);
          toast.success('Cart cleared');
        }
        return;
      }
      
      // Ctrl + P to Print Invoice
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        if (completedInvoice) {
          handlePrintReceipt(completedInvoice.id);
        } else if (lastCreatedInvoiceId) {
          handlePrintReceipt(lastCreatedInvoiceId);
        } else {
          toast.error('No invoice available to print');
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [billItems, customerInfo, paymentMode, billDiscountMode, billDiscountValue, amountTendered, lastCreatedInvoiceId, showQrModal, completedInvoice, handlePrintReceipt]);

  // Ref to always access the latest addItem function in event listeners
  const addItemRef = useRef<any>(null);
  addItemRef.current = addItem;

  useEffect(() => {
    lookupBarcodeRef.current = async (rawCode: string, source = 'Scanner') => {
      const code = String(rawCode || '').trim();
      if (!code) return;
      const now = Date.now();
      if (lastProcessedScanRef.current.code === code && now - lastProcessedScanRef.current.at < 400) {
        return;
      }
      lastProcessedScanRef.current = { code, at: now };
      try {
        const res = await api.get(`/items/barcode/${encodeURIComponent(code)}`, {
          params: { godown_id: selectedGodownId || undefined },
        });
        const item = res.data?.data || res.data;
        if (!item) throw new Error('Item not found');
        addItemRef.current?.(item);
        setSearchQuery('');
        toast.success(`${source}: ${item.name}`);
      } catch (err: any) {
        toast.error(err.response?.data?.error || `Barcode not found: ${code}`);
      }
    };
  }, [selectedGodownId]);

  // USB Barcode Scanner global keyboard intercept
  useEffect(() => {
    let buffer = '';
    let firstKeyTime = 0;
    let lastKeyTime = 0;

    const reset = () => {
      buffer = '';
      firstKeyTime = 0;
      lastKeyTime = 0;
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const currentTime = Date.now();
      if (e.key === 'Enter' || e.key === 'Tab') {
        const elapsed = firstKeyTime ? currentTime - firstKeyTime : Number.POSITIVE_INFINITY;
        const averageGap = buffer.length > 1 ? elapsed / (buffer.length - 1) : elapsed;
        if (buffer.length >= 3 && elapsed <= 2_500 && averageGap <= 120) {
          e.preventDefault();
          e.stopPropagation();
          const code = buffer.trim();
          reset();
          void lookupBarcodeRef.current(code, 'Scanned');
          return;
        }
        reset();
        return;
      }

      if (e.key.length === 1) {
        if (!firstKeyTime || currentTime - lastKeyTime > 120) {
          buffer = '';
          firstKeyTime = currentTime;
        }
        buffer += e.key;
        lastKeyTime = currentTime;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  // SSE Mobile Scanner Connection Listener
  useEffect(() => {
    const apiBase = getApiBaseURL();
    const absoluteApiBase = apiBase.startsWith('http') ? apiBase : `${window.location.origin}${apiBase}`;
    const registerUrl = `${absoluteApiBase}/pos-scanner/register/${mobileSessionId}`;
    
    const eventSource = new EventSource(registerUrl);
    
    eventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'connected') {
          setIsMobileConnected(true);
        } else if (data.barcode) {
          void lookupBarcodeRef.current(data.barcode, 'Mobile scan');
        }
      } catch (err) {
        console.error('Error processing mobile scan event:', err);
      }
    };
    
    eventSource.onerror = () => {
      setIsMobileConnected(false);
    };
    
    return () => {
      eventSource.close();
    };
  }, [mobileSessionId]);

  // Fetch local IPs when the mobile connect modal is opened
  useEffect(() => {
    if (showMobileConnectModal) {
      api.get('/pos-scanner/ips')
        .then(res => {
          const ips = res.data?.data || res.data || [];
          setServerIps(ips);
          if (ips.length > 0 && !selectedIp) {
            setSelectedIp(ips[0]);
          }
        })
        .catch(err => {
          console.error('Failed to get server IPs:', err);
        });
    }
  }, [showMobileConnectModal, selectedIp]);

  // Handle hardware barcode scan / lookup via GET /api/items/barcode/:code
  const handleSearchKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchResults && searchResults.length > 0) {
        setHighlightedIndex(prev => (prev + 1) % searchResults.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchResults && searchResults.length > 0) {
        setHighlightedIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults && searchResults.length > 0) {
        addItem(searchResults[highlightedIndex]);
        setSearchQuery('');
        return;
      }
      if (searchQuery) {
        await lookupBarcodeRef.current(searchQuery, 'Added');
      }
    }
  };

  function addItem(item: any) {
    setBillItems(prev => {
      const existing = prev.find(i => i.item_id === item.id);
      const tracked = item.track_inventory !== false && item.item_type !== 'service';
      const available = item.available_stock == null && item.total_stock == null
        ? undefined
        : Number(item.available_stock ?? item.total_stock ?? 0);
      if (existing) {
        if (tracked && available != null && existing.quantity + 1 > available) {
          toast.error(`Only ${available} ${item.unit || 'units'} available for ${item.name}`);
          return prev;
        }
        return prev.map(i => i.item_id === item.id ? updateCommputed({ ...i, quantity: i.quantity + 1 }) : i);
      }
      if (tracked && available != null && available < 1) {
        toast.error(`${item.name} is out of stock in the selected godown`);
        return prev;
      }
      const gstRate = Math.max(0, Number(item.gst_rate) || 0);
      const cessRate = Math.max(0, Number(item.cess_rate) || 0);
      const priceIncludesTax = item.selling_price_includes_tax === true;
      const storedExclusivePrice = Math.max(0, Number(item.unit_price ?? item.selling_price) || 0);
      const displayUnitPrice = priceIncludesTax
        ? Math.round(storedExclusivePrice * (1 + (gstRate + cessRate) / 100))
        : storedExclusivePrice;
      return [...prev, updateCommputed({
        item_id: item.id,
        name: item.name,
        sku: item.sku,
        hsn_code: item.hsn_code,
        item_type: item.item_type,
        track_inventory: item.track_inventory,
        unit: item.unit || item.unit_name || 'PCS',
        available_stock: available,
        quantity: 1,
        unit_price: displayUnitPrice,
        gst_rate: gstRate,
        cess_rate: cessRate,
        price_includes_tax: priceIncludesTax,
        discount_mode: 'amount',
        discount_value: 0,
        discount_amount: 0,
        taxable: 0,
        tax: 0,
        cess: 0,
        total: 0
      })];
    });
  };

  const updateItem = (index: number, changes: Partial<BillItem>) => {
    const newItems = [...billItems];
    const current = newItems[index];
    if (changes.quantity != null && current.track_inventory !== false && current.item_type !== 'service') {
      const requested = Math.max(0.001, Number(changes.quantity) || 1);
      if (current.available_stock != null && requested > current.available_stock) {
        toast.error(`Only ${current.available_stock} ${current.unit || 'units'} available for ${current.name}`);
        changes = { ...changes, quantity: current.available_stock };
      }
    }
    if (changes.unit_price != null) changes = { ...changes, unit_price: Math.max(0, Number(changes.unit_price) || 0) };
    const merged = { ...newItems[index], ...changes };
    if (changes.discount_amount != null && changes.discount_value == null) {
      merged.discount_mode = 'amount';
      merged.discount_value = Math.max(0, Number(changes.discount_amount) || 0);
    }
    merged.discount_value = merged.discount_mode === 'percent'
      ? Math.max(0, Math.min(100, Number(merged.discount_value) || 0))
      : Math.max(0, Math.round(Number(merged.discount_value) || 0));
    newItems[index] = updateCommputed(merged);
    setBillItems(newItems);
  };

  const changeItemDiscountMode = (index: number, mode: PosDiscountMode) => {
    const item = billItems[index];
    if (!item || item.discount_mode === mode) return;
    const gross = Math.max(0, item.unit_price * item.quantity);
    const value = mode === 'percent'
      ? (gross > 0 ? Math.round(item.discount_amount * 10_000 / gross) / 100 : 0)
      : item.discount_amount;
    updateItem(index, { discount_mode: mode, discount_value: value });
  };

  const updateCommputed = (item: BillItem) => {
    const base = item.unit_price * item.quantity;
    item.discount_amount = itemDiscountAmount(item);
    const afterDiscount = Math.max(0, base - item.discount_amount);
    const totalRate = item.gst_rate + item.cess_rate;
    item.taxable = item.price_includes_tax && totalRate > 0
      ? Math.round(afterDiscount / (1 + totalRate / 100))
      : afterDiscount;
    const combinedTax = item.price_includes_tax
      ? afterDiscount - item.taxable
      : Math.round(item.taxable * totalRate / 100);
    item.tax = totalRate > 0 ? Math.round(combinedTax * item.gst_rate / totalRate) : 0;
    item.cess = combinedTax - item.tax;
    item.total = item.taxable + item.tax + item.cess;
    return item;
  };

  // Computations
  const roundOffEnabled = transactionConfig?.settings?.roundOffTotal !== false;
  const configuredRoundTo = Number(transactionConfig?.settings?.roundOffTo);
  const roundOffTo: 1 | 10 | 100 = configuredRoundTo === 10 || configuredRoundTo === 100 ? configuredRoundTo : 1;
  const configuredRoundMode = transactionConfig?.settings?.roundOffType;
  const roundMode: 'NEAREST' | 'FLOOR' | 'CEIL' = configuredRoundMode === 'FLOOR' || configuredRoundMode === 'CEIL'
    ? configuredRoundMode
    : 'NEAREST';
  const posTotals = useMemo(() => calculatePosTotals(
    billItems,
    billDiscountMode,
    billDiscountValue,
    roundOffEnabled,
    roundMode,
    roundOffTo,
  ), [billItems, billDiscountMode, billDiscountValue, roundOffEnabled, roundMode, roundOffTo]);
  const subtotal = posTotals.subtotal;
  const itemDiscounts = posTotals.itemDiscount;
  const discountTotal = posTotals.billDiscount;
  const taxable = posTotals.taxable;
  const totalTax = posTotals.gst;
  const totalCess = posTotals.cess;
  const grandTotal = posTotals.total;
  const roundOff = posTotals.roundOff;

  const changeBillDiscountMode = (mode: PosDiscountMode) => {
    if (billDiscountMode === mode) return;
    const nextValue = mode === 'percent'
      ? (posTotals.billDiscountBase > 0
          ? Math.round(discountTotal * 10_000 / posTotals.billDiscountBase) / 100
          : 0)
      : discountTotal;
    setBillDiscountMode(mode);
    setBillDiscountValue(nextValue);
  };

  // Submit Pipeline
  const createInvoiceMut = useMutation({
    mutationFn: async () => {
      const itemsPayload = billItems.map((b) => ({
        item_id: b.item_id,
        item_name: b.name,
        hsn_code: b.hsn_code,
        unit: b.unit || 'PCS',
        quantity: b.quantity,
        unit_price: b.unit_price,
        gst_rate: b.gst_rate,
        cess_rate: b.cess_rate,
        price_includes_tax: b.price_includes_tax,
        discount_amount: b.discount_mode === 'amount' ? b.discount_amount : 0,
        discount_percent: b.discount_mode === 'percent' ? b.discount_value : 0,
      }));
      const tenderPaise =
        paymentMode === 'credit'
          ? 0
          : amountTendered === ''
            ? grandTotal
            : Math.round(Number(amountTendered) * 100);
      const paidPaise = paymentMode === 'credit' ? 0 : Math.min(grandTotal, Math.max(0, tenderPaise));
      const payments = paidPaise > 0 ? [{
        amount: paidPaise,
        payment_mode: paymentMode,
      }] : [];
      const payload: Record<string, unknown> = {
        invoice_type: 'tax_invoice',
        is_gst_invoice: true,
        is_interstate: false,
        transaction_source: 'pos',
        godown_id: selectedGodownId,
        items: itemsPayload,
        discount_amount: discountTotal,
        discount_type: discountTotal > 0 ? (billDiscountMode === 'percent' ? 'percent' : 'flat') : 'none',
        discount_value: billDiscountMode === 'percent' ? billDiscountValue : discountTotal,
        round_off_enabled: roundOffEnabled,
        payments,
        amount_paid: paidPaise,
        payment_mode: paymentMode,
        party_name: customerInfo.name,
        party_phone: customerInfo.phone || undefined,
        custom_fields: {
          pos: {
            tendered_amount: tenderPaise,
            change_amount: Math.max(0, tenderPaise - grandTotal),
            bill_discount_mode: billDiscountMode,
            bill_discount_value: billDiscountValue,
          },
        },
      };
      if (customerInfo.id) payload.party_id = customerInfo.id;
      if (companyBankAccountId) payload.company_bank_account_id = companyBankAccountId;
      return api.post('/invoices', payload);
    },
    onSuccess: async (res) => {
      toast.success('Bill Confirmed!');
      const inv = res.data?.data ?? res.data;
      const id = inv?.id;
      
      // Snapshot billItems NOW before clearing — the API response does not
      // include line items, so we embed the cart items into completedInvoice
      // so ThermalReceipt can display them correctly.
      const itemsSnapshot = billItems.map((b) => ({
        item_name: b.name,
        name: b.name,
        quantity: b.quantity,
        unit_price: b.unit_price,
        total_amount: b.total,
        total: b.total,
        gst_rate: b.gst_rate,
        cess_rate: b.cess_rate,
        price_includes_tax: b.price_includes_tax,
        discount_amount: b.discount_amount,
        hsn_code: b.hsn_code,
      }));

      setLastCreatedInvoiceId(id);
      const tenderPaise =
        paymentMode === 'credit'
          ? 0
          : amountTendered === ''
            ? grandTotal
            : Math.round(Number(amountTendered) * 100);
      setCompletedInvoice({
        ...inv,
        items: itemsSnapshot,
        paid_amount: paymentMode === 'credit' ? 0 : Math.min(grandTotal, Math.max(0, tenderPaise)),
        tendered_amount: tenderPaise,
        change_amount: Math.max(0, tenderPaise - grandTotal),
      });
      
      setBillItems([]);
      setSearchQuery('');
      setAmountTendered('');
      setBillDiscountMode('amount');
      setBillDiscountValue(0);
      setCustomerInfo({ name: 'Walk-in Customer' });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['billingSearch'] });
      searchInputRef.current?.focus();

      const directPrint = readStorageWithLegacy(
        STORAGE_KEYS.directThermalPrint,
        LEGACY_STORAGE_KEYS.directThermalPrint,
      ) === 'true';
      if (id && directPrint) {
        void handlePrintReceipt(id);
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to generate bill')
  });

  const handleCheckout = () => {
    if (billItems.length === 0) return toast.error('Bill is empty');
    if (!selectedGodownId && billItems.some((item) => item.track_inventory !== false && item.item_type !== 'service')) {
      return toast.error('Select a godown before billing stock items');
    }
    if (paymentMode === 'upi') {
      setShowQrModal(true);
    } else {
      createInvoiceMut.mutate();
    }
  };
  checkoutActionRef.current = handleCheckout;

  return (
    <div className="h-[calc(100vh-7.5rem)] overflow-hidden flex flex-col gap-3">
      <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0">
        {/* Left Column - POS Items */}
        <div className="flex-1 flex flex-col bg-background border rounded-xl overflow-hidden shadow-sm shadow-black/5 min-h-0">
          
          {/* Search Bar Segment */}
          <div className="p-3 border-b flex gap-2 items-center bg-muted/20 relative z-30">
            <select
              value={selectedGodownId}
              onChange={(event) => {
                const next = event.target.value;
                if (next === selectedGodownId) return;
                if (billItems.length) {
                  setBillItems([]);
                  toast.success('Cart cleared because the billing godown changed');
                }
                setSelectedGodownId(next);
                setSearchQuery('');
              }}
              className="h-12 max-w-[180px] rounded-md border bg-background px-3 text-sm font-medium"
              aria-label="Billing godown"
              title="Stock will be deducted from this godown"
            >
              <option value="">Select godown</option>
              {godowns.map((godown: any) => (
                <option key={godown.id} value={godown.id}>
                  {godown.name}{godown.is_default ? ' (Default)' : ''}
                </option>
              ))}
            </select>
            <div className="relative flex-1 z-40">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                ref={searchInputRef}
                autoFocus
                placeholder="Start typing or scan barcode (F2)"
                className="pl-9 bg-background font-medium text-lg h-12 shadow-inner"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyPress}
              />
              {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              
              {/* Search Dropdown Overlay */}
              {searchQuery.length >= 2 && searchResults && searchResults.length > 0 && (
                <div className="absolute top-14 left-0 right-0 max-h-64 overflow-y-auto bg-popover border shadow-2xl rounded-lg z-50 flex flex-col">
                  {searchResults.map((item: any, idx: number) => (
                    <button 
                      key={item.id} 
                      className={`flex justify-between items-center p-3 hover:bg-muted text-left border-b last:border-0 ${
                        idx === highlightedIndex ? 'bg-muted/80 ring-2 ring-primary/20 font-semibold' : ''
                      }`}
                      onClick={() => { addItem(item); setSearchQuery(''); searchInputRef.current?.focus(); }}
                    >
                      <div>
                        <div className="font-bold">{item.name}</div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                          <span>SKU: {item.sku}</span>
                          {thermalSettings.cashier_show_tax && <span>GST: {item.gst_rate}%</span>}
                        </div>
                      </div>
                      {(thermalSettings.cashier_show_rate || thermalSettings.cashier_show_stock) && <div className="text-right">
                        {thermalSettings.cashier_show_rate && <div className="font-bold text-primary">{formatMoney(item.unit_price)}</div>}
                        {thermalSettings.cashier_show_stock && (item.item_type === 'service' ? (
                          <div className="text-xs text-muted-foreground">Service</div>
                        ) : (
                          <div className="text-xs text-muted-foreground">In Stock: {item.available_stock}</div>
                        ))}
                      </div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {thermalSettings.cashier_show_rate && <Button
              size="lg"
              variant="outline"
              className="h-12 px-3 shrink-0 gap-1.5"
              type="button"
              onClick={() => {
                setQuickAddItemDefaultName(searchQuery.trim());
                setQuickAddItemOpen(true);
              }}
              title="Add item to catalog and bill"
            >
              <PackagePlus className="h-5 w-5" />
              <span className="hidden sm:inline text-sm font-medium">Add item</span>
            </Button>}
            <Button size="lg" variant="secondary" className="h-12 w-12 px-0 shrink-0" onClick={() => setScannerOpen(true)}>
              <Camera className="h-5 w-5" />
            </Button>
            <Button 
              size="lg" 
              variant="secondary" 
              className={`h-12 w-12 px-0 shrink-0 relative ${isMobileConnected ? 'border-2 border-emerald-500 bg-emerald-50/10' : ''}`}
              onClick={() => setShowMobileConnectModal(true)}
              title="Connect Phone as Wireless Barcode Scanner"
            >
              <Smartphone className={`h-5.5 w-5.5 ${isMobileConnected ? 'text-emerald-500' : 'text-muted-foreground'}`} />
              {isMobileConnected && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              )}
            </Button>
          </div>

          {/* Bill Render Header */}
          <div className="grid bg-muted py-3 px-4 text-sm font-semibold sticky top-0 z-0 border-b" style={{ gridTemplateColumns: cartGridColumns }}>
            <div>Item</div>
            <div className="text-center">Qty</div>
            {thermalSettings.cashier_show_rate && <div className="text-right">Rate</div>}
            {thermalSettings.cashier_show_discount && <div className="text-right">Disc</div>}
            {thermalSettings.cashier_show_line_total && <div className="text-right">Total</div>}
            <div></div>
          </div>

          {/* Bill Render Scroll Container */}
          <div ref={cartContainerRef} className="flex-1 overflow-hidden min-h-0 bg-background relative">
            {billItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/60 space-y-4">
                <QrCode className="h-24 w-24 opacity-20" />
                <p className="font-medium text-lg">Scan items to begin billing</p>
              </div>
            ) : (
              <List
                height={cartHeight}
                itemCount={billItems.length}
                itemSize={64}
                width="100%"
              >
                {({ index, style }: { index: number; style: CSSProperties }) => {
                  const item = billItems[index];
                  return (
                    <div style={{ ...style, gridTemplateColumns: cartGridColumns }} className="grid items-center border-b hover:bg-muted/50 py-2 px-4 transition-colors">
                      <div>
                        <div className="font-bold truncate max-w-[200px]">{item.name}</div>
                        {(thermalSettings.cashier_show_tax || thermalSettings.cashier_show_stock) && <div className="text-xs text-muted-foreground">
                          {thermalSettings.cashier_show_tax ? `GST ${item.gst_rate}%` : ''}
                          {thermalSettings.cashier_show_stock && item.available_stock != null && item.track_inventory !== false
                            ? `${thermalSettings.cashier_show_tax ? ' · ' : ''}Stock ${item.available_stock} ${item.unit || ''}`
                            : ''}
                        </div>}
                      </div>
                      <div className="flex items-center justify-center bg-background border rounded-md overflow-hidden shadow-sm max-w-[100px] mx-auto">
                        <button className="px-2 py-1 hover:bg-muted" onClick={() => updateItem(index, { quantity: Math.max(1, item.quantity - 1) })}><Minus className="h-3 w-3"/></button>
                        <Input 
                          type="number"
                          min="0.001"
                          step="any"
                          value={item.quantity} 
                          onChange={e => updateItem(index, { quantity: Number(e.target.value) || 1 })} 
                          className="w-10 h-8 text-center border-0 p-0 focus-visible:ring-0" 
                        />
                        <button className="px-2 py-1 hover:bg-muted" onClick={() => updateItem(index, { quantity: item.quantity + 1 })}><Plus className="h-3 w-3"/></button>
                      </div>
                      {thermalSettings.cashier_show_rate && <div className="text-right">
                        <Input 
                          value={item.unit_price / 100} 
                          onChange={e => updateItem(index, { unit_price: Math.round(Number(e.target.value) * 100) })} 
                          className="h-8 w-20 text-right ml-auto px-1" 
                        />
                      </div>}
                      {thermalSettings.cashier_show_discount && <div className="text-right">
                        <div className="flex h-8 items-stretch justify-end overflow-hidden rounded-md border bg-background">
                          <select
                            value={item.discount_mode}
                            onChange={(event) => changeItemDiscountMode(index, event.target.value as PosDiscountMode)}
                            className="w-12 border-0 border-r bg-muted px-1 text-xs font-semibold outline-none"
                            aria-label={`Discount type for ${item.name}`}
                            title="Choose amount or percentage discount"
                          >
                            <option value="amount">Amt</option>
                            <option value="percent">%</option>
                          </select>
                          <Input
                            type="number"
                            min="0"
                            max={item.discount_mode === 'percent' ? 100 : undefined}
                            step={item.discount_mode === 'percent' ? '0.01' : '0.01'}
                            value={item.discount_mode === 'percent' ? item.discount_value : item.discount_value / 100}
                            onChange={(event) => updateItem(index, {
                              discount_value: item.discount_mode === 'percent'
                                ? Number(event.target.value)
                                : Math.round(Number(event.target.value) * 100),
                            })}
                            className="h-8 w-20 rounded-none border-0 px-1 text-right focus-visible:ring-0"
                            aria-label={`Discount value for ${item.name}`}
                          />
                        </div>
                      </div>}
                      {thermalSettings.cashier_show_line_total && <div className="text-right font-bold tabular-nums">
                        {formatMoney(item.total)}
                      </div>}
                      <div className="text-right">
                        <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 hover:bg-destructive/10"
                          onClick={() => setBillItems(prev => prev.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  );
                }}
              </List>
            )}
          </div>
          
          {/* Helper footer */}
          <div className="p-3 bg-muted border-t text-xs text-muted-foreground flex justify-between">
            <span>Items: {billItems.length}</span>
            <span>Press <b>Del</b> on selected row to remove | Switch between inputs with <b>Tab</b></span>
          </div>
        </div>

      {/* Right Column - Summary & Execution */}
      <div className="w-full lg:w-[380px] flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
        
        {/* Customer Block */}
        <Card className="p-3 shadow-sm border-2 border-transparent focus-within:border-primary/50 transition-colors shrink-0 relative">
          <div className="flex items-start justify-between mb-1.5">
            <h3 className="font-semibold text-sm flex items-center gap-1.5 text-muted-foreground">
              <User className="h-4 w-4" /> Customer Details
            </h3>
            {!isEditingCustomer && (
              <Button
                variant="link"
                className="h-auto p-0 border-b leading-tight text-xs"
                onClick={startEditingCustomer}
              >
                Change
              </Button>
            )}
          </div>
          
          {isEditingCustomer ? (
            <div className="space-y-3 mt-1">
              <div className="relative">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Name</label>
                <div className="relative">
                  <Input
                    placeholder="Search or enter customer name"
                    value={partySearchQuery}
                    onChange={(e) => searchParties(e.target.value)}
                    className="h-9 mt-0.5 animate-in fade-in-50 duration-100"
                  />
                  {partySearchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>

                {partySearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-40 overflow-y-auto rounded-lg border bg-popover shadow-xl border-slate-200 dark:border-slate-800">
                    {partySearchResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted border-b last:border-0 flex flex-col"
                        onClick={() => selectParty(p)}
                      >
                        <span className="font-semibold text-foreground">{p.name}</span>
                        {p.phone && <span className="text-[10px] text-muted-foreground">Ph: {p.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Phone</label>
                <Input
                  placeholder="Enter phone number"
                  value={editCustomerInfo.phone || ''}
                  onChange={(e) => setEditCustomerInfo(prev => ({ ...prev, phone: e.target.value }))}
                  className="h-9 mt-0.5"
                  type="tel"
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 text-xs gap-1"
                  onClick={() => setIsEditingCustomer(false)}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-8 px-2.5 text-xs gap-1 bg-primary text-primary-foreground"
                  onClick={saveCustomerEdit}
                >
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xl font-bold text-foreground">{customerInfo.name}</div>
              {customerInfo.phone && (
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                  Ph: {customerInfo.phone}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Calculation Board */}
        <Card className="p-4 flex-1 shadow-sm flex flex-col min-h-0">
          <h3 className="font-semibold text-sm flex items-center gap-1.5 mb-3 border-b pb-1.5 text-muted-foreground"><FileText className="h-4 w-4" /> Bill Summary</h3>

          {thermalSettings.cashier_show_discount && (
            <div className="mb-3 rounded-md border bg-muted/20 p-2.5">
              <label className="mb-1.5 block text-[10px] font-semibold uppercase text-muted-foreground">
                Discount on total bill
              </label>
              <div className="grid grid-cols-[7rem_1fr] gap-2">
                <select
                  value={billDiscountMode}
                  onChange={(event) => changeBillDiscountMode(event.target.value as PosDiscountMode)}
                  className="h-9 rounded-md border bg-background px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label="Total bill discount type"
                >
                  <option value="amount">Amount</option>
                  <option value="percent">Percentage</option>
                </select>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max={billDiscountMode === 'percent' ? 100 : undefined}
                    step="0.01"
                    value={billDiscountMode === 'percent' ? billDiscountValue : billDiscountValue / 100}
                    onChange={(event) => setBillDiscountValue(
                      billDiscountMode === 'percent'
                        ? Math.max(0, Math.min(100, Number(event.target.value) || 0))
                        : Math.max(0, Math.round((Number(event.target.value) || 0) * 100)),
                    )}
                    className="h-9 pr-8 text-right font-semibold"
                    aria-label="Total bill discount value"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                    {billDiscountMode === 'percent' ? '%' : 'INR'}
                  </span>
                </div>
              </div>
              {discountTotal > 0 && (
                <div className="mt-1.5 text-right text-xs font-medium text-emerald-700">
                  Applied: -{formatMoney(discountTotal)}
                </div>
              )}
            </div>
          )}
          
          {thermalSettings.cashier_show_bill_breakdown && <div className="space-y-2 flex-1 overflow-y-auto text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatMoney(thermalSettings.cashier_show_tax ? subtotal : grandTotal)}
              </span>
            </div>
            {thermalSettings.cashier_show_tax && itemDiscounts > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Item Level Discount</span>
                <span className="tabular-nums font-medium">-{formatMoney(itemDiscounts)}</span>
              </div>
            )}
            {thermalSettings.cashier_show_tax && discountTotal > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Bill Discount{billDiscountMode === 'percent' ? ` (${billDiscountValue}%)` : ''}</span>
                <span className="tabular-nums font-medium">-{formatMoney(discountTotal)}</span>
              </div>
            )}
            {thermalSettings.cashier_show_tax && <div className="flex justify-between text-muted-foreground">
              <span>Taxable Value</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(taxable)}</span>
            </div>}
            
            {thermalSettings.cashier_show_tax && <div className="flex justify-between border-l-2 border-primary/20 pl-3 py-0.5 text-xs bg-muted/30">
              <span className="text-muted-foreground">CGST</span>
              <span className="tabular-nums">{formatMoney(Math.ceil(totalTax / 2))}</span>
            </div>}
            {thermalSettings.cashier_show_tax && <div className="flex justify-between border-l-2 border-primary/20 pl-3 py-0.5 text-xs bg-muted/30">
              <span className="text-muted-foreground">SGST</span>
              <span className="tabular-nums">{formatMoney(Math.floor(totalTax / 2))}</span>
            </div>}
            {thermalSettings.cashier_show_tax && totalCess > 0 && (
              <div className="flex justify-between border-l-2 border-primary/20 pl-3 py-0.5 text-xs bg-muted/30">
                <span className="text-muted-foreground">Cess</span>
                <span className="tabular-nums">{formatMoney(totalCess)}</span>
              </div>
            )}

            {thermalSettings.cashier_show_tax && <div className="flex justify-between text-muted-foreground">
              <span>Round Off</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(roundOff)}</span>
            </div>}
          </div>}

          <div className="mt-3 pt-3 border-t-2 border-dashed shrink-0">
             <div className="flex justify-between items-end">
              <span className="text-xl font-black">TOTAL</span>
              <span className="text-3xl font-black tabular-nums text-primary tracking-tight">{formatMoney(grandTotal)}</span>
             </div>
          </div>
        </Card>

        <Card className="p-3 shadow-sm shrink-0">
          <BankAccountPicker value={companyBankAccountId} onChange={setCompanyBankAccountId} />
        </Card>

        {/* Payment & Checkout Action */}
        <Card className="p-3 shadow-sm border-2 border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/20 shrink-0">
          <div className="mb-3">
             <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">Payment Mode</label>
             <div className="flex gap-1.5 mb-3">
                {['cash', 'upi', 'card', 'credit'].map(mode => (
                  <button 
                    key={mode}
                    onClick={() => setPaymentMode(mode)}
                    className={`flex-1 capitalize py-1.5 rounded-lg font-bold text-xs transition-all border
                      ${paymentMode === mode ? 'bg-primary border-primary text-primary-foreground shadow-sm' : 'bg-background hover:bg-muted text-muted-foreground'}`}
                  >
                    {mode}
                  </button>
                ))}
             </div>
             
             {paymentMode !== 'credit' && (
               <div className="flex gap-1.5 items-center mb-1">
                 <Input 
                   type="number"
                   placeholder="Amount Tendered" 
                   className="h-10 text-base font-bold"
                   value={amountTendered}
                   onChange={e => setAmountTendered(e.target.value ? Number(e.target.value) : '')}
                 />
                 <Button variant="outline" className="h-10 text-xs whitespace-nowrap" onClick={() => setAmountTendered(grandTotal / 100)}>EXACT</Button>
               </div>
             )}
          </div>
          
          <Button
            className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-600/10"
            onClick={handleCheckout}
            loading={createInvoiceMut.isPending}
          >
            Confirm & Print [F10]
          </Button>
        </Card>

      </div>
      </div>

      <BarcodeScanner 
        isOpen={isScannerOpen} 
        onClose={() => setScannerOpen(false)} 
        onScan={(code) => {
           void lookupBarcodeRef.current(code, 'Camera scan');
        }} 
      />

      <QuickAddItemSheet
        open={quickAddItemOpen}
        onOpenChange={setQuickAddItemOpen}
        defaultName={quickAddItemDefaultName}
        onCreated={(row) => {
          addItem({
            id: row.id,
            name: row.name as string,
            sku: String(row.sku ?? ''),
            hsn_code: String(row.hsn_code ?? ''),
            item_type: String(row.item_type ?? 'product'),
            track_inventory: row.track_inventory !== false,
            unit_price: Number(row.selling_price ?? 0),
            gst_rate: Number(row.gst_rate ?? 0),
            cess_rate: Number(row.cess_rate ?? 0),
            selling_price_includes_tax: row.selling_price_includes_tax === true,
            unit: String(row.unit ?? row.unit_name ?? 'PCS'),
            available_stock: row.track_inventory === false
              ? undefined
              : Number(row.opening_stock ?? 0),
          });
        }}
      />

      {/* QR Payment Modal */}
      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl p-5 max-w-sm w-full border border-slate-200 dark:border-slate-800 text-center animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-1">Scan & Pay (UPI)</h3>
            <p className="text-xs text-slate-500 mb-3 font-sans">Simulating India UPI/Razorpay Payment Verification</p>
            
            <div className="flex flex-col items-center bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border mb-4 border-slate-200 dark:border-slate-800 w-full">
              <span className="text-2xl font-black text-primary tabular-nums mb-3">{formatMoney(grandTotal)}</span>
              
              {/* UPI ID Input field inside the QR payment modal */}
              <div className="w-full mb-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide block mb-1 text-left">
                  UPI ID (VPA)
                </label>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Enter UPI ID (e.g. name@bank)"
                    value={modalUpiId}
                    onChange={(e) => setModalUpiId(e.target.value)}
                    className="h-9 text-xs font-semibold bg-background"
                  />
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-9 text-[10px] px-2.5 shrink-0" 
                    onClick={async () => {
                      if (!modalUpiId.trim()) return toast.error("Please enter a valid UPI ID");
                      try {
                        await api.put('/settings/transaction', {
                          ...transactionConfig?.settings,
                          defaultUpiId: modalUpiId.trim()
                        });
                        toast.success("UPI ID saved as default!");
                        qc.invalidateQueries({ queryKey: ['transaction-settings'] });
                      } catch (err: any) {
                        toast.error(err.response?.data?.error || "Failed to save UPI ID");
                      }
                    }}
                    title="Save as default in settings"
                  >
                    Save Default
                  </Button>
                </div>
              </div>

              {/* Custom or Generated QR Code */}
              <div className="w-full mb-3 border-t pt-3 flex flex-col items-center">
                {customUpiQr ? (
                  <div className="flex flex-col items-center gap-1.5 w-full">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Custom QR Code Active</span>
                    <img src={customUpiQr} className="w-full max-h-[280px] object-contain border bg-white p-2 rounded-xl shadow-sm" />
                    {modalUpiId.trim() && (
                      <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mt-1 font-mono truncate max-w-[280px]">VPA: {modalUpiId}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center w-full">
                    {modalUpiId.trim() ? (
                      <div className="flex flex-col items-center gap-1.5 w-full">
                        <QRCodeSVG 
                          value={`upi://pay?pa=${encodeURIComponent(modalUpiId.trim())}&pn=${encodeURIComponent(companyData?.name || '')}&am=${(grandTotal / 100).toFixed(2)}&cu=INR`}
                          size={160}
                          className="w-40 h-40 border bg-white p-2 rounded-lg shadow-sm"
                        />
                        <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mt-1.5 font-mono truncate max-w-[280px]">VPA: {modalUpiId}</span>
                      </div>
                    ) : (
                      <div className="p-4 text-center text-amber-500 border border-amber-500/20 bg-amber-500/5 rounded-lg text-xs font-sans w-full mb-2">
                        <b>UPI ID not entered.</b>
                        <br />Please enter a UPI ID above to generate the QR Code.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Button 
                onClick={handleConfirmUpiPayment} 
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 shadow-lg shadow-emerald-600/20 text-sm"
                disabled={createInvoiceMut.isPending}
              >
                {createInvoiceMut.isPending ? 'Confirming...' : 'Simulate Payment Success [Enter]'}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowQrModal(false)} 
                className="w-full h-10 text-xs"
                disabled={createInvoiceMut.isPending}
              >
                Cancel [Esc]
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* On-screen Thermal Receipt Preview */}
      {completedInvoice && (
        <ThermalReceipt
          invoice={completedInvoice}
          company={companyData || { name: useAuthStore?.getState?.()?.company?.name || 'My Company' }}
          items={completedInvoice.items || billItems}
          widthMm={receiptWidthMm}
          onClose={() => setCompletedInvoice(null)}
          onPrint={() => handlePrintReceipt(completedInvoice.id)}
        />
      )}

      {/* Wireless Mobile Scanner Modal */}
      {showMobileConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm bg-popover text-popover-foreground border shadow-2xl rounded-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-base flex items-center gap-2 text-foreground">
                <Smartphone className="h-5 w-5 text-primary" /> Wireless Phone Scanner
              </h3>
              <Button variant="ghost" size="icon" onClick={() => setShowMobileConnectModal(false)} className="rounded-full h-8 w-8 p-0">
                <X className="h-4.5 w-4.5" />
              </Button>
            </div>

            {/* Connection Status Banner */}
            <div className={`p-2.5 rounded-xl border flex items-center justify-between ${
              isMobileConnected 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold' 
                : 'bg-muted/50 border-muted text-muted-foreground font-medium'
            }`}>
              <div className="flex items-center gap-2 text-xs">
                <span className={`h-2.5 w-2.5 rounded-full ${isMobileConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {isMobileConnected ? 'Phone Connected & Active' : 'Waiting for phone...'}
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider">SSE Sync</span>
            </div>

            <div className="text-center py-1">
              <div className="inline-block border p-3 rounded-2xl bg-white shadow-md mb-2">
                <QRCodeSVG value={getQrUrl()} size={170} />
              </div>
              <p className="text-[11px] text-muted-foreground max-w-xs mx-auto leading-normal">
                Scan this QR code with your phone camera to open the wireless mobile scanner.
              </p>
            </div>

            {/* IP configuration selector if multiple IPs exist */}
            {serverIps.length > 1 && (
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-muted-foreground uppercase">Local IP Interface</label>
                <select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="w-full text-xs font-semibold h-9 rounded-lg border bg-background px-3 outline-none"
                >
                  {serverIps.map(ip => (
                    <option key={ip} value={ip}>{ip}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Instruction Warning for Local Dev */}
            <div className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl p-3 leading-relaxed">
              <b>Wi-Fi Connection Tips:</b>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                <li>Your phone and PC must be on the same Wi-Fi.</li>
                <li>Camera permission requires a secure origin. On plain HTTP IP, search "Chrome flags unsafely-treat-insecure-origin-as-secure" to allow camera.</li>
              </ul>
            </div>

            <Button onClick={() => setShowMobileConnectModal(false)} className="w-full h-10 font-bold bg-primary text-primary-foreground text-xs">
              Close Settings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
