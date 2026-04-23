import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { BarcodeScanner } from '@/components/shared/BarcodeScanner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Search, Loader2, Camera, Plus, Minus, Trash2, User, FileText, QrCode } from 'lucide-react';
import { formatMoney } from '@/lib/formatters';

interface BillItem {
  item_id: string;
  name: string;
  sku: string;
  hsn_code: string;
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

  // Search Results
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['billingSearch', searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await api.post('/invoices/search-items', { q: searchQuery });
      return res.data;
    },
    enabled: searchQuery.length >= 2,
    staleTime: 0,
  });

  // Hotkeys & Scan Interception
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F2 to focus search
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // F10 to confirm and print
      if (e.key === 'F10') {
        e.preventDefault();
        handleCheckout();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [billItems, customerInfo, paymentMode, discountTotal, amountTendered]); // Deps required due to handleCheckout closure scope

  // Handle hardware barcode scan (Assume scanner sends Enter key at end)
  const handleSearchKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery) {
      if (searchResults && searchResults.length > 0) {
        // Assume first result if it wasn't a strict barcode scan
        addItem(searchResults[0]);
        setSearchQuery('');
        return;
      }

      // Check strictly if it matches a barcode
      try {
        const res = await api.post('/invoices/scan-barcode', { barcode: searchQuery });
        if (res.data.found) {
          addItem(res.data.item);
          setSearchQuery('');
          toast.success('Item added');
        } else {
          toast.error('Item not found');
        }
      } catch (err) {
        toast.error('Scan failed');
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
        quantity: 1,
        unit_price: item.unit_price, // Assuming paise payload directly
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
        amount_paid: tenderPaise,
        payment_mode: paymentMode,
      };
      if (customerInfo.id) payload.party_id = customerInfo.id;
      return api.post('/invoices', payload);
    },
    onSuccess: async (res) => {
      toast.success('Bill Confirmed!');
      const inv = res.data?.data ?? res.data;
      const id = inv?.id;
      const printer = localStorage.getItem('bizflow_printer_type') || 'a4';
      if (id && (printer === 'thermal80' || printer === 'thermal58')) {
        try {
          const w = printer === 'thermal58' ? '58' : '80';
          const pdfRes = await api.get(`/print/receipt/${id}`, { params: { width: w }, responseType: 'blob' });
          const url = window.URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' }));
          window.open(url, '_blank');
        } catch {
          toast.error('Receipt PDF could not be opened');
        }
      }
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
    createInvoiceMut.mutate();
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col lg:flex-row gap-4">
      {/* Left Column - POS Items */}
      <div className="flex-1 flex flex-col bg-background border rounded-xl overflow-hidden shadow-sm shadow-black/5">
        
        {/* Search Bar Segment */}
        <div className="p-3 border-b flex gap-2 items-center bg-muted/20">
          <div className="relative flex-1">
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
              <div className="absolute top-14 left-0 right-0 max-h-64 overflow-y-auto bg-popover border shadow-2xl rounded-lg z-10 flex flex-col">
                {searchResults.map((item: any) => (
                  <button 
                    key={item.id} 
                    className="flex justify-between items-center p-3 hover:bg-muted text-left border-b last:border-0"
                    onClick={() => { addItem(item); setSearchQuery(''); searchInputRef.current?.focus(); }}
                  >
                    <div>
                      <div className="font-bold">{item.name}</div>
                      <div className="text-xs text-muted-foreground flex gap-2"><span>SKU: {item.sku}</span> <span>GST: {item.gst_rate}%</span></div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">{formatMoney(item.unit_price)}</div>
                      <div className="text-xs text-muted-foreground">In Stock: {item.available_stock}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <Button size="lg" variant="secondary" className="h-12 w-12 px-0 shrink-0" onClick={() => setScannerOpen(true)}>
            <Camera className="h-5 w-5" />
          </Button>
        </div>

        {/* Bill Render Table */}
        <div className="flex-1 overflow-y-auto">
          {billItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground/60 space-y-4">
              <QrCode className="h-24 w-24 opacity-20" />
              <p className="font-medium text-lg">Scan items to begin billing</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold">Item</th>
                  <th className="py-3 px-4 text-center font-semibold w-32">Qty</th>
                  <th className="py-3 px-4 text-right font-semibold w-24">Rate</th>
                  <th className="py-3 px-4 text-right font-semibold w-24">Disc</th>
                  <th className="py-3 px-4 text-right font-semibold w-32">Total</th>
                  <th className="py-3 px-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {billItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/50 transition-colors">
                    <td className="py-2 px-4">
                      <div className="font-bold">{item.name}</div>
                      <div className="text-xs text-muted-foreground">GST {item.gst_rate}%</div>
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex items-center justify-center bg-background border rounded-md overflow-hidden shadow-sm">
                        <button className="px-2 py-1 hover:bg-muted" onClick={() => updateItem(idx, { quantity: Math.max(1, item.quantity - 1) })}><Minus className="h-3 w-3"/></button>
                        <Input 
                           value={item.quantity} 
                           onChange={e => updateItem(idx, { quantity: Number(e.target.value) || 1 })} 
                           className="w-10 h-8 text-center border-0 p-0 focus-visible:ring-0" 
                        />
                        <button className="px-2 py-1 hover:bg-muted" onClick={() => updateItem(idx, { quantity: item.quantity + 1 })}><Plus className="h-3 w-3"/></button>
                      </div>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <Input 
                        value={item.unit_price / 100} 
                        onChange={e => updateItem(idx, { unit_price: Math.round(Number(e.target.value) * 100) })} 
                        className="h-8 w-20 text-right ml-auto px-1" 
                      />
                    </td>
                    <td className="py-2 px-4 text-right">
                       <Input 
                        value={item.discount_amount / 100} 
                        onChange={e => updateItem(idx, { discount_amount: Math.round(Number(e.target.value) * 100) })} 
                        className="h-8 w-20 text-right ml-auto px-1" 
                      />
                    </td>
                    <td className="py-2 px-4 text-right font-bold tabular-nums">
                      {formatMoney(item.total)}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 hover:bg-destructive/10"
                        onClick={() => setBillItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Helper footer */}
        <div className="p-3 bg-muted border-t text-xs text-muted-foreground flex justify-between">
          <span>Items: {billItems.length}</span>
          <span>Press <b>Del</b> on selected row to remove | Switch between inputs with <b>Tab</b></span>
        </div>
      </div>

      {/* Right Column - Summary & Execution */}
      <div className="w-full lg:w-[400px] flex flex-col gap-4">
        
        {/* Customer Block */}
        <Card className="p-4 shadow-sm border-2 border-transparent focus-within:border-primary/50 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-lg flex items-center gap-2"><User className="h-5 w-5" /> Customer Details</h3>
            <Button variant="link" className="h-auto p-0 border-b leading-tight">Change</Button>
          </div>
          <div className="text-2xl font-bold">{customerInfo.name}</div>
        </Card>

        {/* Calculation Board */}
        <Card className="p-5 flex-1 shadow-sm flex flex-col">
          <h3 className="font-semibold text-lg flex items-center gap-2 mb-4 border-b pb-2"><FileText className="h-5 w-5" /> Bill Summary</h3>
          
          <div className="space-y-3 flex-1">
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
            
            <div className="flex justify-between border-l-2 border-primary/20 pl-4 py-1 text-sm bg-muted/30">
              <span className="text-muted-foreground">CGST</span>
              <span className="tabular-nums">{formatMoney(Math.ceil(totalTax / 2))}</span>
            </div>
            <div className="flex justify-between border-l-2 border-primary/20 pl-4 py-1 text-sm bg-muted/30">
              <span className="text-muted-foreground">SGST</span>
              <span className="tabular-nums">{formatMoney(Math.floor(totalTax / 2))}</span>
            </div>

            <div className="flex justify-between text-muted-foreground">
              <span>Round Off</span>
              <span className="tabular-nums font-medium text-foreground">{formatMoney(roundOff)}</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t-2 border-dashed">
             <div className="flex justify-between items-end">
              <span className="text-2xl font-black">TOTAL</span>
              <span className="text-4xl font-black tabular-nums text-primary tracking-tight">{formatMoney(grandTotal)}</span>
             </div>
          </div>
        </Card>

        {/* Payment & Checkout Action */}
        <Card className="p-4 shadow-sm border-2 border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/20">
          <div className="mb-4">
             <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Payment Mode</label>
             <div className="flex gap-2 mb-4">
                {['cash', 'upi', 'card', 'credit'].map(mode => (
                  <button 
                    key={mode}
                    onClick={() => setPaymentMode(mode)}
                    className={`flex-1 capitalize py-2 rounded-lg font-bold text-sm transition-all border
                      ${paymentMode === mode ? 'bg-primary border-primary text-primary-foreground shadow-md' : 'bg-background hover:bg-muted text-muted-foreground'}`}
                  >
                    {mode}
                  </button>
                ))}
             </div>
             
             {paymentMode !== 'credit' && (
               <div className="flex gap-2 items-center mb-2">
                 <Input 
                   type="number"
                   placeholder="Amount Tendered" 
                   className="h-12 text-lg font-bold"
                   value={amountTendered}
                   onChange={e => setAmountTendered(e.target.value ? Number(e.target.value) : '')}
                 />
                 <Button variant="outline" className="h-12 whitespace-nowrap" onClick={() => setAmountTendered(grandTotal / 100)}>EXACT</Button>
               </div>
             )}
          </div>
          
          <Button 
            className="w-full h-16 text-xl font-bold bg-green-600 hover:bg-green-700 text-white shadow-xl shadow-green-600/20"
            onClick={handleCheckout}
            disabled={createInvoiceMut.isPending}
          >
            {createInvoiceMut.isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Confirm & Print [F10]'}
          </Button>
        </Card>

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
    </div>
  );
}
