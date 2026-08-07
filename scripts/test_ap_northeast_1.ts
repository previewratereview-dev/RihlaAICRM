import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';
const host = 'aws-0-ap-northeast-1.pooler.supabase.com';

const testPasswords = [
  'Sabr4lyf@2',
  'Sabr4lyf%402',
  process.env.NEXT_PUBLIC_SEED_PASSWORD || '',
];

async function testApNortheast1() {
  console.log('Testing ap-northeast-1 pooler...');
  for (const pw of testPasswords) {
    if (!pw) continue;
    const connStr = `postgres://postgres.${projectRef}:${encodeURIComponent(pw)}@${host}:6543/postgres`;
    console.log('Trying password length:', pw.length);
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      console.log('✓ SUCCESS! CONNECTED TO TOKYO POOLER (ap-northeast-1)!');
      const res = await client.query('SELECT current_database(), current_user;');
      console.log('Result:', res.rows[0]);
      await client.end();
      return connStr;
    } catch (err: any) {
      console.log('Error:', err.message);
    }
  }
}

testApNortheast1().catch(console.error);
