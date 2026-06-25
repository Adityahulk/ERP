/**
 * Client-side preview for expense GST (mirrors backend gstService). Final amounts always come from the API.
 */

export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin || '').trim().toUpperCase();
  if (g.length < 2) return null;
  const a = g.charCodeAt(0);
  const b = g.charCodeAt(1);
  if (a >= 48 && a <= 57 && b >= 48 && b <= 57) return g.slice(0, 2);
  return null;
}

export function determineGSTType(supplierStateCode: string, buyerStateCode: string): 'intra' | 'inter' {
  if (!supplierStateCode || !buyerStateCode) return 'intra';
  return supplierStateCode === buyerStateCode ? 'intra' : 'inter';
}

function lineTax(
  taxablePaise: number,
  gstRate: number,
  gstType: 'intra' | 'inter'
): { cgst: number; sgst: number; igst: number; gst: number; total: number } {
  const rate = Math.max(0, Math.min(100, Math.round(gstRate)));
  const taxable = Math.max(0, Math.round(taxablePaise));
  const gstAmount = Math.round((taxable * rate) / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (gstType === 'intra') {
    cgst = Math.round(gstAmount / 2);
    sgst = gstAmount - cgst;
  } else {
    igst = gstAmount;
  }
  return { cgst, sgst, igst, gst: gstAmount, total: taxable + gstAmount };
}

export function previewExpenseGst(
  inputPaise: number,
  gstRate: number,
  gstType: 'intra' | 'inter',
  amountIncludesGst: boolean
): { taxable: number; cgst: number; sgst: number; igst: number; gst: number; total: number } {
  const rate = Math.max(0, Math.min(100, Math.round(gstRate)));
  const input = Math.max(0, Math.round(inputPaise));
  if (input === 0) return { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, total: 0 };
  if (rate === 0) return { taxable: input, cgst: 0, sgst: 0, igst: 0, gst: 0, total: input };

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
    return { taxable, cgst, sgst, igst, gst: gstAmount, total };
  }

  const t = lineTax(input, rate, gstType);
  return { taxable: input, cgst: t.cgst, sgst: t.sgst, igst: t.igst, gst: t.gst, total: t.total };
}
