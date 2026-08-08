import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const projectRef = 'djnscrvzsnttkfwsvrln';
const pass = 'a3iIWlBC4uvzlEdb';

async function investigate() {
  const client = new Client({
    host: 'aws-0-ap-northeast-1.pooler.supabase.com',
    port: 6543,
    user: `postgres.${projectRef}`,
    password: pass,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const tenantId = 'tenant-e54822a1ecba4d7bb3e097827b587a05';
  const travelerId = 'a05ef7c0-77c4-4d4a-9db0-2d5bd752dc92';

  console.log('--- 1. INQUIRIES FOR DAZZLE DENTAL CLINIC ---');
  const dazzleInquiries = await client.query(`
    SELECT id, legacy_lead_id, pipeline_stage, archived_at, created_at, updated_at, external_source, external_event_id, destination
    FROM inquiries
    WHERE tenant_id = $1 AND traveler_id = $2
    ORDER BY created_at ASC;
  `, [tenantId, travelerId]);

  console.log(JSON.stringify(dazzleInquiries.rows, null, 2));

  console.log('--- 2. MATCHING LEADS FOR DAZZLE DENTAL CLINIC ---');
  const dazzleLeads = await client.query(`
    SELECT id, status, archived_at, created_at, updated_at, destination
    FROM leads
    WHERE tenant_id = $1 AND (
      email = 'contact@dazzle.dental' OR phone = '02241498949' OR full_name = 'Dazzle Dental Clinic'
      OR id IN (SELECT legacy_lead_id FROM inquiries WHERE traveler_id = $2)
    )
    ORDER BY created_at ASC;
  `, [tenantId, travelerId]);

  console.log(JSON.stringify(dazzleLeads.rows, null, 2));

  console.log('--- 3. ALL INQUIRIES FOR TENANT SORTED BY CREATED_AT ---');
  const allInquiries = await client.query(`
    SELECT id, traveler_id, legacy_lead_id, pipeline_stage, archived_at, created_at, destination
    FROM inquiries
    WHERE tenant_id = $1
    ORDER BY created_at ASC;
  `, [tenantId]);

  console.log(`Total Inquiries in Tenant: ${allInquiries.rows.length}`);
  console.log(JSON.stringify(allInquiries.rows, null, 2));

  console.log('--- 4. ALL LEADS FOR TENANT SORTED BY CREATED_AT ---');
  const allLeads = await client.query(`
    SELECT id, status, archived_at, created_at, full_name, destination
    FROM leads
    WHERE tenant_id = $1
    ORDER BY created_at ASC;
  `, [tenantId]);

  console.log(`Total Leads in Tenant: ${allLeads.rows.length}`);
  console.log(JSON.stringify(allLeads.rows, null, 2));

  await client.end();
}

investigate().catch(console.error);
