import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const dbPassword = process.env.DATABASE_PASSWORD || process.env.NEXT_PUBLIC_SEED_PASSWORD || '';

async function main() {
  console.log('======================================================================');
  console.log('APPLYING STAGE C0 MIGRATION VIA DIRECT PG CLIENT OPTIONS');
  console.log('======================================================================\n');

  console.log(`Connecting to Tokyo Pooler (aws-0-ap-northeast-1.pooler.supabase.com:6543)...`);
  const client = new Client({
    host: 'aws-0-ap-northeast-1.pooler.supabase.com',
    port: 6543,
    user: `postgres.${projectRef}`,
    password: dbPassword,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✓ SUCCESSFUL DB CONNECTION!');
    
    const ddlPath = path.join(__dirname, '../supabase/migrations/011_stage_c0_compatibility_rpc.sql');
    const sql = fs.readFileSync(ddlPath, 'utf8');

    console.log('Executing 011_stage_c0_compatibility_rpc.sql...');
    await client.query(sql);
    console.log('✓ Stage C0 Migration 011 executed successfully!');

    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('✓ PostgREST schema cache reloaded!');
  } catch (err: any) {
    console.error('Migration Failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
