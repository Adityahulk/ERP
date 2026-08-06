import { PoolClient } from 'pg';
import { query, withTransaction } from '../../../config/db';
import { enforceSingleDefaultTerm } from './helpers/terms-default.helper';

type Db = { query: PoolClient['query'] };

const MAIN_COLUMNS = [
  'show_invoice_number', 'add_time_on_transactions', 'cash_sale_by_default',
  'show_billing_name_of_parties', 'show_customer_po_details',
  'show_inclusive_exclusive_tax', 'show_purchase_price_in_items',
  'show_last5_sale_price', 'show_last5_purchase_price', 'show_free_item_quantity',
  'show_count_column', 'count_column_label', 'enable_transaction_wise_tax',
  'enable_transaction_wise_discount', 'round_off_total', 'round_off_type',
  'round_off_to', 'enable_eway_bill', 'enable_quick_entry',
  'do_not_show_invoice_preview', 'enable_passcode_for_edit_delete',
  'enable_discount_during_payments', 'link_payments_to_invoices',
  'enable_due_dates_and_payment_terms', 'show_profit_while_making_sale_invoice',
  'enable_terms_and_conditions', 'billing_type', 'default_upi_id',
] as const;

const PREFIX_COLUMNS = ['sale', 'credit_note', 'sale_order', 'purchase_order', 'estimate', 'proforma_invoice', 'delivery_challan', 'payment_in'] as const;

const ADDITIONAL_FIELDS_COLUMNS = [
  'invoice_theme', 'firm_field1_enabled', 'firm_field1_label', 'firm_field2_enabled', 'firm_field2_label',
  'txn_field1_enabled', 'txn_field1_label', 'txn_field2_enabled', 'txn_field2_label', 'txn_field3_enabled',
  'txn_field3_label', 'txn_date_field_enabled', 'txn_date_field_label', 'show_on_sales', 'show_on_purchase',
  'show_on_expense', 'show_on_payment_in',
] as const;

const TRANSPORT_COLUMNS = Array.from({ length: 6 }, (_, i) => {
  const n = i + 1;
  return [`field${n}_label`, `field${n}_enabled`, `field${n}_show_in_print`];
}).flat() as string[];

const CHARGE_COLUMNS = [
  'master_enabled',
  'charge1_label', 'charge1_enabled', 'charge1_sac_code', 'charge1_tax_rate', 'charge1_tax_enabled',
  'charge2_label', 'charge2_enabled', 'charge2_sac_code', 'charge2_tax_rate', 'charge2_tax_enabled',
  'charge3_label', 'charge3_enabled', 'charge3_sac_code', 'charge3_tax_rate', 'charge3_tax_enabled',
] as const;

function camel(key: string) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function toCamel(row: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row || {})) out[camel(key)] = value;
  return out;
}

async function ensureDefaults(db: Db, firmId: string) {
  await db.query(`INSERT INTO transaction_settings (firm_id) VALUES ($1) ON CONFLICT (firm_id) DO NOTHING`, [firmId]);
  await db.query(
    `INSERT INTO transaction_prefixes (firm_id, sale)
     SELECT id, COALESCE(NULLIF(invoice_prefix, ''), 'INV')
     FROM companies
     WHERE id = $1
     ON CONFLICT (firm_id) DO NOTHING`,
    [firmId],
  );
  await db.query(`INSERT INTO additional_fields_config (firm_id) VALUES ($1) ON CONFLICT (firm_id) DO NOTHING`, [firmId]);
  await db.query(`INSERT INTO transportation_details_config (firm_id) VALUES ($1) ON CONFLICT (firm_id) DO NOTHING`, [firmId]);
  await db.query(`INSERT INTO additional_charges_config (firm_id) VALUES ($1) ON CONFLICT (firm_id) DO NOTHING`, [firmId]);
}

async function getOne(table: string, firmId: string) {
  const result = await query(`SELECT * FROM ${table} WHERE firm_id = $1`, [firmId]);
  return toCamel(result.rows[0] || {});
}

async function updateTable(table: string, firmId: string, columns: readonly string[], payload: Record<string, any>) {
  const updates: string[] = [];
  const values: any[] = [];
  for (const column of columns) {
    const key = camel(column);
    if (payload[key] !== undefined) {
      values.push(payload[key]);
      updates.push(`${column} = $${values.length}`);
    }
  }
  if (!updates.length) return getOne(table, firmId);
  values.push(firmId);
  const result = await query(
    `UPDATE ${table} SET ${updates.join(', ')}, updated_at = now() WHERE firm_id = $${values.length} RETURNING *`,
    values,
  );
  return toCamel(result.rows[0]);
}

export async function getAllTransactionSettings(firmId: string) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  const [settings, prefixes, additionalFields, transportation, charges, terms] = await Promise.all([
    getOne('transaction_settings', firmId),
    getOne('transaction_prefixes', firmId),
    getOne('additional_fields_config', firmId),
    getOne('transportation_details_config', firmId),
    getOne('additional_charges_config', firmId),
    listTerms(firmId),
  ]);
  return { settings, prefixes, additionalFields, transportation, charges, terms };
}

export async function updateMainSettings(firmId: string, payload: Record<string, any>) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return updateTable('transaction_settings', firmId, MAIN_COLUMNS, payload);
}

export async function getPrefixes(firmId: string) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return getOne('transaction_prefixes', firmId);
}

export async function updatePrefixes(firmId: string, payload: Record<string, any>) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return updateTable('transaction_prefixes', firmId, PREFIX_COLUMNS, payload);
}

export async function getAdditionalFields(firmId: string) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return getOne('additional_fields_config', firmId);
}

export async function updateAdditionalFields(firmId: string, payload: Record<string, any>) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return updateTable('additional_fields_config', firmId, ADDITIONAL_FIELDS_COLUMNS, payload);
}

export async function getTransportation(firmId: string) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return getOne('transportation_details_config', firmId);
}

export async function updateTransportation(firmId: string, payload: Record<string, any>) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return updateTable('transportation_details_config', firmId, TRANSPORT_COLUMNS, payload);
}

export async function getCharges(firmId: string) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return getOne('additional_charges_config', firmId);
}

export async function updateCharges(firmId: string, payload: Record<string, any>) {
  await withTransaction((client) => ensureDefaults(client, firmId));
  return updateTable('additional_charges_config', firmId, CHARGE_COLUMNS, payload);
}

export async function listTerms(firmId: string) {
  const result = await query(
    `SELECT * FROM terms_and_conditions WHERE firm_id = $1 ORDER BY transaction_type, sort_order, created_at`,
    [firmId],
  );
  const grouped: Record<string, any[]> = {};
  for (const row of result.rows) {
    const item = toCamel(row);
    grouped[item.transactionType] = grouped[item.transactionType] || [];
    grouped[item.transactionType].push(item);
  }
  return grouped;
}

export async function createTerm(firmId: string, payload: Record<string, any>) {
  return withTransaction(async (client) => {
    if (payload.isDefault) await enforceSingleDefaultTerm(client, firmId, payload.transactionType);
    const result = await client.query(
      `INSERT INTO terms_and_conditions (firm_id, transaction_type, title, content, is_default, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [firmId, payload.transactionType, payload.title, payload.content, !!payload.isDefault, payload.sortOrder || 0],
    );
    return toCamel(result.rows[0]);
  });
}

export async function updateTerm(firmId: string, id: string, payload: Record<string, any>) {
  return withTransaction(async (client) => {
    const existing = await client.query(`SELECT * FROM terms_and_conditions WHERE id = $1 AND firm_id = $2`, [id, firmId]);
    if (!existing.rows.length) return null;
    const nextType = payload.transactionType || existing.rows[0].transaction_type;
    if (payload.isDefault) await enforceSingleDefaultTerm(client, firmId, nextType, id);
    const result = await client.query(
      `UPDATE terms_and_conditions
          SET transaction_type = $1, title = $2, content = $3, is_default = $4, sort_order = $5, updated_at = now()
        WHERE id = $6 AND firm_id = $7 RETURNING *`,
      [
        nextType,
        payload.title ?? existing.rows[0].title,
        payload.content ?? existing.rows[0].content,
        payload.isDefault ?? existing.rows[0].is_default,
        payload.sortOrder ?? existing.rows[0].sort_order,
        id,
        firmId,
      ],
    );
    return toCamel(result.rows[0]);
  });
}

export async function deleteTerm(firmId: string, id: string) {
  const result = await query(`DELETE FROM terms_and_conditions WHERE id = $1 AND firm_id = $2 RETURNING id`, [id, firmId]);
  return Number(result.rowCount || 0) > 0;
}
