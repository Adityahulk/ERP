import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatMoney } from '@/lib/formatters';
import { useGenerateEwayBill } from '@/hooks/useBusiness';

type EligibleInvoice = {
  id: string;
  invoice_number: string;
  party_name: string;
  total_amount: number;
  invoice_date: string;
  eway_bill_status?: string;
  eway_bill_no?: string;
};

const emptyForm = {
  transporter_id: '',
  transporter_name: '',
  vehicle_no: '',
  vehicle_type: 'R' as 'R' | 'O',
  transport_mode: '1',
  distance_km: '',
  trans_doc_no: '',
  trans_doc_dt: '',
};

export default function EwayBillPage() {
  const genEwb = useGenerateEwayBill();
  const [selected, setSelected] = useState<EligibleInvoice | null>(null);
  const [ewbForm, setEwbForm] = useState(emptyForm);

  const { data: invoices = [], isLoading, refetch } = useQuery<EligibleInvoice[]>({
    queryKey: ['eway-bill', 'eligible'],
    queryFn: async () => (await api.get('/gst/eway-bill/eligible')).data?.data || [],
  });

  const openGenerate = (inv: EligibleInvoice) => {
    setSelected(inv);
    setEwbForm(emptyForm);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const tid = ewbForm.transporter_id.trim().toUpperCase();
    const vn = ewbForm.vehicle_no.trim().toUpperCase();
    if (tid && tid.length !== 15) {
      toast.error('Transporter ID must be blank or exactly 15 characters');
      return;
    }
    if (vn.length < 4) {
      toast.error('Vehicle number must be at least 4 characters');
      return;
    }
    const t = toast.loading('Generating E-Way Bill…');
    try {
      await genEwb.mutateAsync({
        id: selected.id,
        data: {
          transporter_id: tid || undefined,
          transporter_name: ewbForm.transporter_name.trim() || undefined,
          vehicle_no: vn,
          vehicle_type: ewbForm.vehicle_type,
          transport_mode: ewbForm.transport_mode,
          distance_km: ewbForm.distance_km === '' ? 0 : Number(ewbForm.distance_km),
          trans_doc_no: ewbForm.trans_doc_no.trim() || undefined,
          trans_doc_dt: ewbForm.trans_doc_dt.trim() || undefined,
        },
      });
      toast.success('E-Way Bill generated', { id: t });
      setSelected(null);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed', { id: t });
    }
  };

  return (
    <div className="h-full bg-slate-50">
      <div className="border-b bg-white px-6 py-4">
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/gst-filing"><ArrowLeft className="mr-2 h-4 w-4" /> GST Returns</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">E-way Bills</h1>
        <p className="text-sm text-slate-500">Invoices with IRN generated and no active e-way bill — generate transport documents from here.</p>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 text-left">Invoice</th>
                  <th className="p-3 text-left">Party</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 text-left">EWB status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && !invoices.length && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No eligible invoices right now.</td></tr>
                )}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{inv.invoice_number}</td>
                    <td className="p-3">{inv.party_name}</td>
                    <td className="p-3">{formatDate(inv.invoice_date)}</td>
                    <td className="p-3 text-right tabular-nums">{formatMoney(inv.total_amount)}</td>
                    <td className="p-3">
                      <Badge variant={inv.eway_bill_status === 'cancelled' ? 'secondary' : 'outline'}>
                        {inv.eway_bill_status || 'pending'}
                      </Badge>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/sales/invoices/${inv.id}`}><ExternalLink className="mr-1 h-3.5 w-3.5" /> View</Link>
                      </Button>
                      <Button size="sm" onClick={() => openGenerate(inv)}>
                        <Truck className="mr-1 h-3.5 w-3.5" /> Generate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Generate E-Way Bill — {selected?.invoice_number}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4 text-sm">
            <p className="text-muted-foreground text-xs">
              Same fields as invoice detail. Vehicle number is required (min 4 characters).
            </p>
            <div className="space-y-2">
              <Label htmlFor="ewb-transporter-id">Transporter ID (optional)</Label>
              <Input
                id="ewb-transporter-id"
                className="font-mono uppercase"
                maxLength={15}
                value={ewbForm.transporter_id}
                onChange={(e) => setEwbForm((f) => ({ ...f, transporter_id: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ewb-vehicle">Vehicle number</Label>
              <Input
                id="ewb-vehicle"
                className="font-mono uppercase"
                value={ewbForm.vehicle_no}
                onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_no: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ewb-transporter-name">Transporter name (optional)</Label>
              <Input
                id="ewb-transporter-name"
                value={ewbForm.transporter_name}
                onChange={(e) => setEwbForm((f) => ({ ...f, transporter_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Transport mode</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-2"
                  value={ewbForm.transport_mode}
                  onChange={(e) => setEwbForm((f) => ({ ...f, transport_mode: e.target.value }))}
                >
                  <option value="1">Road</option>
                  <option value="2">Rail</option>
                  <option value="3">Air</option>
                  <option value="4">Ship</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Distance (km)</Label>
                <Input
                  type="number"
                  min={0}
                  value={ewbForm.distance_km}
                  onChange={(e) => setEwbForm((f) => ({ ...f, distance_km: e.target.value }))}
                />
              </div>
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={genEwb.isPending}>
              Generate E-Way Bill
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
