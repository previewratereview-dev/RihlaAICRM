import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function verifyTables() {
  console.log('Testing table existence on Supabase instance...');

  const { data: travData, error: travErr } = await adminClient.from('traveler_profiles').select('id');
  console.log('traveler_profiles:', travErr ? travErr.message : `EXISTS (${travData?.length || 0} rows)`);

  const { data: inqData, error: inqErr } = await adminClient.from('inquiries').select('id');
  console.log('inquiries:', inqErr ? inqErr.message : `EXISTS (${inqData?.length || 0} rows)`);

  const { data: bkData, error: bkErr } = await adminClient.from('bookings').select('id');
  console.log('bookings:', bkErr ? bkErr.message : `EXISTS (${bkData?.length || 0} rows)`);
}

verifyTables().catch(console.error);
