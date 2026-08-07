import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_ue2uDJPS6vKiKNRaQRy6Zg_j8SlQc14';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function deployStageADdl() {
  console.log('======================================================================');
  console.log('DEPLOYING STAGE A DDL TO SUPABASE DATABASE');
  console.log('Target:', supabaseUrl);
  console.log('======================================================================\n');

  const ddlPath = path.join(__dirname, '../supabase/migrations/008_stage_a_additive_schema.sql');
  const ddlSql = fs.readFileSync(ddlPath, 'utf8');

  // Try via sql / query endpoint if accessible via fetch
  console.log('Executing DDL SQL queries via Supabase endpoint...');

  // Execute statements sequentially or via query endpoint
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ sql_string: ddlSql }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.log('RPC exec_sql response status:', response.status, errText);

    // Fallback: Use Management API or raw SQL runner
    console.log('Attempting Supabase Management SQL runner...');
    const mgmtRes = await fetch(`${supabaseUrl}/pg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ query: ddlSql }),
    });

    console.log('Management API status:', mgmtRes.status, await mgmtRes.text().catch(() => ''));
  } else {
    console.log('✓ Stage A DDL executed successfully via RPC!');
  }
}

deployStageADdl().catch(console.error);
