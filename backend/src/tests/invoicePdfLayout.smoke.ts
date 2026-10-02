import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateInvoicePDF } from '../services/pdfService';

const company = {
  name: 'Microtechnique Accounts',
  legal_name: 'Microtechnique Accounts Private Limited',
  address: '22 Industrial Estate, Main Road, Surat, Gujarat 395001',
  phone: '9876543210',
  email: 'billing@example.com',
  gstin: '24AACCM1234F1Z5',
  state_code: '24',
  bank_name: 'Example Bank',
  bank_account_number: '123456789012',
  bank_ifsc: 'EXAM0001234',
  upi_id: 'billing@examplebank',
  terms_and_conditions: 'Payment due within 30 days. Goods once sold may be returned under our written returns policy.',
  invoice_notes: 'Please quote the invoice number when making payment.',
};

const party = {
  name: 'A Customer With A Longer Registered Trading Name',
  billing_address: 'Office 14, First Floor, Example Business Plaza, Ring Road, Surat, Gujarat 395002',
  shipping_address: 'Warehouse 3, Logistics Park, Surat, Gujarat 395003',
  phone: '9123456789',
  gstin: '24AAACB1234C1Z1',
  billing_state_code: '24',
};

const invoice = {
  invoice_number: 'INV0004',
  invoice_date: '2026-10-02',
  due_date: '2026-11-01',
  total_amount: 118000,
  subtotal: 100000,
  subtotal_amount: 100000,
  taxable_amount: 100000,
  cgst_amount: 9000,
  sgst_amount: 9000,
  discount_amount: 0,
  paid_amount: 0,
  balance_due: 118000,
  shipping_address_snapshot: party.shipping_address,
  notes: 'Handle with care and verify quantities at delivery.',
};

function pageCount(buffer: Buffer): number {
  // Chromium writes page dictionaries uncompressed; exclude /Pages tree nodes.
  return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

async function run() {
  const shortItems = [
    { item_name: 'Aluminium composite panel, matte finish', item_description: 'Size 8 x 4 feet', hsn_code: '760611', quantity: 2, unit: 'PCS', unit_price: 50000, gst_rate: 18, tax_amount: 18000, total_amount: 118000 },
  ];
  const short = await generateInvoicePDF(invoice, company, party, shortItems, { themeOverride: 'business-theme-1' });
  if (process.env.DEBUG_INVOICE_PDF_LAYOUT) fs.writeFileSync('/tmp/invoice-layout-short.pdf', short);
  assert.equal(pageCount(short), 1, 'A one-item invoice must fit on one A4 page');
  const threeItems = Array.from({ length: 3 }, (_, index) => ({ ...shortItems[0], item_name: `Aluminium composite panel ${index + 1}` }));
  const three = await generateInvoicePDF(invoice, company, party, threeItems, { themeOverride: 'business-theme-1' });
  if (process.env.DEBUG_INVOICE_PDF_LAYOUT) fs.writeFileSync('/tmp/invoice-layout-three.pdf', three);
  assert.equal(pageCount(three), 1, 'A three-item invoice must fit on one A4 page');

  for (const theme of ['business-theme-2', 'business-theme-3', 'business-theme-4']) {
    const alternate = await generateInvoicePDF(invoice, company, party, shortItems, { themeOverride: theme });
    if (process.env.DEBUG_INVOICE_PDF_LAYOUT) fs.writeFileSync(`/tmp/invoice-layout-${theme}.pdf`, alternate);
    assert.equal(pageCount(alternate), 1, `${theme} should fit a one-item invoice on one A4 page`);
  }

  const denseItems = Array.from({ length: 32 }, (_, index) => ({
    ...shortItems[0],
    item_name: `Aluminium composite panel batch ${index + 1}`,
    item_description: `Lengthy specification and finishing instructions for item ${index + 1}. Deliver in original packing.`,
  }));
  const long = await generateInvoicePDF(invoice, company, party, denseItems, { themeOverride: 'business-theme-1' });
  if (process.env.DEBUG_INVOICE_PDF_LAYOUT) fs.writeFileSync('/tmp/invoice-layout-long.pdf', long);
  assert.ok(pageCount(long) > 1, 'A genuinely long invoice must paginate without clipping');
  console.log('Invoice PDF A4 layout smoke test passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
