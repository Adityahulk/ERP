import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function GRNScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [billNumber, setBillNumber] = useState('');
  const [receivals, setReceivals] = useState<Record<string, number>>({});

  const { data: po, isLoading } = useQuery({
     queryKey: ['po', id],
     queryFn: async () => (await api.get(`/purchases/orders/${id}`)).data?.data
  });

  const receiveAction = useMutation({
     mutationFn: async () => {
       if (!po?.items?.length) {
         toast.error('Purchase order has no lines');
         throw new Error('No PO lines');
       }
       const items = Object.entries(receivals)
         .filter(([, qty]) => Number(qty) > 0)
         .map(([itemId, qty]) => {
           const line = po?.items?.find((it: { id: string }) => it.id === itemId);
           return {
             po_item_id: itemId,
             quantity_received: Number(qty),
             unit_price: Number(line?.unit_price) || 0,
             gst_rate: Number(line?.gst_rate ?? 0),
           };
         });
       if (items.length === 0) {
         toast.error('Enter at least one positive quantity to receive');
         throw new Error('No quantities');
       }
      return api.post(`/purchases/orders/${id}/receive`, {
         bill_number: billNumber,
         bill_date: new Date().toISOString().split('T')[0],
         items
       });
     },
     onSuccess: () => {
        toast.success('Stock Received via GRN');
        navigate('/purchases');
     },
     onError: (e: any) => toast.error(e.response?.data?.error || 'GRN failed'),
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Receive Stock (GRN): {po?.po_number}</h1>
      <Card>
         <CardContent className="p-6 space-y-6">
             <div>
                <label className="text-sm font-medium">Supplier Bill Number</label>
                <Input value={billNumber} onChange={e => setBillNumber(e.target.value)} placeholder="e.g. INV-2023" />
             </div>

             <div className="space-y-4">
                <h3 className="font-semibold border-b pb-2">Items Expected</h3>
                {po?.items.map((item: any) => (
                   <div key={item.id} className="flex gap-4 items-center">
                      <div className="flex-1 font-medium">{item.item_name} (Ordered: {item.quantity_ordered})</div>
                      <Input 
                        type="number" 
                        placeholder="Qty Receiving" 
                        className="w-32" 
                        value={receivals[item.id] || ''}
                        onChange={e => setReceivals({ ...receivals, [item.id]: Number(e.target.value) })}
                      />
                   </div>
                ))}
             </div>

             <Button onClick={() => receiveAction.mutate()} className="w-full" loading={receiveAction.isPending}>
               Confirm Stock Receipt
             </Button>
         </CardContent>
      </Card>
    </div>
  );
}
