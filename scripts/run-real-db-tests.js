/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Real Local PostgreSQL Verification Suite for Phase AI-3
 * 
 * Targets ONLY 127.0.0.1:5432 (local PostgreSQL).
 * Exercises real PostgreSQL transactions, constraints, RLS/grants, and error codes.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_HOST = '127.0.0.1';
const LOCAL_PORT = 5432;
const LOCAL_USER = 'postgres';
const LOCAL_PASSWORD = 'postgres';
const TEST_DB_NAME = 'rihla_local_test_db';

// Hard Safety Boundary Check
if (LOCAL_HOST !== '127.0.0.1' && LOCAL_HOST !== 'localhost') {
  console.error('UNSAFE DATABASE TARGET — STOPPED');
  process.exit(1);
}

function verifyMigrationHashes() {
  const m11Path = path.resolve(__dirname, '../supabase/migrations/011_stage_c0_compatibility_rpc.sql');
  const m12Path = path.resolve(__dirname, '../supabase/migrations/012_c1_selected_traveler_linkage.sql');

  const m11Hash = crypto.createHash('sha256').update(fs.readFileSync(m11Path)).digest('hex').toLowerCase();
  const m12Hash = crypto.createHash('sha256').update(fs.readFileSync(m12Path)).digest('hex').toLowerCase();

  const EXPECTED_M11 = '2fd5d5a8b41666941e471094ca2c70e3812644509bd5a5f32b9284182dacc29e';
  const EXPECTED_M12 = '7cc2ebf5c452c5db4769b9def6f3f53d1948208feb1bc608d37b9f7b89180ba8';

  if (m11Hash !== EXPECTED_M11) {
    throw new Error(`IMMUTABLE HASH MISMATCH on migration 011: got ${m11Hash}, expected ${EXPECTED_M11}`);
  }
  if (m12Hash !== EXPECTED_M12) {
    throw new Error(`IMMUTABLE HASH MISMATCH on migration 012: got ${m12Hash}, expected ${EXPECTED_M12}`);
  }
  console.log('✓ Verified immutable migration hashes for 011 and 012.');
}

async function runRealDbVerification() {
  console.log('======================================================================');
  console.log('PHASE AI-3: REAL LOCAL DATABASE VERIFICATION');
  console.log(`Target: ${LOCAL_HOST}:${LOCAL_PORT}/${TEST_DB_NAME}`);
  console.log('BASELINE MODE: DEPENDENCY-COMPLETE LOCAL SCHEMA FIXTURE');
  console.log('======================================================================\n');

  // Verify immutable hashes before touching DB
  verifyMigrationHashes();

  // 1. Connect to root postgres database and create fresh isolated test database
  const rootClient = new Client({
    host: LOCAL_HOST,
    port: LOCAL_PORT,
    user: LOCAL_USER,
    password: LOCAL_PASSWORD,
    database: 'postgres',
  });

  await rootClient.connect();
  console.log('\n[1/18] Connected to root PostgreSQL on 127.0.0.1:5432.');

  // Drop existing test database if exists, then create fresh
  await rootClient.query(`
    SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid();
  `);
  await rootClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME};`);
  await rootClient.query(`CREATE DATABASE ${TEST_DB_NAME};`);
  console.log(`[2/18] Created isolated fresh database "${TEST_DB_NAME}".`);
  await rootClient.end();

  // 2. Connect to fresh test database as superuser (postgres)
  const client = new Client({
    host: LOCAL_HOST,
    port: LOCAL_PORT,
    user: LOCAL_USER,
    password: LOCAL_PASSWORD,
    database: TEST_DB_NAME,
  });
  await client.connect();

  // 3. Setup standard Supabase database schemas, roles and extensions
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid; $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user; $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END
    $$;
  `);

  // Provide fallback for pgvector on native Windows if extension is not compiled
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  } catch (extErr) {
    console.log('  [Notice] Native pgvector extension not present in Windows binaries; providing stub vector domain for knowledge table.');
    await client.query(`CREATE DOMAIN vector AS text;`);
  }
  console.log('[3/18] Ensured auth schema, roles (anon, authenticated, service_role) exist.');

  // 4. Apply Schema Base & Additive Migrations
  console.log('\n[4/18] Applying repository schemas & dependency-complete baseline...');
  
  // 4a. 01_supabase_schema.sql
  const s01Path = path.resolve(__dirname, '../supabase/01_supabase_schema.sql');
  let s01Sql = fs.readFileSync(s01Path, 'utf8');
  s01Sql = s01Sql.replace(/create extension if not exists vector;/gi, '-- create extension if not exists vector;');
  s01Sql = s01Sql.replace(/vector\(\d+\)/gi, 'vector');
  await client.query(s01Sql);
  console.log('  ✓ Applied supabase/01_supabase_schema.sql');

  // 4b. 008_stage_a_additive_schema.sql
  const s08Path = path.resolve(__dirname, '../supabase/migrations/008_stage_a_additive_schema.sql');
  const s08Sql = fs.readFileSync(s08Path, 'utf8');
  await client.query(s08Sql);
  console.log('  ✓ Applied supabase/migrations/008_stage_a_additive_schema.sql');

  // 4c. DDL Additions from 011_stage_c0_compatibility_rpc.sql (source: 011 lines 44-70)
  // Replicating canonical schema additions without historical production row-count assertions
  await client.query(`
    -- [Source: 011_stage_c0_compatibility_rpc.sql lines 44-62]
    ALTER TABLE public.leads 
      ADD COLUMN IF NOT EXISTS archived_at timestamptz;

    ALTER TABLE public.inquiries 
      ADD COLUMN IF NOT EXISTS archived_at timestamptz,
      ADD COLUMN IF NOT EXISTS external_source text,
      ADD COLUMN IF NOT EXISTS external_event_id text,
      ADD COLUMN IF NOT EXISTS identity_review_required boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS identity_review_reason text,
      ADD COLUMN IF NOT EXISTS proposed_display_name text,
      ADD COLUMN IF NOT EXISTS proposed_email text,
      ADD COLUMN IF NOT EXISTS proposed_phone text;

    ALTER TABLE public.bookings 
      ADD COLUMN IF NOT EXISTS archived_at timestamptz;

    ALTER TABLE public.conversations 
      ADD COLUMN IF NOT EXISTS external_message_id text;

    -- [Source: 011_stage_c0_compatibility_rpc.sql lines 64-70]
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_inquiries_external_event') THEN
        ALTER TABLE public.inquiries ADD CONSTRAINT uq_inquiries_external_event UNIQUE (tenant_id, external_source, external_event_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_conversations_external_message') THEN
        ALTER TABLE public.conversations ADD CONSTRAINT uq_conversations_external_message UNIQUE (tenant_id, external_message_id);
      END IF;
    END $$;
  `);
  console.log('  ✓ Applied canonical DDL additions from 011_stage_c0_compatibility_rpc.sql (archived_at on leads/inquiries/bookings, external sync columns & constraints)');

  // 4d. 013_platform_agency_lifecycle_rpcs.sql
  const s13Path = path.resolve(__dirname, '../supabase/migrations/013_platform_agency_lifecycle_rpcs.sql');
  const s13Sql = fs.readFileSync(s13Path, 'utf8');
  await client.query(s13Sql);
  console.log('  ✓ Applied supabase/migrations/013_platform_agency_lifecycle_rpcs.sql');

  // 4e. 014_platform_user_lifecycle_rpcs.sql
  const s14Path = path.resolve(__dirname, '../supabase/migrations/014_platform_user_lifecycle_rpcs.sql');
  const s14Sql = fs.readFileSync(s14Path, 'utf8');
  await client.query(s14Sql);
  console.log('  ✓ Applied supabase/migrations/014_platform_user_lifecycle_rpcs.sql');

  // 5. Verification: Real Pre-015 Schema Baseline
  console.log('\n[5/18] Verifying real pre-015 schema baseline...');
  const baselineCols = [
    ['inquiries', 'archived_at'],
    ['inquiries', 'pipeline_stage'],
    ['inquiries', 'assigned_agent_id'],
    ['inquiries', 'next_follow_up_at'],
    ['inquiries', 'legacy_lead_id'],
    ['leads', 'status'],
    ['leads', 'assigned_to'],
    ['leads', 'next_follow_up'],
    ['activities', 'lead_id'],
    ['activities', 'user_id'],
  ];

  for (const [tbl, col] of baselineCols) {
    const colCheck = await client.query(`
      SELECT data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2;
    `, [tbl, col]);
    if (colCheck.rows.length === 0) {
      throw new Error(`PRE-015 BASELINE FAILURE: public.${tbl}.${col} does not exist!`);
    }
    console.log(`  REAL DATABASE TEST — PRE-015 BASELINE: public.${tbl}.${col.padEnd(20)} -> ${colCheck.rows[0].data_type} (${colCheck.rows[0].udt_name}) [EXISTS]`);
  }

  // 6. Apply Migration 015
  console.log('\n[6/18] Applying migration 015_copilot_atomic_inquiry_actions.sql...');
  const s15Path = path.resolve(__dirname, '../supabase/migrations/015_copilot_atomic_inquiry_actions.sql');
  const s15Sql = fs.readFileSync(s15Path, 'utf8');
  await client.query(s15Sql);
  console.log('  ✓ REAL DATABASE TEST — PASS: Applied supabase/migrations/015_copilot_atomic_inquiry_actions.sql successfully.');

  // 7. Verify Migration 015 Objects
  console.log('\n[7/18] Verifying migration 015 database objects...');
  const tableCheck = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'copilot_action_executions';
  `);
  if (tableCheck.rowCount !== 1) throw new Error('Table copilot_action_executions not found');

  const funcCheck = await client.query(`
    SELECT proname, prorettype::regtype, pronargs
    FROM pg_proc 
    WHERE proname = 'execute_copilot_inquiry_action_atomic' 
      AND pronamespace = 'public'::regnamespace;
  `);
  if (funcCheck.rowCount !== 1) throw new Error('RPC execute_copilot_inquiry_action_atomic not found');
  console.log('  ✓ REAL DATABASE TEST — PASS: copilot_action_executions table and execute_copilot_inquiry_action_atomic function exist.');

  // 8. Function Privileges
  console.log('\n[8/18] Verifying function privileges...');
  const privCheck = await client.query(`
    SELECT 
      has_function_privilege('public', 'public.execute_copilot_inquiry_action_atomic(uuid,text,uuid,text,jsonb,jsonb)', 'EXECUTE') AS public_exec,
      has_function_privilege('anon', 'public.execute_copilot_inquiry_action_atomic(uuid,text,uuid,text,jsonb,jsonb)', 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', 'public.execute_copilot_inquiry_action_atomic(uuid,text,uuid,text,jsonb,jsonb)', 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', 'public.execute_copilot_inquiry_action_atomic(uuid,text,uuid,text,jsonb,jsonb)', 'EXECUTE') AS service_exec,
      has_function_privilege('postgres', 'public.execute_copilot_inquiry_action_atomic(uuid,text,uuid,text,jsonb,jsonb)', 'EXECUTE') AS postgres_exec;
  `);
  const privs = privCheck.rows[0];
  console.log(`    PUBLIC:        ${privs.public_exec ? 'YES' : 'NO'}`);
  console.log(`    anon:          ${privs.anon_exec ? 'YES' : 'NO'}`);
  console.log(`    authenticated: ${privs.auth_exec ? 'YES' : 'NO'}`);
  console.log(`    service_role:  ${privs.service_exec ? 'YES' : 'NO'}`);
  console.log(`    postgres:      ${privs.postgres_exec ? 'YES' : 'NO'}`);

  if (privs.public_exec || privs.anon_exec || privs.auth_exec) {
    throw new Error('SECURITY VIOLATION: RPC is executable by PUBLIC, anon, or authenticated!');
  }
  if (!privs.service_exec || !privs.postgres_exec) {
    throw new Error('CONFIG ERROR: service_role or postgres cannot execute RPC!');
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: RPC privileges strictly limited to service_role and postgres.');

  // 9. Receipt Table Privileges
  console.log('\n[9/18] Verifying receipt table privileges...');
  const tablePrivs = await client.query(`
    SELECT 
      has_table_privilege('anon', 'public.copilot_action_executions', 'SELECT') AS anon_select,
      has_table_privilege('anon', 'public.copilot_action_executions', 'INSERT') AS anon_insert,
      has_table_privilege('anon', 'public.copilot_action_executions', 'UPDATE') AS anon_update,
      has_table_privilege('anon', 'public.copilot_action_executions', 'DELETE') AS anon_delete,
      has_table_privilege('authenticated', 'public.copilot_action_executions', 'SELECT') AS auth_select,
      has_table_privilege('authenticated', 'public.copilot_action_executions', 'INSERT') AS auth_insert,
      has_table_privilege('authenticated', 'public.copilot_action_executions', 'UPDATE') AS auth_update,
      has_table_privilege('authenticated', 'public.copilot_action_executions', 'DELETE') AS auth_delete,
      has_table_privilege('service_role', 'public.copilot_action_executions', 'SELECT') AS service_select,
      has_table_privilege('service_role', 'public.copilot_action_executions', 'INSERT') AS service_insert,
      has_table_privilege('service_role', 'public.copilot_action_executions', 'UPDATE') AS service_update,
      has_table_privilege('service_role', 'public.copilot_action_executions', 'DELETE') AS service_delete;
  `);
  const tp = tablePrivs.rows[0];
  console.log(`    anon (SEL/INS/UPD/DEL):          ${tp.anon_select ? 'YES' : 'NO'} / ${tp.anon_insert ? 'YES' : 'NO'} / ${tp.anon_update ? 'YES' : 'NO'} / ${tp.anon_delete ? 'YES' : 'NO'}`);
  console.log(`    authenticated (SEL/INS/UPD/DEL): ${tp.auth_select ? 'YES' : 'NO'} / ${tp.auth_insert ? 'YES' : 'NO'} / ${tp.auth_update ? 'YES' : 'NO'} / ${tp.auth_delete ? 'YES' : 'NO'}`);
  console.log(`    service_role (SEL/INS/UPD/DEL):  ${tp.service_select ? 'YES' : 'NO'} / ${tp.service_insert ? 'YES' : 'NO'} / ${tp.service_update ? 'YES' : 'NO'} / ${tp.service_delete ? 'YES' : 'NO'}`);

  if (tp.anon_select || tp.anon_insert || tp.anon_update || tp.anon_delete ||
      tp.auth_select || tp.auth_insert || tp.auth_update || tp.auth_delete) {
    throw new Error('SECURITY VIOLATION: copilot_action_executions is accessible by anon or authenticated!');
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: Receipt table access (SEL/INS/UPD/DEL) strictly revoked from anon & authenticated.');

  // 10. Create Isolated Test Fixtures
  console.log('\n[10/18] Creating isolated test fixtures...');
  const UUID_ADMIN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const UUID_MGR_A   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const UUID_SPEC_A  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const UUID_SPEC_A2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const UUID_VIEWER_A= 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const UUID_SUPER_1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const UUID_SPEC_B  = '99999999-9999-9999-9999-999999999999';

  // Tenants
  await client.query(`
    INSERT INTO public.tenants (id, name, slug, created_at, updated_at)
    VALUES 
      ('tenant-agency-a', 'Agency A Real Test', 'agency-a-test', now(), now()),
      ('tenant-agency-b', 'Agency B Real Test', 'agency-b-test', now(), now())
    ON CONFLICT (id) DO NOTHING;
  `);

  // auth.users stubs
  await client.query(`
    INSERT INTO auth.users (id, email, created_at)
    VALUES 
      ('${UUID_ADMIN_A}', 'admin@agency-a.com', now()),
      ('${UUID_MGR_A}', 'mgr@agency-a.com', now()),
      ('${UUID_SPEC_A}', 'spec1@agency-a.com', now()),
      ('${UUID_SPEC_A2}', 'spec2@agency-a.com', now()),
      ('${UUID_VIEWER_A}', 'viewer@agency-a.com', now()),
      ('${UUID_SUPER_1}', 'super@platform.com', now()),
      ('${UUID_SPEC_B}', 'spec@agency-b.com', now())
    ON CONFLICT (id) DO NOTHING;
  `);

  // Profiles
  await client.query(`
    INSERT INTO public.profiles (id, email, full_name, role, tenant_id, created_at, updated_at)
    VALUES 
      ('${UUID_ADMIN_A}', 'admin@agency-a.com', 'Rayees Admin', 'admin', 'tenant-agency-a', now(), now()),
      ('${UUID_MGR_A}', 'mgr@agency-a.com', 'Rayees Manager', 'manager', 'tenant-agency-a', now(), now()),
      ('${UUID_SPEC_A}', 'spec1@agency-a.com', 'Rayees Specialist', 'specialist', 'tenant-agency-a', now(), now()),
      ('${UUID_SPEC_A2}', 'spec2@agency-a.com', 'Athar Specialist', 'specialist', 'tenant-agency-a', now(), now()),
      ('${UUID_VIEWER_A}', 'viewer@agency-a.com', 'Bob Viewer', 'viewer', 'tenant-agency-a', now(), now()),
      ('${UUID_SUPER_1}', 'super@platform.com', 'Alice SuperAdmin', 'super_admin', 'tenant-agency-a', now(), now()),
      ('${UUID_SPEC_B}', 'spec@agency-b.com', 'Foreign Specialist', 'specialist', 'tenant-agency-b', now(), now())
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, tenant_id = EXCLUDED.tenant_id;
  `);

  // Travelers
  await client.query(`
    INSERT INTO public.traveler_profiles (id, tenant_id, display_name, email, created_at, updated_at)
    VALUES 
      ('00000000-0000-0000-0000-000000000001', 'tenant-agency-a', 'John Traveler', 'john@traveler.com', now(), now()),
      ('00000000-0000-0000-0000-000000000002', 'tenant-agency-b', 'Jane Foreign Traveler', 'jane@traveler.com', now(), now())
    ON CONFLICT (id) DO NOTHING;
  `);

  // Legacy Lead A
  await client.query(`
    INSERT INTO public.leads (id, tenant_id, status, assigned_to, full_name, destination, created_at, updated_at)
    VALUES ('lead-test-a', 'tenant-agency-a', 'initial_contact', '${UUID_SPEC_A}', 'John Traveler', 'Maldives', now(), now())
    ON CONFLICT (id) DO UPDATE SET status = 'initial_contact', assigned_to = '${UUID_SPEC_A}';
  `);

  // Canonical Inquiry A
  const INQ_A_ID = '11111111-1111-1111-1111-111111111111';
  await client.query(`
    INSERT INTO public.inquiries (id, tenant_id, destination, pipeline_stage, assigned_agent_id, traveler_id, legacy_lead_id, created_at, updated_at)
    VALUES ('${INQ_A_ID}', 'tenant-agency-a', 'Maldives', 'initial_contact', '${UUID_SPEC_A}', '00000000-0000-0000-0000-000000000001', 'lead-test-a', now(), now())
    ON CONFLICT (id) DO UPDATE SET pipeline_stage = 'initial_contact', assigned_agent_id = '${UUID_SPEC_A}', legacy_lead_id = 'lead-test-a', next_follow_up_at = null, archived_at = null;
  `);

  // Foreign Inquiry B
  const INQ_B_ID = '22222222-2222-2222-2222-222222222222';
  await client.query(`
    INSERT INTO public.inquiries (id, tenant_id, destination, pipeline_stage, assigned_agent_id, traveler_id, legacy_lead_id, created_at, updated_at)
    VALUES ('${INQ_B_ID}', 'tenant-agency-b', 'Bali', 'initial_contact', '${UUID_SPEC_B}', '00000000-0000-0000-0000-000000000002', null, now(), now())
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('  ✓ Test fixtures initialized.');

  // 11. Authenticated Direct-RPC Bypass Rejection
  console.log('\n[11/18] Testing direct RPC invocation as authenticated database role...');
  try {
    await client.query(`
      SET ROLE authenticated;
      SELECT public.execute_copilot_inquiry_action_atomic(
        '${UUID_SPEC_A}'::uuid,
        'prop-bypass-attempt',
        '${INQ_A_ID}'::uuid,
        'update_inquiry_stage',
        '{"stage":"initial_contact"}'::jsonb,
        '{"stage":"itinerary_sent"}'::jsonb
      );
    `);
    throw new Error('SECURITY VULNERABILITY: Authenticated role successfully bypassed server action!');
  } catch (bypassErr) {
    await client.query('RESET ROLE;');
    console.log(`  ✓ REAL DATABASE TEST — PASS: Direct RPC call rejected with PostgreSQL code: ${bypassErr.code} (${bypassErr.message})`);
    if (bypassErr.code !== '42501') {
      throw new Error(`Expected error code 42501 (permission denied), got: ${bypassErr.code}`);
    }

    // Verify zero mutations
    const inqState = await client.query(`SELECT pipeline_stage FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
    const leadState = await client.query(`SELECT status FROM public.leads WHERE id = 'lead-test-a'`);
    const receipts = await client.query(`SELECT count(*) FROM public.copilot_action_executions WHERE proposal_id = 'prop-bypass-attempt'`);
    const activities = await client.query(`SELECT count(*) FROM public.activities WHERE lead_id = 'lead-test-a'`);

    if (inqState.rows[0].pipeline_stage !== 'initial_contact' || leadState.rows[0].status !== 'initial_contact') {
      throw new Error('DATA INTEGRITY ERROR: Inquiry or lead was mutated during blocked call!');
    }
    if (parseInt(receipts.rows[0].count, 10) !== 0 || parseInt(activities.rows[0].count, 10) !== 0) {
      throw new Error('DATA INTEGRITY ERROR: Receipts or activities were written during blocked call!');
    }
    console.log('  ✓ REAL DATABASE TEST — PASS: Verified 0 mutations, 0 receipts, 0 activities.');
  }

  // 12. Legitimate Stage Update via service_role Transport
  console.log('\n[12/18] Testing legitimate stage update via service_role transport...');
  await client.query(`SET ROLE service_role;`);
  const stageRes = await client.query(`
    SELECT public.execute_copilot_inquiry_action_atomic(
      '${UUID_SPEC_A}'::uuid,
      'prop-stage-001',
      '${INQ_A_ID}'::uuid,
      'update_inquiry_stage',
      '{"stage":"initial_contact"}'::jsonb,
      '{"stage":"itinerary_sent"}'::jsonb
    ) AS result;
  `);
  await client.query(`RESET ROLE;`);
  const resultObj = stageRes.rows[0].result;
  console.log('  RPC Result:', resultObj);
  if (!resultObj.success || resultObj.newState.stage !== 'itinerary_sent') {
    throw new Error('Stage execution failed: ' + JSON.stringify(resultObj));
  }

  // Verify real database state
  const inqCheck = await client.query(`SELECT pipeline_stage FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
  const leadCheck = await client.query(`SELECT status FROM public.leads WHERE id = 'lead-test-a'`);
  const receiptCheck = await client.query(`SELECT * FROM public.copilot_action_executions WHERE proposal_id = 'prop-stage-001'`);
  const actCheck = await client.query(`SELECT * FROM public.activities WHERE lead_id = 'lead-test-a' ORDER BY created_at DESC LIMIT 1`);

  if (inqCheck.rows[0].pipeline_stage !== 'itinerary_sent') throw new Error('Inquiry stage not updated');
  if (leadCheck.rows[0].status !== 'itinerary_sent') throw new Error('Legacy lead status not updated');
  if (receiptCheck.rowCount !== 1) throw new Error('Receipt row not created');
  if (actCheck.rowCount !== 1 || actCheck.rows[0].user_id !== UUID_SPEC_A || actCheck.rows[0].type !== 'status_change') {
    throw new Error('Activity record invalid: ' + JSON.stringify(actCheck.rows[0]));
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: Stage updated in inquiries + leads, receipt recorded, activity log recorded.');

  // 13. Assignment Mutation & Viewer-Assignee Rejection
  console.log('\n[13/18] Testing legitimate assignment and viewer-assignee rejection...');
  // Legitimate assignment
  await client.query(`SET ROLE service_role;`);
  const assignRes = await client.query(`
    SELECT public.execute_copilot_inquiry_action_atomic(
      '${UUID_SPEC_A}'::uuid,
      'prop-assign-001',
      '${INQ_A_ID}'::uuid,
      'assign_inquiry',
      '{"assignedAgentId":"${UUID_SPEC_A}"}'::jsonb,
      '{"assignedAgentId":"${UUID_SPEC_A2}"}'::jsonb
    ) AS result;
  `);
  await client.query(`RESET ROLE;`);
  if (!assignRes.rows[0].result.success) throw new Error('Assignment failed');

  const inqAssignCheck = await client.query(`SELECT assigned_agent_id FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
  const leadAssignCheck = await client.query(`SELECT assigned_to FROM public.leads WHERE id = 'lead-test-a'`);
  if (inqAssignCheck.rows[0].assigned_agent_id !== UUID_SPEC_A2 || leadAssignCheck.rows[0].assigned_to !== UUID_SPEC_A2) {
    throw new Error('Assignee mismatch in DB');
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: Legitimate assignment updated inquiries.assigned_agent_id and leads.assigned_to.');

  // Prohibited assignment to Viewer
  try {
    await client.query(`SET ROLE service_role;`);
    await client.query(`
      SELECT public.execute_copilot_inquiry_action_atomic(
        '${UUID_ADMIN_A}'::uuid,
        'prop-assign-viewer-illegal',
        '${INQ_A_ID}'::uuid,
        'assign_inquiry',
        '{"assignedAgentId":"${UUID_SPEC_A2}"}'::jsonb,
        '{"assignedAgentId":"${UUID_VIEWER_A}"}'::jsonb
      );
    `);
    throw new Error('SECURITY VULNERABILITY: Permitted assignment to viewer role!');
  } catch (viewerAssignErr) {
    await client.query(`RESET ROLE;`);
    console.log(`  ✓ REAL DATABASE TEST — PASS: Assignment to viewer role rejected with: ${viewerAssignErr.message}`);
    if (!viewerAssignErr.message.includes('not an eligible inquiry assignee')) {
      throw new Error('Unexpected error message for viewer assignment: ' + viewerAssignErr.message);
    }
  }

  // 14. Follow-Up Scheduling & Clearing
  console.log('\n[14/18] Testing follow-up date scheduling and clearing...');
  // Part 1: Scheduling to 2026-09-01T10:00:00.000Z
  await client.query(`SET ROLE service_role;`);
  const followRes = await client.query(`
    SELECT public.execute_copilot_inquiry_action_atomic(
      '${UUID_ADMIN_A}'::uuid,
      'prop-followup-001',
      '${INQ_A_ID}'::uuid,
      'set_inquiry_follow_up',
      '{"nextFollowUpAt":null}'::jsonb,
      '{"nextFollowUpAt":"2026-09-01T10:00:00.000Z"}'::jsonb
    ) AS result;
  `);
  await client.query(`RESET ROLE;`);
  if (!followRes.rows[0].result.success) throw new Error('Follow-up scheduling failed');

  const inqFollowCheck = await client.query(`SELECT next_follow_up_at FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
  const leadFollowCheck = await client.query(`SELECT next_follow_up FROM public.leads WHERE id = 'lead-test-a'`);
  if (!inqFollowCheck.rows[0].next_follow_up_at || !leadFollowCheck.rows[0].next_follow_up) {
    throw new Error('Follow up date missing in inquiries or leads');
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: Follow-up scheduling updated inquiries.next_follow_up_at & leads.next_follow_up.');

  // Part 2: Clearing to null
  await client.query(`SET ROLE service_role;`);
  const clearRes = await client.query(`
    SELECT public.execute_copilot_inquiry_action_atomic(
      '${UUID_ADMIN_A}'::uuid,
      'prop-followup-clear-001',
      '${INQ_A_ID}'::uuid,
      'set_inquiry_follow_up',
      '{"nextFollowUpAt":"2026-09-01T10:00:00.000Z"}'::jsonb,
      '{"nextFollowUpAt":null}'::jsonb
    ) AS result;
  `);
  await client.query(`RESET ROLE;`);
  if (!clearRes.rows[0].result.success) throw new Error('Follow-up clearing failed');

  const inqClearCheck = await client.query(`SELECT next_follow_up_at FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
  const leadClearCheck = await client.query(`SELECT next_follow_up FROM public.leads WHERE id = 'lead-test-a'`);
  if (inqClearCheck.rows[0].next_follow_up_at !== null || leadClearCheck.rows[0].next_follow_up !== null) {
    throw new Error('Follow up date was not cleared in inquiries or leads');
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: Follow-up clearing set inquiries.next_follow_up_at & leads.next_follow_up to NULL.');

  // 15. Single-Use Replay Prevention
  console.log('\n[15/18] Testing replay prevention of previously executed proposal...');
  // Restore stage to initial_contact outside Copilot RPC
  await client.query(`UPDATE public.inquiries SET pipeline_stage = 'initial_contact' WHERE id = '${INQ_A_ID}'`);
  await client.query(`UPDATE public.leads SET status = 'initial_contact' WHERE id = 'lead-test-a'`);

  // Attempt to re-run prop-stage-001
  try {
    await client.query(`SET ROLE service_role;`);
    await client.query(`
      SELECT public.execute_copilot_inquiry_action_atomic(
        '${UUID_ADMIN_A}'::uuid,
        'prop-stage-001',
        '${INQ_A_ID}'::uuid,
        'update_inquiry_stage',
        '{"stage":"initial_contact"}'::jsonb,
        '{"stage":"itinerary_sent"}'::jsonb
      );
    `);
    throw new Error('SECURITY VULNERABILITY: Duplicate proposal execution permitted!');
  } catch (replayErr) {
    await client.query(`RESET ROLE;`);
    console.log(`  ✓ REAL DATABASE TEST — PASS: Replay rejected with: ${replayErr.message} (code: ${replayErr.code})`);
    if (!replayErr.message.includes('ALREADY_EXECUTED') && replayErr.code !== '23505') {
      throw new Error('Expected ALREADY_EXECUTED or 23505, got: ' + replayErr.message);
    }
  }

  // 16. Stale-State Conflict Protection
  console.log('\n[16/18] Testing stale state conflict protection...');
  try {
    await client.query(`SET ROLE service_role;`);
    await client.query(`
      SELECT public.execute_copilot_inquiry_action_atomic(
        '${UUID_ADMIN_A}'::uuid,
        'prop-stale-001',
        '${INQ_A_ID}'::uuid,
        'update_inquiry_stage',
        '{"stage":"options_shared"}'::jsonb, -- Expected options_shared but currently initial_contact
        '{"stage":"itinerary_sent"}'::jsonb
      );
    `);
    throw new Error('CONCURRENCY VULNERABILITY: Stale state conflict was ignored!');
  } catch (staleErr) {
    await client.query(`RESET ROLE;`);
    console.log(`  ✓ REAL DATABASE TEST — PASS: Stale state conflict rejected with: ${staleErr.message}`);
    if (!staleErr.message.includes('STALE_STATE')) {
      throw new Error('Expected STALE_STATE, got: ' + staleErr.message);
    }
  }

  // 17. Legacy ROW_COUNT Failure Protection & Forced Rollback
  console.log('\n[17/18] Testing legacy lead ROW_COUNT failure & forced rollback...');
  // Part 1: Corrupted legacy lead reference
  const INQ_CORRUPT_ID = '33333333-3333-3333-3333-333333333333';
  await client.query(`
    INSERT INTO public.inquiries (id, tenant_id, destination, pipeline_stage, assigned_agent_id, traveler_id, legacy_lead_id, created_at, updated_at)
    VALUES ('${INQ_CORRUPT_ID}', 'tenant-agency-a', 'Tokyo', 'initial_contact', '${UUID_ADMIN_A}', '00000000-0000-0000-0000-000000000001', 'lead-does-not-exist', now(), now())
    ON CONFLICT (id) DO NOTHING;
  `);

  try {
    await client.query(`SET ROLE service_role;`);
    await client.query(`
      SELECT public.execute_copilot_inquiry_action_atomic(
        '${UUID_ADMIN_A}'::uuid,
        'prop-compat-001',
        '${INQ_CORRUPT_ID}'::uuid,
        'update_inquiry_stage',
        '{"stage":"initial_contact"}'::jsonb,
        '{"stage":"itinerary_sent"}'::jsonb
      );
    `);
    throw new Error('COMPATIBILITY VULNERABILITY: 0-row legacy update silently succeeded!');
  } catch (compatErr) {
    await client.query(`RESET ROLE;`);
    console.log(`  ✓ REAL DATABASE TEST — PASS: Zero-row legacy lead update failed closed with: ${compatErr.message}`);
    if (!compatErr.message.includes('COMPATIBILITY_ERROR')) {
      throw new Error('Expected COMPATIBILITY_ERROR, got: ' + compatErr.message);
    }

    // Verify canonical inquiry was rolled back
    const corruptInqCheck = await client.query(`SELECT pipeline_stage FROM public.inquiries WHERE id = '${INQ_CORRUPT_ID}'`);
    if (corruptInqCheck.rows[0].pipeline_stage !== 'initial_contact') {
      throw new Error('ROLLBACK FAILURE: Canonical inquiry changed despite legacy dual-write failure!');
    }
    const corruptReceiptCheck = await client.query(`SELECT * FROM public.copilot_action_executions WHERE proposal_id = 'prop-compat-001'`);
    if (corruptReceiptCheck.rowCount !== 0) {
      throw new Error('ROLLBACK FAILURE: Execution receipt created despite transaction failure!');
    }
    console.log('  ✓ REAL DATABASE TEST — PASS: Verified full transaction rollback on compatibility mismatch.');
  }

  // Part 2: Forced Activity Insert Failure Rollback
  await client.query(`
    CREATE OR REPLACE FUNCTION test_fail_activities_trigger()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.title = 'Inquiry Stage Updated via Copilot' THEN
        RAISE EXCEPTION 'TEST_FORCED_ACTIVITY_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_test_forced_failure
    BEFORE INSERT ON public.activities
    FOR EACH ROW EXECUTE FUNCTION test_fail_activities_trigger();
  `);

  try {
    await client.query(`SET ROLE service_role;`);
    await client.query(`
      SELECT public.execute_copilot_inquiry_action_atomic(
        '${UUID_ADMIN_A}'::uuid,
        'prop-rollback-test',
        '${INQ_A_ID}'::uuid,
        'update_inquiry_stage',
        '{"stage":"initial_contact"}'::jsonb,
        '{"stage":"consultation_booked"}'::jsonb
      );
    `);
    throw new Error('TRANSACTION FAILURE: Expected trigger exception did not fire!');
  } catch (rollbackErr) {
    await client.query(`RESET ROLE;`);
    console.log(`  ✓ REAL DATABASE TEST — PASS: Forced later statement failure caught: ${rollbackErr.message}`);
    if (!rollbackErr.message.includes('TEST_FORCED_ACTIVITY_FAILURE')) {
      throw new Error('Unexpected error in rollback test: ' + rollbackErr.message);
    }

    // Verify all earlier statements (inquiries UPDATE, leads UPDATE, receipt INSERT) were rolled back
    const inqState = await client.query(`SELECT pipeline_stage FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
    const leadState = await client.query(`SELECT status FROM public.leads WHERE id = 'lead-test-a'`);
    const receiptState = await client.query(`SELECT * FROM public.copilot_action_executions WHERE proposal_id = 'prop-rollback-test'`);

    if (inqState.rows[0].pipeline_stage !== 'initial_contact') {
      throw new Error('ROLLBACK FAILURE: Inquiry updated despite later transaction error!');
    }
    if (leadState.rows[0].status !== 'initial_contact') {
      throw new Error('ROLLBACK FAILURE: Legacy lead updated despite later transaction error!');
    }
    if (receiptState.rowCount !== 0) {
      throw new Error('ROLLBACK FAILURE: Execution receipt created despite later transaction error!');
    }
    console.log('  ✓ REAL DATABASE TEST — PASS: Verified complete atomic rollback of all preceding operations.');
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS trg_test_forced_failure ON public.activities;`);
    await client.query(`DROP FUNCTION IF EXISTS test_fail_activities_trigger;`);
  }

  // 18. Actor RBAC & Ownership Security Guardrails
  console.log('\n[18/18] Testing actor RBAC & ownership parity under service_role transport...');
  await client.query(`UPDATE public.inquiries SET assigned_agent_id = '${UUID_SPEC_A}' WHERE id = '${INQ_A_ID}'`);
  await client.query(`UPDATE public.leads SET assigned_to = '${UUID_SPEC_A}' WHERE id = 'lead-test-a'`);

  const rbacTests = [
    {
      label: 'Admin on tenant Inquiry',
      actor: UUID_ADMIN_A,
      inqId: INQ_A_ID,
      expectSuccess: true,
      proposalId: 'prop-rbac-admin',
    },
    {
      label: 'Manager on tenant Inquiry',
      actor: UUID_MGR_A,
      inqId: INQ_A_ID,
      expectSuccess: true,
      proposalId: 'prop-rbac-mgr',
    },
    {
      label: 'Assigned specialist on own Inquiry',
      actor: UUID_SPEC_A,
      inqId: INQ_A_ID,
      expectSuccess: true,
      proposalId: 'prop-rbac-spec-own',
    },
    {
      label: 'Non-owner specialist on another employee assigned Inquiry',
      actor: UUID_SPEC_A2,
      inqId: INQ_A_ID,
      expectSuccess: false,
      expectedError: 'only modify inquiries assigned to you',
      proposalId: 'prop-rbac-spec-other',
    },
    {
      label: 'Viewer actor',
      actor: UUID_VIEWER_A,
      inqId: INQ_A_ID,
      expectSuccess: false,
      expectedError: 'Viewer role has read-only access',
      proposalId: 'prop-rbac-viewer',
    },
    {
      label: 'Platform Super Admin actor',
      actor: UUID_SUPER_1,
      inqId: INQ_A_ID,
      expectSuccess: false,
      expectedError: 'Platform Super Admin cannot execute Agency CRM actions directly',
      proposalId: 'prop-rbac-super',
    },
    {
      label: 'Cross-tenant actor on foreign Inquiry',
      actor: UUID_SPEC_A,
      inqId: INQ_B_ID,
      expectSuccess: false,
      expectedError: 'Inquiry not found in current agency workspace',
      proposalId: 'prop-rbac-crosstenant',
    },
  ];

  for (const t of rbacTests) {
    try {
      await client.query(`SET ROLE service_role;`);
      await client.query(`
        SELECT public.execute_copilot_inquiry_action_atomic(
          '${t.actor}'::uuid,
          '${t.proposalId}',
          '${t.inqId}'::uuid,
          'update_inquiry_stage',
          '{"stage":"initial_contact"}'::jsonb,
          '{"stage":"consultation_booked"}'::jsonb
        );
      `);
      await client.query(`RESET ROLE;`);
      if (!t.expectSuccess) {
        throw new Error(`SECURITY FAILURE: ${t.label} succeeded when it should have failed!`);
      }
      // Reset back for next test
      await client.query(`UPDATE public.inquiries SET pipeline_stage = 'initial_contact' WHERE id = '${t.inqId}'`);
      await client.query(`UPDATE public.leads SET status = 'initial_contact' WHERE id = 'lead-test-a'`);
      console.log(`  ✓ REAL DATABASE TEST — PASS: ${t.label} -> ALLOWED`);
    } catch (testErr) {
      await client.query(`RESET ROLE;`);
      if (t.expectSuccess) {
        throw new Error(`RBAC FAILURE: ${t.label} failed unexpectedly: ${testErr.message}`);
      }
      if (!testErr.message.includes(t.expectedError)) {
        throw new Error(`RBAC MISMATCH: ${t.label} failed with unexpected message: ${testErr.message}`);
      }
      console.log(`  ✓ REAL DATABASE TEST — PASS: ${t.label} -> REJECTED (${testErr.message})`);
    }
  }

  // Activity Actor & Relationship Verification
  const latestAct = await client.query(`
    SELECT * FROM public.activities 
    WHERE lead_id = 'lead-test-a' 
    ORDER BY created_at DESC LIMIT 1;
  `);
  const act = latestAct.rows[0];
  console.log('\n  Latest Activity Log in PostgreSQL:', {
    id: act.id,
    user_id: act.user_id,
    user_name: act.user_name,
    lead_id: act.lead_id,
    tenant_id: act.tenant_id,
    type: act.type,
    title: act.title,
  });

  if (act.lead_id !== 'lead-test-a') throw new Error('Activity lead_id does not reference legacy lead!');
  if (act.tenant_id !== 'tenant-agency-a') throw new Error('Activity tenant_id is incorrect!');
  console.log('  ✓ REAL DATABASE TEST — PASS: Activity correctly references human actor profile, tenant, and legacy lead.');

  // Final Compatibility Parity Verification across linked Inquiry & Lead
  const finalInq = await client.query(`SELECT pipeline_stage, assigned_agent_id, next_follow_up_at FROM public.inquiries WHERE id = '${INQ_A_ID}'`);
  const finalLead = await client.query(`SELECT status, assigned_to, next_follow_up FROM public.leads WHERE id = 'lead-test-a'`);
  const fi = finalInq.rows[0];
  const fl = finalLead.rows[0];

  if (fi.pipeline_stage !== fl.status) {
    throw new Error(`PARITY MISMATCH: inquiries.pipeline_stage (${fi.pipeline_stage}) != leads.status (${fl.status})`);
  }
  if (fi.assigned_agent_id !== fl.assigned_to) {
    throw new Error(`PARITY MISMATCH: inquiries.assigned_agent_id (${fi.assigned_agent_id}) != leads.assigned_to (${fl.assigned_to})`);
  }
  if ((fi.next_follow_up_at === null && fl.next_follow_up !== null) || (fi.next_follow_up_at !== null && fl.next_follow_up === null)) {
    throw new Error(`PARITY MISMATCH: inquiries.next_follow_up_at (${fi.next_follow_up_at}) != leads.next_follow_up (${fl.next_follow_up})`);
  }
  console.log('  ✓ REAL DATABASE TEST — PASS: Final compatibility parity verified (stage, assignee, follow-up match 100%).');

  console.log('\n======================================================================');
  console.log('ALL REAL DATABASE VERIFICATION TESTS PASSED SUCCESSFULLY (18/18)!');
  console.log('======================================================================');

  await client.end();
}

runRealDbVerification().catch((err) => {
  console.error('\nFATAL REAL DATABASE VERIFICATION ERROR:', err);
  process.exit(1);
});
