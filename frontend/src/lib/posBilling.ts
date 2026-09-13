export type PosDiscountMode = 'amount' | 'percent';

export type PosCalculationItem = {
  unit_price: number;
  quantity: number;
  gst_rate: number;
  cess_rate: number;
  price_includes_tax: boolean;
  discount_mode: PosDiscountMode;
  discount_value: number;
};

type RoundOffType = 'NEAREST' | 'FLOOR' | 'CEIL';

const safeRound = (value: number) => Number.isFinite(value) ? Math.round(value) : 0;

export function itemDiscountAmount(item: PosCalculationItem): number {
  const gross = Math.max(0, Number(item.unit_price) || 0) * Math.max(0, Number(item.quantity) || 0);
  if (item.discount_mode === 'percent') {
    const percentage = Math.max(0, Math.min(100, Number(item.discount_value) || 0));
    return Math.min(gross, safeRound(gross * percentage / 100));
  }
  return Math.min(gross, Math.max(0, safeRound(Number(item.discount_value) || 0)));
}

export function calculatePosTotals(
  items: PosCalculationItem[],
  billDiscountMode: PosDiscountMode,
  billDiscountValue: number,
  roundOffEnabled: boolean,
  roundOffType: RoundOffType,
  roundOffTo: 1 | 10 | 100,
) {
  let subtotal = 0;
  let itemDiscount = 0;
  const lines = items.map((item) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = Math.max(0, safeRound(Number(item.unit_price) || 0));
    const gstRate = Math.max(0, Number(item.gst_rate) || 0);
    const cessRate = Math.max(0, Number(item.cess_rate) || 0);
    const totalRate = gstRate + cessRate;
    const divisor = item.price_includes_tax && totalRate > 0 ? 1 + totalRate / 100 : 1;
    const convertedPrice = unitPrice / divisor;
    const enteredDiscount = itemDiscountAmount({ ...item, unit_price: unitPrice, quantity });
    const convertedDiscount = enteredDiscount / divisor;
    const lineSubtotal = convertedPrice * quantity;
    const lineAfterItemDiscount = Math.max(0, lineSubtotal - convertedDiscount);

    subtotal += lineSubtotal;
    itemDiscount += convertedDiscount;
    return { lineAfterItemDiscount, gstRate, cessRate, totalRate };
  });

  const beforeBillDiscount = Math.max(0, subtotal - itemDiscount);
  const requestedBillDiscount = billDiscountMode === 'percent'
    ? beforeBillDiscount * Math.max(0, Math.min(100, Number(billDiscountValue) || 0)) / 100
    : Math.max(0, Number(billDiscountValue) || 0);
  const billDiscount = Math.min(beforeBillDiscount, requestedBillDiscount);

  let taxable = 0;
  let gst = 0;
  let cess = 0;
  for (const line of lines) {
    const allocatedBillDiscount = beforeBillDiscount > 0
      ? billDiscount * line.lineAfterItemDiscount / beforeBillDiscount
      : 0;
    const lineTaxable = Math.max(0, line.lineAfterItemDiscount - allocatedBillDiscount);
    const lineTax = lineTaxable * line.totalRate / 100;
    taxable += lineTaxable;
    gst += line.totalRate > 0 ? lineTax * line.gstRate / line.totalRate : 0;
    cess += line.totalRate > 0 ? lineTax * line.cessRate / line.totalRate : 0;
  }

  const taxablePaise = safeRound(taxable);
  const gstPaise = safeRound(gst);
  const cessPaise = safeRound(cess);
  const totalBeforeRoundOff = taxablePaise + gstPaise + cessPaise;
  const roundUnit = Math.max(1, roundOffTo) * 100;
  const roundOperation = roundOffType === 'FLOOR'
    ? Math.floor
    : roundOffType === 'CEIL'
      ? Math.ceil
      : Math.round;
  const total = Math.max(0, roundOffEnabled
    ? roundOperation(totalBeforeRoundOff / roundUnit) * roundUnit
    : totalBeforeRoundOff);

  return {
    subtotal: safeRound(subtotal),
    itemDiscount: safeRound(itemDiscount),
    billDiscountBase: safeRound(beforeBillDiscount),
    billDiscount: safeRound(billDiscount),
    taxable: taxablePaise,
    gst: gstPaise,
    cess: cessPaise,
    totalBeforeRoundOff,
    roundOff: total - totalBeforeRoundOff,
    total,
  };
}
