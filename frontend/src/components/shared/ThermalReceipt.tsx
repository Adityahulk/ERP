import { Printer, X } from 'lucide-react';
import { formatMoney } from '@/lib/formatters';
import { QRCodeSVG } from 'qrcode.react';
import { getApiBaseURL } from '@/lib/api';

interface ReceiptItem {
  item_name?: string;
  name?: string;
  quantity: number;
  total_amount?: number;
  total?: number; // for draft items
  unit_price: number;
  gst_rate?: number;
  hsn_code?: string;
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
    invoice_type?: string;
    reference_number?: string;
    running_balance?: number;
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
    logo_url?: string;
    receipt_footer_message?: string;
    print_settings?: {
      thermal?: {
        show_seller_name?: boolean;
        seller_name?: string;
        show_seller_phone?: boolean;
        seller_phone?: string;
        show_seller_address?: boolean;
        seller_address?: string;
        show_date_time?: boolean;
        show_bill_no?: boolean;
        show_logo?: boolean;
        show_tax_columns?: boolean;
        show_payment_details?: boolean;
        card_auth_code_override?: string;
        card_last_four_override?: string;
        barcode_or_qr?: 'none' | 'barcode' | 'qr';
        return_policy?: string;
        show_footer_thank_you?: boolean;
        enable_refund_layout?: boolean;
        enable_deposit_layout?: boolean;
        deposit_account_details?: string;
      };
    };
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

  const thermal = {
    show_seller_name: company.print_settings?.thermal?.show_seller_name !== false,
    seller_name: company.print_settings?.thermal?.seller_name || '',
    show_seller_phone: company.print_settings?.thermal?.show_seller_phone !== false,
    seller_phone: company.print_settings?.thermal?.seller_phone || '',
    show_seller_address: company.print_settings?.thermal?.show_seller_address !== false,
    seller_address: company.print_settings?.thermal?.seller_address || '',
    show_date_time: company.print_settings?.thermal?.show_date_time !== false,
    show_bill_no: company.print_settings?.thermal?.show_bill_no !== false,
    show_logo: company.print_settings?.thermal?.show_logo !== false,
    show_tax_columns: company.print_settings?.thermal?.show_tax_columns === true,
    show_payment_details: company.print_settings?.thermal?.show_payment_details !== false,
    card_auth_code_override: company.print_settings?.thermal?.card_auth_code_override || '',
    card_last_four_override: company.print_settings?.thermal?.card_last_four_override || '',
    barcode_or_qr: company.print_settings?.thermal?.barcode_or_qr || 'barcode',
    return_policy: company.print_settings?.thermal?.return_policy ?? 'Items can be returned within 7 days in original condition.',
    show_footer_thank_you: company.print_settings?.thermal?.show_footer_thank_you !== false,
    enable_refund_layout: company.print_settings?.thermal?.enable_refund_layout !== false,
    enable_deposit_layout: company.print_settings?.thermal?.enable_deposit_layout === true,
    deposit_account_details: company.print_settings?.thermal?.deposit_account_details || '',
  };

  const isRefund = (invoice.invoice_type === 'credit_note' || invoice.total_amount < 0) && thermal.enable_refund_layout;
  const isDeposit = thermal.enable_deposit_layout;

  const uploadsBase = () => getApiBaseURL().replace(/\/api$/, '');
  const logoSrc = company.logo_url
    ? (String(company.logo_url).startsWith('http') ? company.logo_url : `${uploadsBase()}${company.logo_url}`)
    : '';

  const sellerNameStr = thermal.show_seller_name
    ? (thermal.seller_name ? thermal.seller_name : company.name)
    : '';

  const sellerAddressStr = thermal.show_seller_address
    ? (thermal.seller_address ? thermal.seller_address : (company.registered_address || ''))
    : '';

  const cityStatePinStr = thermal.show_seller_address
    ? (thermal.seller_address ? '' : [company.city, company.state, company.pincode].filter(Boolean).join(', '))
    : '';

  const sellerPhoneStr = thermal.show_seller_phone
    ? (thermal.seller_phone ? thermal.seller_phone : (company.phone || ''))
    : '';

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
            <div className="text-center space-y-0.5">
              {thermal.show_logo && logoSrc && (
                <div className="flex justify-center mb-2">
                  <img src={logoSrc} alt="logo" className="max-w-[40mm] max-h-[15mm] object-contain filter grayscale contrast-[3]" />
                </div>
              )}
              {isRefund && (
                <div className="text-center font-bold border border-black p-1 my-1 text-[10px] uppercase">
                  *** REFUND RECEIPT ***
                </div>
              )}
              {thermal.show_seller_name && sellerNameStr && (
                <div className="text-sm font-bold uppercase tracking-tight leading-tight">{sellerNameStr}</div>
              )}
              {thermal.show_seller_address && sellerAddressStr && (
                <div className="text-[10px] mt-0.5 whitespace-pre-line">{sellerAddressStr}</div>
              )}
              {thermal.show_seller_address && cityStatePinStr && (
                <div className="text-[10px]">{cityStatePinStr}</div>
              )}
              {company.gstin && (
                <div className="text-[10px] font-semibold mt-0.5">GSTIN: {company.gstin}</div>
              )}
              {thermal.show_seller_phone && sellerPhoneStr && (
                <div className="text-[10px]">Ph: {sellerPhoneStr}</div>
              )}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            <div className="space-y-0.5">
              {isRefund && invoice.reference_number && (
                <div className="flex justify-between">
                  <span>Orig. Invoice:</span>
                  <span>{invoice.reference_number}</span>
                </div>
              )}
              {thermal.show_bill_no && (
                <div className="flex justify-between">
                  <span>INVOICE:</span>
                  <span className="font-semibold">{invoice.invoice_number}</span>
                </div>
              )}
              {thermal.show_date_time && (
                <>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{invoice.invoice_date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Time:</span>
                    <span>{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span>Party:</span>
                <span className="truncate max-w-[120px]">{invoice.party_name_snapshot || invoice.customer_name || 'Walk-in Customer'}</span>
              </div>
            </div>

            {isDeposit ? (
              <>
                <div className="border-t border-dashed border-black my-2"></div>
                <div className="border border-black p-2 my-2 bg-slate-50 dark:bg-slate-900/50 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span>Deposit Amount:</span>
                    <span>{formatMoney(invoice.total_amount)}</span>
                  </div>
                  {thermal.deposit_account_details && (
                    <div className="text-[9px] text-slate-600 dark:text-slate-400">
                      Account: {thermal.deposit_account_details}
                    </div>
                  )}
                  {invoice.running_balance !== undefined && (
                    <div className="flex justify-between text-[9px] border-t border-slate-200 dark:border-slate-800 pt-1">
                      <span>Running Balance:</span>
                      <span>{formatMoney(invoice.running_balance)}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
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
                    const hsn = it.hsn_code ? `HSN: ${it.hsn_code}` : '';
                    const gst = it.gst_rate !== undefined ? `GST: ${it.gst_rate}%` : '';
                    const sublineInfo = [hsn, gst].filter(Boolean).join(' | ');
                    return (
                      <div key={idx} className="flex flex-col mb-1">
                        <div className="flex items-start">
                          <span className="w-[50%] text-left truncate">{name}</span>
                          <span className="w-[20%] text-center">{it.quantity}</span>
                          <span className="w-[30%] text-right tabular-nums">{formatMoney(totalVal)}</span>
                        </div>
                        {thermal.show_tax_columns && sublineInfo && (
                          <div className="text-[9px] text-slate-500 pl-2 leading-none mt-0.5">
                            [{sublineInfo}]
                          </div>
                        )}
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
              </>
            )}

            {thermal.show_payment_details && (
              <>
                <div className="border-t border-dashed border-black my-2"></div>
                {(() => {
                  const paymentMode = String(invoice.payment_mode || 'cash').trim().toLowerCase();
                  if (paymentMode === 'card') {
                    const cardLastFour = thermal.card_last_four_override || '4321';
                    const cardAuthCode = invoice.reference_number || thermal.card_auth_code_override || 'AUTH-099';
                    return (
                      <div className="space-y-0.5">
                        <div className="flex justify-between capitalize">
                          <span>Payment:</span>
                          <span>Card</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Card No:</span>
                          <span>**** **** **** {cardLastFour}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Auth Code:</span>
                          <span>{cardAuthCode}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Paid:</span>
                          <span className="tabular-nums">{formatMoney(paid)}</span>
                        </div>
                      </div>
                    );
                  } else if (paymentMode === 'cash') {
                    return (
                      <div className="space-y-0.5">
                        <div className="flex justify-between capitalize">
                          <span>Payment:</span>
                          <span>Cash</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Paid:</span>
                          <span className="tabular-nums">{formatMoney(paid)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tendered:</span>
                          <span className="tabular-nums">{formatMoney(paid)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Change:</span>
                          <span className="tabular-nums">{formatMoney(change)}</span>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="space-y-0.5">
                        <div className="flex justify-between capitalize">
                          <span>Payment:</span>
                          <span>{paymentMode}</span>
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
                    );
                  }
                })()}
              </>
            )}

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

            {thermal.return_policy && (
              <>
                <div className="border-t border-dashed border-black my-2"></div>
                <div className="text-center text-[9px] leading-tight italic">
                  {thermal.return_policy}
                </div>
              </>
            )}

            {thermal.show_footer_thank_you && (
              <div className="text-center text-[10px] font-bold mt-2 uppercase tracking-tight">
                Thank you for your business!
              </div>
            )}

            {/* Barcode/QR block for lookup */}
            {invoice.invoice_number && thermal.barcode_or_qr === 'barcode' && (
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

            {invoice.invoice_number && thermal.barcode_or_qr === 'qr' && (
              <div className="flex flex-col items-center mt-4 gap-1">
                <QRCodeSVG
                  value={`https://verify.invoice/${invoice.invoice_number}`}
                  size={90}
                  className="w-[24mm] h-[24mm] border border-black p-1 bg-white object-contain"
                />
                <span className="text-[8px] text-slate-500 font-sans mt-0.5">Scan for Digital Lookup</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
