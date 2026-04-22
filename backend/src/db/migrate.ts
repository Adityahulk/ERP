import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bizflow:bizflow_dev@localhost:5432/bizflow',
});

async function migrate(): Promise<void> {
  console.log('🔄 Starting database migration...\n');

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Read migration files
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.error('❌ Migrations directory not found:', migrationsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('ℹ️  No migration files found.');
    await pool.end();
    return;
  }

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    // Check if already applied
    const { rows } = await pool.query(
      'SELECT 1 FROM _migrations WHERE name = $1',
      [file]
    );

    if (rows.length > 0) {
      console.log(`  ⏭  ${file} (already applied)`);
      skipped++;
      continue;
    }

    // Apply migration
    console.log(`  🔄 Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`  ✅ Applied ${file}`);
      applied++;
    } catch (error: any) {
      await pool.query('ROLLBACK');
      console.error(`  ❌ Failed to apply ${file}:`, error.message);
      process.exit(1);
    }
  }

  console.log(`\n🎉 Migration complete! Applied: ${applied}, Skipped: ${skipped}`);
  await pool.end();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
