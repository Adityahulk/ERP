import assert from 'node:assert/strict';
import { calculateInvoiceTotals, resolveTaxComponentRates } from '../services/gstService';

const intra = resolveTaxComponentRates(
  18,
  0,
  [{ type: 'CGST', rate: 6 }, { type: 'SGST', rate: 12 }],
  'intra',
);
assert.deepEqual(intra, { cgstRate: 6, sgstRate: 12, igstRate: 0, cessRate: 0 });

const inter = resolveTaxComponentRates(
  18,
  0,
  [{ type: 'CGST', rate: 9 }, { type: 'SGST', rate: 9 }],
  'inter',
);
assert.deepEqual(inter, { cgstRate: 0, sgstRate: 0, igstRate: 18, cessRate: 0 });

const withCessAndOther = resolveTaxComponentRates(
  18,
  1,
  [
    { type: 'CGST', rate: 9 },
    { type: 'SGST', rate: 9 },
    { type: 'CESS', rate: 2 },
    { type: 'OTHER', rate: 0.5 },
  ],
  'intra',
);
assert.deepEqual(withCessAndOther, { cgstRate: 9, sgstRate: 9, igstRate: 0, cessRate: 3.5 });

const fractional = calculateInvoiceTotals(
  [{
    unit_price: 10_000,
    quantity: 1.1,
    gst_rate: 18,
    tax_components: [{ type: 'CGST', rate: 6 }, { type: 'SGST', rate: 12 }],
  }],
  'intra',
  'none',
  0,
  0,
  false,
  'exclusive',
);
assert.equal(fractional.totalTaxable, 11_000);
assert.equal(fractional.totalCgst, 660);
assert.equal(fractional.totalSgst, 1_320);
assert.equal(fractional.totalAmount, 12_980);

const rounded = calculateInvoiceTotals(
  [{ unit_price: 10_123, quantity: 1, gst_rate: 0 }],
  'intra',
  'none',
  0,
  0,
  true,
  'exclusive',
  'CEIL',
  10,
);
assert.equal(rounded.totalAmount, 11_000);
assert.equal(rounded.roundOff, 877);

const discounted = calculateInvoiceTotals(
  [
    { unit_price: 10_000, quantity: 1, gst_rate: 18 },
    { unit_price: 20_000, quantity: 1, gst_rate: 18 },
  ],
  'intra',
  'flat',
  3_000,
  0,
  false,
  'exclusive',
);
assert.equal(discounted.totalDiscount, 3_000);
assert.equal(discounted.totalTaxable, 27_000);
assert.equal(discounted.totalCgst, 2_430);
assert.equal(discounted.totalSgst, 2_430);
assert.equal(discounted.totalAmount, 31_860);
assert.equal(discounted.lines.reduce((sum, line) => sum + line.totalDiscount, 0), discounted.totalDiscount);
assert.equal(discounted.lines.reduce((sum, line) => sum + line.taxableAmount, 0), discounted.totalTaxable);
assert.equal(discounted.lines.reduce((sum, line) => sum + line.cgstAmount, 0), discounted.totalCgst);
assert.equal(discounted.lines.reduce((sum, line) => sum + line.sgstAmount, 0), discounted.totalSgst);

const lineDiscountWithFractionalQuantity = calculateInvoiceTotals(
  [{ unit_price: 20_000, quantity: 1.5, discount_type: 'flat', discount_value: 3_000, gst_rate: 5 }],
  'intra',
  'none',
  0,
  0,
  false,
  'exclusive',
);
assert.equal(lineDiscountWithFractionalQuantity.totalDiscount, 3_000);
assert.equal(lineDiscountWithFractionalQuantity.totalTaxable, 27_000);
assert.equal(lineDiscountWithFractionalQuantity.totalAmount, 28_350);

const inclusiveDiscounted = calculateInvoiceTotals(
  [
    { unit_price: 11_800, quantity: 1, gst_rate: 18, price_includes_tax: true },
    { unit_price: 23_600, quantity: 1, gst_rate: 18, price_includes_tax: true },
  ],
  'intra',
  'flat',
  3_000,
  0,
  false,
  'inclusive',
);
assert.equal(inclusiveDiscounted.lines.reduce((sum, line) => sum + line.totalDiscount, 0), inclusiveDiscounted.totalDiscount);
assert.equal(inclusiveDiscounted.lines.reduce((sum, line) => sum + line.taxableAmount, 0), inclusiveDiscounted.totalTaxable);
assert.equal(inclusiveDiscounted.lines.reduce((sum, line) => sum + line.totalAmount, 0), inclusiveDiscounted.totalAmount);

console.log('GST components, decimal quantities, global discounts, and configurable round-off passed.');
