import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2 } from 'lucide-react';
import { QuickAddBankAccountSheet } from './QuickAddBankAccountSheet';
import { useState } from 'react';

type BankRow = {
  id: string;
  account_label?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  ifsc?: string | null;
  upi_id?: string | null;
  is_primary?: boolean;
};

function labelFor(b: BankRow) {
  const bits = [b.account_label, b.bank_name].filter(Boolean).join(' · ');
  const tail = b.account_number ? ` · …${String(b.account_number).slice(-4)}` : b.upi_id ? ` · ${b.upi_id}` : '';
  return (bits || 'Account') + tail;
}

type Props = {
  /** When true, remount clears “default to primary” once (e.g. purchase sheet reopen). */
  remountKey?: string | number;
  value: string;
  onChange: (id: string) => void;
  addSheetOpen?: boolean;
  onAddSheetOpenChange?: (open: boolean) => void;
  className?: string;
};

export function BankAccountPicker({
  remountKey = 0,
  value,
  onChange,
  addSheetOpen: controlledAddOpen,
  onAddSheetOpenChange,
  className,
}: Props) {
  const [internalAddOpen, setInternalAddOpen] = useState(false);
  const addOpen = controlledAddOpen ?? internalAddOpen;
  const setAddOpen = onAddSheetOpenChange ?? setInternalAddOpen;

  const { data: raw = [], isLoading } = useQuery({
    queryKey: ['company-bank-accounts'],
    queryFn: () => api.get('/company/bank-accounts').then((r) => (r.data as any)?.data ?? r.data ?? []),
  });
  const accounts = (Array.isArray(raw) ? raw : []) as BankRow[];

  const initRef = useRef(false);
  useEffect(() => {
    initRef.current = false;
  }, [remountKey]);

  useEffect(() => {
    if (initRef.current || isLoading || !accounts.length) return;
    initRef.current = true;
    if (!value) {
      const p = accounts.find((a) => a.is_primary) || accounts[0];
      if (p?.id) onChange(p.id);
    }
  }, [accounts, isLoading, value, onChange]);

  return (
    <div className={className}>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Bank / UPI on invoice</Label>
          <select
            className="mt-1 w-full h-9 rounded-md border bg-background px-3 text-sm"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={isLoading}
          >
            {!accounts.length && <option value="">{isLoading ? 'Loading…' : 'No saved accounts — add one'}</option>}
            {accounts.map((b) => (
              <option key={b.id} value={b.id}>
                {labelFor(b)}
                {b.is_primary ? ' (primary)' : ''}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1 shrink-0" onClick={() => setAddOpen(true)}>
          <Building2 className="h-4 w-4" />
          Add
        </Button>
      </div>
      <QuickAddBankAccountSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(row) => {
          const id = String((row as any).id || '');
          if (id) onChange(id);
        }}
      />
    </div>
  );
}
