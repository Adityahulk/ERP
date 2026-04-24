import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PurchaseOrderList() {
  const [tab, setTab] = useState('orders');
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', tab],
    queryFn: async () => {
      const endpoint = tab === 'orders' ? '/purchases/orders' : '/purchases/invoices';
      const res = await api.get(endpoint);
      return res.data?.data ?? res.data;
    }
  });

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Purchases</h1>
          <p className="text-slate-500 mt-1">Manage purchase orders and supplier bills.</p>
        </div>
        <Button onClick={() => navigate('/purchases/new')} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> New PO
        </Button>
      </div>

      <div className="flex space-x-1 border-b border-slate-200">
        <button onClick={() => setTab('orders')} className={`py-2 px-4 border-b-2 text-sm font-medium transition-colors ${tab === 'orders' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>Purchase Orders</button>
        <button onClick={() => setTab('bills')} className={`py-2 px-4 border-b-2 text-sm font-medium transition-colors ${tab === 'bills' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>Supplier Bills</button>
      </div>

      <Card>
         <CardContent className="p-0">
           {isLoading ? (
             <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>
           ) : (
             <table className="w-full text-sm text-left">
               <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-medium">
                 <tr>
                    <th className="px-6 py-4">Number</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {(data as any)?.data?.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                       <td className="px-6 py-4 font-medium text-slate-900">{tab === 'orders' ? p.po_number : p.bill_number}</td>
                       <td className="px-6 py-4 text-slate-500">{new Date(tab === 'orders' ? p.po_date : p.bill_date).toLocaleDateString()}</td>
                       <td className="px-6 py-4 font-medium">₹{(p.total_amount / 100).toFixed(2)}</td>
                       <td className="px-6 py-4">
                         <Badge variant="outline" className="capitalize">{p.status}</Badge>
                       </td>
                       <td className="px-6 py-4 text-right">
                          {tab === 'orders' && p.status !== 'received' && (
                             <Button variant="ghost" size="sm" onClick={() => navigate(`/purchases/${p.id}/receive`)}>Receive Stock</Button>
                          )}
                       </td>
                    </tr>
                  ))}
                  {!(data as any)?.data?.length && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">No records found.</td></tr>
                  )}
               </tbody>
             </table>
           )}
         </CardContent>
      </Card>
    </div>
  );
}
