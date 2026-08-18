import assert from 'node:assert/strict';
import type { Request } from 'express';
import { pool, query } from '../config/db';
import { reportCatalogDefinitions } from '../controllers/reportCatalogController';

async function main() {
  const company = await query('SELECT id FROM companies WHERE is_deleted = false ORDER BY created_at LIMIT 1');
  assert.ok(company.rows[0]?.id, 'A company is required for the report database smoke test');
  const companyId = String(company.rows[0].id);
  const req = { query: {} } as Request;
  const failures: string[] = [];

  for (const [key, definition] of Object.entries(reportCatalogDefinitions)) {
    try {
      const params = definition.params
        ? definition.params(companyId, '2099-01-01', '2099-01-31', req)
        : [companyId, '2099-01-01', '2099-01-31'];
      await query(definition.sql, params);
    } catch (err: any) {
      failures.push(`${key}: ${err.message}`);
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(`Report database smoke passed (${Object.keys(reportCatalogDefinitions).length} catalog reports).`);
}

main().finally(() => pool.end());
