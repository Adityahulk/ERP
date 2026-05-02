import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills name when sheet opens */
  defaultName?: string;
  /** Called with the created party row from the API */
  onCreated: (party: Record<string, unknown>) => void;
};

export function QuickAddPartySheet({ open, onOpenChange, defaultName = '', onCreated }: Props) {
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName.trim());
      setGstin('');
      setPhone('');
    }
  }, [open, defaultName]);

  const submit = async () => {
    const trimmedName = name.trim();
    const g = gstin.trim().toUpperCase();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    if (g.length > 0 && g.length !== 15) {
      toast.error('GSTIN must be exactly 15 characters, or leave it blank');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string | undefined> = { name: trimmedName };
      if (g.length === 15) body.gstin = g;
      const p = phone.trim();
      if (p) body.phone = p;

      const { data: res } = await api.post('/parties', body);
      const row = (res as { data?: Record<string, unknown> })?.data ?? res;
      if (!row || typeof row !== 'object' || !('id' in row)) {
        toast.error('Unexpected response from server');
        return;
      }
      toast.success('Party saved — you can add full details anytime under Parties');
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
          <SheetTitle>Add party</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground mt-2">
          Only name is required here. Add GSTIN, address, and other details anytime from{' '}
          <span className="font-medium text-foreground">Parties</span>.
        </p>
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
            <Label htmlFor="qa-party-gstin">GSTIN (optional)</Label>
            <Input
              id="qa-party-gstin"
              className="mt-1 font-mono text-sm uppercase"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              maxLength={15}
              placeholder="15 characters if you have it"
              disabled={saving}
            />
          </div>
          <div>
            <Label htmlFor="qa-party-phone">Phone (optional)</Label>
            <Input id="qa-party-phone" className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} />
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
