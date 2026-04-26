import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';

export type QuickAddPartyType = 'customer' | 'supplier';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyType: QuickAddPartyType;
  /** Prefills name when sheet opens */
  defaultName?: string;
  /** Called with the created party row from the API */
  onCreated: (party: Record<string, unknown>) => void;
};

export function QuickAddPartySheet({ open, onOpenChange, partyType, defaultName = '', onCreated }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName.trim());
      setPhone('');
      setGstin('');
    }
  }, [open, defaultName]);

  const title = partyType === 'customer' ? 'New customer' : 'New supplier';

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string | undefined> = {
        name: trimmed,
        party_type: partyType,
      };
      const p = phone.trim();
      const g = gstin.trim().toUpperCase();
      if (p) body.phone = p;
      if (g) body.gstin = g;

      const { data: res } = await api.post('/parties', body);
      const row = (res as { data?: Record<string, unknown> })?.data ?? res;
      if (!row || typeof row !== 'object' || !('id' in row)) {
        toast.error('Unexpected response from server');
        return;
      }
      toast.success(partyType === 'customer' ? 'Customer created' : 'Supplier created');
      onCreated(row as Record<string, unknown>);
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
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="qa-party-name">Name *</Label>
            <Input
              id="qa-party-name"
              className="mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={saving}
            />
          </div>
          <div>
            <Label htmlFor="qa-party-phone">Phone</Label>
            <Input id="qa-party-phone" className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} />
          </div>
          <div>
            <Label htmlFor="qa-party-gstin">GSTIN</Label>
            <Input
              id="qa-party-gstin"
              className="mt-1 font-mono text-sm uppercase"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              maxLength={15}
              disabled={saving}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
