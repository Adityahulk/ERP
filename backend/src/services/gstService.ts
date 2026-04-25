export function determineGSTType(supplierStateCode: string, buyerStateCode: string): 'intra' | 'inter' {
  if (!supplierStateCode || !buyerStateCode) return 'intra'; // fallback
  return supplierStateCode === buyerStateCode ? 'intra' : 'inter';
}

export function calculateLineItemTax(
  unitPrice: number,
  quantity: number,
  discountType: 'percent' | 'flat' | 'none',
  discountValue: number,
  gstRate: number,
  gstType: 'intra' | 'inter',
  cessRate: number = 0
) {
  const baseAmount = unitPrice * quantity;
  let discountAmount = 0;

  if (discountType === 'percent') {
    discountAmount = Math.round((baseAmount * discountValue) / 100);
  } else if (discountType === 'flat') {
    discountAmount = discountValue;
  }

  const taxableAmount = Math.max(0, baseAmount - discountAmount);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  const gstAmount = Math.round((taxableAmount * gstRate) / 100);

  if (gstType === 'intra') {
    cgst = Math.round(gstAmount / 2);
    sgst = gstAmount - cgst; // handle uneven rounding properly
  } else {
    igst = gstAmount;
  }

  const cessAmount = Math.round((taxableAmount * cessRate) / 100);
  const totalAmount = taxableAmount + cgst + sgst + igst + cessAmount;

  return {
    baseAmount,
    discountAmount,
    taxableAmount,
    cgst,
    sgst,
    igst,
    cessAmount,
    totalAmount,
  };
}

export function calculateInvoiceTotals(
  items: Array<{
    unit_price: number;
    quantity: number;
    discount_type?: 'percent' | 'flat' | 'none';
    discount_value?: number;
    gst_rate: number;
    cess_rate?: number;
  }>,
  gstType: 'intra' | 'inter',
  invoiceDiscountType: 'percent' | 'flat' | 'none' = 'none',
  invoiceDiscountValue: number = 0,
  tcsRate: number = 0
) {
  let subtotal = 0;
  let totalDiscountLineLevel = 0;
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalCess = 0;

  for (const item of items) {
    const taxInfo = calculateLineItemTax(
      item.unit_price,
      item.quantity,
      item.discount_type || 'none',
      item.discount_value || 0,
      item.gst_rate,
      gstType,
      item.cess_rate || 0
    );

    subtotal += taxInfo.baseAmount;
    totalDiscountLineLevel += taxInfo.discountAmount;
    totalTaxable += taxInfo.taxableAmount;
    totalCgst += taxInfo.cgst;
    totalSgst += taxInfo.sgst;
    totalIgst += taxInfo.igst;
    totalCess += taxInfo.cessAmount;
  }

  // Invoice-level discount must reduce taxable base first, then tax.
  let globalDiscountAmount = 0;
  if (invoiceDiscountType === 'flat') {
    globalDiscountAmount = Math.max(0, Math.min(invoiceDiscountValue, totalTaxable));
  } else if (invoiceDiscountType === 'percent') {
    globalDiscountAmount = Math.round((totalTaxable * invoiceDiscountValue) / 100);
  }
  globalDiscountAmount = Math.max(0, Math.min(globalDiscountAmount, totalTaxable));

  let taxableAfterDiscount = totalTaxable - globalDiscountAmount;
  const scale = totalTaxable > 0 ? taxableAfterDiscount / totalTaxable : 1;
  let adjCgst = Math.round(totalCgst * scale);
  let adjSgst = Math.round(totalSgst * scale);
  let adjIgst = Math.round(totalIgst * scale);
  let adjCess = Math.round(totalCess * scale);

  // preserve total tax after rounding
  const originalTaxAfter = Math.round((totalCgst + totalSgst + totalIgst + totalCess) * scale);
  const drift = originalTaxAfter - (adjCgst + adjSgst + adjIgst + adjCess);
  if (drift !== 0) {
    if (gstType === 'inter') adjIgst += drift;
    else adjSgst += drift;
  }

  const finalTotalBeforeTcs = Math.max(
    0,
    taxableAfterDiscount + adjCgst + adjSgst + adjIgst + adjCess
  );

  const tcsAmount = Math.round((finalTotalBeforeTcs * tcsRate) / 100);
  
  const finalTotalWithTcs = finalTotalBeforeTcs + tcsAmount;
  
  // Calculate Rounding to nearest integer (in paise, 1 rupee = 100 paise. So nearest 100 paise)
  // Since we calculate in paise, round-off usually means nearest Re 1, so nearest 100 paise.
  const roundedAmountPaise = Math.round(finalTotalWithTcs / 100) * 100;
  const roundOff = roundedAmountPaise - finalTotalWithTcs;

  return {
    subtotal,
    totalDiscountLineLevel,
    globalDiscountAmount,
    totalDiscount: totalDiscountLineLevel + globalDiscountAmount,
    totalTaxable: taxableAfterDiscount,
    totalCgst: adjCgst,
    totalSgst: adjSgst,
    totalIgst: adjIgst,
    totalCess: adjCess,
    totalTax: adjCgst + adjSgst + adjIgst + adjCess,
    tcsAmount,
    roundOff,
    totalAmount: roundedAmountPaise,
  };
}
