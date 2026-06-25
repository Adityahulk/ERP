import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';
import { paiseToRupees, rupeesToPaise } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (paise: number) => void;
};

function cleanMoney(value: string) {
  const cleaned = String(value || '').replace(/[^\d.]/g, '');
  const [whole, ...decimalParts] = cleaned.split('.');
  const decimals = decimalParts.join('').slice(0, 2);
  return decimalParts.length ? `${whole}.${decimals}` : whole;
}

function displayValue(paise: number) {
  if (!paise) return '';
  return paiseToRupees(paise).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export default function MoneyInput({ value, onChange, className, onFocus, onBlur, ...props }: MoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      className={cn('tabular-nums', className)}
      value={draft ?? displayValue(value)}
      onFocus={(event) => {
        setDraft(displayValue(value));
        requestAnimationFrame(() => event.currentTarget.select());
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const nextDraft = cleanMoney(event.target.value);
        setDraft(nextDraft);
        onChange(rupeesToPaise(nextDraft || '0'));
      }}
    />
  );
}
