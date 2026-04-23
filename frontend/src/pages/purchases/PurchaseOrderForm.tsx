import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function PurchaseOrderForm() {
  const navigate = useNavigate();
  const [partyId, setPartyId] = useState('');
  
  // simplified for space, using the exact same generic schema
  const createPO = useMutation({
    mutationFn: async () => {
      return api.post('/purchase/orders', {
        party_id: partyId,
        po_date: new Date().toISOString().split('T')[0],
        items: [{ item_name: 'Raw Materials', quantity: 100, unit_price: 500, gst_rate: 18 }] // mocked item for UI layout purposes
      });
    },
    onSuccess: () => {
      toast.success('PO Created');
      navigate('/purchases');
    }
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">New Purchase Order</h1>
      <Card>
        <CardContent className="p-6 space-y-4">
           <div>
             <label className="text-sm font-medium">Supplier ID (Mocked until Autocomplete available)</label>
             <Input value={partyId} onChange={e => setPartyId(e.target.value)} placeholder="UUID of Supplier" />
           </div>
           
           <Button onClick={() => createPO.mutate()} disabled={!partyId}>Save Purchase Order</Button>
        </CardContent>
      </Card>
    </div>
  );
}
