import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';
const dbPassword = process.env.NEXT_PUBLIC_SEED_PASSWORD || 'Sabr4lyf@2';

const connectionString = `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
const directConnectionString = `postgres://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`;

async function applyMigration() {
  console.log('======================================================================');
  console.log('APPLYING STAGE A MIGRATION VIA DIRECT PG CONNECTION');
  console.log('======================================================================\n');

  let client: Client;
  try {
    console.log('Connecting via pooler endpoint...');
    client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('Connected to Supabase Postgres via pooler!');
  } catch (err: any) {
    console.log('Pooler connection error:', err.message, '\nTrying direct db endpoint...');
    client = new Client({ connectionString: directConnectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('Connected to Supabase Postgres via direct endpoint!');
  }

  const ddlPath = path.join(__dirname, '../supabase/migrations/008_stage_a_additive_schema.sql');
  const sql = fs.readFileSync(ddlPath, 'utf8');

  console.log('Executing 008_stage_a_additive_schema.sql...');
  await client.query(sql);
  console.log('✓ Migration executed successfully!');

  // Notify PostgREST to reload schema cache
  console.log('Reloading PostgREST schema cache...');
  await client.query("NOTIFY pgrst, 'reload schema';");
  console.log('✓ PostgREST schema cache reloaded!');

  await client.end();
}

applyMigration().catch(console.error);
