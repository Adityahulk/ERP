import { Request, Response, NextFunction } from 'express';

const DATE_KEY_PATTERN = /(^|_)(date|from_date|to_date|due_date|bill_date|entry_date|payment_date|expense_date|invoice_date)$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateValue(value: unknown): unknown {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || ISO_DATE_PATTERN.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateFields(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(normalizeDateFields);

  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (DATE_KEY_PATTERN.test(key)) {
      if (Array.isArray(value)) obj[key] = value.map(normalizeDateValue);
      else obj[key] = normalizeDateValue(value);
    } else if (value && typeof value === 'object') {
      obj[key] = normalizeDateFields(value);
    }
  }
  return obj;
}

export function normalizeRequestDates(req: Request, _res: Response, next: NextFunction) {
  normalizeDateFields(req.body);
  normalizeDateFields(req.query);
  next();
}
