import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

describe('Migration 016 Local PostgreSQL Invariants', () => {
  let client: Client;
  const testTenantA = 'tenant_ai5_a';
  const testTenantB = 'tenant_ai5_b';

  beforeAll(async () => {
    client = new Client({
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    });
    await client.connect();

    // 0. Mock auth schema and update_updated_at_column if not present
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ 
        SELECT '00000000-0000-0000-0000-000000000000'::uuid 
      $$ LANGUAGE sql;

      CREATE OR REPLACE FUNCTION public.update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
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
        id text PRIMARY KEY,
        type text NOT NULL,
        title text NOT NULL,
        content jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'draft',
        tenant_id text NOT NULL DEFAULT 'default' REFERENCES public.tenants(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
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

    // 2. Apply migration 016
    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/016_itinerary_and_quote_domain_foundation.sql'),
      'utf8'
    );
    await client.query(migrationSql);

    // 3. Setup test fixtures
    await client.query(`
      INSERT INTO public.tenants (id, name, slug) 
      VALUES ('${testTenantA}', 'AI-5 Agency A', 'agency-a'),
             ('${testTenantB}', 'AI-5 Agency B', 'agency-b')
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
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await client.query(`
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
        DELETE FROM public.tenants WHERE id IN ('${testTenantA}', '${testTenantB}');
      `);
      await client.end();
    } catch (_err) {
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

    // 5. Insert quote v1
    await client.query(`
      INSERT INTO public.quote_versions (tenant_id, quote_id, version_number, itinerary_version_id, subtotal, grand_total)
      VALUES ('${testTenantA}', '${quoteId}', 1, '${itinVerId}', 150000.00, 150000.00);
    `);

    // 6. Duplicate quote v1 must fail
    await expect(
      client.query(`
        INSERT INTO public.quote_versions (tenant_id, quote_id, version_number, itinerary_version_id, subtotal, grand_total)
        VALUES ('${testTenantA}', '${quoteId}', 1, '${itinVerId}', 160000.00, 160000.00);
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
        INSERT INTO public.quote_versions (tenant_id, quote_id, version_number, itinerary_version_id, subtotal, grand_total)
        VALUES ('${testTenantA}', '${quoteARes.rows[0].id}', 2, '${itinVerBRes.rows[0].id}', 200000.00, 200000.00);
      `)
    ).rejects.toThrow(/CROSS_INQUIRY_INTEGRITY_VIOLATION/);
  });

  it('enforces single active acceptance invariant per Inquiry and allows historical voided acceptances', async () => {
    const quoteRes = await client.query(`
      SELECT id FROM public.quotes WHERE tenant_id = '${testTenantA}' AND quote_number = 'QT-2026-0001';
    `);
    const quoteId = quoteRes.rows[0].id;
    const qvRes = await client.query(`
      SELECT id, itinerary_version_id FROM public.quote_versions WHERE quote_id = $1 AND version_number = 1;
    `, [quoteId]);
    const qvId = qvRes.rows[0].id;
    const ivId = qvRes.rows[0].itinerary_version_id;

    // 1. Insert first acceptance
    const acc1Res = await client.query(`
      INSERT INTO public.quote_acceptances (
        tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
        acceptance_type, accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash
      ) VALUES (
        '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${quoteId}', '${qvId}', '${ivId}',
        '11111111-1111-1111-1111-111111111111', 'traveler_portal', 150000.00, 'INR',
        '{"grandTotal":"150000.00"}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234'
      ) RETURNING id;
    `);
    expect(acc1Res.rows).toHaveLength(1);
    const acc1Id = acc1Res.rows[0].id;

    // 2. Second active acceptance on same Inquiry must FAIL
    await expect(
      client.query(`
        INSERT INTO public.quote_acceptances (
          tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
          acceptance_type, accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash
        ) VALUES (
          '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${quoteId}', '${qvId}', '${ivId}',
          '11111111-1111-1111-1111-111111111111', 'staff_recorded', 150000.00, 'INR',
          '{"grandTotal":"150000.00"}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234'
        );
      `)
    ).rejects.toThrow();

    // 3. Void the first acceptance
    await client.query(`
      UPDATE public.quote_acceptances 
      SET voided_at = now(), void_reason = 'Customer requested revised itinerary'
      WHERE id = $1;
    `, [acc1Id]);

    // 4. Now a new acceptance can be created (historical preservation)
    const acc2Res = await client.query(`
      INSERT INTO public.quote_acceptances (
        tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
        acceptance_type, accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash
      ) VALUES (
        '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${quoteId}', '${qvId}', '${ivId}',
        '11111111-1111-1111-1111-111111111111', 'staff_recorded', 150000.00, 'INR',
        '{"grandTotal":"150000.00"}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234'
      ) RETURNING id;
    `);
    expect(acc2Res.rows).toHaveLength(1);

    // Verify both rows exist in DB (acc1 is voided, acc2 is active)
    const countRes = await client.query(`
      SELECT count(*) as total, count(*) FILTER (WHERE voided_at IS NULL) as active
      FROM public.quote_acceptances
      WHERE inquiry_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    `);
    expect(Number(countRes.rows[0].total)).toBe(2);
    expect(Number(countRes.rows[0].active)).toBe(1);
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
});
