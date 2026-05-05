export const GST_RATE_OPTIONS = [0, 1, 3, 5, 6, 12, 18, 28, 40] as const;

export function gstRateLabel(rate: number) {
  if (rate <= 0) return '0% GST (Exempt / Nil / Non-GST)';
  const half = rate / 2;
  return `${rate}% GST (CGST ${half}% + SGST ${half}% / IGST ${rate}%)`;
}

