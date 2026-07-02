const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testVerify() {
  const token = 'f7d20b8f31a9857a6393e5a161769f97ad0d34440924d1622bbf4328ebb4dae5';
  const otp = '606099';

  console.log("Current time:", new Date().toISOString());

  const { data, error } = await supabase
    .from('email_verification_otps')
    .select('*')
    .eq('token', token)
    .eq('otp', otp)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  console.log("Result:");
  console.dir({ data, error }, { depth: null });
}

testVerify();
