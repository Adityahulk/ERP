import assert from 'node:assert/strict';
import { saleReturnTotal } from '../lib/saleReturnTotal';

assert.equal(saleReturnTotal([{ quantity: 2, unit_price: 1250 }]), 2500);
assert.equal(saleReturnTotal([{ quantity: 1.5, unit_price: 100 }]), 150);
assert.throws(() => saleReturnTotal([{ quantity: -1, unit_price: 100 }]), /quantity/);
assert.throws(() => saleReturnTotal([{ quantity: 1, unit_price: -100 }]), /unit price/);
assert.throws(() => saleReturnTotal([{ quantity: 1, unit_price: Number.MAX_SAFE_INTEGER + 1 }]), /unit price/);

console.log('Sale return amount checks passed.');
