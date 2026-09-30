import assert from 'node:assert/strict';
import '../middleware/auth';
import { clearItemStockForDeletion } from '../controllers/itemController';

const calls: Array<{ sql: string; params: any[] }> = [];
const fakeClient = {
  async query(sql: string, params: any[] = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM item_stock') && sql.includes('FOR UPDATE')) {
      return {
        rows: [
          { godown_id: 'godown-a', quantity: 5, reserved_quantity: 2, avg_cost_price: 12_000 },
          { godown_id: 'godown-b', quantity: -3, reserved_quantity: 0, avg_cost_price: 10_000 },
          { godown_id: 'godown-c', quantity: 0, reserved_quantity: 4, avg_cost_price: 8_000 },
        ],
      };
    }
    return { rows: [] };
  },
};

async function main() {
  await clearItemStockForDeletion(fakeClient, 'company-id', 'item-id', 'user-id');

  const movementCalls = calls.filter((call) => call.sql.includes('INSERT INTO stock_movements'));
  assert.equal(movementCalls.length, 2, 'Only non-zero quantity rows should receive balancing movements');
  assert.equal(movementCalls[0].params[3], -5, 'Positive stock must be balanced with a negative movement');
  assert.equal(movementCalls[1].params[3], 3, 'Negative stock must be balanced with a positive movement');
  assert.ok(movementCalls.every((call) => call.params[5].includes('bulk item deletion')));

  const deleteStockCall = calls.find((call) => call.sql.includes('DELETE FROM item_stock'));
  assert.ok(deleteStockCall, 'Item-to-godown stock rows must be removed in the same deletion transaction');
  assert.deepEqual(deleteStockCall?.params, ['company-id', 'item-id']);

  const batchCall = calls.find((call) => call.sql.includes('UPDATE item_batches'));
  assert.ok(batchCall, 'Active batch quantities must be cleared and archived');
  assert.deepEqual(batchCall?.params, ['company-id', 'item-id']);

  const serialCall = calls.find((call) => call.sql.includes('UPDATE item_serial_numbers'));
  assert.ok(serialCall, 'Available serial numbers must be written off');
  assert.deepEqual(serialCall?.params, ['company-id', 'item-id']);

  const labelProfileCall = calls.find((call) => call.sql.includes('DELETE FROM barcode_label_profiles'));
  assert.ok(labelProfileCall, 'Saved barcode label configuration must be removed');
  assert.deepEqual(labelProfileCall?.params, ['company-id', 'item-id']);

  console.log('Bulk item deletion stock-clearing checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
