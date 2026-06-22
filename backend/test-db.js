const { Client } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'bizflow'}:${process.env.DB_PASSWORD || 'bizflow_dev'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'bizflow'}`;

console.log('Testing database connection...');
console.log(`Connection string: ${connectionString.replace(/:([^:@]+)@/, ':****@')}`);

const client = new Client({
  connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log('✅ SUCCESS: Connected to the PostgreSQL database!');
    const res = await client.query('SELECT NOW() as now, version() as version;');
    console.log(`PostgreSQL Version: ${res.rows[0].version}`);
    console.log(`Database server time: ${res.rows[0].now}`);
  } catch (err) {
    console.error('❌ FAILURE: Could not connect to the database.');
    console.error(err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
