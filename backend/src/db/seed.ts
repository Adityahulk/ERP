import { Pool } from 'pg';
import { env } from '../config/env';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

/**
 * No demo tenant data. Platform super_admin is created by migration `012_superadmin_setup.sql`
 * (email superadmin@microtechnique.in). This block is an idempotent no-op if that row exists.
 */
async function seed(): Promise<void> {
  console.log('🌱 Seed: no demo tenant data. Ensures platform super_admin row exists (same as migration 012).\n');
  await pool.query(
    `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
     SELECT NULL, 'Super Admin', 'superadmin@microtechnique.in',
            '$2a$12$3PnyYnA4LnIgK3gZK4vsyu2D5OGgyNPhn7tnkFdLm/Z3baHpFsp4u',
            'super_admin', true
     WHERE NOT EXISTS (
       SELECT 1 FROM users u
       WHERE u.company_id IS NULL AND lower(u.email) = 'superadmin@microtechnique.in' AND u.is_deleted = false
     )`
  );
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
