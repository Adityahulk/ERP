import assert from 'node:assert/strict';
import { matchExistingImportItem, type ExistingImportItem } from '../services/itemImportMatch';
import { setImportedGodownStock } from '../services/itemImportStock';

const items: ExistingImportItem[] = [
  { id: 'item-1', name: 'Rice', sku: 'RICE-1', barcode: '1234', item_type: 'product', track_inventory: true, is_serialized: false },
  { id: 'item-2', name: 'Oil', sku: 'OIL-1', barcode: '5678', item_type: 'product', track_inventory: true, is_serialized: false },
];

assert.equal(matchExistingImportItem(items, { name: ' Rice ', sku: 'rice-1' }).item?.id, 'item-1');
assert.equal(matchExistingImportItem(items, { name: 'Rice', barcode: '1234' }).item?.id, 'item-1');
assert.equal(matchExistingImportItem(items, { name: 'rice' }).item?.id, 'item-1');
assert.match(matchExistingImportItem(items, { name: 'Rice', sku: 'OIL-1' }).error || '', /name does not match/i);
assert.match(matchExistingImportItem(items, { name: 'Rice', sku: 'RICE-1', barcode: '5678' }).error || '', /different existing items/i);
assert.match(matchExistingImportItem([...items, { ...items[0], id: 'item-3', sku: null, barcode: null }], { name: 'Rice' }).error || '', /Multiple existing items/i);

async function main() {
  const stock = new Map([['varachha', 5]]);
  const movements: Array<{ godown: string; delta: number; balance: number }> = [];
  const client = {
    async query(sql: string, params: any[] = []) {
      if (sql.startsWith('SELECT quantity FROM item_stock')) {
        return { rows: stock.has(params[2]) ? [{ quantity: stock.get(params[2]) }] : [] };
      }
      if (sql.startsWith('INSERT INTO item_stock')) {
        stock.set(params[2], params[3]);
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO stock_movements')) {
        movements.push({ godown: params[2], delta: params[3], balance: params[5] });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const args = { companyId: 'company', itemId: 'item-1', godownId: 'nanpura', quantity: 3, unitCost: 10000, createdBy: 'user' };
  await setImportedGodownStock(client, args);
  await setImportedGodownStock(client, args);
  await setImportedGodownStock(client, { ...args, quantity: 4 });
  await setImportedGodownStock(client, { ...args, quantity: 0 });
  assert.equal(stock.get('varachha'), 5);
  assert.equal(stock.get('nanpura'), 0);
  assert.deepEqual(movements, [
    { godown: 'nanpura', delta: 3, balance: 3 },
    { godown: 'nanpura', delta: 1, balance: 4 },
    { godown: 'nanpura', delta: -4, balance: 0 },
  ]);
  console.log('Cross-godown item import checks passed.');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
