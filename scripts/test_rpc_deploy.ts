import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function testRpc() {
  console.log('Testing sync_lead_service_role RPC call...');
  const { data, error } = await adminClient.rpc('sync_lead_service_role' as any, {
    p_tenant_id: 'test',
    p_lead_id: 'test',
    p_payload: {}
  });

  if (error) {
    console.log('RPC Error:', error.message);
  } else {
    console.log('✓ RPC Result:', data);
  }
}

testRpc().catch(console.error);
