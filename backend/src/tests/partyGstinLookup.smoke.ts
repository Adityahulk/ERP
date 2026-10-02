import assert from 'node:assert/strict';
import { env } from '../config/env';
import { lookupGstinDetails } from '../services/gstService';

const gstin = '27AAPFU0939F1ZV';
const originalFetch = globalThis.fetch;
const originalUrl = env.GSTIN_LOOKUP_API_URL;
const originalKey = env.GSTIN_LOOKUP_API_KEY;

async function run() {
  env.GSTIN_LOOKUP_API_URL = 'https://example.invalid/gstin/{gstin}';
  env.GSTIN_LOOKUP_API_KEY = 'test-secret';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `https://example.invalid/gstin/${gstin}`);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    return new Response(JSON.stringify({
      data: {
        lgnm: 'Registered Legal Business', tradeNam: 'Registered Trade Business', sts: 'Active',
        pradr: { addr: { bno: '12', st: 'Main Road', loc: 'Mumbai', stcd: 'Maharashtra', pncd: '400001' } },
      },
    }), { status: 200 });
  };
  const details = await lookupGstinDetails(gstin);
  assert.equal(details.source, 'provider');
  assert.equal(details.legal_name, 'Registered Legal Business');
  assert.equal(details.trade_name, 'Registered Trade Business');
  assert.match(details.address || '', /12, Main Road, Mumbai/);
  assert.equal(details.city, 'Mumbai');
  assert.equal(details.pincode, '400001');
  assert.equal(details.state, 'Maharashtra');
  assert.equal(details.state_code, '27');

  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, message: 'GSTIN not found' }), { status: 200 });
  await assert.rejects(lookupGstinDetails(gstin), /GSTIN not found/);

  env.GSTIN_LOOKUP_API_URL = undefined;
  const local = await lookupGstinDetails(gstin);
  assert.equal(local.source, 'local');
  assert.equal(local.address, null);
  assert.equal(local.legal_name, null);
  await assert.rejects(lookupGstinDetails('invalid'), /Invalid GSTIN/);
  console.log('Party GSTIN lookup smoke test passed');
}

run().then(() => {
  globalThis.fetch = originalFetch;
  env.GSTIN_LOOKUP_API_URL = originalUrl;
  env.GSTIN_LOOKUP_API_KEY = originalKey;
}).catch((error) => {
  globalThis.fetch = originalFetch;
  env.GSTIN_LOOKUP_API_URL = originalUrl;
  env.GSTIN_LOOKUP_API_KEY = originalKey;
  console.error(error);
  process.exitCode = 1;
});
