const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('../../backend/node_modules/puppeteer');

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-import-ui-'));
  try {
    const page = await browser.newPage();
    const failures = [];
    page.on('pageerror', (err) => failures.push(err.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('microtechnique-auth', JSON.stringify({ state: { user: { id: 'user', companyId: 'company', role: 'admin', name: 'Test' },
        company: { id: 'company', name: 'Import Test', itemTerminology: 'Item', itemTerminologyPlural: 'Items' }, isAuthenticated: true, license: null }, version: 0 }));
      localStorage.setItem('microtechnique_access_token', 'test-only');
    });
    await page.setRequestInterception(true);
    let confirmed = false;
    const dataRow = { name: 'LAPCARE stand', opening_stock: 2 };
    page.on('request', async (request) => {
      if (!request.url().includes('/api/')) return request.continue();
      const url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
      let data = [];
      if (url.pathname.endsWith('/godowns')) data = [{ id: 'varachha', name: 'Varachha', is_active: true, is_default: true }, { id: 'nanpura', name: 'Nanpura', is_active: true }];
      else if (url.pathname.endsWith('/company')) data = { id: 'company', name: 'Import Test' };
      else if (url.pathname.endsWith('/auth/me')) data = { user: { id: 'user', role: 'admin' }, license: null };
      else if (url.pathname.endsWith('/notifications/in-app')) data = { overdueCount: 0, lowStockCount: 0, overdueInvoices: [], lowStockItems: [] };
      else if (url.pathname.endsWith('/settings/transaction')) data = { settings: {}, prefixes: {}, terms: {} };
      else if (url.pathname.endsWith('/item-categories')) data = { tree: [], flat: [] };
      else if (url.pathname.endsWith('/items') || url.pathname.endsWith('/users')) data = { data: [], pagination: { total: 0, hasNext: false } };
      else if (url.pathname.endsWith('/items/bulk-import')) {
        const body = request.postData() || await request.fetchPostData() || '';
        assert.ok(body.includes('nanpura'), 'Chosen godown is sent in preview and confirm');
        if (url.searchParams.get('action') === 'confirm') {
          assert.ok(body.includes('reviewed-hash'));
          assert.ok(body.includes('confirm_transfers'));
          confirmed = true;
          data = { inserted: 0, reused: 2, transferred: 1, skipped: 0 };
        } else if (body.includes('existing-2') && body.includes('transfer')) {
          data = { total: 3, valid: 2, invalid: 0, transfers: 1, preview_hash: 'reviewed-hash', alreadyPresent: [], errors: [],
            preview: [{ row: 31, data: dataRow, warnings: ['Nanpura stock will be set to 2.'] }, { row: 675, data: { name: 'WD HDD', opening_stock: 1 }, warnings: ['Moves one unit from Varachha to Nanpura.'] }] };
        } else data = { total: 3, valid: 0, invalid: 2, preview_hash: 'initial-hash', alreadyPresent: [], preview: [],
          errors: [{ row: 31, data: dataRow, errors: ['Choose which existing item to stock'], resolutionKey: 'name-key', choices: [{ value: 'existing-1', label: 'Stand 1' }, { value: 'existing-2', label: 'Stand 2' }] },
            { row: 675, data: { name: 'WD HDD' }, errors: ['This unit is in Varachha'], resolutionKey: 'serial-key', choices: [{ value: 'skip', label: 'Keep in Varachha' }, { value: 'transfer', label: 'Transfer to Nanpura' }] }] };
      }
      return request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ success: true, data }) });
    });
    const button = async (text) => {
      const handle = await page.waitForFunction((label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label)), {}, text);
      return handle.asElement();
    };
    await page.goto('http://127.0.0.1:3000/settings?section=data', { waitUntil: 'networkidle0' });
    await page.waitForSelector('select');
    await page.select('select', 'nanpura');
    const fixture = path.join(directory, 'items.json');
    fs.writeFileSync(fixture, JSON.stringify([{ Name: 'LAPCARE stand', Qty: 2 }]));
    const input = await page.$('input[type="file"][accept=".xlsx,.xls,.csv,.json"]');
    await input.uploadFile(fixture);
    await page.waitForSelector('select[aria-label="Resolve row 31"]');
    await page.select('select[aria-label="Resolve row 31"]', 'existing-2');
    await page.select('select[aria-label="Resolve row 675"]', 'transfer');
    await (await button('Recheck selections')).click();
    await page.waitForFunction(() => document.body.textContent.includes('I confirm transferring 1'));
    const save = await button('Import 2 valid');
    assert.equal(await save.evaluate((node) => node.disabled), true);
    const transferCheckbox = await page.waitForFunction(() => [...document.querySelectorAll('label')].find((node) => node.textContent.includes('I confirm transferring'))?.querySelector('input'));
    await transferCheckbox.asElement().click();
    assert.equal(await save.evaluate((node) => node.disabled), false);
    await page.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true });
    await save.click();
    await page.waitForFunction(() => document.body.textContent.includes('1 units transferred'));
    assert.equal(confirmed, true);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:3000/settings?section=data', { waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://127.0.0.1:3000/items', { waitUntil: 'networkidle0' });
    await (await button('Import Items')).click();
    await page.waitForSelector('[role="dialog"] input[type="file"]');
    assert.ok(await page.$('[role="dialog"] select'), 'Items screen uses the same godown selector and preview');
    assert.deepEqual(failures, []);
    console.log(`Import UI checks passed. Screenshots: ${directory}`);
  } finally { await browser.close(); }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
