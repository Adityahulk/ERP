import { z } from 'zod';

// PostgreSQL bigint is wider, but JavaScript arithmetic must remain exact.
export const MAX_MONEY_PAISE = Number.MAX_SAFE_INTEGER;

const safePaiseNumber = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .int('Amount must resolve to whole paise')
  .min(-MAX_MONEY_PAISE, 'Amount is below the supported range')
  .max(MAX_MONEY_PAISE, 'Amount exceeds the supported range');

/** Shared schemas for every API field that stores currency as integer paise. */
export const moneyPaiseSchema = safePaiseNumber;
export const nonNegativeMoneyPaiseSchema = safePaiseNumber.min(0, 'Amount cannot be negative');
export const positiveMoneyPaiseSchema = safePaiseNumber.positive('Amount must be positive');

export function isSafePaise(value: unknown): boolean {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && Math.abs(amount) <= MAX_MONEY_PAISE;
}

export function parseMoneyPaise(value: unknown, fallback = 0): number {
  if (value === '' || value == null) return fallback;
  const amount = Math.round(Number(value));
  if (!isSafePaise(amount)) throw new Error('Amount exceeds the supported range');
  return amount;
}
