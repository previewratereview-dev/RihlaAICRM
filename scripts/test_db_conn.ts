import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const pass = process.env.NEXT_PUBLIC_SEED_PASSWORD || 'Sabr4lyf@2';

// Different host formats for Supabase projects
const configs = [
  { host: 'db.djnscrvzsnttkfwsvrln.supabase.co', port: 5432, user: 'postgres' },
  { host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, user: 'postgres.djnscrvzsnttkfwsvrln' },
  { host: 'aws-0-ap-south-1.pooler.supabase.com', port: 6543, user: 'postgres.djnscrvzsnttkfwsvrln' },
  { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: 'postgres.djnscrvzsnttkfwsvrln' },
  { host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: 'postgres.djnscrvzsnttkfwsvrln' },
];

async function check() {
  for (const cfg of configs) {
    try {
      const connStr = `postgres://${cfg.user}:${encodeURIComponent(pass)}@${cfg.host}:${cfg.port}/postgres`;
      console.log(`Connecting to ${cfg.host}:${cfg.port} as ${cfg.user}...`);
      const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
      await c.connect();
      console.log('>>> SUCCESSFUL CONNECTION:', cfg.host, cfg.port, cfg.user);
      await c.end();
      return connStr;
    } catch (e: any) {
      console.log(`FAILED ${cfg.host}:${cfg.port}:`, e.message);
    }
  }
}

check().catch(console.error);
