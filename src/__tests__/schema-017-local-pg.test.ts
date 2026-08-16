import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { calculateQuotePricing } from '../lib/quotes-itineraries/pricing';

describe('Migration 017 Local PostgreSQL Domain Lifecycle & Immutability Integration Tests', () => {
  let client: Client;
  const testTenantA = 'tenant_ai5_a';
  const testTenantB = 'tenant_ai5_b';

  const adminUserId = 'aaaaaaaa-1111-1111-1111-111111111111';
  const consultantUserId = 'cccccccc-3333-3333-3333-333333333333';

  beforeAll(async () => {
    client = new Client({
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    });
    await client.connect();

    // 1. Setup base mocks
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
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
      END $$;
    `);

    // 2. Base tables
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

    // 3. Apply migration 016
    const m16 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/016_itinerary_and_quote_domain_foundation.sql'), 'utf8');
    await client.query(m16);

    // 4. Apply migration 017
    const m17 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/017_itinerary_and_quote_lifecycle_and_immutability.sql'), 'utf8');
    await client.query(m17);

    // Clean up test records
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE public.quote_versions DISABLE TRIGGER ALL;
        ALTER TABLE public.itinerary_versions DISABLE TRIGGER ALL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

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
      DELETE FROM public.profiles WHERE tenant_id IN ('${testTenantA}', '${testTenantB}', 'global');
      DELETE FROM public.tenants WHERE id IN ('${testTenantA}', '${testTenantB}', 'global');

      DO $$ BEGIN
        ALTER TABLE public.quote_versions ENABLE TRIGGER ALL;
        ALTER TABLE public.itinerary_versions ENABLE TRIGGER ALL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    // Seed test fixtures
    await client.query(`
      INSERT INTO public.tenants (id, name, slug) 
      VALUES ('${testTenantA}', 'AI-5 Agency A', 'agency-a'),
             ('${testTenantB}', 'AI-5 Agency B', 'agency-b')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (id, tenant_id, role, full_name, email)
      VALUES
        ('${adminUserId}', '${testTenantA}', 'admin', 'Agency Admin', 'admin@agency-a.com'),
        ('${consultantUserId}', '${testTenantA}', 'consultant', 'Agency Consultant', 'consultant@agency-a.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.traveler_profiles (id, tenant_id, display_name, email)
      VALUES 
        ('11111111-1111-1111-1111-111111111111', '${testTenantA}', 'Traveler A1', 'a1@test.com'),
        ('33333333-3333-3333-3333-333333333333', '${testTenantB}', 'Traveler B1', 'b1@test.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination, number_of_travelers)
      VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${testTenantA}', '11111111-1111-1111-1111-111111111111', 'Dubai', 2),
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', '${testTenantB}', '33333333-3333-3333-3333-333333333333', 'Paris', 2)
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    try {
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE public.quote_versions DISABLE TRIGGER ALL;
          ALTER TABLE public.itinerary_versions DISABLE TRIGGER ALL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

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
        DELETE FROM public.profiles WHERE tenant_id IN ('${testTenantA}', '${testTenantB}', 'global');
        DELETE FROM public.tenants WHERE id IN ('${testTenantA}', '${testTenantB}', 'global');

        DO $$ BEGIN
          ALTER TABLE public.quote_versions ENABLE TRIGGER ALL;
          ALTER TABLE public.itinerary_versions ENABLE TRIGGER ALL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;
      `);
      await client.end();
    } catch {
      // Ignored
    }
  });

  it('atomically creates Itinerary family and Version 1 Draft via RPC', async () => {
    const payload = {
      title: 'Dubai 5-Day Luxury Adventure',
      destinationSummary: 'Explore the Burj Khalifa and Desert Safari',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      durationDays: 5,
      passengerCount: 2,
      days: [
        {
          dayNumber: 1,
          date: '2026-10-01',
          title: 'Arrival & Welcome',
          items: [{ itemType: 'transfer', title: 'Airport Pickup' }],
        },
      ],
      inclusions: ['Breakfast', 'Private Transfers'],
      exclusions: ['International Flights'],
    };

    const res = await client.query(
      `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5) as result`,
      [testTenantA, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Dubai 5-Day Luxury', adminUserId, JSON.stringify(payload)]
    );

    const result = res.rows[0].result;
    expect(result.itineraryId).toBeDefined();
    expect(result.versionId).toBeDefined();
    expect(result.versionNumber).toBe(1);
    expect(result.status).toBe('draft');
  });

  it('updates Itinerary draft and validates optimistic concurrency', async () => {
    // 1. Get current v1
    const resV1 = await client.query(
      `SELECT id, updated_at FROM public.itinerary_versions WHERE tenant_id = $1 AND version_number = 1 LIMIT 1`,
      [testTenantA]
    );
    const versionId = resV1.rows[0].id;
    const updatedAt = resV1.rows[0].updated_at;

    // 2. Successful update with matching concurrency token
    const updatePayload = {
      title: 'Dubai 5-Day Luxury VIP Edition',
      destinationSummary: 'Upgraded with Helicopter Tour',
    };

    const updateRes = await client.query(
      `SELECT public.rpc_update_itinerary_draft($1, $2, $3, $4) as result`,
      [testTenantA, versionId, updatedAt, JSON.stringify(updatePayload)]
    );
    expect(updateRes.rows[0].result.title).toBe('Dubai 5-Day Luxury VIP Edition');

    // 3. Stale update attempt must FAIL with STALE_VERSION
    await expect(
      client.query(
        `SELECT public.rpc_update_itinerary_draft($1, $2, $3, $4) as result`,
        [testTenantA, versionId, updatedAt, JSON.stringify({ title: 'Stale Overwrite' })] // passing old updatedAt
      )
    ).rejects.toThrow(/STALE_VERSION/);
  });

  it('finalizes Itinerary and enforces database content immutability', async () => {
    const resV1 = await client.query(
      `SELECT id FROM public.itinerary_versions WHERE tenant_id = $1 AND version_number = 1 LIMIT 1`,
      [testTenantA]
    );
    const versionId = resV1.rows[0].id;

    // 1. Finalize version
    const finRes = await client.query(
      `SELECT public.rpc_finalize_itinerary_version($1, $2) as result`,
      [testTenantA, versionId]
    );
    expect(finRes.rows[0].result.status).toBe('finalized');
    expect(finRes.rows[0].result.frozenAt).toBeDefined();

    // 2. Attempt direct or RPC update on frozen content must FAIL with IMMUTABILITY_VIOLATION
    await expect(
      client.query(
        `UPDATE public.itinerary_versions SET title = 'Hacked Frozen Title' WHERE id = $1`,
        [versionId]
      )
    ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);

    // 3. Attempt direct DELETE on frozen record must FAIL with IMMUTABILITY_VIOLATION
    await expect(
      client.query(
        `DELETE FROM public.itinerary_versions WHERE id = $1`,
        [versionId]
      )
    ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);
  });

  it('creates Itinerary Revision v2 without prematurely superseding finalized v1', async () => {
    const resV1 = await client.query(
      `SELECT id, itinerary_id FROM public.itinerary_versions WHERE tenant_id = $1 AND version_number = 1 LIMIT 1`,
      [testTenantA]
    );
    const itinId = resV1.rows[0].itinerary_id;
    const v1Id = resV1.rows[0].id;

    // 1. Create Revision v2
    const revRes = await client.query(
      `SELECT public.rpc_create_itinerary_revision($1, $2, $3, $4) as result`,
      [testTenantA, itinId, v1Id, adminUserId]
    );
    const v2Result = revRes.rows[0].result;
    expect(v2Result.versionNumber).toBe(2);
    expect(v2Result.status).toBe('draft');

    // 2. Check v1 is STILL finalized (NOT superseded prematurely)
    const checkV1 = await client.query(`SELECT status FROM public.itinerary_versions WHERE id = $1`, [v1Id]);
    expect(checkV1.rows[0].status).toBe('finalized');

    // 3. Finalize v2 -> v1 atomically becomes superseded!
    await client.query(
      `SELECT public.rpc_finalize_itinerary_version($1, $2) as result`,
      [testTenantA, v2Result.versionId]
    );

    const checkV1After = await client.query(`SELECT status FROM public.itinerary_versions WHERE id = $1`, [v1Id]);
    expect(checkV1After.rows[0].status).toBe('superseded');

    const checkV2After = await client.query(`SELECT status FROM public.itinerary_versions WHERE id = $1`, [v2Result.versionId]);
    expect(checkV2After.rows[0].status).toBe('finalized');
  });

  it('atomically creates Quote family with sequential quote number and authoritative pricing', async () => {
    // 1. Get finalized itinerary version (v2)
    const itinRes = await client.query(
      `SELECT id FROM public.itinerary_versions WHERE tenant_id = $1 AND status = 'finalized' LIMIT 1`,
      [testTenantA]
    );
    const itinVerId = itinRes.rows[0].id;

    // 2. Calculate pure pricing
    const pricing = calculateQuotePricing({
      lineItems: [
        {
          title: '5-Star Resort Package',
          category: 'accommodation',
          quantity: 2,
          unitPrice: '50000.00',
          supplierCost: '40000.00',
        },
        {
          title: 'Helicopter City Tour',
          category: 'activity',
          quantity: 2,
          unitPrice: '12500.00',
          supplierCost: '9000.00',
        },
      ],
      discountAmount: '5000.00',
      taxAmount: '6000.00',
    });

    const quotePayload = {
      currency: 'INR',
      lineItems: pricing.normalizedLineItems,
      subtotal: pricing.subtotal,
      discountAmount: pricing.discountAmount,
      taxAmount: pricing.taxAmount,
      grandTotal: pricing.grandTotal,
      internalCostTotal: pricing.internalCostTotal,
      grossMarginAmount: pricing.grossMarginAmount,
      validUntil: '2026-11-01',
      termsAndConditions: 'Standard Rihla Luxury Terms',
    };

    const res = await client.query(
      `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
      [testTenantA, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', itinVerId, adminUserId, JSON.stringify(quotePayload)]
    );

    const result = res.rows[0].result;
    expect(result.quoteId).toBeDefined();
    expect(result.quoteNumber).toMatch(/^QT-2026-\d{4}$/);
    expect(result.versionNumber).toBe(1);
    expect(result.status).toBe('draft');
    expect(result.grandTotal).toBe('126000.00'); // 100000 + 25000 - 5000 + 6000 = 126000.00
  });

  it('rejects creating Quote referencing a DRAFT ItineraryVersion', async () => {
    // Create draft itinerary v3
    const itinRes = await client.query(
      `SELECT id, itinerary_id FROM public.itinerary_versions WHERE tenant_id = $1 AND version_number = 2 LIMIT 1`,
      [testTenantA]
    );
    const revRes = await client.query(
      `SELECT public.rpc_create_itinerary_revision($1, $2, $3, $4) as result`,
      [testTenantA, itinRes.rows[0].itinerary_id, itinRes.rows[0].id, adminUserId]
    );
    const draftItinVerId = revRes.rows[0].result.versionId;

    const pricing = calculateQuotePricing({
      lineItems: [{ title: 'Item', category: 'other', quantity: 1, unitPrice: '1000.00' }],
    });

    await expect(
      client.query(
        `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
        [testTenantA, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', draftItinVerId, adminUserId, JSON.stringify(pricing)]
      )
    ).rejects.toThrow(/must be finalized before creating a quote/);
  });

  it('issues Quote and enforces commercial content immutability', async () => {
    const qvRes = await client.query(
      `SELECT id FROM public.quote_versions WHERE tenant_id = $1 AND version_number = 1 LIMIT 1`,
      [testTenantA]
    );
    const qvId = qvRes.rows[0].id;

    // 1. Issue quote version
    const issueRes = await client.query(
      `SELECT public.rpc_issue_quote_version($1, $2) as result`,
      [testTenantA, qvId]
    );
    expect(issueRes.rows[0].result.status).toBe('issued');
    expect(issueRes.rows[0].result.frozenAt).toBeDefined();

    // 2. Direct commercial modification must FAIL with IMMUTABILITY_VIOLATION
    await expect(
      client.query(`UPDATE public.quote_versions SET grand_total = 999.00 WHERE id = $1`, [qvId])
    ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);

    // 3. Direct DELETE on issued quote must FAIL with IMMUTABILITY_VIOLATION
    await expect(
      client.query(`DELETE FROM public.quote_versions WHERE id = $1`, [qvId])
    ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);
  });

  it('creates Quote Revision v2 and issuing v2 atomically supersedes v1', async () => {
    const qvRes = await client.query(
      `SELECT id, quote_id, itinerary_version_id FROM public.quote_versions WHERE tenant_id = $1 AND version_number = 1 LIMIT 1`,
      [testTenantA]
    );
    const quoteId = qvRes.rows[0].quote_id;
    const v1Id = qvRes.rows[0].id;
    const itinVerId = qvRes.rows[0].itinerary_version_id;

    // 1. Create Revision v2
    const pricingV2 = calculateQuotePricing({
      lineItems: [
        {
          title: '5-Star Resort Package - Special Client Rate',
          category: 'accommodation',
          quantity: 2,
          unitPrice: '48000.00',
          supplierCost: '40000.00',
        },
      ],
    });

    const revRes = await client.query(
      `SELECT public.rpc_create_quote_revision($1, $2, $3, $4, $5, $6) as result`,
      [testTenantA, quoteId, v1Id, itinVerId, adminUserId, JSON.stringify(pricingV2)]
    );
    const v2Result = revRes.rows[0].result;
    expect(v2Result.versionNumber).toBe(2);
    expect(v2Result.status).toBe('draft');

    // 2. Verify v1 remains issued while v2 is in draft
    const checkV1 = await client.query(`SELECT status FROM public.quote_versions WHERE id = $1`, [v1Id]);
    expect(checkV1.rows[0].status).toBe('issued');

    // 3. Issue v2 -> v1 transitions to 'superseded' atomically!
    await client.query(
      `SELECT public.rpc_issue_quote_version($1, $2) as result`,
      [testTenantA, v2Result.versionId]
    );

    const checkV1After = await client.query(`SELECT status FROM public.quote_versions WHERE id = $1`, [v1Id]);
    expect(checkV1After.rows[0].status).toBe('superseded');

    const checkV2After = await client.query(`SELECT status FROM public.quote_versions WHERE id = $1`, [v2Result.versionId]);
    expect(checkV2After.rows[0].status).toBe('issued');
  });

  it('fails safe if active acceptance fixture exists when attempting to issue a revision', async () => {
    const qvRes = await client.query(
      `SELECT id, quote_id, itinerary_version_id FROM public.quote_versions WHERE tenant_id = $1 AND status = 'issued' LIMIT 1`,
      [testTenantA]
    );
    const quoteId = qvRes.rows[0].quote_id;
    const v2Id = qvRes.rows[0].id;
    const itinVerId = qvRes.rows[0].itinerary_version_id;

    // Insert active acceptance fixture for this quote
    await client.query(`
      INSERT INTO public.quote_acceptances (
        tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
        acceptance_type, accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash
      ) VALUES (
        '${testTenantA}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${quoteId}', '${v2Id}', '${itinVerId}',
        '11111111-1111-1111-1111-111111111111', 'traveler_portal', 96000.00, 'INR',
        '{"grandTotal":"96000.00"}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234'
      );
    `);

    // Create draft v3
    const pricingV3 = calculateQuotePricing({
      lineItems: [{ title: 'Item 3', category: 'other', quantity: 1, unitPrice: '500.00' }],
    });
    const v3Res = await client.query(
      `SELECT public.rpc_create_quote_revision($1, $2, $3, $4, $5, $6) as result`,
      [testTenantA, quoteId, v2Id, itinVerId, adminUserId, JSON.stringify(pricingV3)]
    );
    const v3Id = v3Res.rows[0].result.versionId;

    // Attempting to issue v3 when active acceptance exists must FAIL
    await expect(
      client.query(`SELECT public.rpc_issue_quote_version($1, $2) as result`, [testTenantA, v3Id])
    ).rejects.toThrow(/ACTIVE_ACCEPTANCE_EXISTS/);

    // Clean up acceptance fixture
    await client.query(`DELETE FROM public.quote_acceptances WHERE tenant_id = '${testTenantA}'`);
  });
});
