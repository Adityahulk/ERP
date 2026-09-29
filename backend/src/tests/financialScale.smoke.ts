import assert from 'node:assert/strict';
import { calculateStockValuation } from '../lib/stockValuation';
import { isSafePaise, MAX_MONEY_PAISE } from '../lib/money';

const zeroStock = calculateStockValuation([
  { quantity: 0, avg_cost_price: 120_000_000 },
]);
assert.deepEqual(zeroStock, { stockOnHand: 0, stockValue: 0, hasNegativeStock: false });

const offsettingGodowns = calculateStockValuation([
  { quantity: '2', avg_cost_price: '100000000' },
  { quantity: '-2', avg_cost_price: '120000000' },
]);
assert.equal(offsettingGodowns.stockOnHand, 0);
assert.equal(offsettingGodowns.stockValue, 0);
assert.equal(offsettingGodowns.hasNegativeStock, true);

const croreScale = calculateStockValuation([
  { quantity: 9, avg_cost_price: 1_000_000_000 },
]);
assert.equal(croreScale.stockOnHand, 9);
assert.equal(croreScale.stockValue, 9_000_000_000);
assert.equal(croreScale.hasNegativeStock, false);

const legitimateNegative = calculateStockValuation([
  { quantity: -2, avg_cost_price: 120_000_000 },
]);
assert.equal(legitimateNegative.stockValue, -240_000_000);
assert.equal(legitimateNegative.hasNegativeStock, true);

assert.equal(isSafePaise(9_000_000_000), true);
assert.equal(isSafePaise(MAX_MONEY_PAISE), true);
assert.equal(isSafePaise(MAX_MONEY_PAISE + 1), false);

console.log('Large-value money validation and stock valuation checks passed.');
