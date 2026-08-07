import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';
const dbPassword = process.env.NEXT_PUBLIC_SEED_PASSWORD || 'Sabr4lyf@2';

// Standard Supabase pooler formats
const connectionStrings = [
  `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  `postgres://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`,
  `postgres://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:6543/postgres`,
];

async function testPgConnection() {
  console.log('Testing PG connections...');
  for (const connStr of connectionStrings) {
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      console.log('✓ CONNECTED SUCCESSFULLY TO:', connStr);
      
      const res = await client.query('SELECT current_database(), current_user, version();');
      console.log('DB Info:', res.rows[0]);
      
      await client.end();
      return connStr;
    } catch (err: any) {
      console.log('Failed:', connStr.split('@')[1], '->', err.message);
    }
  }
  return null;
}

testPgConnection().catch(console.error);
