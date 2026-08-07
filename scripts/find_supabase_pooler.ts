import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';
const dbPassword = process.env.NEXT_PUBLIC_SEED_PASSWORD || 'Sabr4lyf@2';

const regions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-south-1',
  'sa-east-1',
];

async function findPooler() {
  console.log('Testing regions for Supabase pooler...');
  for (const r of regions) {
    const host = `aws-0-${r}.pooler.supabase.com`;
    const connStr = `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@${host}:6543/postgres`;
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      console.log(`✓ FOUND MATCHING REGION: ${r}! Host: ${host}`);
      await client.end();
      return { region: r, host, connStr };
    } catch (err: any) {
      if (!err.message.includes('ENOTFOUND')) {
        console.log(`Region ${r} -> ${err.message}`);
      }
    }
  }
  console.log('No pooler region matched.');
  return null;
}

findPooler().catch(console.error);
