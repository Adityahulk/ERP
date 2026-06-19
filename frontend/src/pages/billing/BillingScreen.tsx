import { useState, useRef, useEffect, CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { BarcodeScanner } from '@/components/shared/BarcodeScanner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Search, Loader2, Camera, Plus, Minus, Trash2, User, FileText, QrCode, PackagePlus, X, Check } from 'lucide-react';
import { QuickAddItemSheet } from '@/components/items/QuickAddItemSheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import { formatMoney } from '@/lib/formatters';
import { useCompany } from '@/hooks/useBusiness';
import { useAuthStore } from '@/store/authStore';
import ThermalReceipt from '@/components/shared/ThermalReceipt';
import { QRCodeSVG } from 'qrcode.react';
import { FixedSizeList as List } from 'react-window';

interface BillItem {
  item_id: string;
  name: string;
  sku: string;
  hsn_code: string;
  item_type?: string;
  track_inventory?: boolean;
  quantity: number;
  unit_price: number;
  gst_rate: number;
  discount_amount: number;
  // Computed for display
  taxable: number;
  total: number;
}

export default function BillingScreen() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // States
  const [searchQuery, setSearchQuery] = useState('');
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [billItems, setBillItems] = useState<BillItem[]>([]);
  const [customerInfo, setCustomerInfo] = useState<{ id?: string, name: string, phone?: string }>({ name: 'Walk-in Customer' });
  const [discountTotal] = useState(0);
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
    return localStorage.getItem('bizflow_custom_upi_qr') || '';
  });

  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
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

  // Transaction Settings Fetching
  const { data: transactionConfig } = useQuery({
    queryKey: ['transaction-settings'],
    queryFn: () => api.get('/settings/transaction').then((r) => r.data?.data ?? r.data),
  });

  useEffect(() => {
    if (showQrModal) {
      const defaultUpi = transactionConfig?.settings?.defaultUpiId || companyData?.upi_id || '';
      setModalUpiId(defaultUpi);
      setCustomUpiQr(localStorage.getItem('bizflow_custom_upi_qr') || '');
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
    queryKey: ['billingSearch', searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await api.post('/invoices/search-items', { q: searchQuery });
      return res.data?.data || [];
    },
    enabled: searchQuery.length >= 2,
    staleTime: 0,
  });

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchResults]);

  const handlePrintReceipt = async (id: string) => {
    const printer = localStorage.getItem('bizflow_printer_type') || 'a4';
    let pdfUrl = '';
    try {
      // Always print the receipt preview (thermal) in POS Billing rather than the standard A4 invoice
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
        handleConfirmUpiPayment();
        return;
      }
      
      // Ctrl + Enter to Checkout
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleCheckout();
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
  }, [billItems, customerInfo, paymentMode, discountTotal, amountTendered, lastCreatedInvoiceId, showQrModal, completedInvoice]);

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
        try {
          const res = await api.get(`/items/barcode/${encodeURIComponent(searchQuery)}`);
          const item = res.data?.data || res.data;
          if (item) {
            addItem(item);
            setSearchQuery('');
            toast.success('Item added');
            return;
          }
        } catch (err: any) {
          toast.error(err.response?.data?.error || 'Item not found');
        }
      }
    }
  };

  const addItem = (item: any) => {
    setBillItems(prev => {
      const existing = prev.find(i => i.item_id === item.id);
      if (existing) {
        return prev.map(i => i.item_id === item.id ? updateCommputed({ ...i, quantity: i.quantity + 1 }) : i);
      }
      return [...prev, updateCommputed({
        item_id: item.id,
        name: item.name,
        sku: item.sku,
        hsn_code: item.hsn_code,
        item_type: item.item_type,
        track_inventory: item.track_inventory,
        quantity: 1,
        unit_price: item.unit_price || item.selling_price || 0,
        gst_rate: item.gst_rate || 0,
        discount_amount: 0,
        taxable: 0,
        total: 0
      })];
    });
  };

  const updateItem = (index: number, changes: Partial<BillItem>) => {
    const newItems = [...billItems];
    newItems[index] = updateCommputed({ ...newItems[index], ...changes });
    setBillItems(newItems);
  };

  const updateCommputed = (item: BillItem) => {
    const base = item.unit_price * item.quantity;
    item.taxable = Math.max(0, base - item.discount_amount);
    const tax = Math.round(item.taxable * item.gst_rate / 100);
    item.total = item.taxable + tax;
    return item;
  };

  // Computations
  const subtotal = billItems.reduce((acc, i) => acc + (i.unit_price * i.quantity), 0);
  const itemDiscounts = billItems.reduce((acc, i) => acc + i.discount_amount, 0);
  const taxable = billItems.reduce((acc, i) => acc + i.taxable, 0);
  
  // Note: POS often strictly considers CGST/SGST by default. Interstate can be toggled by party selection. We assume Intra.
  const totalTax = billItems.reduce((acc, i) => acc + Math.round(i.taxable * i.gst_rate / 100), 0);
  const rawTotal = taxable + totalTax - discountTotal;
  const grandTotal = Math.max(0, Math.round(rawTotal / 100) * 100); // nearest rupee in paise
  const roundOff = grandTotal - rawTotal;

  // Submit Pipeline
  const createInvoiceMut = useMutation({
    mutationFn: async () => {
      const itemsPayload = billItems.map((b) => ({
        item_id: b.item_id,
        item_name: b.name,
        hsn_code: b.hsn_code,
        quantity: b.quantity,
        unit_price: b.unit_price,
        gst_rate: b.gst_rate,
        discount_amount: b.discount_amount,
      }));
      const tenderPaise =
        paymentMode === 'credit'
          ? 0
          : amountTendered === ''
            ? grandTotal
            : Math.round(Number(amountTendered) * 100);
      const payload: Record<string, unknown> = {
        invoice_type: 'tax_invoice',
        is_interstate: false,
        items: itemsPayload,
        discount_amount: discountTotal,
        payments: [
          {
            amount: tenderPaise,
            payment_mode: paymentMode,
          }
        ],
        amount_paid: tenderPaise,
        payment_mode: paymentMode,
        party_name: customerInfo.name,
        party_phone: customerInfo.phone || undefined,
      };
      if (customerInfo.id) payload.party_id = customerInfo.id;
      if (companyBankAccountId) payload.company_bank_account_id = companyBankAccountId;
      return api.post('/invoices', payload);
    },
    onSuccess: async (res) => {
      toast.success('Bill Confirmed!');
      const inv = res.data?.data ?? res.data;
      const id = inv?.id;
      
      setLastCreatedInvoiceId(id);
      setCompletedInvoice(inv);
      
      setBillItems([]);
      setSearchQuery('');
      setAmountTendered('');
      setCustomerInfo({ name: 'Walk-in Customer' });
      searchInputRef.current?.focus();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to generate bill')
  });

  const handleCheckout = () => {
    if (billItems.length === 0) return toast.error('Bill is empty');
    if (paymentMode === 'upi') {
      setShowQrModal(true);
    } else {
      createInvoiceMut.mutate();
    }
  };

  return (
    <div className="h-[calc(100vh-7.5rem)] overflow-hidden flex flex-col gap-3">
      <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0">
        {/* Left Column - POS Items */}
        <div className="flex-1 flex flex-col bg-background border rounded-xl overflow-hidden shadow-sm shadow-black/5 min-h-0">
          
          {/* Search Bar Segment */}
          <div className="p-3 border-b flex gap-2 items-center bg-muted/20 relative z-30">
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
                        <div className="text-xs text-muted-foreground flex gap-2"><span>SKU: {item.sku}</span> <span>GST: {item.gst_rate}%</span></div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-primary">{formatMoney(item.unit_price)}</div>
                        {item.item_type === 'service' ? (
                          <div className="text-xs text-muted-foreground">Service</div>
                        ) : (
                          <div className="text-xs text-muted-foreground">In Stock: {item.available_stock}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <Button
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
            </Button>
            <Button size="lg" variant="secondary" className="h-12 w-12 px-0 shrink-0" onClick={() => setScannerOpen(true)}>
              <Camera className="h-5 w-5" />
            </Button>
          </div>

          {/* Bill Render Header */}
          <div className="grid grid-cols-[1fr_8rem_6rem_6rem_8rem_3rem] bg-muted py-3 px-4 text-sm font-semibold sticky top-0 z-0 border-b">
            <div>Item</div>
            <div className="text-center">Qty</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Disc</div>
            <div className="text-right">Total</div>
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
                    <div style={style} className="grid grid-cols-[1fr_8rem_6rem_6rem_8rem_3rem] items-center border-b hover:bg-muted/50 py-2 px-4 transition-colors">
                      <div>
                        <div className="font-bold truncate max-w-[200px]">{item.name}</div>
                        <div className="text-xs text-muted-foreground">GST {item.gst_rate}%</div>
                      </div>
                      <div className="flex items-center justify-center bg-background border rounded-md overflow-hidden shadow-sm max-w-[100px] mx-auto">
                        <button className="px-2 py-1 hover:bg-muted" onClick={() => updateItem(index, { quantity: Math.max(1, item.quantity - 1) })}><Minus className="h-3 w-3"/></button>
                        <Input 
                          value={item.quantity} 
                          onChange={e => updateItem(index, { quantity: Number(e.target.value) || 1 })} 
                          className="w-10 h-8 text-center border-0 p-0 focus-visible:ring-0" 
                        />
                        <button className="px-2 py-1 hover:bg-muted" onClick={() => updateItem(index, { quantity: item.quantity + 1 })}><Plus className="h-3 w-3"/></button>
                      </div>
                      <div className="text-right">
                        <Input 
                          value={item.unit_price / 100} 
                          onChange={e => updateItem(index, { unit_price: Math.round(Number(e.target.value) * 100) })} 
                          className="h-8 w-20 text-right ml-auto px-1" 
                        />
                      </div>
                      <div className="text-right">
                        <Input 
                          value={item.discount_amount / 100} 
                          onChange={e => updateItem(index, { discount_amount: Math.round(Number(e.target.value) * 100) })} 
                          className="h-8 w-20 text-right ml-auto px-1" 
                        />
                      </div>
                      <div className="text-right font-bold tabular-nums">
                        {formatMoney(item.total)}
                      </div>
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
          
          <div className="space-y-2 flex-1 overflow-y-auto text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(subtotal)}</span>
            </div>
            {itemDiscounts > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Item Level Discount</span>
                <span className="tabular-nums font-medium">-{formatMoney(itemDiscounts)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Taxable Value</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(taxable)}</span>
            </div>
            
            <div className="flex justify-between border-l-2 border-primary/20 pl-3 py-0.5 text-xs bg-muted/30">
              <span className="text-muted-foreground">CGST</span>
              <span className="tabular-nums">{formatMoney(Math.ceil(totalTax / 2))}</span>
            </div>
            <div className="flex justify-between border-l-2 border-primary/20 pl-3 py-0.5 text-xs bg-muted/30">
              <span className="text-muted-foreground">SGST</span>
              <span className="tabular-nums">{formatMoney(Math.floor(totalTax / 2))}</span>
            </div>

            <div className="flex justify-between text-muted-foreground">
              <span>Round Off</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(roundOff)}</span>
            </div>
          </div>

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
           setSearchQuery(code);
           // Mimic keyboard ENTER payload behavior via state sync timeout 
           setTimeout(() => handleSearchKeyPress({ key: 'Enter' } as any), 50);
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
          widthMm={localStorage.getItem('bizflow_printer_type') === 'thermal58' ? 58 : 80}
          onClose={() => setCompletedInvoice(null)}
          onPrint={() => handlePrintReceipt(completedInvoice.id)}
        />
      )}
    </div>
  );
}
