export function determineGSTType(supplierStateCode: string, buyerStateCode: string): 'intra' | 'inter' {
  if (!supplierStateCode || !buyerStateCode) return 'intra'; // fallback
  return supplierStateCode === buyerStateCode ? 'intra' : 'inter';
}

/** First two characters of GSTIN are the state code (e.g. 27 = Maharashtra). */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin || '').trim().toUpperCase();
  if (g.length < 2) return null;
  const a = g.charCodeAt(0);
  const b = g.charCodeAt(1);
  if (a >= 48 && a <= 57 && b >= 48 && b <= 57) return g.slice(0, 2);
  return null;
}

export type ExpenseGstBreakdown = {
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  gst_amount: number;
  total_amount: number;
};

/**
 * Expense / purchase voucher: amounts in paise.
 * If `amountIncludesGst`, `inputAmountPaise` is the total paid (tax-inclusive); stored taxable is derived.
 * Otherwise `inputAmountPaise` is taxable value (GST extra), matching sales line-item logic.
 */
export function calculateExpenseGstBreakdown(
  inputAmountPaise: number,
  gstRate: number,
  gstType: 'intra' | 'inter',
  amountIncludesGst: boolean
): ExpenseGstBreakdown {
  const rate = Math.max(0, Math.min(100, Math.round(Number(gstRate) || 0)));
  const input = Math.max(0, Math.round(Number(inputAmountPaise) || 0));

  if (input === 0) {
    return {
      taxable_amount: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      gst_amount: 0,
      total_amount: 0,
    };
  }

  if (rate === 0) {
    return {
      taxable_amount: input,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      gst_amount: 0,
      total_amount: input,
    };
  }

  if (amountIncludesGst) {
    const total = input;
    const taxable = Math.round((total * 100) / (100 + rate));
    const gstAmount = total - taxable;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (gstType === 'intra') {
      cgst = Math.round(gstAmount / 2);
      sgst = gstAmount - cgst;
    } else {
      igst = gstAmount;
    }
    return {
      taxable_amount: taxable,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,
      gst_amount: gstAmount,
      total_amount: total,
    };
  }

  const line = calculateLineItemTax(input, 1, 'none', 0, rate, gstType, 0);
  const gstAmt = line.cgst + line.sgst + line.igst;
  return {
    taxable_amount: line.taxableAmount,
    cgst_amount: line.cgst,
    sgst_amount: line.sgst,
    igst_amount: line.igst,
    gst_amount: gstAmt,
    total_amount: line.totalAmount,
  };
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
