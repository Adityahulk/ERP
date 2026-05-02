import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bizflow:bizflow_dev@localhost:5432/bizflow',
});

/**
 * Intentionally does not insert demo companies, users, or inventory.
 * Schema comes from SQL migrations only; create data via registration / onboarding / SQL.
 */
async function seed(): Promise<void> {
  console.log('🌱 Seed: no demo data (by design). Use the app or SQL to populate the database.\n');
  await pool.query('SELECT 1');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
