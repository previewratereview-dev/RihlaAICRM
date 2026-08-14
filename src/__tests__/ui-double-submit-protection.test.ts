import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { generateId } from '@/lib/utils';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const pass = process.env.DATABASE_PASSWORD || '';
const isDbConfigured = Boolean(projectRef && pass);

describe.skipIf(!isDbConfigured)('UI-Level Rapid Double-Submit Safety & Idempotency', () => {
  let pgClient: Client;
  const testTenantId = `tenant-ui-double-submit-${Date.now()}`;
  let seedTravelerId: string;

  beforeEach(async () => {
    if (!isDbConfigured) return;
    pgClient = new Client({
      host: 'aws-0-ap-northeast-1.pooler.supabase.com',
      port: 6543,
      user: `postgres.${projectRef}`,
      password: pass,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
    });

    await pgClient.connect();

    // 1. Ensure test tenant exists in tenants table
    await pgClient.query(`
      INSERT INTO tenants (id, name, slug, created_at, updated_at)
      VALUES ($1, 'UI Double Submit Test Tenant', $1, now(), now());
    `, [testTenantId]);

    // 2. Create 1 seed TravelerProfile
    const travelerRes = await pgClient.query(`
      INSERT INTO traveler_profiles (tenant_id, display_name, email, phone, created_at, updated_at)
      VALUES ($1, 'UI Rapid Submit Test Traveler', 'uirapid@test.com', '9988776655', now(), now())
      RETURNING id;
    `, [testTenantId]);

    seedTravelerId = travelerRes.rows[0].id;
  });

  afterEach(async () => {
    if (pgClient) {
      await pgClient.query(`SET session_replication_role = 'replica';`);
      await pgClient.query(`DELETE FROM inquiries WHERE tenant_id = $1;`, [testTenantId]);
      await pgClient.query(`DELETE FROM bookings WHERE tenant_id = $1;`, [testTenantId]);
      await pgClient.query(`DELETE FROM leads WHERE tenant_id = $1;`, [testTenantId]);
      await pgClient.query(`DELETE FROM traveler_profiles WHERE tenant_id = $1;`, [testTenantId]);
      await pgClient.query(`DELETE FROM tenants WHERE id = $1;`, [testTenantId]);
      await pgClient.query(`SET session_replication_role = 'origin';`);
      await pgClient.end();
    }
  });

  it('simulates rapid double-submit through UI form session handler and proves idempotency', async () => {
    // Initial counts
    const countProfilesBefore = parseInt((await pgClient.query(`SELECT count(*)::text FROM traveler_profiles WHERE tenant_id = $1`, [testTenantId])).rows[0].count, 10);
    const countLeadsBefore = parseInt((await pgClient.query(`SELECT count(*)::text FROM leads WHERE tenant_id = $1`, [testTenantId])).rows[0].count, 10);
    const countInquiriesBefore = parseInt((await pgClient.query(`SELECT count(*)::text FROM inquiries WHERE tenant_id = $1`, [testTenantId])).rows[0].count, 10);

    expect(countProfilesBefore).toBe(1);
    expect(countLeadsBefore).toBe(0);
    expect(countInquiriesBefore).toBe(0);

    // Simulate form session ID generated once by LeadFormModal upon mount
    const sessionFormId = `lead-${generateId()}`;

    const payload = {
      id: sessionFormId,
      fullName: 'UI Rapid Submit Test Traveler',
      businessName: 'Pied Piper Test',
      email: 'uirapid@test.com',
      phone: '9988776655',
      whatsapp: '9988776655',
      destination: 'Kyoto Rapid Click Test',
      selectedTravelerId: seedTravelerId,
      leadSource: 'referral',
      tripType: 'Custom Itinerary',
      status: 'inquiry_received',
      priority: 'medium',
      dealValue: 9500,
    };

    // Simulate 2 rapid submit invocations through Migration 012 compatibility write contract using the stable sessionFormId
    const p1 = pgClient.query(`SELECT execute_sync_lead_dual_write($1::text, $2::text, $3::jsonb) AS result`, [testTenantId, sessionFormId, JSON.stringify(payload)]);
    const p2 = pgClient.query(`SELECT execute_sync_lead_dual_write($1::text, $2::text, $3::jsonb) AS result`, [testTenantId, sessionFormId, JSON.stringify(payload)]);

    const [res1, res2] = await Promise.all([p1, p2]);

    console.log('Attempt 1 result:', res1.rows[0].result);
    console.log('Attempt 2 result:', res2.rows[0].result);

    // Post-submission counts
    const countProfilesAfter = parseInt((await pgClient.query(`SELECT count(*)::text FROM traveler_profiles WHERE tenant_id = $1`, [testTenantId])).rows[0].count, 10);
    const countLeadsAfter = parseInt((await pgClient.query(`SELECT count(*)::text FROM leads WHERE tenant_id = $1`, [testTenantId])).rows[0].count, 10);
    const countInquiriesAfter = parseInt((await pgClient.query(`SELECT count(*)::text FROM inquiries WHERE tenant_id = $1`, [testTenantId])).rows[0].count, 10);

    const createdInquiry = (await pgClient.query(`SELECT id, traveler_id, destination FROM inquiries WHERE tenant_id = $1`, [testTenantId])).rows[0];

    // Assertions required by prompt:
    // - exactly +1 Lead
    expect(countLeadsAfter - countLeadsBefore).toBe(1);
    // - exactly +1 Inquiry
    expect(countInquiriesAfter - countInquiriesBefore).toBe(1);
    // - exactly +0 TravelerProfiles
    expect(countProfilesAfter - countProfilesBefore).toBe(0);
    // - both attempts cannot generate two distinct inquiries (res1 inquiry_id === res2 inquiry_id)
    expect(res1.rows[0].result.inquiry_id).toBe(res2.rows[0].result.inquiry_id);
    // - Inquiry.traveler_id equals selected TravelerProfile.id
    expect(createdInquiry.traveler_id).toBe(seedTravelerId);
  });
});
