import assert from 'node:assert/strict';
import { resolveStockImportGodown } from '../services/stockImportGodown';

const godowns = [
  { id: 'varachha-id', name: 'Varachha', code: 'VAR', is_active: true },
  { id: 'nanpura-id', name: 'Nanpura', code: 'NAN', is_active: true },
  { id: 'old-id', name: 'Old Branch', code: 'OLD', is_active: false },
];

assert.equal(resolveStockImportGodown(godowns, 'varachha-id', '', '').godown?.id, 'varachha-id');
assert.equal(resolveStockImportGodown(godowns, '', 'Nanpura', 'NAN').godown?.id, 'nanpura-id');
assert.match(resolveStockImportGodown(godowns, 'varachha-id', 'Nanpura', '').error || '', /does not match/);
assert.match(resolveStockImportGodown(godowns, '', 'Varachha', 'NAN').error || '', /different godowns/);
assert.match(resolveStockImportGodown(godowns, '', 'Varachha', 'TYPO').error || '', /was not found/);
assert.match(resolveStockImportGodown(godowns, '', 'Old Branch', '').error || '', /inactive/);
assert.match(resolveStockImportGodown(godowns, 'old-id', '', '').error || '', /inactive/);
assert.match(resolveStockImportGodown(godowns, '', '', '').error || '', /Select a godown/);

console.log('Stock import godown mapping checks passed.');
