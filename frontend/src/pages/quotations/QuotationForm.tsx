import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGodowns } from '@/hooks/useStock';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';

const rupeesToPaise = (r: number) => Math.round(r * 100);

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{children}</p>;
}

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
  const [discountRupees, setDiscountRupees] = useState('');
  const [totalRupees, setTotalRupees] = useState('');
  const [partyNameOverride, setPartyNameOverride] = useState('');
  const [partyPhoneOverride, setPartyPhoneOverride] = useState('');
  const [partyEmailOverride, setPartyEmailOverride] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');

  const defaultGodown = useMemo(() => {
    const def = godowns.find((g: any) => g.is_default);
    return def?.id ?? godowns[0]?.id ?? '';
  }, [godowns]);

  useEffect(() => {
    if (!godownId && defaultGodown) setGodownId(defaultGodown);
  }, [godownId, defaultGodown]);

  const create = useMutation({
    mutationFn: async () => {
      const discount = rupeesToPaise(parseFloat(discountRupees) || 0);
      const total = rupeesToPaise(parseFloat(totalRupees) || 0);
      const subtotal = total + discount;
      return api.post('/quotations', {
        party_id: partyId,
        godown_id: godownId || undefined,
        quotation_number: quotationNumber.trim() || undefined,
        quotation_date: quotationDate,
        valid_until: validUntil || undefined,
        subtotal,
        discount_amount: discount,
        total_amount: total,
        party_name_override: partyNameOverride.trim() || undefined,
        party_phone_override: partyPhoneOverride.trim() || undefined,
        party_email_override: partyEmailOverride.trim() || undefined,
        customer_notes: customerNotes.trim() || undefined,
        internal_notes: internalNotes.trim() || undefined,
        terms_and_conditions: termsAndConditions.trim() || undefined,
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
  const totalOk =
    totalRupees.trim() !== '' &&
    !Number.isNaN(parseFloat(totalRupees)) &&
    parseFloat(totalRupees) >= 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/quotations')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New quotation</h1>
          <p className="text-sm text-muted-foreground">
            A quotation (quote) is a formal price offer. Line-item GST breakdown can be added in a later release.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Quote reference</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div>
            <Label htmlFor="quote-ref">Quotation number (optional)</Label>
            <Input
              id="quote-ref"
              className="mt-1.5 max-w-md font-mono text-sm"
              placeholder="e.g. QT-2026-0042 or leave blank for auto-number"
              value={quotationNumber}
              onChange={(e) => setQuotationNumber(e.target.value)}
            />
            <FieldHint>
              This is the <strong>document reference</strong> printed on the quote—the same role as an invoice number,
              but for a pre-sale offer. If you leave it blank, the system assigns the next number from your company&apos;s{' '}
              <strong>quotation series</strong> (same style as invoices: prefix / branch / financial year / sequence).
            </FieldHint>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div>
                <Label>Bill-to customer</Label>
                <select
                  className="mt-1.5 w-full h-10 rounded-md border bg-background px-3 text-sm"
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
                <Label>Godown / branch context (optional)</Label>
                <select
                  className="mt-1.5 w-full h-10 rounded-md border bg-background px-3 text-sm"
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
                <FieldHint>Used for numbering (HQ vs GW) and stock context when you convert this quote to an invoice.</FieldHint>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <Label>Display name on quote (optional)</Label>
                  <Input
                    className="mt-1.5"
                    placeholder="Override legal name for this PDF"
                    value={partyNameOverride}
                    onChange={(e) => setPartyNameOverride(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Quote contact phone (optional)</Label>
                  <Input
                    className="mt-1.5"
                    placeholder="Shown on quote only"
                    value={partyPhoneOverride}
                    onChange={(e) => setPartyPhoneOverride(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Quote contact email (optional)</Label>
                  <Input
                    type="email"
                    className="mt-1.5"
                    placeholder="Shown on quote only"
                    value={partyEmailOverride}
                    onChange={(e) => setPartyEmailOverride(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Dates & validity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 pt-0">
          <div>
            <Label>Quotation date</Label>
            <Input type="date" className="mt-1.5" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
            <FieldHint>Date the quote is issued.</FieldHint>
          </div>
          <div>
            <Label>Valid until (offer expiry)</Label>
            <Input type="date" className="mt-1.5" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            <FieldHint>Prices and terms normally apply only until this date.</FieldHint>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Amounts (summary)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Discount (₹)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="mt-1.5 tabular-nums"
                placeholder="0.00"
                value={discountRupees}
                onChange={(e) => setDiscountRupees(e.target.value)}
              />
              <FieldHint>Total discount on this quote (before tax). Optional.</FieldHint>
            </div>
            <div>
              <Label>Quote total (₹) incl. taxes</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="mt-1.5 tabular-nums"
                placeholder="0.00"
                value={totalRupees}
                onChange={(e) => setTotalRupees(e.target.value)}
              />
              <FieldHint>Final round-figure you are offering on this quotation.</FieldHint>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Notes & terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div>
            <Label>Customer notes (optional)</Label>
            <textarea
              className="mt-1.5 w-full min-h-[88px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Message printed on the quote for the customer—e.g. delivery timeline, scope summary."
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
            />
          </div>
          <div>
            <Label>Internal notes (optional)</Label>
            <textarea
              className="mt-1.5 w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Not shown to customer—margin, competitor, follow-up reminders."
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
            />
          </div>
          <div>
            <Label>Terms & conditions (optional)</Label>
            <textarea
              className="mt-1.5 w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Payment terms, warranty, exclusions, validity, etc."
              value={termsAndConditions}
              onChange={(e) => setTermsAndConditions(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          onClick={() => create.mutate()}
          disabled={!partyId || !quotationDate || !totalOk || create.isPending}
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save quotation'}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate('/quotations')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
