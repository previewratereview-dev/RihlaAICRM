import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';

const host = 'aws-0-ap-northeast-1.pooler.supabase.com';

const possiblePasswords = [
  'Sabr4lyf@2',
  'sb_secret_ue2uDJPS6vKiKNRaQRy6Zg_j8SlQc14',
  'sb_publishable_BI7a7SPMgD9743a1UJaKtQ_HiNZp-yh',
  'f6b871f1e2247353a78391aeaff198bb4b585d4edb4f907601162c7499ccb7df',
  're_Dwid42Wk_QJKqFbwU5UwPLEe46vi5LUEY',
  'rzp_test_T8GBZuZ956g2ui',
];

async function testPasswords() {
  console.log('Testing password candidates against Tokyo pooler...');
  for (const pw of possiblePasswords) {
    const connStr = `postgres://postgres.${projectRef}:${encodeURIComponent(pw)}@${host}:6543/postgres`;
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      console.log('✓ SUCCESS! PASSWORD MATCHED:', pw);
      const res = await client.query('SELECT current_database(), current_user;');
      console.log('DB Info:', res.rows[0]);
      await client.end();
      return connStr;
    } catch (err: any) {
      console.log(`Password starting with '${pw.substring(0, 5)}...' -> ${err.message}`);
    }
  }
}

testPasswords().catch(console.error);
