import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5432/smart_landlord' });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log('Tables in database:');
    result.rows.forEach(r => console.log(' -', r.table_name));
  } finally {
    await client.end();
  }
}

main().catch(console.error);
