export type CurrencyCode = 'INR' | 'USD';

export const SUPPORTED_CURRENCIES: { code: CurrencyCode; label: string; symbol: string; locale: string }[] = [
    { code: 'INR', label: 'Indian Rupee (INR)', symbol: '₹', locale: 'en-IN' },
    { code: 'USD', label: 'US Dollar (USD)', symbol: '$', locale: 'en-US' },
];

export function normalizeCurrencyCode(value: unknown, fallback: CurrencyCode = 'INR'): CurrencyCode {
    const code = String(value || fallback).toUpperCase();
    return code === 'USD' ? 'USD' : 'INR';
}

export function currencySymbol(currency?: string): string {
    return normalizeCurrencyCode(currency) === 'USD' ? '$' : '₹';
}

export function currencyLabel(currency?: string): string {
    return normalizeCurrencyCode(currency) === 'USD' ? 'USD' : 'INR';
}

export function formatMoney(amountPaise: number | undefined, currency: string = 'INR'): string {
    const code = normalizeCurrencyCode(currency);
    if (amountPaise === undefined || amountPaise === null) return `${currencySymbol(code)}0.00`;
    const major = amountPaise / 100;
    const meta = SUPPORTED_CURRENCIES.find((c) => c.code === code)!;
    return `${meta.symbol}${major.toLocaleString(meta.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rupeesToPaise(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
}

export function paiseToRupees(amountPaise: number | null | undefined): number {
    const n = Number(amountPaise ?? 0);
    if (!Number.isFinite(n)) return 0;
    return n / 100;
}

export function formatCurrency(amount: number): string {
    return formatMoney(amount); 
}

export function parseRupeeInput(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? parseFloat(value.replace(/,/g, '').trim()) : Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

export function formatCurrencyCompact(amountPaise: number, currency: string = 'INR'): string {
    const amount = amountPaise / 100;
    const abs = Math.abs(amount);
    const symbol = currencySymbol(currency);
    if (normalizeCurrencyCode(currency) === 'INR' && abs >= 100000) return `${symbol}${(amount/100000).toFixed(1)}L`;
    if(abs >= 1000) return `${symbol}${(amount/1000).toFixed(1)}K`;
    return `${symbol}${amount.toFixed(0)}`;
}

export function indianNumberFormat(n: number): string {
    return n.toLocaleString('en-IN');
}

export function formatDate(dateString: string | undefined): string {
   if (!dateString) return '-';
   const d = new Date(dateString);
   return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRelativeTime(dateString: string | undefined): string {
    if (!dateString) return '-';
    const d = new Date(dateString);
    const ms = new Date().getTime() - d.getTime();
    const days = Math.floor(ms / (1000*3600*24));
    if(days === 0) return 'Today';
    if(days === 1) return 'Yesterday';
    if(days < 30) return `${days} days ago`;
    return formatDate(dateString);
}

export function formatQuantity(qty: number, unit: string): string {
    return `${qty} ${unit || 'Pcs'}`;
}

export function formatGST(cgst: number, sgst: number, igst: number): string {
    const total = cgst + sgst + igst;
    if(igst > 0) return `GST ${total}% (IGST ${igst}%)`;
    return `GST ${total}% (CGST ${cgst}% + SGST ${sgst}%)`;
}
