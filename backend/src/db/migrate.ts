import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

const LEGACY_MIGRATION_ALIASES: Record<string, string[]> = {
  '003b_expense_gst_breakdown.sql': ['003_expense_gst_breakdown.sql'],
  '011_trial_system.sql': ['012_trial_system.sql'],
};

function parseMigrationVersion(file: string): string {
  const match = file.match(/^([0-9]+[a-z]?)(?=_)/i);
  return match?.[1] || file;
}

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

  const seenVersions = new Map<string, string>();
  for (const file of files) {
    const version = parseMigrationVersion(file);
    const prior = seenVersions.get(version);
    if (prior) {
      console.error(`❌ Duplicate migration version "${version}" detected: ${prior} and ${file}`);
      console.error('Rename one of them before running migrations.');
      process.exit(1);
    }
    seenVersions.set(version, file);
  }

  if (files.length === 0) {
    console.log('ℹ️  No migration files found.');
    await pool.end();
    return;
  }

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const namesToCheck = [file, ...(LEGACY_MIGRATION_ALIASES[file] || [])];

    // Check if already applied
    const { rows } = await pool.query(
      'SELECT name FROM _migrations WHERE name = ANY($1::text[]) LIMIT 1',
      [namesToCheck]
    );

    if (rows.length > 0) {
      const matchedName = rows[0].name;
      console.log(
        matchedName === file
          ? `  ⏭  ${file} (already applied)`
          : `  ⏭  ${file} (already applied as legacy name ${matchedName})`
      );
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
