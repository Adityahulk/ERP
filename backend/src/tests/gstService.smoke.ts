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

console.log('GST components, decimal quantities, and configurable round-off passed.');
