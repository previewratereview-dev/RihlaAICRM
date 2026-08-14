import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function listRpcs() {
  console.log('Testing RPC functions...');
  
  const testFuncs = [
    'get_user_role',
    'get_user_tenant_id',
    'provision_agency',
    'rate_limit_hit',
    'execute_production_backfill_transaction'
  ];

  for (const f of testFuncs) {
    const { data, error } = await adminClient.rpc(f as any, {});
    console.log(`RPC '${f}':`, error ? error.message : 'EXISTS / Output: ' + JSON.stringify(data));
  }
}

listRpcs().catch(console.error);
