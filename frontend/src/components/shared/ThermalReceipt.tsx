import { Printer, X } from 'lucide-react';
import { formatMoney } from '@/lib/formatters';

interface ReceiptItem {
  item_name?: string;
  name?: string;
  quantity: number;
  total_amount?: number;
  total?: number; // for draft items
  unit_price: number;
  gst_rate?: number;
}

interface ThermalReceiptProps {
  invoice: {
    invoice_number: string;
    invoice_date: string;
    subtotal: number;
    discount_amount?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total_amount: number;
    paid_amount?: number;
    payment_mode?: string;
    party_name_snapshot?: string;
    customer_name?: string; // fallback
    upi_id_snapshot?: string;
  };
  company: {
    name: string;
    registered_address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gstin?: string;
    phone?: string;
    upi_id?: string;
    receipt_footer_message?: string;
  };
  items: ReceiptItem[];
  widthMm?: 58 | 80;
  onClose?: () => void;
  onPrint?: () => void;
}

export default function ThermalReceipt({
  invoice,
  company,
  items,
  widthMm = 80,
  onClose,
  onPrint,
}: ThermalReceiptProps) {
  const paperWClass = widthMm === 58 ? 'w-[58mm]' : 'w-[80mm]';
  const paperPadding = widthMm === 58 ? 'p-[2mm]' : 'p-[4mm]';

  // Compute CGST/SGST/IGST if not explicitly in invoice (e.g. for drafts)
  const cgst = invoice.cgst_amount ?? 0;
  const sgst = invoice.sgst_amount ?? 0;
  const igst = invoice.igst_amount ?? 0;

  const rateGuess = items[0]?.gst_rate ?? 0;
  const paid = invoice.paid_amount ?? invoice.total_amount;
  const change = paid > invoice.total_amount ? paid - invoice.total_amount : 0;

  // Generate UPI QR payload if payment mode is UPI
  const upiId = invoice.upi_id_snapshot || company.upi_id;
  const showUpiQr = invoice.payment_mode === 'upi' && upiId;
  const upiPayload = showUpiQr
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(company.name)}&am=${(invoice.total_amount / 100).toFixed(2)}&cu=INR`
    : '';

  const qrImageUrl = showUpiQr
    ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiPayload)}`
    : '';

  return (
    <div className="bg-slate-900/60 backdrop-blur-sm fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-800 dark:text-slate-200">Receipt Preview ({widthMm}mm)</h3>
          </div>
          <div className="flex items-center gap-2">
            {onPrint && (
              <button
                onClick={onPrint}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 hover:text-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Receipt paper container */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100 dark:bg-slate-900 flex justify-center">
          <div
            className={`bg-white text-black shadow-lg border border-slate-300 font-mono text-[11px] leading-relaxed relative ${paperWClass} ${paperPadding} min-h-[120mm] select-none`}
            style={{ boxSizing: 'border-box' }}
          >
            {/* Inner dashed receipt look */}
            <div className="text-center">
              <div className="text-sm font-bold uppercase tracking-tight leading-tight">{company.name}</div>
              {company.registered_address && <div className="text-[10px] mt-0.5">{company.registered_address}</div>}
              {(company.city || company.state || company.pincode) && (
                <div className="text-[10px]">
                  {[company.city, company.state, company.pincode].filter(Boolean).join(', ')}
                </div>
              )}
              {company.gstin && <div className="text-[10px] font-semibold mt-0.5">GSTIN: {company.gstin}</div>}
              {company.phone && <div className="text-[10px]">Ph: {company.phone}</div>}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>INVOICE:</span>
                <span className="font-semibold">{invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{invoice.invoice_date}</span>
              </div>
              <div className="flex justify-between">
                <span>Time:</span>
                <span>{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
              </div>
              <div className="flex justify-between">
                <span>Party:</span>
                <span className="truncate max-w-[120px]">{invoice.party_name_snapshot || invoice.customer_name || 'Walk-in Customer'}</span>
              </div>
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            {/* Table Header */}
            <div className="flex font-semibold">
              <span className="w-[50%] text-left">Item</span>
              <span className="w-[20%] text-center">Qty</span>
              <span className="w-[30%] text-right">Price</span>
            </div>

            <div className="border-t border-dashed border-black my-1"></div>

            {/* Item Rows */}
            <div className="space-y-1 my-1">
              {items.map((it, idx) => {
                const name = (it.item_name || it.name || '').slice(0, 24);
                const totalVal = it.total_amount ?? it.total ?? (it.unit_price * it.quantity);
                return (
                  <div key={idx} className="flex items-start">
                    <span className="w-[50%] text-left truncate">{name}</span>
                    <span className="w-[20%] text-center">{it.quantity}</span>
                    <span className="w-[30%] text-right tabular-nums">{formatMoney(totalVal)}</span>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            {/* Calculation Block */}
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span className="tabular-nums">{formatMoney(invoice.subtotal)}</span>
              </div>
              {invoice.discount_amount && invoice.discount_amount > 0 ? (
                <div className="flex justify-between text-black">
                  <span>Discount:</span>
                  <span className="tabular-nums">-{formatMoney(invoice.discount_amount)}</span>
                </div>
              ) : null}

              {cgst > 0 && (
                <div className="flex justify-between">
                  <span>CGST @ {rateGuess}%:</span>
                  <span className="tabular-nums">{formatMoney(cgst)}</span>
                </div>
              )}
              {sgst > 0 && (
                <div className="flex justify-between">
                  <span>SGST @ {rateGuess}%:</span>
                  <span className="tabular-nums">{formatMoney(sgst)}</span>
                </div>
              )}
              {igst > 0 && (
                <div className="flex justify-between">
                  <span>IGST:</span>
                  <span className="tabular-nums">{formatMoney(igst)}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            <div className="flex justify-between font-bold text-xs uppercase">
              <span>TOTAL:</span>
              <span className="tabular-nums">{formatMoney(invoice.total_amount)}</span>
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            <div className="space-y-0.5">
              <div className="flex justify-between capitalize">
                <span>Payment:</span>
                <span>{invoice.payment_mode || 'cash'}</span>
              </div>
              <div className="flex justify-between">
                <span>Paid:</span>
                <span className="tabular-nums">{formatMoney(paid)}</span>
              </div>
              {change > 0 && (
                <div className="flex justify-between">
                  <span>Change:</span>
                  <span className="tabular-nums">{formatMoney(change)}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            {/* UPI QR Block */}
            {showUpiQr && qrImageUrl && (
              <div className="flex flex-col items-center my-3 gap-1">
                <img
                  src={qrImageUrl}
                  alt="UPI QR Code"
                  className="w-[30mm] h-[30mm] border border-black p-1 bg-white object-contain"
                />
                <span className="text-[9px] text-slate-500 font-sans mt-0.5">Scan to Pay UPI</span>
              </div>
            )}

            <div className="text-center text-[9px] mt-2 italic leading-tight">
              {company.receipt_footer_message || 'Thank you for your business!'}
            </div>

            {/* Barcode block */}
            {invoice.invoice_number && (
              <div className="flex flex-col items-center mt-4">
                <div className="flex h-8 items-end justify-center select-none" aria-hidden="true">
                  {/* Styled CSS Barcode rendering */}
                  {Array.from({ length: 30 }).map((_, i) => {
                    const spacing = i % 2 === 0 ? 'w-[1px]' : 'w-[2px]';
                    const color = i % 4 === 0 ? 'bg-transparent' : 'bg-black';
                    return <div key={i} className={`h-6 ${spacing} ${color}`} />;
                  })}
                </div>
                <div className="text-[9px] tracking-[2px] font-mono mt-1 uppercase">
                  {invoice.invoice_number}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
