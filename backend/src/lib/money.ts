// PostgreSQL bigint is wider, but JavaScript arithmetic must remain exact.
export const MAX_MONEY_PAISE = Number.MAX_SAFE_INTEGER;

export function isSafePaise(value: unknown): boolean {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && Math.abs(amount) <= MAX_MONEY_PAISE;
}
