import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  onCreated: (party: Record<string, unknown>) => void;
};

type PartyForm = {
  name: string;
  gstin: string;
  phone: string;
  email: string;
  pan: string;
  billing_address: string;
  shipping_address: string;
  city: string;
  state: string;
  pincode: string;
  state_code: string;
  contact_person: string;
  notes: string;
  credit_limit_rupees: string;
  payment_terms: string;
  opening_balance_rupees: string;
};

function emptyForm(defaultName: string): PartyForm {
  return {
    name: defaultName.trim(),
    gstin: '',
    phone: '',
    email: '',
    pan: '',
    billing_address: '',
    shipping_address: '',
    city: '',
    state: '',
    pincode: '',
    state_code: '',
    contact_person: '',
    notes: '',
    credit_limit_rupees: '',
    payment_terms: '30',
    opening_balance_rupees: '',
  };
}

function extractPartyRow(resBody: unknown): Record<string, unknown> | null {
  if (!resBody || typeof resBody !== 'object') return null;
  const envelope = resBody as { data?: unknown; success?: boolean };
  const inner = envelope.data;
  const row =
    inner && typeof inner === 'object' && inner !== null && 'id' in inner
      ? (inner as Record<string, unknown>)
      : 'id' in envelope
        ? (envelope as Record<string, unknown>)
        : null;
  const id = row?.id;
  if (id == null || id === '' || String(id) === 'undefined') return null;
  const normalizedId = String(id).trim();
  if (!normalizedId) return null;
  return { ...row, id: normalizedId };
}

export function QuickAddPartySheet({ open, onOpenChange, defaultName = '', onCreated }: Props) {
  const qc = useQueryClient();
  const [f, setF] = useState<PartyForm>(() => emptyForm(''));
  const [saving, setSaving] = useState(false);
  const u = <K extends keyof PartyForm>(k: K, v: PartyForm[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (open) setF(emptyForm(defaultName));
  }, [open, defaultName]);

  const submit = async () => {
    const trimmedName = f.name.trim();
    const g = f.gstin.trim().toUpperCase();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    if (g.length > 0 && g.length !== 15) {
      toast.error('GSTIN must be exactly 15 characters, or leave it blank');
      return;
    }
    const email = f.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email or leave it blank');
      return;
    }
    const pan = f.pan.trim().toUpperCase();
    if (pan.length > 0 && pan.length !== 10) {
      toast.error('PAN must be 10 characters, or leave it blank');
      return;
    }

    const body: Record<string, unknown> = { name: trimmedName };
    if (g.length === 15) body.gstin = g;
    const phone = f.phone.trim();
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (pan) body.pan = pan;
    const ba = f.billing_address.trim();
    if (ba) body.billing_address = ba;
    const sa = f.shipping_address.trim();
    if (sa) body.shipping_address = sa;
    const city = f.city.trim();
    if (city) body.city = city;
    const state = f.state.trim();
    if (state) body.state = state;
    const pin = f.pincode.trim();
    if (pin) body.pincode = pin;
    const sc = f.state_code.trim().toUpperCase();
    if (sc) body.state_code = sc;
    const cp = f.contact_person.trim();
    if (cp) body.contact_person = cp;
    const notes = f.notes.trim();
    if (notes) body.notes = notes;

    const cr = parseFloat(String(f.credit_limit_rupees).replace(/,/g, ''));
    if (!Number.isNaN(cr) && cr > 0) body.credit_limit = Math.round(cr * 100);

    const pt = parseInt(f.payment_terms, 10);
    if (!Number.isNaN(pt) && pt >= 0) body.payment_terms = pt;

    const ob = parseFloat(String(f.opening_balance_rupees).replace(/,/g, ''));
    if (!Number.isNaN(ob) && ob !== 0) body.opening_balance = Math.round(ob * 100);

    setSaving(true);
    try {
      const { data: resBody } = await api.post('/parties', body);
      const row = extractPartyRow(resBody);
      if (!row) {
        toast.error('Unexpected response from server — party id missing. Try again or add the party under Parties.');
        return;
      }
      toast.success('Party saved — you can refine anything later under Parties');
      await qc.invalidateQueries({ queryKey: ['parties'] });
      onCreated(row);
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to create party');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
        <SheetHeader className="pr-8">
          <SheetTitle>Add party</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground mt-2 shrink-0">
          Only <span className="font-medium text-foreground">name</span> is required. Use the tabs to enter as much as you have now; the rest can be edited anytime under{' '}
          <span className="font-medium text-foreground">Parties</span>.
        </p>

        <Tabs defaultValue="essentials" className="mt-4 flex flex-col flex-1 min-h-0 gap-3">
          <TabsList className="grid w-full shrink-0 grid-cols-3 h-auto flex-wrap gap-1">
            <TabsTrigger value="essentials" className="text-xs sm:text-sm">
              Essentials
            </TabsTrigger>
            <TabsTrigger value="address" className="text-xs sm:text-sm">
              Address
            </TabsTrigger>
            <TabsTrigger value="commercial" className="text-xs sm:text-sm">
              Credit & terms
            </TabsTrigger>
          </TabsList>

          <TabsContent value="essentials" className="mt-0 space-y-4 data-[state=inactive]:hidden">
            <div>
              <Label htmlFor="qa-party-name">Name *</Label>
              <Input id="qa-party-name" className="mt-1" value={f.name} onChange={(e) => u('name', e.target.value)} autoFocus disabled={saving} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qa-party-gstin">GSTIN</Label>
                <Input
                  id="qa-party-gstin"
                  className="mt-1 font-mono text-sm uppercase"
                  value={f.gstin}
                  onChange={(e) => u('gstin', e.target.value.toUpperCase())}
                  maxLength={15}
                  placeholder="15 characters if registered"
                  disabled={saving}
                />
              </div>
              <div>
                <Label htmlFor="qa-party-pan">PAN</Label>
                <Input
                  id="qa-party-pan"
                  className="mt-1 font-mono text-sm uppercase"
                  value={f.pan}
                  onChange={(e) => u('pan', e.target.value.toUpperCase())}
                  maxLength={10}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qa-party-phone">Phone</Label>
                <Input id="qa-party-phone" className="mt-1" value={f.phone} onChange={(e) => u('phone', e.target.value)} disabled={saving} />
              </div>
              <div>
                <Label htmlFor="qa-party-email">Email</Label>
                <Input id="qa-party-email" type="email" className="mt-1" value={f.email} onChange={(e) => u('email', e.target.value)} disabled={saving} />
              </div>
            </div>
            <div>
              <Label htmlFor="qa-party-contact">Contact person</Label>
              <Input id="qa-party-contact" className="mt-1" value={f.contact_person} onChange={(e) => u('contact_person', e.target.value)} disabled={saving} />
            </div>
            <div>
              <Label htmlFor="qa-party-notes">Notes</Label>
              <textarea
                id="qa-party-notes"
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none"
                value={f.notes}
                onChange={(e) => u('notes', e.target.value)}
                disabled={saving}
              />
            </div>
          </TabsContent>

          <TabsContent value="address" className="mt-0 space-y-4 data-[state=inactive]:hidden">
            <div>
              <Label>Billing address</Label>
              <textarea
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none"
                value={f.billing_address}
                onChange={(e) => u('billing_address', e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <Label>Shipping address</Label>
              <textarea
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none"
                value={f.shipping_address}
                onChange={(e) => u('shipping_address', e.target.value)}
                disabled={saving}
                placeholder="If different from billing"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label>City</Label>
                <Input className="mt-1" value={f.city} onChange={(e) => u('city', e.target.value)} disabled={saving} />
              </div>
              <div>
                <Label>State</Label>
                <Input className="mt-1" value={f.state} onChange={(e) => u('state', e.target.value)} disabled={saving} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label>Pincode</Label>
                <Input className="mt-1" maxLength={10} value={f.pincode} onChange={(e) => u('pincode', e.target.value)} disabled={saving} />
              </div>
            </div>
            <div>
              <Label>State code (GST)</Label>
              <Input
                className="mt-1 font-mono text-sm uppercase max-w-[120px]"
                maxLength={3}
                value={f.state_code}
                onChange={(e) => u('state_code', e.target.value.toUpperCase())}
                placeholder="e.g. 27"
                disabled={saving}
              />
            </div>
          </TabsContent>

          <TabsContent value="commercial" className="mt-0 space-y-4 data-[state=inactive]:hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Credit limit (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="mt-1 tabular-nums"
                  value={f.credit_limit_rupees}
                  onChange={(e) => u('credit_limit_rupees', e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <Label>Payment terms (days)</Label>
                <Input type="number" min={0} max={365} className="mt-1" value={f.payment_terms} onChange={(e) => u('payment_terms', e.target.value)} disabled={saving} />
              </div>
            </div>
            <div>
              <Label>Opening balance (₹)</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">Positive = they owe you (receivable). Negative = you owe them (payable).</p>
              <Input
                type="number"
                step="0.01"
                className="mt-1 tabular-nums"
                value={f.opening_balance_rupees}
                onChange={(e) => u('opening_balance_rupees', e.target.value)}
                disabled={saving}
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 mt-auto border-t shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save & select'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
