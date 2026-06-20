const { Client } = require('pg');
require('dotenv').config();

// Try port 5433
const connectionString = "postgresql://bizflow:bizflow_dev@localhost:5433/bizflow";

const client = new Client({
  connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log('✅ Connected to 5433!');
    const res = await client.query("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 5;");
    console.log('Recent Invoices:', JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('❌ Failed on 5433:', err.message);
  } finally {
    await client.end();
  }
}

run();
