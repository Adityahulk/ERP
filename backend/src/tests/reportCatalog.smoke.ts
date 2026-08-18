import assert from 'node:assert/strict';
import { reportCatalogKeys } from '../controllers/reportCatalogController';

const expected = [
  'all-transactions', 'bill-wise-profit', 'sale-aging', 'cash-flow',
  'party-statement', 'party-wise-profit-loss', 'all-parties', 'party-report-by-item', 'sale-purchase-by-party',
  'sale-summary-hsn', 'sac-report', 'item-report-by-party', 'item-category-profit-loss', 'stock-detail', 'item-detail',
  'sale-purchase-by-item-category', 'stock-summary-by-item-category', 'item-wise-discount',
  'business-status', 'bank-statement', 'taxes', 'gst-rate-report', 'form-27eq', 'tcs-receivable', 'tds-payable', 'tds-receivable',
  'expense', 'expense-category', 'expense-item', 'sale-purchase-orders', 'sale-purchase-order-item',
  'other-income', 'other-income-category', 'other-income-item', 'loan-statement',
].sort();

assert.deepEqual([...reportCatalogKeys].sort(), expected, 'Report catalog keys changed unexpectedly');
assert.equal(new Set(reportCatalogKeys).size, reportCatalogKeys.length, 'Report catalog contains duplicate keys');

console.log(`Report catalog smoke passed (${reportCatalogKeys.length} catalog reports).`);
