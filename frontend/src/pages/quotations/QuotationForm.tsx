import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';

const rupeesToPaise = (r: number) => Math.round(r * 100);

export default function QuotationForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: godownRes } = useGodowns();
  const godowns = (godownRes as any)?.data ?? [];

  const { data: partyRes, isLoading: partiesLoading } = useQuery({
    queryKey: ['parties', 'customers', 'quotation'],
    queryFn: () =>
      api.get('/parties', { params: { party_type: 'customer', limit: 100 } }).then((r) => r.data?.data ?? r.data),
  });
  const customers = (partyRes as any)?.data ?? [];

  const [partyId, setPartyId] = useState('');
  const [godownId, setGodownId] = useState('');
  const [quotationNumber, setQuotationNumber] = useState('');
  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  });
  const [totalRupees, setTotalRupees] = useState('');

  const defaultGodown = useMemo(() => {
    const def = godowns.find((g: any) => g.is_default);
    return def?.id ?? godowns[0]?.id ?? '';
  }, [godowns]);

  useEffect(() => {
    if (!godownId && defaultGodown) setGodownId(defaultGodown);
  }, [godownId, defaultGodown]);

  const create = useMutation({
    mutationFn: async () => {
      const total = rupeesToPaise(parseFloat(totalRupees) || 0);
      return api.post('/quotations', {
        party_id: partyId,
        godown_id: godownId || undefined,
        quotation_number: quotationNumber.trim() || undefined,
        quotation_date: quotationDate,
        valid_until: validUntil || undefined,
        subtotal: total,
        total_amount: total,
      });
    },
    onSuccess: () => {
      toast.success('Quotation created');
      qc.invalidateQueries({ queryKey: ['quotations'] });
      navigate('/quotations');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || e.message || 'Failed'),
  });

  const loading = partiesLoading;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/quotations')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New quotation</h1>
          <p className="text-sm text-muted-foreground">Quick quote with customer and total (line items can be added later).</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div>
                <Label>Customer</Label>
                <select
                  className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                >
                  <option value="">Select customer</option>
                  {customers.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Godown (optional)</Label>
                <select
                  className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={godownId}
                  onChange={(e) => setGodownId(e.target.value)}
                >
                  <option value="">—</option>
                  {godowns.map((g: any) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Quotation number (optional)</Label>
                <Input
                  className="mt-1"
                  placeholder="Leave blank to auto-generate"
                  value={quotationNumber}
                  onChange={(e) => setQuotationNumber(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Quote date</Label>
                  <Input type="date" className="mt-1" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
                </div>
                <div>
                  <Label>Valid until</Label>
                  <Input type="date" className="mt-1" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Total (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="mt-1 tabular-nums"
                  placeholder="0.00"
                  value={totalRupees}
                  onChange={(e) => setTotalRupees(e.target.value)}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => create.mutate()}
                  disabled={!partyId || !quotationDate || create.isPending}
                >
                  {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save quotation'}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/quotations')}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
