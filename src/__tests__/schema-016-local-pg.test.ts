import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

describe('Migration 016 Local PostgreSQL Invariants & RLS Authorization', () => {
  let client: Client;
  const testTenantA = 'tenant_m16_a';
  const testTenantB = 'tenant_m16_b';

  // User UUIDs for RLS tests
  const adminUserId = '16161616-1111-1111-1111-111111111111';
  const managerUserId = '16161616-2222-2222-2222-222222222222';
  const consultantUserId = '16161616-3333-3333-3333-333333333333';
  const viewerUserId = '16161616-4444-4444-4444-444444444444';
  const superAdminUserId = '16161616-5555-5555-5555-555555555555';
  const tenantBUserId = '16161616-6666-6666-6666-666666666666';

  beforeAll(async () => {
    client = new Client({
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    });
    await client.connect();

    // Acquire advisory lock for DDL isolation across concurrent test files
    await client.query('SELECT pg_advisory_lock(5432000)');
    try {
      // 0. Mock auth schema, app_user non-superuser role, and update_updated_at_column
      await client.query(`
        DO $$ BEGIN
          CREATE EXTENSION IF NOT EXISTS "pgcrypto";
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ 
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$ LANGUAGE sql STABLE;

        CREATE OR REPLACE FUNCTION public.update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user NOLOGIN;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;
      `);

      // 1. Ensure base tables (tenants, profiles, quotes_itineraries, traveler_profiles, inquiries, bookings)
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.tenants (
          id text PRIMARY KEY,
          name text NOT NULL,
          slug text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.profiles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text REFERENCES public.tenants(id) ON DELETE CASCADE,
          role text NOT NULL DEFAULT 'consultant',
          full_name text NOT NULL,
          email text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.quotes_itineraries (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          title text NOT NULL,
          version int NOT NULL DEFAULT 1,
          is_current boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.traveler_profiles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
          display_name text NOT NULL,
          email text,
          phone text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_traveler_profiles_composite UNIQUE (tenant_id, id)
        );

        CREATE TABLE IF NOT EXISTS public.inquiries (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
          traveler_id uuid NOT NULL,
          destination text,
          number_of_travelers int,
          stage text NOT NULL DEFAULT 'new',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_inquiries_composite UNIQUE (tenant_id, id),
          CONSTRAINT fk_inquiries_traveler FOREIGN KEY (tenant_id, traveler_id)
            REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS public.bookings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
          traveler_id uuid NOT NULL,
          inquiry_id uuid,
          booking_reference text NOT NULL,
          departure_date date,
          return_date date,
          passenger_count int,
          total_amount numeric(12, 2),
          paid_amount numeric(12, 2),
          balance_due numeric(12, 2) GENERATED ALWAYS AS (
            CASE 
              WHEN total_amount IS NULL OR paid_amount IS NULL THEN NULL
              ELSE total_amount - paid_amount
            END
          ) STORED,
          currency text NOT NULL DEFAULT 'INR',
          booking_status text NOT NULL DEFAULT 'confirmed',
          payment_status text NOT NULL DEFAULT 'unknown',
          fulfillment_status text NOT NULL DEFAULT 'unknown',
          financial_data_complete boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_tenant_inquiry_booking UNIQUE (tenant_id, inquiry_id)
        );
      `);

      // 2. Apply migration 016 idempotently
      const check016 = await client.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'itineraries'
      `);
      if (check016.rows.length === 0) {
        const migrationSql = fs.readFileSync(
          path.join(process.cwd(), 'supabase/migrations/016_itinerary_and_quote_domain_foundation.sql'),
          'utf8'
        );
        await client.query(migrationSql);
      }

      // Grant app_user permissions
      await client.query(`
        GRANT USAGE ON SCHEMA public, auth TO app_user;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;
      `);

      // Clean up any stale records from previous runs
      await client.query(`
        SET session_replication_role = 'replica';

        DELETE FROM public.bookings WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quote_acceptances WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quote_shares WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.itinerary_shares WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quote_versions WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quotes WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.itinerary_versions WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.itineraries WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.tenant_quote_sequences WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.inquiries WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.traveler_profiles WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.profiles WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.tenants WHERE id IN ('${testTenantA}', '${testTenantB}');

        SET session_replication_role = 'origin';
      `);

      // 3. Seed test tenants and profiles
      await client.query(`
        INSERT INTO public.tenants (id, name, slug) 
        VALUES ('${testTenantA}', 'AI-5 Agency A', 'agency-m16-a'),
               ('${testTenantB}', 'AI-5 Agency B', 'agency-m16-b'),
               ('global', 'Platform Global', 'platform-global')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.profiles (id, tenant_id, role, full_name, email)
        VALUES
          ('${adminUserId}', '${testTenantA}', 'admin', 'Agency Admin', 'admin@agency-a.com'),
          ('${managerUserId}', '${testTenantA}', 'manager', 'Agency Manager', 'manager@agency-a.com'),
          ('${consultantUserId}', '${testTenantA}', 'consultant', 'Agency Consultant', 'consultant@agency-a.com'),
          ('${viewerUserId}', '${testTenantA}', 'viewer', 'Agency Viewer', 'viewer@agency-a.com'),
          ('${superAdminUserId}', 'global', 'super_admin', 'Platform Super Admin', 'sa@platform.com'),
          ('${tenantBUserId}', '${testTenantB}', 'admin', 'Agency B Admin', 'admin@agency-b.com')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.traveler_profiles (id, tenant_id, display_name, email, created_at, updated_at)
        VALUES 
          ('11111111-1111-1111-1111-111111111111', '${testTenantA}', 'Traveler A1', 'a1@test.com', now(), now()),
          ('22222222-2222-2222-2222-222222222222', '${testTenantA}', 'Traveler A2', 'a2@test.com', now(), now()),
          ('33333333-3333-3333-3333-333333333333', '${testTenantB}', 'Traveler B1', 'b1@test.com', now(), now())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination, number_of_travelers, stage, created_at, updated_at)
        VALUES
          ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${testTenantA}', '11111111-1111-1111-1111-111111111111', 'Dubai', 2, 'quote_sent', now(), now()),
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '${testTenantA}', '22222222-2222-2222-2222-222222222222', 'Tokyo', 2, 'quote_sent', now(), now()),
          ('cccccccc-cccc-cccc-cccc-cccccccccccc', '${testTenantB}', '33333333-3333-3333-3333-333333333333', 'Paris', 2, 'quote_sent', now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      await client.query('SELECT pg_advisory_unlock(5432000)');
    }
  });

  afterAll(async () => {
    try {
      await client.query(`
        SET session_replication_role = 'replica';

        DELETE FROM public.bookings WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quote_acceptances WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quote_shares WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.itinerary_shares WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quote_versions WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.quotes WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.itinerary_versions WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.itineraries WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.tenant_quote_sequences WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.inquiries WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.traveler_profiles WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.profiles WHERE tenant_id IN ('${testTenantA}', '${testTenantB}');
        DELETE FROM public.tenants WHERE id IN ('${testTenantA}', '${testTenantB}');

        SET session_replication_role = 'origin';
      `);
      await client.end();
    } catch {
      // Ignored on teardown
    }
  });

  it('proves all 8 new domain tables exist in public schema', async () => {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'itineraries', 'itinerary_versions', 'quotes', 'quote_versions',
        'itinerary_shares', 'quote_shares', 'quote_acceptances', 'tenant_quote_sequences'
      );
    `);
    const tables = res.rows.map((r: { table_name: string }) => r.table_name);
    expect(tables).toHaveLength(8);
  });

  it('proves bookings.quote_acceptance_id exists and is nullable', async () => {
    const res = await client.query(`
      SELECT is_nullable, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'bookings' 
      AND column_name = 'quote_acceptance_id';
    `);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].is_nullable).toBe('YES');
    expect(res.rows[0].data_type).toBe('uuid');
  });

  it('proves legacy Bookings can be created with NULL quote_acceptance_id', async () => {
    const bookingRes = await client.query(`
      INSERT INTO public.bookings (
        id, tenant_id, inquiry_id, traveler_id, booking_reference,
        total_amount, paid_amount, currency, booking_status, payment_status, financial_data_complete
      ) VALUES (
        gen_random_uuid(), '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
        'LEGACY-REF-001', 120000.00, NULL, 'INR', 'confirmed', 'unknown', false
      ) RETURNING id, quote_acceptance_id, balance_due;
    `);
    expect(bookingRes.rows).toHaveLength(1);
    expect(bookingRes.rows[0].quote_acceptance_id).toBeNull();
    expect(bookingRes.rows[0].balance_due).toBeNull();

    // Clean up test booking
    await client.query(`DELETE FROM public.bookings WHERE id = $1`, [bookingRes.rows[0].id]);
  });

  it('enforces family version uniqueness on quote_versions and itinerary_versions', async () => {
    // 1. Create Itinerary
    const itinRes = await client.query(`
      INSERT INTO public.itineraries (tenant_id, inquiry_id, title)
      VALUES ('${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Dubai 5-Day Luxury')
      RETURNING id;
    `);
    const itinId = itinRes.rows[0].id;

    // 2. Insert v1
    await client.query(`
      INSERT INTO public.itinerary_versions (tenant_id, itinerary_id, version_number, title, days)
      VALUES ('${testTenantA}', '${itinId}', 1, 'Dubai v1', '[]'::jsonb);
    `);

    // 3. Duplicate v1 on same itinerary must fail
    await expect(
      client.query(`
        INSERT INTO public.itinerary_versions (tenant_id, itinerary_id, version_number, title, days)
        VALUES ('${testTenantA}', '${itinId}', 1, 'Dubai v1 Duplicate', '[]'::jsonb);
      `)
    ).rejects.toThrow();

    // 4. Create Quote
    const quoteRes = await client.query(`
      INSERT INTO public.quotes (tenant_id, inquiry_id, quote_number)
      VALUES ('${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QT-2026-0001')
      RETURNING id;
    `);
    const quoteId = quoteRes.rows[0].id;

    const itinVerRes = await client.query(`
      SELECT id FROM public.itinerary_versions WHERE itinerary_id = $1 LIMIT 1
    `, [itinId]);
    const itinVerId = itinVerRes.rows[0].id;

    // 5. Insert quote v1 (gross_margin_amount allowed to be negative if below cost)
    await client.query(`
      INSERT INTO public.quote_versions (
        tenant_id, quote_id, version_number, itinerary_version_id,
        subtotal, grand_total, internal_cost_total, gross_margin_amount, currency
      ) VALUES (
        '${testTenantA}', '${quoteId}', 1, '${itinVerId}',
        150000.00, 150000.00, 160000.00, -10000.00, 'INR'
      );
    `);

    // 6. Duplicate quote v1 must fail
    await expect(
      client.query(`
        INSERT INTO public.quote_versions (tenant_id, quote_id, version_number, itinerary_version_id, subtotal, grand_total, currency)
        VALUES ('${testTenantA}', '${quoteId}', 1, '${itinVerId}', 160000.00, 160000.00, 'INR');
      `)
    ).rejects.toThrow();
  });

  it('enforces tenant-scoped quote_number uniqueness', async () => {
    // Quote QT-2026-0001 already created for tenant A
    // Duplicate in tenant A must fail
    await expect(
      client.query(`
        INSERT INTO public.quotes (tenant_id, inquiry_id, quote_number)
        VALUES ('${testTenantA}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'QT-2026-0001');
      `)
    ).rejects.toThrow();

    // Same quote_number in tenant B must SUCCEED
    const resB = await client.query(`
      INSERT INTO public.quotes (tenant_id, inquiry_id, quote_number)
      VALUES ('${testTenantB}', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'QT-2026-0001')
      RETURNING id;
    `);
    expect(resB.rows).toHaveLength(1);
  });

  it('rejects cross-tenant foreign key relationships', async () => {
    // Attempt to link Quote in Tenant A to Inquiry in Tenant B
    await expect(
      client.query(`
        INSERT INTO public.quotes (tenant_id, inquiry_id, quote_number)
        VALUES ('${testTenantA}', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'QT-2026-9999');
      `)
    ).rejects.toThrow();
  });

  it('enforces higher-order integrity: rejects QuoteVersion linking to ItineraryVersion of a DIFFERENT Inquiry in same tenant', async () => {
    // Itinerary for Inquiry B
    const itinBRes = await client.query(`
      INSERT INTO public.itineraries (tenant_id, inquiry_id, title)
      VALUES ('${testTenantA}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tokyo 7-Day')
      RETURNING id;
    `);
    const itinVerBRes = await client.query(`
      INSERT INTO public.itinerary_versions (tenant_id, itinerary_id, version_number, title, days)
      VALUES ('${testTenantA}', '${itinBRes.rows[0].id}', 1, 'Tokyo v1', '[]'::jsonb)
      RETURNING id;
    `);

    // Quote for Inquiry A
    const quoteARes = await client.query(`
      SELECT id FROM public.quotes WHERE tenant_id = '${testTenantA}' AND quote_number = 'QT-2026-0001';
    `);

    // Attempt to attach Tokyo Itinerary (Inquiry B) to Dubai Quote (Inquiry A)
    await expect(
      client.query(`
        INSERT INTO public.quote_versions (tenant_id, quote_id, version_number, itinerary_version_id, subtotal, grand_total, currency)
        VALUES ('${testTenantA}', '${quoteARes.rows[0].id}', 2, '${itinVerBRes.rows[0].id}', 200000.00, 200000.00, 'INR');
      `)
    ).rejects.toThrow(/CROSS_INQUIRY_INTEGRITY_VIOLATION/);
  });

  it('enforces QuoteAcceptance coherence: validates quote_id, itinerary_version_id, and quote_share_id', async () => {
    const quoteRes = await client.query(`
      SELECT id FROM public.quotes WHERE tenant_id = '${testTenantA}' AND quote_number = 'QT-2026-0001';
    `);
    const quoteId = quoteRes.rows[0].id;
    const qvRes = await client.query(`
      SELECT id, itinerary_version_id FROM public.quote_versions WHERE quote_id = $1 AND version_number = 1;
    `, [quoteId]);
    const qvId = qvRes.rows[0].id;
    const ivId = qvRes.rows[0].itinerary_version_id;

    // Create a share for quote v1
    const shareRes = await client.query(`
      INSERT INTO public.quote_shares (tenant_id, quote_version_id, token_hash, expires_at)
      VALUES ('${testTenantA}', '${qvId}', 'validtokenhash1234567890123456789012345678901234567890123456789012', now() + interval '7 days')
      RETURNING id;
    `);
    const shareId = shareRes.rows[0].id;

    // 1. Attempting acceptance with mismatched quote_id must FAIL
    await expect(
      client.query(`
        INSERT INTO public.quote_acceptances (
          tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
          acceptance_type, accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash
        ) VALUES (
          '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', '${qvId}', '${ivId}',
          '11111111-1111-1111-1111-111111111111', 'traveler_portal', 150000.00, 'INR',
          '{"grandTotal":"150000.00"}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234'
        );
      `)
    ).rejects.toThrow();

    // 2. Valid acceptance with correct share_id must SUCCEED
    const accRes = await client.query(`
      INSERT INTO public.quote_acceptances (
        tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
        quote_share_id, acceptance_type, accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash
      ) VALUES (
        '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${quoteId}', '${qvId}', '${ivId}',
        '11111111-1111-1111-1111-111111111111', '${shareId}', 'traveler_portal', 150000.00, 'INR',
        '{"grandTotal":"150000.00"}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234'
      ) RETURNING id;
    `);
    expect(accRes.rows).toHaveLength(1);
    const accId = accRes.rows[0].id;

    // Void the acceptance for subsequent tests
    await client.query(`UPDATE public.quote_acceptances SET voided_at = now() WHERE id = $1`, [accId]);
  });

  it('proves tenant_quote_sequences supports atomic UPSERT counter', async () => {
    const res1 = await client.query(`
      INSERT INTO public.tenant_quote_sequences (tenant_id, year, last_number)
      VALUES ('${testTenantA}', 2026, 1)
      ON CONFLICT (tenant_id, year)
      DO UPDATE SET last_number = tenant_quote_sequences.last_number + 1
      RETURNING last_number;
    `);
    expect(res1.rows[0].last_number).toBe(1);

    const res2 = await client.query(`
      INSERT INTO public.tenant_quote_sequences (tenant_id, year, last_number)
      VALUES ('${testTenantA}', 2026, 1)
      ON CONFLICT (tenant_id, year)
      DO UPDATE SET last_number = tenant_quote_sequences.last_number + 1
      RETURNING last_number;
    `);
    expect(res2.rows[0].last_number).toBe(2);
  });

  it('proves legacy public.quotes_itineraries remains intact and unaltered', async () => {
    const res = await client.query(`
      SELECT count(*) as count FROM public.quotes_itineraries;
    `);
    expect(Number(res.rows[0].count)).toBe(0);
  });

  // =========================================================================
  // REAL LOCAL POSTGRESQL RLS AUTHORIZATION TESTS
  // =========================================================================
  describe('Real Local PostgreSQL RLS Authorization Execution', () => {
    it('Agency Admin can SELECT itineraries, quotes, and raw quote_versions in own tenant', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`SET LOCAL request.jwt.claim.sub = '${adminUserId}'`);

      const itinRes = await client.query(`SELECT count(*) FROM public.itineraries WHERE tenant_id = '${testTenantA}'`);
      expect(Number(itinRes.rows[0].count)).toBeGreaterThan(0);

      const qvRes = await client.query(`SELECT count(*) FROM public.quote_versions WHERE tenant_id = '${testTenantA}'`);
      expect(Number(qvRes.rows[0].count)).toBeGreaterThan(0);

      await client.query('ROLLBACK');
    });

    it('Agency Consultant can SELECT itineraries & quotes, but receives 0 rows on raw quote_versions (internal pricing protection)', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`SET LOCAL request.jwt.claim.sub = '${consultantUserId}'`);

      // 1. Can view Itineraries Header
      const itinRes = await client.query(`SELECT count(*) FROM public.itineraries WHERE tenant_id = '${testTenantA}'`);
      expect(Number(itinRes.rows[0].count)).toBeGreaterThan(0);

      // 2. Can view Quotes Header
      const quoteRes = await client.query(`SELECT count(*) FROM public.quotes WHERE tenant_id = '${testTenantA}'`);
      expect(Number(quoteRes.rows[0].count)).toBeGreaterThan(0);

      // 3. Raw quote_versions table direct SELECT is DENIED by RLS (returns 0 rows)
      const qvRes = await client.query(`SELECT count(*) FROM public.quote_versions WHERE tenant_id = '${testTenantA}'`);
      expect(Number(qvRes.rows[0].count)).toBe(0);

      await client.query('ROLLBACK');
    });

    it('Agency Viewer receives 0 rows on raw quote_versions direct SELECT', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`SET LOCAL request.jwt.claim.sub = '${viewerUserId}'`);

      const qvRes = await client.query(`SELECT count(*) FROM public.quote_versions WHERE tenant_id = '${testTenantA}'`);
      expect(Number(qvRes.rows[0].count)).toBe(0);

      await client.query('ROLLBACK');
    });

    it('Super Admin fails closed and receives 0 rows on all Agency operational tables', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`SET LOCAL request.jwt.claim.sub = '${superAdminUserId}'`);

      const itinRes = await client.query(`SELECT count(*) FROM public.itineraries WHERE tenant_id = '${testTenantA}'`);
      expect(Number(itinRes.rows[0].count)).toBe(0);

      const quoteRes = await client.query(`SELECT count(*) FROM public.quotes WHERE tenant_id = '${testTenantA}'`);
      expect(Number(quoteRes.rows[0].count)).toBe(0);

      const qvRes = await client.query(`SELECT count(*) FROM public.quote_versions WHERE tenant_id = '${testTenantA}'`);
      expect(Number(qvRes.rows[0].count)).toBe(0);

      await client.query('ROLLBACK');
    });

    it('Tenant B user receives 0 rows when attempting to SELECT Tenant A records', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`SET LOCAL request.jwt.claim.sub = '${tenantBUserId}'`);

      const itinRes = await client.query(`SELECT count(*) FROM public.itineraries WHERE tenant_id = '${testTenantA}'`);
      expect(Number(itinRes.rows[0].count)).toBe(0);

      const qvRes = await client.query(`SELECT count(*) FROM public.quote_versions WHERE tenant_id = '${testTenantA}'`);
      expect(Number(qvRes.rows[0].count)).toBe(0);

      await client.query('ROLLBACK');
    });

    it('Direct client INSERT mutations are DENIED by RLS policies', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query(`SET LOCAL request.jwt.claim.sub = '${consultantUserId}'`);

      // Attempting direct client INSERT on itineraries without domain RPC fails closed
      await expect(
        client.query(`
          INSERT INTO public.itineraries (tenant_id, inquiry_id, title)
          VALUES ('${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Direct Client Hack');
        `)
      ).rejects.toThrow();

      await client.query('ROLLBACK');
    });
  });
});
