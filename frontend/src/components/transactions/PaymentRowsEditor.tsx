import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { BankAccountPicker } from '@/components/company/BankAccountPicker';
import MoneyInput from './MoneyInput';

export interface PaymentEditorRow {
  id: string;
  payment_mode: string;
  amount: number;
  company_bank_account_id?: string;
  reference_number?: string;
  cheque_number?: string;
  instrument_date?: string;
}

export function newPaymentEditorRow(): PaymentEditorRow {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, payment_mode: 'cash', amount: 0 };
}

export default function PaymentRowsEditor({
  rows,
  onChange,
  defaultBankAccountId,
  disabled,
}: {
  rows: PaymentEditorRow[];
  onChange: (rows: PaymentEditorRow[]) => void;
  defaultBankAccountId?: string;
  disabled?: boolean;
}) {
  const update = (id: string, patch: Partial<PaymentEditorRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const remove = (id: string) => {
    onChange(rows.length <= 1 ? [newPaymentEditorRow()] : rows.filter((row) => row.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Payment</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          disabled={disabled}
          onClick={() => onChange([...rows, newPaymentEditorRow()])}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {rows.map((row, idx) => (
        <div key={row.id} className="rounded-md border bg-muted/10 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Type</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={row.payment_mode}
                disabled={disabled}
                onChange={(e) => update(row.id, { payment_mode: e.target.value, amount: e.target.value === 'credit' ? 0 : row.amount })}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI / Online</option>
                <option value="bank_transfer">NEFT / Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card</option>
                <option value="credit">Credit / Balance</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Amount (₹)</Label>
              <MoneyInput
                className="mt-1"
                placeholder="0"
                disabled={disabled || row.payment_mode === 'credit'}
                value={row.amount}
                onChange={(amount) => update(row.id, { amount })}
              />
            </div>
          </div>

          {['upi', 'bank_transfer', 'cheque', 'card'].includes(row.payment_mode) && (
            <BankAccountPicker
              value={row.company_bank_account_id || defaultBankAccountId || ''}
              onChange={(id) => update(row.id, { company_bank_account_id: id })}
              className="mt-2"
            />
          )}

          {row.payment_mode !== 'cash' && row.payment_mode !== 'credit' && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{row.payment_mode === 'cheque' ? 'Cheque No.' : 'Reference No.'}</Label>
                <Input
                  className="mt-1"
                  disabled={disabled}
                  value={row.payment_mode === 'cheque' ? row.cheque_number || '' : row.reference_number || ''}
                  onChange={(e) => update(row.id, row.payment_mode === 'cheque' ? { cheque_number: e.target.value } : { reference_number: e.target.value })}
                />
              </div>
              {row.payment_mode === 'cheque' && (
                <div>
                  <Label className="text-xs">Cheque Date</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    disabled={disabled}
                    value={row.instrument_date || ''}
                    onChange={(e) => update(row.id, { instrument_date: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Payment {idx + 1}</span>
            <button type="button" className="inline-flex items-center gap-1 text-destructive hover:underline" disabled={disabled} onClick={() => remove(row.id)}>
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
