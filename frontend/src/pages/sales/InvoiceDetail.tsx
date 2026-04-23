import { useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, Send, AlertTriangle, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const { data: inv, isLoading, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const res = await api.get(`/invoices/${id}`);
      return res.data;
    }
  });

  useEffect(() => {
    if (inv && params.get('record') === '1') {
      // Could open a payment modal here mapped to state natively
      toast("Record Payment Flow initiated", { icon: '💰' });
    }
  }, [inv, params]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading invoice details...</div>;
  if (!inv) return <div className="p-8 text-center text-destructive">Invoice not found.</div>;

  const handleGenerateEInvoice = async () => {
    const loader = toast.loading('Connecting to NIC Portal...');
    try {
      await api.post(`/invoices/${id}/einvoice`);
      toast.success('E-Invoice generated successfully', { id: loader });
      refetch();
    } catch (e: any) {
      toast.error('Failed: ' + e.message, { id: loader });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Invoice {inv.invoice_number}</h1>
          <Badge variant="outline" className="capitalize text-sm px-3">{inv.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => {}}>Record Payment</Button>
          <Button variant="outline" onClick={async () => {
              const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
              const url = window.URL.createObjectURL(new Blob([res.data]));
              const link = document.createElement('a');
              link.href = url; link.setAttribute('download', `${inv.invoice_number}.pdf`);
              document.body.appendChild(link); link.click(); link.remove();
          }}>
            <Download className="h-4 w-4 mr-2" /> Download
          </Button>
          <Button onClick={async () => {
             await api.post(`/invoices/${inv.id}/whatsapp`);
             toast.success('WhatsApp dispatched');
          }}>
             <Send className="h-4 w-4 mr-2" /> WhatsApp
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Preview Area */}
        <Card className="md:col-span-2">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Billed To</CardTitle>
                <div className="font-bold text-lg">{inv.party_name || 'Walk-in Customer'}</div>
                {inv.party_phone && <div>{inv.party_phone}</div>}
                {inv.party_gstin && <div className="text-sm mt-1">GSTIN: <span className="font-mono">{inv.party_gstin}</span></div>}
              </div>
              <div className="text-right">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Invoice Info</CardTitle>
                <div>Date: {formatDate(inv.invoice_date)}</div>
                {inv.due_date && <div>Due: {formatDate(inv.due_date)}</div>}
                <div>Type: {inv.is_interstate ? 'Interstate (IGST)' : 'Intrastate (CGST/SGST)'}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
             <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="py-2 px-4 text-left font-medium">Item</th>
                    <th className="py-2 px-4 text-center font-medium">Qty</th>
                    <th className="py-2 px-4 text-right font-medium">Rate</th>
                    <th className="py-2 px-4 text-right font-medium">Tax</th>
                    <th className="py-2 px-4 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                   {inv.items.map((i: any) => (
                     <tr key={i.id}>
                       <td className="py-3 px-4">
                         <div className="font-medium">{i.item_name}</div>
                         <div className="text-xs text-muted-foreground">HSN: {i.hsn_code}</div>
                       </td>
                       <td className="py-3 px-4 text-center">{Number(i.quantity)}</td>
                       <td className="py-3 px-4 text-right tabular-nums">{formatMoney(i.unit_price)}</td>
                       <td className="py-3 px-4 text-right text-xs">
                          {i.gst_rate}% <br/>
                          <span className="text-muted-foreground">{formatMoney(i.cgst_amount + i.sgst_amount + i.igst_amount)}</span>
                       </td>
                       <td className="py-3 px-4 text-right font-medium tabular-nums">{formatMoney(i.total_amount)}</td>
                     </tr>
                   ))}
                </tbody>
             </table>
             
             <div className="border-t p-4 flex justify-end">
               <div className="w-64 space-y-2">
                 <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span> <span className="tabular-nums">{formatMoney(inv.subtotal)}</span></div>
                 {inv.discount_amount > 0 && <div className="flex justify-between text-sm text-emerald-600"><span>Discount</span> <span className="tabular-nums">-{formatMoney(inv.discount_amount)}</span></div>}
                 <div className="flex justify-between text-sm border-t pt-2 font-bold"><span>Total</span> <span className="tabular-nums text-lg">{formatMoney(inv.total_amount)}</span></div>
                 <div className="flex justify-between text-sm text-emerald-600 font-medium"><span>Paid</span> <span className="tabular-nums">{formatMoney(inv.amount_paid)}</span></div>
                 <div className="flex justify-between text-sm font-bold text-destructive border-t pt-2"><span>Balance</span> <span className="tabular-nums">{formatMoney(inv.balance_due)}</span></div>
               </div>
             </div>
          </CardContent>
        </Card>

        {/* E-Invoice & Meta panel */}
        <div className="space-y-6">
           <Card>
             <CardHeader className="pb-3 border-b"><CardTitle className="text-sm font-medium flex items-center gap-2"><QrCode className="h-4 w-4"/> E-Invoice portal</CardTitle></CardHeader>
             <CardContent className="p-4">
               {inv.irn ? (
                 <div className="space-y-4">
                   <div className="bg-emerald-50 text-emerald-800 p-3 rounded-lg text-sm font-medium border border-emerald-200">
                     Generated on {formatDate(inv.ack_date)}
                   </div>
                   <div>
                     <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">IRN</p>
                     <p className="text-xs font-mono break-all bg-muted p-2 rounded">{inv.irn}</p>
                   </div>
                 </div>
               ) : (
                 <div className="text-center space-y-4">
                   <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
                   <p className="text-sm text-muted-foreground">NIC IRN has not been generated for this invoice yet.</p>
                   <Button onClick={handleGenerateEInvoice} className="w-full">Generate IRN</Button>
                 </div>
               )}
             </CardContent>
           </Card>

           {/* Payments History */}
           <Card>
             <CardHeader className="pb-3 border-b"><CardTitle className="text-sm font-medium">Payments</CardTitle></CardHeader>
             <CardContent className="p-4">
               {inv.payments && inv.payments.length > 0 ? (
                 <div className="space-y-3">
                   {inv.payments.map((p: any) => (
                     <div key={p.id} className="flex justify-between items-center text-sm border-b last:border-0 pb-2 last:pb-0">
                       <div>
                         <div className="font-medium">{formatDate(p.payment_date)}</div>
                         <div className="text-xs text-muted-foreground capitalize">{p.payment_mode} • {p.payment_number}</div>
                       </div>
                       <div className="font-bold tabular-nums text-emerald-600">{formatMoney(p.amount)}</div>
                     </div>
                   ))}
                 </div>
               ) : (
                 <p className="text-sm text-muted-foreground text-center py-2">No payments recorded</p>
               )}
             </CardContent>
           </Card>
        </div>
      </div>
    </div>
  );
}
