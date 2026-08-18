import assert from 'node:assert/strict';
import { pool } from '../config/db';
import { INVOICE_PRINT_THEMES } from '../lib/printThemes';
import { generateInvoicePDF } from '../services/pdfService';

async function verifyPartyCreation(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fixture = await client.query(
      `SELECT c.id AS company_id, u.id AS user_id
       FROM companies c
       JOIN users u
         ON u.company_id = c.id
        AND u.is_active = true
        AND u.is_deleted = false
       WHERE c.is_deleted = false
       ORDER BY c.created_at ASC
       LIMIT 1`,
    );
    if (!fixture.rows.length) {
      console.log('Production regression smoke: skipped party insert (no local company/user fixture).');
      await client.query('ROLLBACK');
      return;
    }

    const { company_id: companyId, user_id: userId } = fixture.rows[0];
    const marker = `SMOKE-${Date.now()}`;
    const inserted = await client.query(
      `INSERT INTO parties (
        company_id, name, party_type, phone, email, gstin, pan,
        billing_address, shipping_address,
        billing_city, billing_state, billing_pincode, billing_state_code,
        city, state, pincode, state_code,
        credit_limit, credit_days, payment_terms,
        opening_balance, balance,
        contact_person, notes, custom_fields
      ) VALUES (
        $1, $2, 'party', $3, $4, NULL, NULL, $5, $6,
        $7, $8, $9, $10, $7, $8, $9, $10,
        $11, $12, $12, $13, $13, $14, $15, $16::jsonb
      )
      RETURNING id, name, balance`,
      [
        companyId,
        `Production Smoke ${marker}`,
        marker.slice(-20),
        `smoke-${Date.now()}@example.test`,
        'Billing address',
        'Shipping address',
        'Surat',
        'Gujarat',
        '395007',
        '24',
        100_000,
        30,
        12_345,
        'Smoke Contact',
        'Rolled back after verification',
        JSON.stringify({ smoke: true }),
      ],
    );
    assert.ok(inserted.rows[0]?.id);
    assert.equal(Number(inserted.rows[0].balance), 12_345);

    await client.query(
      `INSERT INTO party_ledger (
         company_id, party_id, type, amount, balance_after,
         narration, created_by
       ) VALUES ($1, $2, 'debit', $3, $3, 'Opening Balance', $4)`,
      [companyId, inserted.rows[0].id, 12_345, userId],
    );
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function verifyInvoicePdfs(): Promise<void> {
  const invoiceResult = await pool.query(
    `SELECT i.*
     FROM invoices i
     WHERE i.is_deleted = false
     ORDER BY i.created_at DESC
     LIMIT 1`,
  );
  if (!invoiceResult.rows.length) {
    console.log('Production regression smoke: skipped invoice PDFs (no local invoice fixture).');
    return;
  }

  const invoice = invoiceResult.rows[0];
  const [companyResult, partyResult, itemsResult] = await Promise.all([
    pool.query('SELECT * FROM companies WHERE id = $1 AND is_deleted = false', [invoice.company_id]),
    invoice.party_id
      ? pool.query('SELECT * FROM parties WHERE id = $1 AND company_id = $2', [invoice.party_id, invoice.company_id])
      : Promise.resolve({ rows: [null] }),
    pool.query(
      `SELECT * FROM invoice_items
       WHERE invoice_id = $1 AND company_id = $2
       ORDER BY sort_order, id`,
      [invoice.id, invoice.company_id],
    ),
  ]);
  assert.ok(companyResult.rows[0], 'Invoice company fixture is missing');
  assert.ok(itemsResult.rows.length, 'Invoice item fixture is missing');

  for (const theme of INVOICE_PRINT_THEMES) {
    const pdf = await generateInvoicePDF(
      { ...invoice, pdf_template: theme, document_theme: theme },
      companyResult.rows[0],
      partyResult.rows[0] || null,
      itemsResult.rows,
      { themeOverride: theme },
    );
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF', `${theme} did not return a PDF`);
    assert.ok(pdf.length > 1_000, `${theme} returned an unexpectedly small PDF`);
  }
}

async function main(): Promise<void> {
  await verifyPartyCreation();
  await verifyInvoicePdfs();
  await pool.end();
  console.log('Party creation and all invoice PDF themes passed.');
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
