import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const IST_TIMEZONE = 'Asia/Kolkata';

// ═══════════════════════════════════════════════════════════════
// MONEY FORMATTING (Indian Number System)
// ═══════════════════════════════════════════════════════════════

/**
 * Convert paise to rupees
 */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Convert rupees to paise
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Format paise as Indian currency string
 * e.g., 12345600 paise → "₹1,23,456"
 */
export function formatMoney(paise: number): string {
  const rupees = paise / 100;
  return formatRupees(rupees);
}

/**
 * Format rupees in Indian number system
 * e.g., 123456.50 → "₹1,23,456.50"
 */
export function formatRupees(amount: number): string {
  const isNegative = amount < 0;
  const abs = Math.abs(amount);
  const [intPart, decPart] = abs.toFixed(2).split('.');

  // Indian grouping: first group of 3, then groups of 2
  let formatted = '';
  const digits = intPart.split('');

  if (digits.length <= 3) {
    formatted = intPart;
  } else {
    // Last 3 digits
    const lastThree = digits.slice(-3).join('');
    const remaining = digits.slice(0, -3);

    // Group remaining in pairs from right
    const pairs: string[] = [];
    for (let i = remaining.length - 1; i >= 0; i -= 2) {
      if (i - 1 >= 0) {
        pairs.unshift(remaining[i - 1] + remaining[i]);
      } else {
        pairs.unshift(remaining[i]);
      }
    }

    formatted = pairs.join(',') + ',' + lastThree;
  }

  const result = decPart === '00'
    ? `₹${formatted}`
    : `₹${formatted}.${decPart}`;

  return isNegative ? `-${result}` : result;
}

/**
 * Format large amounts in lakhs/crores with tooltip
 * e.g., 1234500 paise → "₹12,345" but 1234500000 paise → "₹1.23Cr"
 */
export function formatMoneyShort(paise: number): { display: string; full: string } {
  const rupees = paise / 100;
  const full = formatRupees(rupees);

  if (Math.abs(rupees) >= 10000000) {
    // Crores
    const cr = rupees / 10000000;
    return { display: `₹${cr.toFixed(1)}Cr`, full };
  }
  if (Math.abs(rupees) >= 100000) {
    // Lakhs
    const lakhs = rupees / 100000;
    return { display: `₹${lakhs.toFixed(1)}L`, full };
  }

  return { display: full, full };
}

// ═══════════════════════════════════════════════════════════════
// DATE FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Format date as DD MMM YYYY (e.g., "15 Apr 2025")
 */
export function formatDate(date: string | Date): string {
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  const ist = toZonedTime(parsed, IST_TIMEZONE);
  return format(ist, 'dd MMM yyyy');
}

/**
 * Format date as DD/MM/YYYY
 */
export function formatDateSlash(date: string | Date): string {
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  const ist = toZonedTime(parsed, IST_TIMEZONE);
  return format(ist, 'dd/MM/yyyy');
}

/**
 * Format datetime as DD MMM YYYY, HH:mm
 */
export function formatDateTime(date: string | Date): string {
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  const ist = toZonedTime(parsed, IST_TIMEZONE);
  return format(ist, 'dd MMM yyyy, HH:mm');
}

/**
 * Format to YYYY-MM-DD for input fields
 */
export function formatDateInput(date: string | Date): string {
  const parsed = typeof date === 'string' ? parseISO(date) : date;
  return format(parsed, 'yyyy-MM-dd');
}

// ═══════════════════════════════════════════════════════════════
// GST FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Format GST breakdown
 */
export function formatGSTBreakdown(
  gstRate: number,
  taxableAmount: number,
  isInterstate: boolean
): { label: string; amount: string }[] {
  if (gstRate === 0) return [];

  const totalTax = Math.round(taxableAmount * gstRate / 100);

  if (isInterstate) {
    return [
      { label: `IGST @ ${gstRate}%`, amount: formatMoney(totalTax) },
    ];
  }

  const halfRate = gstRate / 2;
  const halfTax = Math.round(totalTax / 2);

  return [
    { label: `CGST @ ${halfRate}%`, amount: formatMoney(halfTax) },
    { label: `SGST @ ${halfRate}%`, amount: formatMoney(halfTax) },
  ];
}

// ═══════════════════════════════════════════════════════════════
// NUMBER FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Format number with Indian grouping (no currency symbol)
 * e.g., 1234567 → "12,34,567"
 */
export function formatIndianNumber(num: number): string {
  const isNegative = num < 0;
  const abs = Math.abs(num);
  const str = abs.toString();
  const digits = str.split('');

  if (digits.length <= 3) return isNegative ? `-${str}` : str;

  const lastThree = digits.slice(-3).join('');
  const remaining = digits.slice(0, -3);
  const pairs: string[] = [];

  for (let i = remaining.length - 1; i >= 0; i -= 2) {
    if (i - 1 >= 0) {
      pairs.unshift(remaining[i - 1] + remaining[i]);
    } else {
      pairs.unshift(remaining[i]);
    }
  }

  const result = pairs.join(',') + ',' + lastThree;
  return isNegative ? `-${result}` : result;
}

/**
 * Format quantity with unit
 */
export function formatQuantity(qty: number, unit?: string): string {
  const formatted = qty % 1 === 0 ? qty.toString() : qty.toFixed(3);
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}
