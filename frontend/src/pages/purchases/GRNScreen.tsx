import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScanLine } from 'lucide-react';
import OcrBillSheet, { type OcrResult } from '@/components/shared/OcrBillSheet';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';

const BILL_NUMBER_PATTERN = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const BILL_NUMBER_HELP = 'Use 1-16 characters: A-Z, 0-9, / or -. First character cannot be 0.';

export default function GRNScreen() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [receivals, setReceivals] = useState<Record<string, number>>({});
  const [ocrOpen, setOcrOpen] = useState(false);
  const [companyBankAccountId, setCompanyBankAccountId] = useState('');

  const { data: po, isLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => (await api.get(`/purchases/orders/${id}`)).data?.data,
  });

  /** OCR confirmed → apply bill number and date */
  const handleOcrConfirm = (data: OcrResult & { overrides: any }) => {
    if (data.invoice_number) setBillNumber(String(data.invoice_number).trim().toUpperCase().slice(0, 16));
    if (data.bill_date) setBillDate(data.bill_date);
    toast.success('Bill details applied — verify and confirm receipt');
  };

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
      const normalizedBillNumber = billNumber.trim();
      if (normalizedBillNumber && !BILL_NUMBER_PATTERN.test(normalizedBillNumber)) {
        toast.error(BILL_NUMBER_HELP);
        throw new Error('Invalid bill number');
      }
      return api.post(`/purchases/orders/${id}/receive`, {
        bill_number: normalizedBillNumber || undefined,
        bill_date: billDate,
        company_bank_account_id: companyBankAccountId || undefined,
        items,
      });
    },
    onSuccess: () => {
      toast.success('Stock Received via GRN');
      navigate('/purchases');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'GRN failed'),
  });

  if (isLoading) return <div>Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Receive Stock (GRN): {po?.po_number}</h1>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">
          {/* Supplier Bill Details */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Supplier Bill Details</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setOcrOpen(true)}
              >
                <ScanLine className="w-4 h-4" />
                Scan Bill
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Upload a photo or PDF of the supplier's bill to auto-fill the number and date below.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Supplier Bill Number</label>
                <Input
                  value={billNumber}
                  maxLength={16}
                  onChange={e => setBillNumber(e.target.value.trim().toUpperCase())}
                  placeholder="e.g. INV-2024-001"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">{BILL_NUMBER_HELP}</p>
              </div>
              <div>
                <label className="text-sm font-medium">Supplier Bill Date</label>
                <Input
                  type="date"
                  value={billDate}
                  onChange={e => setBillDate(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <BankAccountPicker remountKey={id ?? 0} value={companyBankAccountId} onChange={setCompanyBankAccountId} />

          {/* Items */}
          <div className="space-y-4">
            <h3 className="font-semibold border-b pb-2">Items Expected</h3>
            {po?.items?.map((item: any) => (
              <div key={item.id} className="flex gap-4 items-center">
                <div className="flex-1 font-medium">
                  {item.item_name}{' '}
                  <span className="text-muted-foreground font-normal text-sm">
                    (Ordered: {item.quantity_ordered})
                  </span>
                </div>
                <Input
                  type="number"
                  placeholder="Qty Receiving"
                  className="w-32"
                  value={receivals[item.id] || ''}
                  onChange={e =>
                    setReceivals({ ...receivals, [item.id]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
          </div>

          <Button
            onClick={() => receiveAction.mutate()}
            className="w-full"
            loading={receiveAction.isPending}
          >
            Confirm Stock Receipt
          </Button>
        </CardContent>
      </Card>

      <OcrBillSheet
        open={ocrOpen}
        onOpenChange={setOcrOpen}
        context="Purchase Bill"
        onConfirm={handleOcrConfirm}
      />
    </div>
  );
}
