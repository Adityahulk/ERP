import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bizflow:bizflow_dev@localhost:5432/bizflow',
});

async function reset(): Promise<void> {
  console.log('⚠️  Dropping all tables...\n');

  try {
    // Drop all tables in correct order (reverse of creation)
    await pool.query(`
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS notification_logs CASCADE;
      DROP TABLE IF EXISTS attendance CASCADE;
      DROP TABLE IF EXISTS leave_applications CASCADE;
      DROP TABLE IF EXISTS leave_types CASCADE;
      DROP TABLE IF EXISTS employee_profiles CASCADE;
      DROP TABLE IF EXISTS expenses CASCADE;
      DROP TABLE IF EXISTS journal_entry_lines CASCADE;
      DROP TABLE IF EXISTS journal_entries CASCADE;
      DROP TABLE IF EXISTS accounts CASCADE;
      DROP TABLE IF EXISTS purchase_invoice_items CASCADE;
      DROP TABLE IF EXISTS purchase_invoices CASCADE;
      DROP TABLE IF EXISTS purchase_order_items CASCADE;
      DROP TABLE IF EXISTS purchase_orders CASCADE;
      DROP TABLE IF EXISTS quotation_items CASCADE;
      DROP TABLE IF EXISTS quotations CASCADE;
      DROP TABLE IF EXISTS payment_allocations CASCADE;
      DROP TABLE IF EXISTS payments CASCADE;
      DROP TABLE IF EXISTS invoice_items CASCADE;
      DROP TABLE IF EXISTS invoices CASCADE;
      DROP TABLE IF EXISTS parties CASCADE;
      DROP TABLE IF EXISTS stock_adjustment_items CASCADE;
      DROP TABLE IF EXISTS stock_adjustments CASCADE;
      DROP TABLE IF EXISTS stock_transfer_items CASCADE;
      DROP TABLE IF EXISTS stock_transfers CASCADE;
      DROP TABLE IF EXISTS stock_movements CASCADE;
      DROP TABLE IF EXISTS item_serial_numbers CASCADE;
      DROP TABLE IF EXISTS item_batches CASCADE;
      DROP TABLE IF EXISTS item_stock CASCADE;
      DROP TABLE IF EXISTS items CASCADE;
      DROP TABLE IF EXISTS item_units CASCADE;
      DROP TABLE IF EXISTS item_categories CASCADE;
      DROP TABLE IF EXISTS godowns CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS companies CASCADE;
      DROP TABLE IF EXISTS _migrations CASCADE;
      DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    `);

    console.log('✅ All tables dropped successfully.');
  } catch (error) {
    console.error('❌ Reset failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
