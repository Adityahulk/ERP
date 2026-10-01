export function saleReturnTotal(items: any[]): number {
  let total = 0;
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw Object.assign(new Error('Each returned quantity must be greater than zero'), { status: 400 });
    }
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error('Each return unit price must be a non-negative amount in paise'), { status: 400 });
    }
    const lineTotal = Math.round(quantity * unitPrice);
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) {
      throw Object.assign(new Error('Sale return total exceeds the supported amount'), { status: 400 });
    }
    total += lineTotal;
  }
  return total;
}
