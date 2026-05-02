import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  defaultLabel?: string;
  onCreated: (row: Record<string, unknown>) => void;
};

export function QuickAddBankAccountSheet({ open, onOpenChange, defaultLabel = '', onCreated }: Props) {
  const qc = useQueryClient();
  const [accountLabel, setAccountLabel] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [branch, setBranch] = useState('');
  const [upiId, setUpiId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAccountLabel(defaultLabel.trim());
      setBankName('');
      setAccountNumber('');
      setIfsc('');
      setBranch('');
      setUpiId('');
    }
  }, [open, defaultLabel]);

  const submit = async () => {
    const label = accountLabel.trim();
    const bank = bankName.trim();
    if (!label && !bank) {
      toast.error('Enter a display name or bank name');
      return;
    }
    setSaving(true);
    try {
      const { data: res } = await api.post('/company/bank-accounts', {
        account_label: label || null,
        bank_name: bank || label || 'Bank account',
        account_number: accountNumber.trim() || undefined,
        ifsc: ifsc.trim() || undefined,
        branch: branch.trim() || undefined,
        upi_id: upiId.trim() || undefined,
        is_primary: false,
        is_active: true,
      });
      const row = (res as any)?.data ?? res;
      if (!row?.id) throw new Error('Invalid response');
      await qc.invalidateQueries({ queryKey: ['company-bank-accounts'] });
      toast.success('Bank details saved — complete them anytime in Settings');
      onCreated(row);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add bank / UPI</SheetTitle>
          <p className="text-sm text-muted-foreground font-normal">
            Saved to company settings. Add IFSC, account number, and UPI later under Settings if you skip them now.
          </p>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <Label>Display name *</Label>
            <Input
              className="mt-1.5"
              placeholder="e.g. Main current, HDFC shop"
              value={accountLabel}
              onChange={(e) => setAccountLabel(e.target.value)}
            />
          </div>
          <div>
            <Label>Bank name (optional)</Label>
            <Input className="mt-1.5" placeholder="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div>
            <Label>Account number (optional)</Label>
            <Input className="mt-1.5 font-mono text-sm" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>IFSC (optional)</Label>
              <Input className="mt-1.5 uppercase font-mono text-sm" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label>UPI ID (optional)</Label>
              <Input className="mt-1.5 text-sm" placeholder="name@upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Branch (optional)</Label>
            <Input className="mt-1.5" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <Button className="w-full" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
