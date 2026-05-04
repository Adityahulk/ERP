import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInvoice, useCancelInvoice, useCreatePayment } from '@/hooks/useBusiness';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ArrowLeft, Printer, Send, Loader2, CreditCard, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useInvoice(id!);
  const cancelMutation = useCancelInvoice();
  const paymentMutation = useCreatePayment();
  const [showPayment, setShowPayment] = useState(false);
  const [payForm, setPayForm] = useState<any>({ amount: 0, payment_mode: 'cash' });
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  const inv: any = data;
  if (!inv) return <div className="text-center py-20 text-muted-foreground">Invoice not found</div>;

  const statusColors: Record<string, any> = { paid: 'success', partial: 'warning', unpaid: 'destructive', cancelled: 'secondary' };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(id!);
      toast.success('Invoice cancelled');
      setCancelConfirmOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const handlePayment = async () => {
    if (payForm.amount <= 0) { toast.error('Amount must be positive'); return; }
    try {
      await paymentMutation.mutateAsync({
        payment_type: inv.invoice_type === 'purchase' ? 'payment_out' : 'payment_in',
        party_id: inv.party_id, invoice_id: id,
        amount: Math.round(payForm.amount * 100), payment_mode: payForm.payment_mode,
        reference_number: payForm.reference_number,
      });
      toast.success('Payment recorded');
      setShowPayment(false);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}><ArrowLeft className="w-5 h-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold font-mono">{inv.invoice_number}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={statusColors[inv.status] || 'secondary'} className="capitalize">{inv.status}</Badge>
              <span className="text-sm text-muted-foreground capitalize">{inv.invoice_type} invoice</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm"><Printer className="w-4 h-4 mr-1" />Print</Button>
          <Button variant="outline" size="sm"><Send className="w-4 h-4 mr-1" />Share</Button>
          {inv.balance_due > 0 && inv.status !== 'cancelled' && (
            <Button size="sm" onClick={() => { setPayForm({ amount: inv.balance_due / 100, payment_mode: 'cash' }); setShowPayment(true); }}>
              <CreditCard className="w-4 h-4 mr-1" />Record Payment
            </Button>
          )}
          {inv.status !== 'cancelled' && inv.status !== 'paid' && (
            <Button variant="destructive" size="sm" onClick={() => setCancelConfirmOpen(true)}>
              <XCircle className="w-4 h-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Date</p><p className="text-lg font-bold mt-1">{formatDate(inv.invoice_date)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Amount</p><p className="text-lg font-bold tabular-nums mt-1">{formatMoney(inv.total_amount)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Amount Paid</p><p className="text-lg font-bold tabular-nums mt-1 text-emerald-600">{formatMoney(inv.amount_paid)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Balance Due</p><p className={`text-lg font-bold tabular-nums mt-1 ${inv.balance_due > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{formatMoney(inv.balance_due)}</p></CardContent></Card>
      </div>

      {/* Party & Company Info */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card><CardContent className="p-5">
          <h3 className="font-semibold text-sm text-muted-foreground mb-3">{inv.invoice_type === 'sale' ? 'Bill To' : 'Bill From'}</h3>
          <p className="font-semibold text-lg">{inv.party_name || '—'}</p>
          {inv.party_gstin && <p className="font-mono text-xs text-muted-foreground mt-1">GSTIN: {inv.party_gstin}</p>}
          {inv.party_billing_address && <p className="text-sm text-muted-foreground mt-2">{inv.party_billing_address}</p>}
          {inv.party_city && <p className="text-sm text-muted-foreground">{inv.party_city}{inv.party_state ? `, ${inv.party_state}` : ''} {inv.party_pincode || ''}</p>}
          {inv.party_phone && <p className="text-sm text-muted-foreground mt-1">📞 {inv.party_phone}</p>}
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold text-sm text-muted-foreground mb-3">{inv.invoice_type === 'sale' ? 'From' : 'To'}</h3>
          <p className="font-semibold text-lg">{inv.company_name}</p>
          {inv.company_gstin && <p className="font-mono text-xs text-muted-foreground mt-1">GSTIN: {inv.company_gstin}</p>}
          {inv.company_address && <p className="text-sm text-muted-foreground mt-2">{inv.company_address}</p>}
          {inv.due_date && <p className="text-sm mt-3 text-muted-foreground">Due: <span className="font-medium text-foreground">{formatDate(inv.due_date)}</span></p>}
        </CardContent></Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/40">
              <th className="p-3 text-left font-medium">#</th>
              <th className="p-3 text-left font-medium">Item</th>
              <th className="p-3 text-left font-medium hidden md:table-cell">HSN</th>
              <th className="p-3 text-right font-medium">Qty</th>
              <th className="p-3 text-right font-medium">Price</th>
              <th className="p-3 text-right font-medium hidden md:table-cell">Taxable</th>
              <th className="p-3 text-right font-medium hidden lg:table-cell">GST</th>
              <th className="p-3 text-right font-medium">Total</th>
            </tr></thead>
            <tbody>
              {(inv.items || []).map((item: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="p-3 text-muted-foreground">{i + 1}</td>
                  <td className="p-3"><div className="font-medium">{item.item_name || item.description || '—'}</div>{item.item_sku && <div className="text-xs text-muted-foreground">{item.item_sku}</div>}</td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground font-mono text-xs">{item.hsn_code || '—'}</td>
                  <td className="p-3 text-right tabular-nums">{item.quantity} {item.unit_abbr || ''}</td>
                  <td className="p-3 text-right tabular-nums">{formatMoney(item.unit_price)}</td>
                  <td className="p-3 text-right tabular-nums hidden md:table-cell">{formatMoney(item.taxable_amount)}</td>
                  <td className="p-3 text-right tabular-nums hidden lg:table-cell"><span className="text-muted-foreground text-xs">{item.gst_rate}%</span> {formatMoney((item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0))}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{formatMoney(item.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end p-4 border-t">
            <div className="w-72 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatMoney(inv.subtotal)}</span></div>
              {inv.total_cgst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatMoney(inv.total_cgst)}</span></div>}
              {inv.total_sgst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatMoney(inv.total_sgst)}</span></div>}
              {inv.total_igst > 0 && <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatMoney(inv.total_igst)}</span></div>}
              {inv.total_cess > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cess</span><span className="tabular-nums">{formatMoney(inv.total_cess)}</span></div>}
              {inv.round_off !== 0 && <div className="flex justify-between"><span className="text-muted-foreground">Round Off</span><span className="tabular-nums">{formatMoney(inv.round_off)}</span></div>}
              <div className="flex justify-between pt-2 border-t font-bold text-base"><span>Total</span><span className="tabular-nums">{formatMoney(inv.total_amount)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      {(inv.payments || []).length > 0 && (
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Payment History</h3>
          <div className="space-y-2">
            {inv.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div><span className="font-medium text-sm">{p.payment_number}</span><span className="text-muted-foreground text-xs ml-2">{formatDate(p.payment_date)}</span><span className="text-muted-foreground text-xs ml-2 capitalize">{p.payment_mode}</span></div>
                <span className="font-semibold tabular-nums text-emerald-600">{formatMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      {/* Bank Details for sale invoices */}
      {inv.invoice_type === 'sale' && inv.bank_account_number && (
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Bank Details</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div><span className="text-muted-foreground">Bank</span><p className="font-medium">{inv.bank_name}</p></div>
            <div><span className="text-muted-foreground">Account</span><p className="font-medium font-mono">{inv.bank_account_number}</p></div>
            <div><span className="text-muted-foreground">IFSC</span><p className="font-medium font-mono">{inv.bank_ifsc}</p></div>
            {inv.upi_id && <div><span className="text-muted-foreground">UPI</span><p className="font-medium">{inv.upi_id}</p></div>}
          </div>
        </CardContent></Card>
      )}

      {/* Record Payment Sheet */}
      <Sheet open={showPayment} onOpenChange={setShowPayment}>
        <SheetContent><SheetHeader className="mb-6"><SheetTitle>Record Payment</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/30 text-sm"><span className="text-muted-foreground">Balance Due: </span><span className="font-bold tabular-nums">{formatMoney(inv.balance_due)}</span></div>
            <div><Label>Amount (₹)</Label><Input type="number" className="mt-1 tabular-nums text-lg" min={0.01} step={0.01} value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: parseFloat(e.target.value) || 0 })} /></div>
            <div><Label>Payment Mode</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={payForm.payment_mode} onChange={e => setPayForm({ ...payForm, payment_mode: e.target.value })}>
                <option value="cash">💵 Cash</option><option value="upi">📱 UPI</option>
                <option value="bank_transfer">🏦 Bank Transfer</option><option value="cheque">📝 Cheque</option>
                <option value="card">💳 Card</option>
              </select>
            </div>
            <div><Label>Reference #</Label><Input className="mt-1" placeholder="UPI Ref / Cheque No..." value={payForm.reference_number || ''} onChange={e => setPayForm({ ...payForm, reference_number: e.target.value })} /></div>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setShowPayment(false)}>Cancel</Button>
              <Button className="flex-1" disabled={paymentMutation.isPending} onClick={handlePayment}>{paymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save Payment</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="Cancel invoice?"
        description="Stock movements and party balances for this invoice will be reversed. This cannot be undone from the UI."
        confirmLabel="Cancel invoice"
        variant="destructive"
        isPending={cancelMutation.isPending}
        onConfirm={handleCancel}
      />
    </div>
  );
}
