import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_ue2uDJPS6vKiKNRaQRy6Zg_j8SlQc14';

async function deploySql() {
  console.log('Testing SQL Deployment Endpoints...');
  const ddlPath = path.join(__dirname, '../supabase/migrations/010_production_backfill_transaction.sql');
  const sqlString = fs.readFileSync(ddlPath, 'utf8');

  // Test 1: Management API
  const endpoints = [
    `https://api.supabase.com/v1/projects/djnscrvzsnttkfwsvrln/database/query`,
    `${supabaseUrl}/rest/v1/rpc/exec_sql`,
    `${supabaseUrl}/rest/v1/rpc/query`,
    `${supabaseUrl}/pg_exec`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ query: sqlString, sql_string: sqlString, sql: sqlString }),
      });
      console.log(`Endpoint ${ep} -> Status:`, res.status, await res.text().catch(() => ''));
    } catch (err: any) {
      console.log(`Endpoint ${ep} -> Error:`, err.message);
    }
  }
}

deploySql().catch(console.error);
