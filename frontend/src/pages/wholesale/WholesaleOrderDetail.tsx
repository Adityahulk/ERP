import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Truck, CheckCircle2, Package, XCircle } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useState } from 'react';

const STATUS_STEPS = ['draft', 'confirmed', 'dispatched', 'delivered'];
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', confirmed: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-amber-100 text-amber-700', delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function WholesaleOrderDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const qc = useQueryClient();
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({ dispatch_date: new Date().toISOString().split('T')[0], transport_details: '', lr_number: '', vehicle_number: '', eway_bill_number: '' });

  const { data: order, isLoading } = useQuery({
    queryKey: ['wholesale-order', id], enabled: !!id,
    queryFn: () => api.get(`/wholesale/${id}`).then(r => r.data?.data ?? r.data),
  });

  const confirmMut = useMutation({ mutationFn: () => api.post(`/wholesale/${id}/confirm`), onSuccess: () => { toast.success('Order confirmed'); qc.invalidateQueries({ queryKey: ['wholesale-order', id] }); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const dispatchMut = useMutation({ mutationFn: (d: any) => api.post(`/wholesale/${id}/dispatch`, d), onSuccess: () => { toast.success('Order dispatched'); setShowDispatch(false); qc.invalidateQueries({ queryKey: ['wholesale-order', id] }); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const deliverMut = useMutation({ mutationFn: () => api.post(`/wholesale/${id}/deliver`), onSuccess: () => { toast.success('Order delivered'); qc.invalidateQueries({ queryKey: ['wholesale-order', id] }); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const cancelMut = useMutation({ mutationFn: () => api.post(`/wholesale/${id}/cancel`), onSuccess: () => { toast.success('Order cancelled'); qc.invalidateQueries({ queryKey: ['wholesale-order', id] }); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });

  if (isLoading) return <div className="p-8 text-center text-slate-400">Loading order...</div>;
  if (!order) return <div className="p-8 text-center text-red-500">Order not found</div>;

  const fmtAmt = (v: number) => `₹${((v || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const currentStep = STATUS_STEPS.indexOf(order.status);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <Button variant="ghost" className="mb-4 gap-2 text-slate-600" onClick={() => navigate('/wholesale')}><ArrowLeft className="w-4 h-4" /> Back to Orders</Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Truck className="w-6 h-6 text-indigo-600" /> {order.order_number}</h1>
          <p className="text-slate-500 text-sm mt-1">{order.party_name_snapshot || order.party_name} • {new Date(order.order_date).toLocaleDateString('en-IN')}</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm font-bold uppercase ${STATUS_COLORS[order.status] || 'bg-slate-100'}`}>{order.status}</span>
      </div>

      {/* Status Timeline */}
      {order.status !== 'cancelled' && (
        <div className="flex items-center gap-0 mb-8">
          {STATUS_STEPS.map((step, i) => (
            <div key={step} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i <= currentStep ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {i < currentStep ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <p className={`ml-2 text-xs font-medium capitalize ${i <= currentStep ? 'text-indigo-600' : 'text-slate-400'}`}>{step}</p>
              {i < STATUS_STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < currentStep ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {order.status === 'draft' && <Button onClick={() => confirmMut.mutate()} loading={confirmMut.isPending} className="gap-2"><CheckCircle2 className="w-4 h-4" /> Confirm Order</Button>}
        {order.status === 'confirmed' && <Button onClick={() => setShowDispatch(true)} className="gap-2 bg-amber-600 hover:bg-amber-700"><Truck className="w-4 h-4" /> Dispatch</Button>}
        {order.status === 'dispatched' && <Button onClick={() => deliverMut.mutate()} loading={deliverMut.isPending} className="gap-2 bg-emerald-600 hover:bg-emerald-700"><Package className="w-4 h-4" /> Mark Delivered</Button>}
        {['draft', 'confirmed'].includes(order.status) && <Button variant="outline" className="gap-2 text-red-600" onClick={() => cancelMut.mutate()} loading={cancelMut.isPending}><XCircle className="w-4 h-4" /> Cancel</Button>}
      </div>

      {/* Dispatch Form */}
      {showDispatch && (
        <Card className="mb-6 border-amber-200 bg-amber-50"><CardContent className="p-4 space-y-3">
          <h3 className="font-bold text-amber-800">Dispatch Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><Label className="text-xs">Date</Label><Input type="date" className="mt-1" value={dispatchForm.dispatch_date} onChange={e => setDispatchForm({ ...dispatchForm, dispatch_date: e.target.value })} /></div>
            <div><Label className="text-xs">Transport</Label><Input className="mt-1" value={dispatchForm.transport_details} onChange={e => setDispatchForm({ ...dispatchForm, transport_details: e.target.value })} /></div>
            <div><Label className="text-xs">LR #</Label><Input className="mt-1" value={dispatchForm.lr_number} onChange={e => setDispatchForm({ ...dispatchForm, lr_number: e.target.value })} /></div>
            <div><Label className="text-xs">Vehicle #</Label><Input className="mt-1" value={dispatchForm.vehicle_number} onChange={e => setDispatchForm({ ...dispatchForm, vehicle_number: e.target.value })} /></div>
            <div><Label className="text-xs">E-Way Bill #</Label><Input className="mt-1" value={dispatchForm.eway_bill_number} onChange={e => setDispatchForm({ ...dispatchForm, eway_bill_number: e.target.value })} /></div>
          </div>
          <div className="flex gap-2"><Button className="bg-amber-600 hover:bg-amber-700" loading={dispatchMut.isPending} onClick={() => dispatchMut.mutate(dispatchForm)}>Confirm Dispatch</Button><Button variant="outline" onClick={() => setShowDispatch(false)}>Cancel</Button></div>
        </CardContent></Card>
      )}

      {/* Order Info */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <Card><CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-slate-700 mb-2">Order Details</h3>
          <p className="text-sm"><span className="text-slate-500">Party:</span> <span className="font-medium">{order.party_name_snapshot || order.party_name}</span></p>
          <p className="text-sm"><span className="text-slate-500">GSTIN:</span> {order.party_gstin_snapshot || '—'}</p>
          <p className="text-sm"><span className="text-slate-500">Godown:</span> {order.godown_name || '—'}</p>
          {order.expected_delivery && <p className="text-sm"><span className="text-slate-500">Expected Delivery:</span> {new Date(order.expected_delivery).toLocaleDateString('en-IN')}</p>}
          {order.notes && <p className="text-sm"><span className="text-slate-500">Notes:</span> {order.notes}</p>}
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-slate-700 mb-2">Amount Summary</h3>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span>{fmtAmt(order.subtotal)}</span></div>
          {order.cgst_amount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">CGST</span><span>{fmtAmt(order.cgst_amount)}</span></div>}
          {order.sgst_amount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">SGST</span><span>{fmtAmt(order.sgst_amount)}</span></div>}
          {order.igst_amount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">IGST</span><span>{fmtAmt(order.igst_amount)}</span></div>}
          <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Total</span><span className="text-indigo-600">{fmtAmt(order.total_amount)}</span></div>
        </CardContent></Card>
      </div>

      {/* Transport Info */}
      {order.dispatch_date && (
        <Card className="mb-6"><CardContent className="p-4">
          <h3 className="font-bold text-slate-700 mb-2">Dispatch Info</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div><p className="text-slate-500">Dispatch Date</p><p className="font-medium">{new Date(order.dispatch_date).toLocaleDateString('en-IN')}</p></div>
            <div><p className="text-slate-500">Transport</p><p className="font-medium">{order.transport_details || '—'}</p></div>
            <div><p className="text-slate-500">LR #</p><p className="font-medium">{order.lr_number || '—'}</p></div>
            <div><p className="text-slate-500">Vehicle #</p><p className="font-medium">{order.vehicle_number || '—'}</p></div>
            <div><p className="text-slate-500">E-Way Bill</p><p className="font-medium">{order.eway_bill_number || '—'}</p></div>
          </div>
        </CardContent></Card>
      )}

      {/* Items Table */}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b"><tr>
            <th className="px-4 py-3 font-semibold text-slate-600">#</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Item</th>
            <th className="px-4 py-3 font-semibold text-slate-600">HSN</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Qty</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Rate</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">GST %</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Amount</th>
          </tr></thead>
          <tbody className="divide-y">
            {(order.items || []).map((item: any, i: number) => (
              <tr key={item.id}><td className="px-4 py-3 text-slate-400">{i + 1}</td>
                <td className="px-4 py-3 font-medium">{item.item_name}{item.tier_applied ? <span className="ml-2 text-xs text-indigo-500">[{item.tier_applied}]</span> : ''}</td>
                <td className="px-4 py-3 text-slate-500">{item.hsn_code || '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(item.quantity)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtAmt(item.unit_price)}</td>
                <td className="px-4 py-3 text-right">{item.gst_rate}%</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">{fmtAmt(item.total_amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
