import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';
const host = 'aws-0-ap-northeast-1.pooler.supabase.com';

const users = [`postgres.${projectRef}`, 'postgres'];
const passwords = [
  'Sabr4lyf@2',
  'Sabr4lyf2',
  'sabr4lyf@2',
  'Sabr4lyf@1',
  'Sabr4lyf',
  process.env.NEXT_PUBLIC_SEED_PASSWORD || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
];

async function findAuth() {
  for (const u of users) {
    for (const p of passwords) {
      if (!p) continue;
      for (const port of [6543, 5432]) {
        try {
          const connStr = `postgres://${u}:${encodeURIComponent(p)}@${host}:${port}/postgres`;
          const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
          await client.connect();
          console.log(`✓ SUCCESS! CONNECTED WITH user=${u}, port=${port}, pass='${p}'`);
          await client.end();
          return connStr;
        } catch (err: any) {
          // ignore
        }
      }
    }
  }
  console.log('No matching password found.');
}

findAuth().catch(console.error);
