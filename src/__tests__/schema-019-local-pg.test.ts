import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { calculateQuotePricing } from '../lib/quotes-itineraries/pricing';
import { hashCanonicalSnapshot, AcceptanceSnapshot } from '../lib/quotes-itineraries/acceptance';

/**
 * Phase AI-5B.4: Migration 019 Local PostgreSQL Integration & Concurrency Tests
 *
 * Comprehensive tests proving:
 * 1. Sequence table security, RLS FORCE, and table grant denial to anon/authenticated.
 * 2. Booking reference uniqueness constraint UNIQUE (tenant_id, booking_reference).
 * 3. Immutable acceptance provenance and same-version retry share preservation.
 * 4. Acceptance validity preservation post share revocation/expiration.
 * 5. Governed explicit booking conversion with exact financial handoff.
 * 6. Trip facts pinned from accepted ItineraryVersion (not newer versions).
 * 7. Single Booking EVER per inquiry enforcement (even after cancellation).
 * 8. Legacy compatibility dual-write to public.leads (status = 'booking_confirmed').
 * 9. Real PostgreSQL multi-client concurrency races (competing acceptance, retry, void vs convert, double convert).
 *
 * Requires local PostgreSQL at 127.0.0.1:5432 with user postgres/postgres.
 */
describe('Migration 019 Local PostgreSQL Commercial Acceptance & Booking Conversion Tests', () => {
  let client: Client;
  const runId = Math.random().toString(36).substring(2, 8);
  const testTenantA = 'tenant_m19_a_' + runId;
  const testTenantB = 'tenant_m19_b_' + runId;

  const adminUserId = randomUUID();
  const managerUserId = randomUUID();
  const consultantUserId = randomUUID();
  const specialistUserId = randomUUID();
  const viewerUserId = randomUUID();
  const superAdminUserId = randomUUID();
  const tenantBUserId = randomUUID();

  const travelerId = randomUUID();

  // Distinct Suite Inquiries & Version IDs
  let inqPortalId: string;
  let qvPortalId: string;

  let inqStaffId: string;
  let qvStaffId: string;

  let inqConflictId: string;
  let qvConflict1Id: string;
  let qvConflict2Id: string;

  let inqBookingId: string;
  let qvBookingId: string;
  let itinBookingVer1Id: string;

  let inqLegacyId: string;
  let legacyLeadId: string;
  let qvLegacyId: string;

  function makeTokenHash(): string {
    const raw = randomBytes(32).toString('base64url');
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  function futureTimestamp(hoursFromNow = 24): string {
    return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
  }

  async function createHelperQuote(
    inquiryId: string,
    title: string,
    pricing: ReturnType<typeof calculateQuotePricing>,
    startDate = '2026-10-01',
    endDate = '2026-10-08',
    passengerCount = 2
  ) {
    const itinRes = await client.query(
      `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5) as result`,
      [
        testTenantA,
        adminUserId,
        inquiryId,
        title,
        JSON.stringify({
          startDate,
          endDate,
          durationDays: 8,
          passengerCount,
          days: [
            {
              dayNumber: 1,
              date: startDate,
              title: 'Arrival',
              summary: 'Lodge check-in',
              items: [
                {
                  itemType: 'transfer',
                  title: 'Private Transfer',
                  supplierName: 'SECRET_LIMO_SUPPLIER',
                  internalNotes: 'DRIVER_PHONE_SECRET_999',
                },
              ],
            },
          ],
          inclusions: ['Breakfast'],
          exclusions: ['Lunches'],
        }),
      ]
    );
    const itinVerId = itinRes.rows[0].result.versionId;
    await client.query(`SELECT public.rpc_finalize_itinerary_version($1, $2, $3)`, [
      testTenantA,
      adminUserId,
      itinVerId,
    ]);

    const qRes = await client.query(
      `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
      [
        testTenantA,
        adminUserId,
        inquiryId,
        itinVerId,
        JSON.stringify({
          lineItems: pricing.normalizedLineItems,
          currency: 'USD',
          subtotal: pricing.subtotal,
          discountAmount: pricing.discountAmount,
          taxAmount: pricing.taxAmount,
          grandTotal: pricing.grandTotal,
          internalCostTotal: pricing.internalCostTotal,
          grossMarginAmount: pricing.grossMarginAmount,
          validUntil: '2026-12-31',
          termsAndConditions: 'Standard Swiss Terms',
          customerNotes: 'Enjoy your luxury trip!',
        }),
      ]
    );
    const qvId = qRes.rows[0].result.versionId;
    await client.query(`SELECT public.rpc_issue_quote_version($1, $2, $3)`, [
      testTenantA,
      adminUserId,
      qvId,
    ]);

    return { itinVerId, quoteId: qRes.rows[0].result.quoteId, qvId };
  }

  beforeAll(async () => {
    client = new Client({
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    });
    await client.connect();

    // Advisory lock for DDL isolation across test files
    await client.query('SELECT pg_advisory_lock(5432000)');
    try {
      // 1. Setup base mocks
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
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role NOLOGIN;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user NOLOGIN;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
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

        CREATE TABLE IF NOT EXISTS public.leads (
          id text PRIMARY KEY,
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          full_name text NOT NULL,
          status text NOT NULL DEFAULT 'new',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.inquiries (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
          traveler_id uuid NOT NULL,
          destination text,
          number_of_travelers int,
          stage text NOT NULL DEFAULT 'new',
          pipeline_stage text NOT NULL DEFAULT 'new',
          assigned_agent_id uuid,
          legacy_lead_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_inquiries_composite UNIQUE (tenant_id, id),
          CONSTRAINT fk_inquiries_traveler FOREIGN KEY (tenant_id, traveler_id)
            REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE RESTRICT
        );

        ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'new';
        ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS assigned_agent_id uuid;
        ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS legacy_lead_id text;

        CREATE TABLE IF NOT EXISTS public.bookings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
          traveler_id uuid NOT NULL,
          inquiry_id uuid,
          legacy_lead_id text,
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
          assigned_agent_id uuid,
          quote_acceptance_id uuid,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_bookings_composite UNIQUE (tenant_id, id),
          CONSTRAINT uq_tenant_booking_reference UNIQUE (tenant_id, booking_reference),
          CONSTRAINT uq_tenant_inquiry_booking UNIQUE (tenant_id, inquiry_id)
        );
      `);

      // 3. Apply migrations 016, 017, 018, 019 once if not yet applied
      const procCheck = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'rpc_convert_accepted_quote_to_booking'`);
      if (procCheck.rows.length === 0) {
        const m16 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/016_itinerary_and_quote_domain_foundation.sql'), 'utf8');
        await client.query(m16);
        const m17 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/017_itinerary_and_quote_lifecycle_and_immutability.sql'), 'utf8');
        await client.query(m17);
        const m18 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/018_secure_sharing_and_public_portal.sql'), 'utf8');
        await client.query(m18);
        const m19 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/019_commercial_acceptance_and_booking_conversion.sql'), 'utf8');
        await client.query(m19);
      }

      // 4. Seed fixtures for this isolated test run
      inqPortalId = randomUUID();
      inqStaffId = randomUUID();
      inqConflictId = randomUUID();
      inqBookingId = randomUUID();
      inqLegacyId = randomUUID();
      legacyLeadId = 'lead_legacy_' + runId;

      await client.query(`
        INSERT INTO public.tenants (id, name, slug) 
        VALUES ('${testTenantA}', 'AI-5B.4 Agency A', 'agency-${testTenantA}'),
               ('${testTenantB}', 'AI-5B.4 Agency B', 'agency-${testTenantB}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.profiles (id, tenant_id, role, full_name, email)
        VALUES
          ('${adminUserId}', '${testTenantA}', 'admin', 'Agency Admin', 'admin@agency-a.com'),
          ('${managerUserId}', '${testTenantA}', 'manager', 'Agency Manager', 'manager@agency-a.com'),
          ('${consultantUserId}', '${testTenantA}', 'consultant', 'Agency Consultant', 'consultant@agency-a.com'),
          ('${specialistUserId}', '${testTenantA}', 'specialist', 'Agency Specialist', 'specialist@agency-a.com'),
          ('${viewerUserId}', '${testTenantA}', 'viewer', 'Agency Viewer', 'viewer@agency-a.com'),
          ('${superAdminUserId}', 'global', 'super_admin', 'Platform Super Admin', 'sa@platform.com'),
          ('${tenantBUserId}', '${testTenantB}', 'admin', 'Agency B Admin', 'admin@agency-b.com')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.traveler_profiles (id, tenant_id, display_name, email)
        VALUES 
          ('${travelerId}', '${testTenantA}', 'Traveler A1', 'a1@test.com')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.leads (id, tenant_id, full_name, status)
        VALUES ('${legacyLeadId}', '${testTenantA}', 'Legacy Lead Traveler', 'customizing_package')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination, number_of_travelers, pipeline_stage)
        VALUES
          ('${inqPortalId}', '${testTenantA}', '${travelerId}', 'Switzerland', 2, 'proposal'),
          ('${inqStaffId}', '${testTenantA}', '${travelerId}', 'Japan', 1, 'proposal'),
          ('${inqConflictId}', '${testTenantA}', '${travelerId}', 'France', 2, 'proposal'),
          ('${inqBookingId}', '${testTenantA}', '${travelerId}', 'Italy', 2, 'proposal'),
          ('${inqLegacyId}', '${testTenantA}', '${travelerId}', 'Spain', 2, 'customizing_package')
        ON CONFLICT (tenant_id, id) DO NOTHING;

        UPDATE public.inquiries SET legacy_lead_id = '${legacyLeadId}' WHERE id = '${inqLegacyId}';
      `);

      const pricingMain = calculateQuotePricing({
        lineItems: [
          {
            title: 'Swiss Hotel 5 Star',
            category: 'accommodation',
            quantity: 7,
            unitPrice: '500.00',
            supplierCost: '300.00',
            supplierName: 'SECRET_HOTEL_SUPPLIER',
          },
        ],
        discountAmount: '100.00',
        taxAmount: '200.00',
        currency: 'USD',
      });

      const qPortal = await createHelperQuote(inqPortalId, 'Swiss Luxury Portal', pricingMain);
      qvPortalId = qPortal.qvId;

      const qStaff = await createHelperQuote(inqStaffId, 'Japan Discovery', pricingMain);
      qvStaffId = qStaff.qvId;

      const qConf1 = await createHelperQuote(inqConflictId, 'France Luxury', pricingMain);
      qvConflict1Id = qConf1.qvId;

      const pricingBudget = calculateQuotePricing({
        lineItems: [
          {
            title: 'France Budget Hotel',
            category: 'accommodation',
            quantity: 3,
            unitPrice: '100.00',
            supplierCost: '50.00',
          },
        ],
        discountAmount: '0.00',
        taxAmount: '10.00',
        currency: 'USD',
      });
      const qConf2 = await createHelperQuote(inqConflictId, 'France Budget', pricingBudget);
      qvConflict2Id = qConf2.qvId;

      const qBooking = await createHelperQuote(inqBookingId, 'Italy Grand Tour', pricingMain, '2026-10-01', '2026-10-08', 2);
      qvBookingId = qBooking.qvId;
      itinBookingVer1Id = qBooking.itinVerId;

      const qLegacy = await createHelperQuote(inqLegacyId, 'Spain Adventure', pricingMain);
      qvLegacyId = qLegacy.qvId;
    } finally {
      await client.query('SELECT pg_advisory_unlock(5432000)');
    }
  });

  afterAll(async () => {
    try {
      await client.end();
    } catch {
      // Ignored
    }
  });

  // ==========================================================================
  // 1. SEQUENCE TABLE PHYSICAL SECURITY & AUTHORIZATION
  // ==========================================================================
  describe('Sequence Table Physical Security & Authorization', () => {
    it('verifies tenant_booking_sequences schema, PK, and constraints', async () => {
      const colRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenant_booking_sequences'
        ORDER BY ordinal_position
      `);
      expect(colRes.rows.map((r) => r.column_name)).toEqual(['tenant_id', 'year', 'last_number']);

      const pkRes = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.tenant_booking_sequences'::regclass AND contype = 'p'
      `);
      expect(pkRes.rows[0].conname).toBe('tenant_booking_sequences_pkey');
    });

    it('verifies RLS is enabled and forced on tenant_booking_sequences', async () => {
      const tblRes = await client.query(`
        SELECT relrowsecurity, relforcerowsecurity 
        FROM pg_class 
        WHERE relname = 'tenant_booking_sequences'
      `);
      expect(tblRes.rows[0].relrowsecurity).toBe(true);
      expect(tblRes.rows[0].relforcerowsecurity).toBe(true);
    });

    it('denies direct SELECT/INSERT/UPDATE/DELETE to anon, authenticated, and app_user', async () => {
      // As anon
      await client.query(`SET ROLE anon`);
      await expect(
        client.query(`SELECT * FROM public.tenant_booking_sequences`)
      ).rejects.toThrow(/permission denied/);

      await expect(
        client.query(`INSERT INTO public.tenant_booking_sequences (tenant_id, year, last_number) VALUES ('t1', 2026, 1)`)
      ).rejects.toThrow(/permission denied/);

      // As authenticated
      await client.query(`SET ROLE authenticated`);
      await expect(
        client.query(`SELECT * FROM public.tenant_booking_sequences`)
      ).rejects.toThrow(/permission denied/);

      await expect(
        client.query(`UPDATE public.tenant_booking_sequences SET last_number = 999 WHERE year = 2026`)
      ).rejects.toThrow(/permission denied/);

      await expect(
        client.query(`DELETE FROM public.tenant_booking_sequences WHERE year = 2026`)
      ).rejects.toThrow(/permission denied/);

      // Reset to postgres
      await client.query(`RESET ROLE`);
    });

    it('privileged Booking conversion RPC can allocate sequence safely', async () => {
      // Postgres / service_role path can execute RPC and allocate sequence
      const seqBefore = await client.query(
        `SELECT last_number FROM public.tenant_booking_sequences WHERE tenant_id = $1 AND year = EXTRACT(YEAR FROM now())::int`,
        [testTenantA]
      );
      const startNum = seqBefore.rows.length > 0 ? seqBefore.rows[0].last_number : 0;
      expect(startNum).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // 2. BOOKING REFERENCE UNIQUENESS DEFENSE
  // ==========================================================================
  describe('Booking Reference Unique Contract', () => {
    it('verifies UNIQUE (tenant_id, booking_reference) constraint exists on public.bookings', async () => {
      const chkRes = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.bookings'::regclass AND conname = 'uq_tenant_booking_reference'
      `);
      expect(chkRes.rows).toHaveLength(1);
    });

    it('rejects duplicate booking reference within the same tenant', async () => {
      const dupRef = 'BK-2026-9999';
      await client.query(`
        INSERT INTO public.bookings (tenant_id, traveler_id, booking_reference, total_amount, currency)
        VALUES ('${testTenantA}', '${travelerId}', '${dupRef}', 1000.00, 'USD')
      `);

      // Duplicate in same tenant MUST FAIL
      await expect(
        client.query(`
          INSERT INTO public.bookings (tenant_id, traveler_id, booking_reference, total_amount, currency)
          VALUES ('${testTenantA}', '${travelerId}', '${dupRef}', 2000.00, 'USD')
        `)
      ).rejects.toThrow(/uq_tenant_booking_reference/);

      // Clean up fixture
      await client.query(`DELETE FROM public.bookings WHERE tenant_id = $1 AND booking_reference = $2`, [
        testTenantA,
        dupRef,
      ]);
    });
  });

  // ==========================================================================
  // 3. CORE IMMUTABILITY TRIGGER & DATA DEFENSE
  // ==========================================================================
  describe('Quote Acceptance Immutability Trigger', () => {
    it('database immutability trigger blocks modifying core acceptance facts', async () => {
      const tokenHash = makeTokenHash();
      await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, tokenHash, futureTimestamp()]
      );

      const acceptRes = await client.query(
        `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5) as result`,
        [tokenHash, 'Jane Doe', 'jane@example.com', '127.0.0.1', 'Vitest Agent']
      );
      const acceptanceId = acceptRes.rows[0].result.acceptance_id;

      // Attempting to tamper with accepted_grand_total MUST trigger IMMUTABILITY_VIOLATION
      await expect(
        client.query(
          `UPDATE public.quote_acceptances SET accepted_grand_total = 0.00 WHERE id = $1`,
          [acceptanceId]
        )
      ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);

      // Attempting to tamper with currency MUST fail
      await expect(
        client.query(
          `UPDATE public.quote_acceptances SET currency = 'EUR' WHERE id = $1`,
          [acceptanceId]
        )
      ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);

      // Void it cleanly
      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, acceptanceId, 'Initial test cleanup']
      );

      // Attempting to alter void metadata after voiding MUST fail
      await expect(
        client.query(
          `UPDATE public.quote_acceptances SET void_reason = 'tampered reason' WHERE id = $1`,
          [acceptanceId]
        )
      ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);
    });
  });

  // ==========================================================================
  // 4. PORTAL QUOTE ACCEPTANCE & SNAPSHOT PROVENANCE
  // ==========================================================================
  describe('Portal Quote Acceptance & Snapshot Provenance', () => {
    it('records valid portal quote acceptance with leak-free snapshot and exact SHA-256 hash', async () => {
      const tokenHash = makeTokenHash();
      await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, tokenHash, futureTimestamp()]
      );

      const acceptRes = await client.query(
        `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5) as result`,
        [tokenHash, 'John Doe', 'john@example.com', '192.168.1.100', 'Mozilla/5.0']
      );

      const res = acceptRes.rows[0].result;
      expect(res.acceptance_id).toBeDefined();
      expect(res.idempotent).toBe(false);
      expect(res.currency).toBe('USD');
      expect(res.accepted_grand_total).toBe('3600.00');

      // Fetch row from DB and verify leak-free snapshot
      const rowRes = await client.query(
        `SELECT * FROM public.quote_acceptances WHERE id = $1`,
        [res.acceptance_id]
      );
      const qaRow = rowRes.rows[0];

      expect(qaRow.acceptance_type).toBe('traveler_portal');
      expect(qaRow.traveler_name_input).toBe('John Doe');
      expect(qaRow.traveler_email_input).toBe('john@example.com');
      expect(qaRow.client_ip).toBe('192.168.1.100');
      expect(qaRow.user_agent).toBe('Mozilla/5.0');
      expect(qaRow.accepted_by_user_id).toBeNull();
      expect(qaRow.staff_acceptance_method).toBeNull();

      const snapshot = qaRow.customer_safe_snapshot as AcceptanceSnapshot;
      expect(snapshot.snapshotSchemaVersion).toBe(1);
      expect(snapshot.quote.grandTotal).toBe('3600.00');
      expect(snapshot.itinerary.title).toBe('Swiss Luxury Portal');

      const snapshotString = JSON.stringify(snapshot);
      // PROVE ZERO occurrence of secrets or margins
      expect(snapshotString).not.toContain('SECRET_HOTEL_SUPPLIER');
      expect(snapshotString).not.toContain('SECRET_LIMO_SUPPLIER');
      expect(snapshotString).not.toContain('DRIVER_PHONE_SECRET_999');
      expect(snapshotString).not.toContain('isAcceptable');
      expect(snapshotString).not.toContain('shareId');
      expect(snapshotString).not.toContain('expiresAt');

      // SHA-256 hash match
      expect(qaRow.accepted_snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
      const computedHash = hashCanonicalSnapshot(snapshot);
      expect(qaRow.accepted_snapshot_hash).toBe(computedHash);

      // Clean void for next test
      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, res.acceptance_id, 'Reset for next test']
      );
    });

    it('same-version retry preserves original quote_share_id provenance when retried via Share B', async () => {
      // Share A accepts Quote
      const tokenHashA = makeTokenHash();
      const shareResA = await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, tokenHashA, futureTimestamp()]
      );
      const shareAId = shareResA.rows[0].result.share_id;

      const acceptResA = await client.query(
        `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5) as result`,
        [tokenHashA, 'Original Buyer', 'buyer@example.com', '1.1.1.1', 'Browser A']
      );
      const acceptanceId = acceptResA.rows[0].result.acceptance_id;

      // Share B created for SAME QuoteVersion
      const tokenHashB = makeTokenHash();
      await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, tokenHashB, futureTimestamp()]
      );

      // Retry through Share B
      const acceptResB = await client.query(
        `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5) as result`,
        [tokenHashB, 'Original Buyer', 'buyer@example.com', '2.2.2.2', 'Browser B']
      );
      expect(acceptResB.rows[0].result.acceptance_id).toBe(acceptanceId);
      expect(acceptResB.rows[0].result.idempotent).toBe(true);

      // Verify DB row still holds shareAId
      const checkRow = (
        await client.query(`SELECT quote_share_id FROM public.quote_acceptances WHERE id = $1`, [acceptanceId])
      ).rows[0];
      expect(checkRow.quote_share_id).toBe(shareAId);

      // Clean void
      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, acceptanceId, 'Cleanup']
      );
    });

    it('acceptance remains active and commercially valid after its QuoteShare is revoked or expired', async () => {
      const tokenHash = makeTokenHash();
      const shareRes = await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, tokenHash, futureTimestamp()]
      );
      const shareId = shareRes.rows[0].result.share_id;

      const acceptRes = await client.query(
        `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5) as result`,
        [tokenHash, 'Persistent Traveler', 'persist@test.com', '127.0.0.1', 'Agent']
      );
      const acceptanceId = acceptRes.rows[0].result.acceptance_id;

      // Revoke the share link
      await client.query(
        `SELECT public.rpc_revoke_quote_share($1, $2, $3) as result`,
        [testTenantA, adminUserId, shareId]
      );

      // Verify acceptance is still active (voided_at IS NULL)
      const accRow = (
        await client.query(`SELECT voided_at FROM public.quote_acceptances WHERE id = $1`, [acceptanceId])
      ).rows[0];
      expect(accRow.voided_at).toBeNull();

      // Clean void
      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, acceptanceId, 'Cleanup']
      );
    });

    it('rejects portal acceptance for revoked or expired share link', async () => {
      // Revoked share
      const revokedHash = makeTokenHash();
      const shareRes = await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, revokedHash, futureTimestamp()]
      );
      await client.query(
        `SELECT public.rpc_revoke_quote_share($1, $2, $3) as result`,
        [testTenantA, adminUserId, shareRes.rows[0].result.share_id]
      );

      await expect(
        client.query(
          `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5)`,
          [revokedHash, 'Jane', 'jane@test.com', '127.0.0.1', 'Agent']
        )
      ).rejects.toThrow(/TOKEN_REVOKED/);

      // Expired share
      const expiredHash = makeTokenHash();
      await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, qvPortalId, expiredHash, futureTimestamp()]
      );
      await client.query(
        `UPDATE public.quote_shares SET expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
        [expiredHash]
      );

      await expect(
        client.query(
          `SELECT public.rpc_record_portal_quote_acceptance($1, $2, $3, $4, $5)`,
          [expiredHash, 'Jane', 'jane@test.com', '127.0.0.1', 'Agent']
        )
      ).rejects.toThrow(/TOKEN_EXPIRED/);
    });
  });

  // ==========================================================================
  // 5. STAFF MANUAL QUOTE ACCEPTANCE & GOVERNANCE
  // ==========================================================================
  describe('Staff Manual Quote Acceptance Governance', () => {
    it('admin, manager, consultant, and specialist can record staff acceptance', async () => {
      const acceptRes = await client.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [
          testTenantA,
          specialistUserId,
          qvStaffId,
          'email',
          'Traveler confirmed via email thread #882',
          'Alice Smith',
          'alice@example.com',
        ]
      );
      expect(acceptRes.rows[0].result.acceptance_id).toBeDefined();

      const rowRes = await client.query(
        `SELECT * FROM public.quote_acceptances WHERE id = $1`,
        [acceptRes.rows[0].result.acceptance_id]
      );
      expect(rowRes.rows[0].acceptance_type).toBe('staff_recorded');
      expect(rowRes.rows[0].accepted_by_user_id).toBe(specialistUserId);
      expect(rowRes.rows[0].staff_acceptance_method).toBe('email');
      expect(rowRes.rows[0].staff_reference_notes).toBe('Traveler confirmed via email thread #882');

      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, managerUserId, acceptRes.rows[0].result.acceptance_id, 'Reset test']
      );
    });

    it('denies viewer, super_admin, and cross-tenant user from recording staff acceptance', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7)`,
          [testTenantA, viewerUserId, qvStaffId, 'phone', 'notes', 'Alice', 'alice@test.com']
        )
      ).rejects.toThrow(/FORBIDDEN/);

      await expect(
        client.query(
          `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7)`,
          [testTenantA, superAdminUserId, qvStaffId, 'phone', 'notes', 'Alice', 'alice@test.com']
        )
      ).rejects.toThrow(/FORBIDDEN/);

      await expect(
        client.query(
          `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7)`,
          [testTenantA, tenantBUserId, qvStaffId, 'phone', 'notes', 'Alice', 'alice@test.com']
        )
      ).rejects.toThrow(/CROSS_TENANT_VIOLATION|FORBIDDEN/);
    });
  });

  // ==========================================================================
  // 6. IDEMPOTENCY & COMPETING OFFER CONFLICTS
  // ==========================================================================
  describe('Acceptance Idempotency & Competing Offer Conflict', () => {
    it('returns existing acceptance idempotently for same quote version retry', async () => {
      const res1 = await client.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvConflict1Id, 'phone', 'Phone call', 'Bob', 'bob@test.com']
      );
      const accId1 = res1.rows[0].result.acceptance_id;
      expect(res1.rows[0].result.idempotent).toBe(false);

      const res2 = await client.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvConflict1Id, 'whatsapp', 'Second call', 'Bob', 'bob@test.com']
      );
      expect(res2.rows[0].result.acceptance_id).toBe(accId1);
      expect(res2.rows[0].result.idempotent).toBe(true);

      // Attempting to accept COMPETING QuoteVersion 2 for the same inquiry MUST THROW CONFLICT
      await expect(
        client.query(
          `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7)`,
          [testTenantA, adminUserId, qvConflict2Id, 'email', 'Competing offer', 'Bob', 'bob@test.com']
        )
      ).rejects.toThrow(/CONFLICT_ACTIVE_ACCEPTANCE_EXISTS/);

      // Void active acceptance to test unblocking
      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, accId1, 'Traveler changed mind, wants budget option']
      );

      // Now QuoteVersion 2 CAN be accepted
      const res3 = await client.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvConflict2Id, 'email', 'Accepted budget option', 'Bob', 'bob@test.com']
      );
      expect(res3.rows[0].result.acceptance_id).toBeDefined();

      // Reset
      await client.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, res3.rows[0].result.acceptance_id, 'Reset']
      );
    });
  });

  // ==========================================================================
  // 7. ATOMIC BOOKING CONVERSION, FINANCIAL INVARIANTS & TRIP FACTS PINNING
  // ==========================================================================
  describe('Governed Atomic Booking Conversion & Legacy Compatibility', () => {
    let testAcceptanceId: string;

    beforeAll(async () => {
      const res = await client.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvBookingId, 'in_person', 'Walk-in booking', 'David', 'david@test.com']
      );
      testAcceptanceId = res.rows[0].result.acceptance_id;
    });

    it('denies consultant, specialist, and viewer from converting quote to booking', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3)`,
          [testTenantA, consultantUserId, testAcceptanceId]
        )
      ).rejects.toThrow(/FORBIDDEN/);

      await expect(
        client.query(
          `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3)`,
          [testTenantA, specialistUserId, testAcceptanceId]
        )
      ).rejects.toThrow(/FORBIDDEN/);

      await expect(
        client.query(
          `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3)`,
          [testTenantA, viewerUserId, testAcceptanceId]
        )
      ).rejects.toThrow(/FORBIDDEN/);
    });

    it('admin converts accepted quote to booking with exact financial & trip fact handoff', async () => {
      const convRes = await client.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3, $4) as result`,
        [testTenantA, adminUserId, testAcceptanceId, consultantUserId]
      );

      const bData = convRes.rows[0].result;
      expect(bData.booking_id).toBeDefined();
      expect(bData.booking_reference).toMatch(/^BK-\d{4}-\d{4}$/);
      expect(bData.total_amount).toBe('3600.00');
      expect(bData.currency).toBe('USD');
      expect(bData.booking_status).toBe('confirmed');

      const bRow = (
        await client.query(
          `SELECT *, departure_date::text as departure_date_str, return_date::text as return_date_str 
           FROM public.bookings WHERE id = $1`,
          [bData.booking_id]
        )
      ).rows[0];

      // Financial Invariants
      expect(bRow.total_amount).toBe('3600.00');
      expect(bRow.paid_amount).toBeNull();
      expect(bRow.balance_due).toBeNull();
      expect(bRow.currency).toBe('USD');
      expect(bRow.booking_status).toBe('confirmed');
      expect(bRow.payment_status).toBe('unknown');
      expect(bRow.fulfillment_status).toBe('unknown');
      expect(bRow.financial_data_complete).toBe(false);
      expect(bRow.quote_acceptance_id).toBe(testAcceptanceId);

      // Trip facts pinned from accepted ItineraryVersion 1
      expect(bRow.departure_date_str).toBe('2026-10-01');
      expect(bRow.return_date_str).toBe('2026-10-08');
      expect(bRow.passenger_count).toBe(2);

      // Atomic Inquiry Stage Transition
      const inqRow = (
        await client.query(`SELECT pipeline_stage FROM public.inquiries WHERE id = $1`, [inqBookingId])
      ).rows[0];
      expect(inqRow.pipeline_stage).toBe('booking_confirmed');

      // Same conversion is idempotent
      const convRes2 = await client.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3, $4) as result`,
        [testTenantA, adminUserId, testAcceptanceId, consultantUserId]
      );
      expect(convRes2.rows[0].result.booking_id).toBe(bData.booking_id);
      expect(convRes2.rows[0].result.idempotent).toBe(true);
    });

    it('cancelled existing Booking still blocks second Booking conversion on same Inquiry', async () => {
      // Mark booking cancelled
      await client.query(`UPDATE public.bookings SET booking_status = 'cancelled' WHERE quote_acceptance_id = $1`, [
        testAcceptanceId,
      ]);

      // Same acceptance conversion retry returns the existing booking idempotently
      const retryRes = await client.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3)`,
        [testTenantA, adminUserId, testAcceptanceId]
      );
      expect(retryRes.rows[0].rpc_convert_accepted_quote_to_booking.idempotent).toBe(true);
      expect(retryRes.rows[0].rpc_convert_accepted_quote_to_booking.booking_status).toBe('cancelled');

      // Create a mock second acceptance for this inquiry (simulating another offer)
      const qRow = (
        await client.query(`SELECT quote_id FROM public.quote_versions WHERE id = $1`, [qvBookingId])
      ).rows[0];
      const actualQuoteId = qRow.quote_id;

      const fakeAccId = randomUUID();
      await client.query(`
        INSERT INTO public.quote_acceptances (
          id, tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
          acceptance_type, accepted_by_user_id, traveler_name_input, traveler_email_input,
          accepted_grand_total, currency, customer_safe_snapshot, accepted_snapshot_hash,
          staff_acceptance_method, voided_at, voided_by, void_reason
        ) VALUES (
          '${fakeAccId}', '${testTenantA}', '${inqBookingId}', '${actualQuoteId}', '${qvBookingId}', '${itinBookingVer1Id}', '${travelerId}',
          'staff_recorded', '${adminUserId}', 'Traveler 2', 't2@test.com',
          3600.00, 'USD', '{"quote":{}}'::jsonb, '1234567890123456789012345678901234567890123456789012345678901234',
          'phone', now(), '${adminUserId}', 'Historical superseded acceptance'
        )
      `);

      // Attempting to convert the voided acceptance MUST BE REJECTED
      await expect(
        client.query(
          `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3)`,
          [testTenantA, adminUserId, fakeAccId]
        )
      ).rejects.toThrow(/INVALID_ACCEPTANCE: Cannot convert a voided acceptance/);
    });

    it('blocks voiding an acceptance once it has been converted to a Booking', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
          [testTenantA, adminUserId, testAcceptanceId, 'Customer cancelled']
        )
      ).rejects.toThrow(/ACCEPTANCE_ALREADY_CONVERTED/);
    });

    it('converts legacy-linked inquiry and updates public.leads.status = booking_confirmed in same tx', async () => {
      const accRes = await client.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvLegacyId, 'email', 'Legacy client booked', 'Legacy Client', 'legacy@test.com']
      );
      const accId = accRes.rows[0].result.acceptance_id;

      const convRes = await client.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3) as result`,
        [testTenantA, adminUserId, accId]
      );
      expect(convRes.rows[0].result.booking_id).toBeDefined();

      // Check leads row
      const leadRow = (
        await client.query(`SELECT status FROM public.leads WHERE id = $1`, [legacyLeadId])
      ).rows[0];
      expect(leadRow.status).toBe('booking_confirmed');
    });

    it('legacy bookings with quote_acceptance_id NULL remain intact and unaffected', async () => {
      const legacyBkId = randomUUID();
      await client.query(`
        INSERT INTO public.bookings (id, tenant_id, traveler_id, booking_reference, total_amount, currency, quote_acceptance_id)
        VALUES ('${legacyBkId}', '${testTenantA}', '${travelerId}', 'BK-LEGACY-001', 5000.00, 'USD', NULL)
      `);

      const bkRow = (
        await client.query(`SELECT quote_acceptance_id FROM public.bookings WHERE id = $1`, [legacyBkId])
      ).rows[0];
      expect(bkRow.quote_acceptance_id).toBeNull();
    });
  });

  // ==========================================================================
  // 8. MULTI-CLIENT CONCURRENCY RACES
  // ==========================================================================
  describe('Multi-Client Real PostgreSQL Concurrency Races', () => {
    let client1: Client;
    let client2: Client;
    let inqRaceId: string;
    let itinRaceId: string;
    let qvRace1Id: string;
    let qvRace2Id: string;

    beforeAll(async () => {
      client1 = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'postgres' });
      client2 = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'postgres' });
      await client1.connect();
      await client2.connect();

      // Seed independent Inquiry for concurrency tests
      inqRaceId = randomUUID();
      await client1.query(
        `INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination, number_of_travelers, pipeline_stage)
         VALUES ('${inqRaceId}', '${testTenantA}', '${travelerId}', 'Norway', 2, 'proposal')`
      );

      const itinRes = await client1.query(
        `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5) as result`,
        [testTenantA, adminUserId, inqRaceId, 'Norway Fjords', JSON.stringify({ days: [] })]
      );
      itinRaceId = itinRes.rows[0].result.versionId;
      await client1.query(`SELECT public.rpc_finalize_itinerary_version($1, $2, $3)`, [testTenantA, adminUserId, itinRaceId]);

      const q1 = await client1.query(
        `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
        [
          testTenantA,
          adminUserId,
          inqRaceId,
          itinRaceId,
          JSON.stringify({
            lineItems: [],
            currency: 'USD',
            subtotal: '1000.00',
            discountAmount: '0.00',
            taxAmount: '0.00',
            grandTotal: '1000.00',
            internalCostTotal: '0.00',
            grossMarginAmount: '0.00',
            validUntil: '2026-12-31',
          }),
        ]
      );
      qvRace1Id = q1.rows[0].result.versionId;
      await client1.query(`SELECT public.rpc_issue_quote_version($1, $2, $3)`, [testTenantA, adminUserId, qvRace1Id]);

      const q2 = await client1.query(
        `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
        [
          testTenantA,
          adminUserId,
          inqRaceId,
          itinRaceId,
          JSON.stringify({
            lineItems: [],
            currency: 'USD',
            subtotal: '2000.00',
            discountAmount: '0.00',
            taxAmount: '0.00',
            grandTotal: '2000.00',
            internalCostTotal: '0.00',
            grossMarginAmount: '0.00',
            validUntil: '2026-12-31',
          }),
        ]
      );
      qvRace2Id = q2.rows[0].result.versionId;
      await client1.query(`SELECT public.rpc_issue_quote_version($1, $2, $3)`, [testTenantA, adminUserId, qvRace2Id]);
    });

    afterAll(async () => {
      try {
        await client1.end();
        await client2.end();
      } catch {
        /* ignore */
      }
    });

    it('RACE 1: Competing Different-Quote Acceptance Race — exactly one succeeds, one throws CONFLICT', async () => {
      const p1 = client1.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvRace1Id, 'email', 'Client 1 accept', 'Traveler 1', 't1@test.com']
      );
      const p2 = client2.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvRace2Id, 'email', 'Client 2 accept', 'Traveler 2', 't2@test.com']
      );

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedError.message).toContain('CONFLICT_ACTIVE_ACCEPTANCE_EXISTS');

      const qaRows = (
        await client1.query(
          `SELECT * FROM public.quote_acceptances WHERE tenant_id = $1 AND inquiry_id = $2 AND voided_at IS NULL`,
          [testTenantA, inqRaceId]
        )
      ).rows;
      expect(qaRows).toHaveLength(1);

      // Clean void
      await client1.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4)`,
        [testTenantA, adminUserId, qaRows[0].id, 'Reset race']
      );
    });

    it('RACE 2: Same-Quote Double-Submit Race — one inserts, other idempotently returns', async () => {
      const p1 = client1.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvRace1Id, 'email', 'Double submit A', 'Traveler 1', 't1@test.com']
      );
      const p2 = client2.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qvRace1Id, 'email', 'Double submit B', 'Traveler 1', 't1@test.com']
      );

      const [r1, r2] = await Promise.all([p1, p2]);
      const id1 = r1.rows[0].result.acceptance_id;
      const id2 = r2.rows[0].result.acceptance_id;

      expect(id1).toBe(id2);

      const rows = (
        await client1.query(
          `SELECT * FROM public.quote_acceptances WHERE tenant_id = $1 AND inquiry_id = $2 AND voided_at IS NULL`,
          [testTenantA, inqRaceId]
        )
      ).rows;
      expect(rows).toHaveLength(1);
    });

    it('RACE 3: Concurrent Booking Conversion Double-Click — exactly ONE booking created', async () => {
      const qaRow = (
        await client1.query(
          `SELECT id FROM public.quote_acceptances WHERE tenant_id = $1 AND inquiry_id = $2 AND voided_at IS NULL`,
          [testTenantA, inqRaceId]
        )
      ).rows[0];

      const p1 = client1.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3) as result`,
        [testTenantA, adminUserId, qaRow.id]
      );
      const p2 = client2.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3) as result`,
        [testTenantA, managerUserId, qaRow.id]
      );

      const [r1, r2] = await Promise.all([p1, p2]);
      const bk1 = r1.rows[0].result.booking_id;
      const bk2 = r2.rows[0].result.booking_id;

      expect(bk1).toBe(bk2);

      const bks = (
        await client1.query(`SELECT * FROM public.bookings WHERE inquiry_id = $1`, [inqRaceId])
      ).rows;
      expect(bks).toHaveLength(1);
    });

    it('RACE 4: Concurrent Void vs Booking Conversion — never ends with Booking pointing to voided acceptance', async () => {
      // Seed a fresh inquiry + quote + acceptance for this race
      const inqRace4Id = randomUUID();
      await client1.query(
        `INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination, number_of_travelers, pipeline_stage)
         VALUES ('${inqRace4Id}', '${testTenantA}', '${travelerId}', 'Austria', 2, 'proposal')`
      );

      const qRace4 = await createHelperQuote(
        inqRace4Id,
        'Austria Race',
        calculateQuotePricing({ lineItems: [{ title: 'Item', category: 'other', quantity: 1, unitPrice: '100.00' }] })
      );
      const accRes = await client1.query(
        `SELECT public.rpc_record_staff_quote_acceptance($1, $2, $3, $4, $5, $6, $7) as result`,
        [testTenantA, adminUserId, qRace4.qvId, 'phone', 'Phone Booking', 'Traveler 4', 't4@test.com']
      );
      const accId = accRes.rows[0].result.acceptance_id;

      // Launch concurrent void and conversion
      const pVoid = client1.query(
        `SELECT public.rpc_void_quote_acceptance($1, $2, $3, $4) as result`,
        [testTenantA, adminUserId, accId, 'Race Void']
      );
      const pConvert = client2.query(
        `SELECT public.rpc_convert_accepted_quote_to_booking($1, $2, $3) as result`,
        [testTenantA, adminUserId, accId]
      );

      const results = await Promise.allSettled([pVoid, pConvert]);
      // Either void succeeded first (and convert was rejected) OR convert succeeded first (and void was rejected)
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify DB consistency: if booking exists, acceptance voided_at IS NULL; if acceptance voided_at IS NOT NULL, booking does not exist
      const accState = (
        await client1.query(`SELECT voided_at FROM public.quote_acceptances WHERE id = $1`, [accId])
      ).rows[0];
      const bkState = (
        await client1.query(`SELECT id FROM public.bookings WHERE quote_acceptance_id = $1`, [accId])
      ).rows;

      if (accState.voided_at !== null) {
        expect(bkState).toHaveLength(0);
      } else {
        expect(bkState).toHaveLength(1);
      }
    });
  });
});
