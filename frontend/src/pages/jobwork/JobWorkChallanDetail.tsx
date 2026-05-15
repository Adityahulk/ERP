import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Wrench, Send, ArrowDownLeft, XCircle, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useState } from 'react';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', sent: 'bg-blue-100 text-blue-700',
  partial_return: 'bg-amber-100 text-amber-700', returned: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function JobWorkChallanDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const qc = useQueryClient();
  const [showReceive, setShowReceive] = useState(false);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);

  const { data: challan, isLoading } = useQuery({
    queryKey: ['jw-challan', id], enabled: !!id,
    queryFn: () => api.get(`/job-work/challans/${id}`).then(r => r.data?.data ?? r.data),
  });

  const sendMut = useMutation({ mutationFn: () => api.post(`/job-work/challans/${id}/send`), onSuccess: () => { toast.success('Challan sent — stock deducted'); qc.invalidateQueries({ queryKey: ['jw-challan', id] }); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const cancelMut = useMutation({ mutationFn: () => api.post(`/job-work/challans/${id}/cancel`), onSuccess: () => { toast.success('Challan cancelled'); qc.invalidateQueries({ queryKey: ['jw-challan', id] }); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const receiveMut = useMutation({
    mutationFn: (data: any) => api.post(`/job-work/challans/${id}/receive`, data),
    onSuccess: () => { toast.success('Materials received'); setShowReceive(false); qc.invalidateQueries({ queryKey: ['jw-challan', id] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const downloadPdf = async () => {
    try {
      const res = await api.get(`/job-work/challans/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${challan?.challan_number || 'job-work-challan'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Challan download started');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Download failed');
    }
  };

  const startReceive = () => {
    if (!challan?.items) return;
    setReceiveItems(challan.items.map((i: any) => ({
      challan_item_id: i.id, item_name: i.item_name,
      max_receivable: Number(i.quantity_sent) - Number(i.quantity_received) - Number(i.quantity_rejected) - Number(i.wastage),
      quantity_received: 0, quantity_rejected: 0, wastage: 0,
    })));
    setShowReceive(true);
  };

  if (isLoading) return <div className="p-8 text-center text-slate-400">Loading...</div>;
  if (!challan) return <div className="p-8 text-center text-red-500">Challan not found</div>;

  const fmtAmt = (v: number) => `₹${((v || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const isOverdue = challan.challan_type === 'outward' && challan.return_due_date && !challan.is_returned && challan.status !== 'cancelled' && challan.status !== 'returned' && new Date(challan.return_due_date) < new Date();

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 animate-in slide-in-from-bottom-4 duration-500">
      <Button variant="ghost" className="mb-4 gap-2 text-slate-600" onClick={() => navigate('/job-work')}><ArrowLeft className="w-4 h-4" /> Back</Button>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Wrench className="w-6 h-6 text-indigo-600" /> {challan.challan_number}</h1>
          <p className="text-slate-500 text-sm mt-1">{challan.challan_type.toUpperCase()} • {challan.party_name_snapshot || challan.party_name} • {new Date(challan.challan_date).toLocaleDateString('en-IN')}</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm font-bold uppercase ${isOverdue ? 'bg-red-100 text-red-700' : (STATUS_COLORS[challan.status] || 'bg-slate-100')}`}>
          {isOverdue ? 'OVERDUE' : challan.status}
        </span>
      </div>

      {/* Overdue Warning */}
      {isOverdue && (
        <Card className="mb-6 border-red-200 bg-red-50"><CardContent className="p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <div>
            <p className="font-bold text-red-800">⚠ GST Section 143 — Return Deadline Exceeded</p>
            <p className="text-xs text-red-600">Materials were due by {new Date(challan.return_due_date!).toLocaleDateString('en-IN')}. Unreturned goods may be treated as deemed supply and attract GST liability.</p>
          </div>
        </CardContent></Card>
      )}

      {/* Actions */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <Button variant="outline" onClick={downloadPdf} className="gap-2"><Download className="w-4 h-4" /> Download PDF</Button>
        {challan.status === 'draft' && challan.challan_type === 'outward' && (
          <Button onClick={() => sendMut.mutate()} loading={sendMut.isPending} className="gap-2"><Send className="w-4 h-4" /> Send to Job Worker</Button>
        )}
        {['sent', 'partial_return'].includes(challan.status) && challan.challan_type === 'outward' && (
          <Button onClick={startReceive} className="gap-2 bg-emerald-600 hover:bg-emerald-700"><ArrowDownLeft className="w-4 h-4" /> Receive Materials</Button>
        )}
        {challan.status === 'draft' && (
          <Button variant="outline" className="gap-2 text-red-600" onClick={() => cancelMut.mutate()} loading={cancelMut.isPending}><XCircle className="w-4 h-4" /> Cancel</Button>
        )}
      </div>

      {/* Receive Panel */}
      {showReceive && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50"><CardContent className="p-4">
          <h3 className="font-bold text-emerald-800 mb-3 flex items-center gap-2"><ArrowDownLeft className="w-4 h-4" /> Record Received Materials</h3>
          <div className="space-y-2">
            {receiveItems.map((ri, i) => (
              <div key={ri.challan_item_id} className="grid grid-cols-12 gap-2 items-center p-2 bg-white rounded-lg">
                <div className="col-span-3"><p className="text-sm font-medium">{ri.item_name}</p><p className="text-xs text-slate-500">Remaining: {ri.max_receivable}</p></div>
                <div className="col-span-3"><Label className="text-xs">Received</Label><Input type="number" min={0} max={ri.max_receivable} className="mt-1" value={ri.quantity_received || ''} onChange={e => { const u = [...receiveItems]; u[i].quantity_received = parseFloat(e.target.value) || 0; setReceiveItems(u); }} /></div>
                <div className="col-span-3"><Label className="text-xs">Rejected</Label><Input type="number" min={0} className="mt-1" value={ri.quantity_rejected || ''} onChange={e => { const u = [...receiveItems]; u[i].quantity_rejected = parseFloat(e.target.value) || 0; setReceiveItems(u); }} /></div>
                <div className="col-span-3"><Label className="text-xs">Wastage</Label><Input type="number" min={0} className="mt-1" value={ri.wastage || ''} onChange={e => { const u = [...receiveItems]; u[i].wastage = parseFloat(e.target.value) || 0; setReceiveItems(u); }} /></div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <Button className="bg-emerald-600 hover:bg-emerald-700" loading={receiveMut.isPending} onClick={() => receiveMut.mutate({ items: receiveItems.filter(r => r.quantity_received > 0 || r.quantity_rejected > 0 || r.wastage > 0) })}>Confirm Receipt</Button>
            <Button variant="outline" onClick={() => setShowReceive(false)}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {/* Details */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <Card><CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-slate-700 mb-2">Challan Details</h3>
          <p className="text-sm"><span className="text-slate-500">Party:</span> <span className="font-medium">{challan.party_name_snapshot || challan.party_name}</span></p>
          <p className="text-sm"><span className="text-slate-500">GSTIN:</span> {challan.party_gstin_snapshot || '—'}</p>
          <p className="text-sm"><span className="text-slate-500">Godown:</span> {challan.godown_name || '—'}</p>
          {challan.return_due_date && <p className="text-sm"><span className="text-slate-500">Return Due:</span> <span className={isOverdue ? 'text-red-600 font-bold' : ''}>{new Date(challan.return_due_date).toLocaleDateString('en-IN')}</span></p>}
          <p className="text-sm"><span className="text-slate-500">Capital Goods:</span> {challan.is_capital_goods ? 'Yes (3yr return)' : 'No (1yr return)'}</p>
          {challan.transport_details && <p className="text-sm"><span className="text-slate-500">Transport:</span> {challan.transport_details}</p>}
          {challan.vehicle_number && <p className="text-sm"><span className="text-slate-500">Vehicle:</span> {challan.vehicle_number}</p>}
          {challan.notes && <p className="text-sm"><span className="text-slate-500">Notes:</span> {challan.notes}</p>}
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-slate-700 mb-2">Charges & Values</h3>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Material Value</span><span className="font-medium">{fmtAmt(challan.total_material_value)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Labour Charges</span><span>{fmtAmt(challan.labour_charges)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Other Charges</span><span>{fmtAmt(challan.other_charges)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">GST on Charges</span><span>{fmtAmt(challan.gst_on_charges)}</span></div>
          <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Total Charges</span><span className="text-indigo-600">{fmtAmt(challan.total_charges)}</span></div>
        </CardContent></Card>
      </div>

      {/* Items Table */}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b"><tr>
            <th className="px-4 py-3 font-semibold text-slate-600">#</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Material</th>
            <th className="px-4 py-3 font-semibold text-slate-600">HSN/SAC</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Sent</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Received</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Rejected</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Wastage</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-right">Value</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
          </tr></thead>
          <tbody className="divide-y">
            {(challan.items || []).map((item: any, i: number) => {
              const pending = Number(item.quantity_sent) - Number(item.quantity_received) - Number(item.quantity_rejected) - Number(item.wastage);
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{item.item_name}</td>
                  <td className="px-4 py-3 text-slate-500">{item.hsn_code || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(item.quantity_sent)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{Number(item.quantity_received)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-500">{Number(item.quantity_rejected)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-500">{Number(item.wastage)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtAmt(item.total_value)}</td>
                  <td className="px-4 py-3">
                    {pending <= 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <span className="text-xs text-amber-600">{pending} pending</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
