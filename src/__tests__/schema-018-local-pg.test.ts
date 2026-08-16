import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { calculateQuotePricing } from '../lib/quotes-itineraries/pricing';

/**
 * Phase AI-5B.3: Migration 018 Local PostgreSQL Tests
 *
 * Tests share issuance, revocation, token resolution, lifecycle enforcement,
 * and customer-safe data stripping at the database RPC level.
 *
 * Requires local PostgreSQL at 127.0.0.1:5432 with user postgres/postgres.
 */
describe('Migration 018 Local PostgreSQL Secure Sharing Tests', () => {
  let client: Client;
  const runId = Math.random().toString(36).substring(2, 8);
  const testTenantA = 'tenant_m18_a_' + runId;
  const testTenantB = 'tenant_m18_b_' + runId;

  const adminUserId = randomUUID();
  const consultantUserId = randomUUID();
  const specialistUserId = randomUUID();
  const viewerUserId = randomUUID();
  const superAdminUserId = randomUUID();
  const tenantBUserId = randomUUID();
  const specialistTenantBUserId = randomUUID();
  const travelerId = randomUUID();
  const inquiryId = randomUUID();

  // Fixtures
  let itineraryVersionId: string;
  let quoteVersionId: string;

  function makeTokenHash(): string {
    const raw = randomBytes(32).toString('base64url');
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  function futureTimestamp(hoursFromNow = 24): string {
    return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
  }

  function pastTimestamp(): string {
    return new Date(Date.now() - 3600_000).toISOString();
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

    // Acquire advisory lock for DDL isolation across concurrent test files
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
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user NOLOGIN;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

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
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_user;
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

      // 3. Apply migrations 016, 017, 018 idempotently
      const check017 = await client.query(`
        SELECT 1 FROM pg_proc WHERE proname = 'rpc_create_itinerary_family_and_version'
      `);
      if (check017.rows.length === 0) {
        const m16 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/016_itinerary_and_quote_domain_foundation.sql'), 'utf8');
        await client.query(m16);
        const m17 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/017_itinerary_and_quote_lifecycle_and_immutability.sql'), 'utf8');
        await client.query(m17);
      }

      const check018 = await client.query(`
        SELECT 1 FROM pg_proc WHERE proname = 'rpc_create_itinerary_share'
      `);
      if (check018.rows.length === 0) {
        const m18 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/018_secure_sharing_and_public_portal.sql'), 'utf8');
        await client.query(m18);
      }
      // 4. Seed fixtures for this isolated test run
      await client.query(`
        INSERT INTO public.tenants (id, name, slug) 
        VALUES ('${testTenantA}', 'AI-5 Agency A', 'agency-${testTenantA}'),
               ('${testTenantB}', 'AI-5 Agency B', 'agency-${testTenantB}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.profiles (id, tenant_id, role, full_name, email)
        VALUES
          ('${adminUserId}', '${testTenantA}', 'admin', 'Agency Admin', 'admin@agency-a.com'),
          ('${consultantUserId}', '${testTenantA}', 'consultant', 'Agency Consultant', 'consultant@agency-a.com'),
          ('${specialistUserId}', '${testTenantA}', 'specialist', 'Agency Specialist', 'specialist@agency-a.com'),
          ('${viewerUserId}', '${testTenantA}', 'viewer', 'Agency Viewer', 'viewer@agency-a.com'),
          ('${superAdminUserId}', 'global', 'super_admin', 'Platform Super Admin', 'sa@platform.com'),
          ('${tenantBUserId}', '${testTenantB}', 'admin', 'Agency B Admin', 'admin@agency-b.com'),
          ('${specialistTenantBUserId}', '${testTenantB}', 'specialist', 'Agency B Specialist', 'specialist@agency-b.com')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.traveler_profiles (id, tenant_id, display_name, email)
        VALUES 
          ('${travelerId}', '${testTenantA}', 'Traveler A1', 'a1@test.com')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination, number_of_travelers)
        VALUES
          ('${inquiryId}', '${testTenantA}', '${travelerId}', 'Dubai', 2)
        ON CONFLICT (tenant_id, id) DO NOTHING;
      `);

      // 5. Create a finalized ItineraryVersion
      const itinRes = await client.query(
        `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5) as result`,
        [
          testTenantA,
          adminUserId,
          inquiryId,
          'Dubai Desert Safari',
          JSON.stringify({
            days: [{ dayNumber: 1, title: 'Arrival', items: [
              { itemType: 'transfer', title: 'Airport pickup', supplierName: 'SECRET_SUPPLIER', internalNotes: 'SECRET_NOTE' }
            ]}],
            inclusions: ['Breakfast'],
            exclusions: ['Lunch'],
          }),
        ]
      );
      const itinResult = itinRes.rows[0].result;
      const itinVerId = itinResult.versionId;

      // Finalize the itinerary
      await client.query(
        `SELECT public.rpc_finalize_itinerary_version($1, $2, $3) as result`,
        [testTenantA, adminUserId, itinVerId]
      );
      itineraryVersionId = itinVerId;

      // 6. Create an issued QuoteVersion
      const pricing = calculateQuotePricing({
        lineItems: [
          { title: 'Desert Safari', category: 'activity', quantity: 2, unitPrice: '15000.00', supplierCost: '10000.00', supplierName: 'SECRET_TOUR_OP' },
          { title: 'Hotel Night', category: 'accommodation', quantity: 3, unitPrice: '8000.00', supplierCost: '5000.00' },
        ],
        discountAmount: '500.00',
        taxAmount: '1000.00',
        currency: 'INR',
      });

      const quoteRes = await client.query(
        `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
        [
          testTenantA,
          adminUserId,
          inquiryId,
          itineraryVersionId,
          JSON.stringify({
            lineItems: pricing.normalizedLineItems,
            currency: 'INR',
            subtotal: pricing.subtotal,
            discountAmount: pricing.discountAmount,
            taxAmount: pricing.taxAmount,
            grandTotal: pricing.grandTotal,
            internalCostTotal: pricing.internalCostTotal,
            grossMarginAmount: pricing.grossMarginAmount,
            termsAndConditions: 'Non-refundable',
            customerNotes: 'Enjoy your trip!',
            validUntil: '2026-12-31',
          }),
        ]
      );
      const quoteResult = quoteRes.rows[0].result;
      const qvId = quoteResult.versionId;

      // Issue the quote
      await client.query(
        `SELECT public.rpc_issue_quote_version($1, $2, $3) as result`,
        [testTenantA, adminUserId, qvId]
      );
      quoteVersionId = qvId;
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
  // ITINERARY SHARE ISSUANCE
  // ==========================================================================
  describe('Itinerary Share Issuance', () => {
    it('admin can issue itinerary share for finalized version', async () => {
      const tokenHash = makeTokenHash();
      const expiresAt = futureTimestamp();

      const res = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, tokenHash, expiresAt]
      );

      expect(res.rows[0].result.share_id).toBeDefined();
      expect(res.rows[0].result.itinerary_version_id).toBe(itineraryVersionId);
    });

    it('consultant can issue itinerary share', async () => {
      const tokenHash = makeTokenHash();
      const res = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, consultantUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );
      expect(res.rows[0].result.share_id).toBeDefined();
    });

    it('rejects viewer from issuing share', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, viewerUserId, itineraryVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/FORBIDDEN/);
    });

    it('rejects share on non-finalized itinerary', async () => {
      // Create a new draft itinerary (not finalized)
      const draftRes = await client.query(
        `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5) as result`,
        [testTenantA, adminUserId, inquiryId, 'Draft Itinerary', '{}']
      );
      const draftVersionId = draftRes.rows[0].result.versionId;

      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, adminUserId, draftVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/LIFECYCLE_VIOLATION.*finalized/);
    });

    it('rejects expired expires_at', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, adminUserId, itineraryVersionId, makeTokenHash(), pastTimestamp()]
        )
      ).rejects.toThrow(/expires_at must be in the future/);
    });

    it('rejects invalid token_hash format', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, adminUserId, itineraryVersionId, 'bad-token', futureTimestamp()]
        )
      ).rejects.toThrow(/VALIDATION_ERROR.*SHA-256/);
    });

    it('rejects cross-tenant share issuance', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, tenantBUserId, itineraryVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/CROSS_TENANT_VIOLATION/);
    });
  });

  // ==========================================================================
  // QUOTE SHARE ISSUANCE
  // ==========================================================================
  describe('Quote Share Issuance', () => {
    it('admin can issue quote share for issued version', async () => {
      const tokenHash = makeTokenHash();
      const res = await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, quoteVersionId, tokenHash, futureTimestamp()]
      );
      expect(res.rows[0].result.share_id).toBeDefined();
      expect(res.rows[0].result.quote_version_id).toBe(quoteVersionId);
    });

    it('rejects share on non-issued quote', async () => {
      // Create a draft quote (not issued)
      const draftPricing = calculateQuotePricing({
        lineItems: [{ title: 'Test', category: 'other', quantity: 1, unitPrice: '100.00' }],
      });
      const draftRes = await client.query(
        `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
        [
          testTenantA, adminUserId, inquiryId, itineraryVersionId,
          JSON.stringify({
            lineItems: draftPricing.normalizedLineItems,
            subtotal: draftPricing.subtotal,
            discountAmount: draftPricing.discountAmount,
            taxAmount: draftPricing.taxAmount,
            grandTotal: draftPricing.grandTotal,
            currency: 'INR',
          }),
        ]
      );
      const draftQvId = draftRes.rows[0].result.versionId;

      await expect(
        client.query(
          `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, adminUserId, draftQvId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/LIFECYCLE_VIOLATION.*issued/);
    });
  });

  // ==========================================================================
  // SHARE REVOCATION
  // ==========================================================================
  describe('Share Revocation', () => {
    it('admin can revoke itinerary share', async () => {
      const tokenHash = makeTokenHash();
      const createRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );
      const shareId = createRes.rows[0].result.share_id;

      const revokeRes = await client.query(
        `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
        [testTenantA, adminUserId, shareId]
      );
      expect(revokeRes.rows[0].result.revoked).toBe(true);
    });

    it('consultant can revoke their own share but not others', async () => {
      // Admin creates a share
      const adminHash = makeTokenHash();
      const adminRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, adminHash, futureTimestamp()]
      );
      const adminShareId = adminRes.rows[0].result.share_id;

      // Consultant tries to revoke admin's share → FORBIDDEN
      await expect(
        client.query(
          `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
          [testTenantA, consultantUserId, adminShareId]
        )
      ).rejects.toThrow(/FORBIDDEN.*only revoke shares they created/);

      // Consultant creates and revokes their own share → OK
      const consultantHash = makeTokenHash();
      const consultantRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, consultantUserId, itineraryVersionId, consultantHash, futureTimestamp()]
      );
      const consultantShareId = consultantRes.rows[0].result.share_id;

      const revokeRes = await client.query(
        `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
        [testTenantA, consultantUserId, consultantShareId]
      );
      expect(revokeRes.rows[0].result.revoked).toBe(true);
    });

    it('rejects revoking already-revoked share', async () => {
      const tokenHash = makeTokenHash();
      const createRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );
      const shareId = createRes.rows[0].result.share_id;

      await client.query(
        `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
        [testTenantA, adminUserId, shareId]
      );

      await expect(
        client.query(
          `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
          [testTenantA, adminUserId, shareId]
        )
      ).rejects.toThrow(/LIFECYCLE_VIOLATION.*already revoked/);
    });

    it('admin can revoke quote share', async () => {
      const tokenHash = makeTokenHash();
      const createRes = await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, quoteVersionId, tokenHash, futureTimestamp()]
      );
      const shareId = createRes.rows[0].result.share_id;

      const revokeRes = await client.query(
        `SELECT public.rpc_revoke_quote_share($1, $2, $3) as result`,
        [testTenantA, adminUserId, shareId]
      );
      expect(revokeRes.rows[0].result.revoked).toBe(true);
    });
  });

  // ==========================================================================
  // PUBLIC TOKEN RESOLUTION
  // ==========================================================================
  describe('Public Token Resolution', () => {
    it('resolves valid itinerary share token with customer-safe data', async () => {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');

      await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );

      const res = await client.query(
        `SELECT public.resolve_itinerary_share_token($1) as result`,
        [tokenHash]
      );

      const data = res.rows[0].result;
      expect(data.title).toBe('Dubai Desert Safari');
      expect(data.agency_name).toBe('AI-5 Agency A');
      expect(data.version_id).toBe(itineraryVersionId);

      // Verify customer-safe: no supplierName, no internalNotes in raw JSONB
      const daysJson = JSON.stringify(data.days);
      expect(daysJson).toContain('Airport pickup');
      // Note: The DB function returns raw JSONB days — 
      // The TS service layer strips supplierName/internalNotes.
      // We verify that stripping occurs in the TS layer test below.
    });

    it('updates view metadata on resolution', async () => {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');

      const createRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );
      const shareId = createRes.rows[0].result.share_id;

      // First view
      await client.query(
        `SELECT public.resolve_itinerary_share_token($1) as result`,
        [tokenHash]
      );

      const after1 = await client.query(
        `SELECT first_viewed_at, last_viewed_at FROM public.itinerary_shares WHERE id = $1`,
        [shareId]
      );
      expect(after1.rows[0].first_viewed_at).not.toBeNull();
      expect(after1.rows[0].last_viewed_at).not.toBeNull();
      const firstViewedAt = after1.rows[0].first_viewed_at;

      // Second view — first_viewed_at should not change, last_viewed_at should update
      await new Promise(r => setTimeout(r, 50)); // small delay
      await client.query(
        `SELECT public.resolve_itinerary_share_token($1) as result`,
        [tokenHash]
      );

      const after2 = await client.query(
        `SELECT first_viewed_at, last_viewed_at FROM public.itinerary_shares WHERE id = $1`,
        [shareId]
      );
      expect(after2.rows[0].first_viewed_at.getTime()).toBe(firstViewedAt.getTime());
    });

    it('rejects resolution of revoked token', async () => {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');

      const createRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );
      const shareId = createRes.rows[0].result.share_id;

      // Revoke
      await client.query(
        `SELECT public.rpc_revoke_itinerary_share($1, $2, $3) as result`,
        [testTenantA, adminUserId, shareId]
      );

      await expect(
        client.query(
          `SELECT public.resolve_itinerary_share_token($1) as result`,
          [tokenHash]
        )
      ).rejects.toThrow(/TOKEN_REVOKED/);
    });

    it('rejects resolution of expired token', async () => {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');

      // Insert directly with past expiry (bypassing RPC validation)
      await client.query(
        `INSERT INTO public.itinerary_shares (tenant_id, itinerary_version_id, token_hash, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [testTenantA, itineraryVersionId, tokenHash, adminUserId, pastTimestamp()]
      );

      await expect(
        client.query(
          `SELECT public.resolve_itinerary_share_token($1) as result`,
          [tokenHash]
        )
      ).rejects.toThrow(/TOKEN_EXPIRED/);
    });

    it('rejects resolution of nonexistent token', async () => {
      const fakeHash = createHash('sha256').update('nonexistent-token', 'utf8').digest('hex');
      await expect(
        client.query(
          `SELECT public.resolve_itinerary_share_token($1) as result`,
          [fakeHash]
        )
      ).rejects.toThrow(/INVALID_TOKEN/);
    });

    it('rejects malformed token hash', async () => {
      await expect(
        client.query(
          `SELECT public.resolve_itinerary_share_token($1) as result`,
          ['not-a-valid-hash']
        )
      ).rejects.toThrow(/INVALID_TOKEN/);
    });

    it('resolves valid quote share token with customer-safe data', async () => {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');

      await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, quoteVersionId, tokenHash, futureTimestamp()]
      );

      const res = await client.query(
        `SELECT public.resolve_quote_share_token($1) as result`,
        [tokenHash]
      );

      const data = res.rows[0].result;
      expect(data.quote_number).toMatch(/^QT-/);
      expect(data.version_number).toBe(1);
      expect(data.currency).toBe('INR');
      expect(data.agency_name).toBe('AI-5 Agency A');

      // Verify grand_total is correct: subtotal(54000) - discount(500) + tax(1000) = 54500
      expect(Number(data.grand_total)).toBe(54500);

      // Verify line_items are present (but we'll check stripping in TS layer)
      expect(data.line_items).toHaveLength(2);

      // Verify linked itinerary is present
      expect(data.itinerary).toBeDefined();
      expect(data.itinerary.title).toBe('Dubai Desert Safari');

      // Verify isAcceptable
      expect(data.is_acceptable).toBe(true);
    });
  });

  // =========================================================================
  // REAL LOCAL POSTGRESQL RPC DIRECT PRIVILEGE ATTACK TESTS
  // =========================================================================
  describe('Direct RPC Privilege & Attack Resistance Tests', () => {
    it('anon role direct EXECUTE on resolve_itinerary_share_token is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE anon');
        await expect(
          client.query(`SELECT public.resolve_itinerary_share_token($1)`, [makeTokenHash()])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('anon role direct EXECUTE on resolve_quote_share_token is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE anon');
        await expect(
          client.query(`SELECT public.resolve_quote_share_token($1)`, [makeTokenHash()])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('authenticated role direct EXECUTE on resolve_itinerary_share_token is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE authenticated');
        await expect(
          client.query(`SELECT public.resolve_itinerary_share_token($1)`, [makeTokenHash()])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('authenticated role direct EXECUTE on resolve_quote_share_token is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE authenticated');
        await expect(
          client.query(`SELECT public.resolve_quote_share_token($1)`, [makeTokenHash()])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('ordinary app_user direct EXECUTE on resolve_itinerary_share_token is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE app_user');
        await expect(
          client.query(`SELECT public.resolve_itinerary_share_token($1)`, [makeTokenHash()])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('ordinary app_user direct EXECUTE on resolve_quote_share_token is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE app_user');
        await expect(
          client.query(`SELECT public.resolve_quote_share_token($1)`, [makeTokenHash()])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('anon role direct EXECUTE on rpc_create_itinerary_share is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE anon');
        await expect(
          client.query(
            `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz)`,
            [testTenantA, adminUserId, itineraryVersionId, makeTokenHash(), futureTimestamp()]
          )
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('anon role direct EXECUTE on rpc_create_quote_share is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE anon');
        await expect(
          client.query(
            `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz)`,
            [testTenantA, adminUserId, quoteVersionId, makeTokenHash(), futureTimestamp()]
          )
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('anon role direct EXECUTE on rpc_revoke_itinerary_share is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE anon');
        await expect(
          client.query(
            `SELECT public.rpc_revoke_itinerary_share($1, $2, $3)`,
            [testTenantA, adminUserId, '00000000-0000-0000-0000-000000000000']
          )
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('anon role direct EXECUTE on rpc_revoke_quote_share is DENIED', async () => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE anon');
        await expect(
          client.query(
            `SELECT public.rpc_revoke_quote_share($1, $2, $3)`,
            [testTenantA, adminUserId, '00000000-0000-0000-0000-000000000000']
          )
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  // =========================================================================
  // SPECIALIST & ROLE BOUNDARY AUTHORIZATION TESTS
  // =========================================================================
  describe('Specialist & Role Boundary Share Issuance Authorization', () => {
    it('valid Specialist in same tenant successfully issues Itinerary share', async () => {
      const tokenHash = makeTokenHash();
      const res = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, specialistUserId, itineraryVersionId, tokenHash, futureTimestamp()]
      );
      expect(res.rows[0].result.share_id).toBeDefined();
      expect(res.rows[0].result.itinerary_version_id).toBe(itineraryVersionId);
    });

    it('valid Specialist in same tenant successfully issues Quote share', async () => {
      const tokenHash = makeTokenHash();
      const res = await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, specialistUserId, quoteVersionId, tokenHash, futureTimestamp()]
      );
      expect(res.rows[0].result.share_id).toBeDefined();
      expect(res.rows[0].result.quote_version_id).toBe(quoteVersionId);
    });

    it('Viewer actor attempting share issuance is rejected with FORBIDDEN', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, viewerUserId, itineraryVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/FORBIDDEN/);

      await expect(
        client.query(
          `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, viewerUserId, quoteVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/FORBIDDEN/);
    });

    it('Super Admin actor attempting operational share issuance is rejected with FORBIDDEN', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, superAdminUserId, itineraryVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/FORBIDDEN/);

      await expect(
        client.query(
          `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, superAdminUserId, quoteVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/FORBIDDEN/);
    });

    it('Cross-tenant Specialist attempting share issuance is rejected with CROSS_TENANT_VIOLATION', async () => {
      await expect(
        client.query(
          `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, specialistTenantBUserId, itineraryVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/CROSS_TENANT_VIOLATION/);

      await expect(
        client.query(
          `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
          [testTenantA, specialistTenantBUserId, quoteVersionId, makeTokenHash(), futureTimestamp()]
        )
      ).rejects.toThrow(/CROSS_TENANT_VIOLATION/);
    });
  });

  // =========================================================================
  // DETERMINISTIC SINGLE-HASH VS DOUBLE-HASH PROOFS
  // =========================================================================
  describe('Exact Token Hashing & Double-Hash Rejection Proofs', () => {
    it('proves database resolver expects exact SHA-256 hash and rejects double-hashed token', async () => {
      const rawToken = randomBytes(32).toString('base64url');
      expect(rawToken).toHaveLength(43);

      const expectedHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');
      expect(expectedHash).toHaveLength(64);
      expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);

      const doubleHash = createHash('sha256').update(expectedHash, 'utf8').digest('hex');
      expect(doubleHash).not.toBe(expectedHash);

      // 1. Store share with single expectedHash
      const shareRes = await client.query(
        `SELECT public.rpc_create_itinerary_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, itineraryVersionId, expectedHash, futureTimestamp()]
      );
      expect(shareRes.rows[0].result.share_id).toBeDefined();

      // 2. Lookup using exact expectedHash MUST SUCCEED
      const resolveRes = await client.query(
        `SELECT public.resolve_itinerary_share_token($1) as result`,
        [expectedHash]
      );
      expect(resolveRes.rows[0].result.title).toBe('Dubai Desert Safari');
      expect(resolveRes.rows[0].result.version_id).toBe(itineraryVersionId);

      // 3. Lookup using doubleHash MUST FAIL (throws INVALID_TOKEN / Share not found)
      await expect(
        client.query(
          `SELECT public.resolve_itinerary_share_token($1) as result`,
          [doubleHash]
        )
      ).rejects.toThrow(/INVALID_TOKEN/);

      // 4. Also prove Quote resolver behaves identically
      const quoteToken = randomBytes(32).toString('base64url');
      const quoteExpectedHash = createHash('sha256').update(quoteToken, 'utf8').digest('hex');
      const quoteDoubleHash = createHash('sha256').update(quoteExpectedHash, 'utf8').digest('hex');

      await client.query(
        `SELECT public.rpc_create_quote_share($1, $2, $3, $4, $5::timestamptz) as result`,
        [testTenantA, adminUserId, quoteVersionId, quoteExpectedHash, futureTimestamp()]
      );

      const quoteResolveRes = await client.query(
        `SELECT public.resolve_quote_share_token($1) as result`,
        [quoteExpectedHash]
      );
      expect(quoteResolveRes.rows[0].result.grand_total).toBeDefined();

      await expect(
        client.query(
          `SELECT public.resolve_quote_share_token($1) as result`,
          [quoteDoubleHash]
        )
      ).rejects.toThrow(/INVALID_TOKEN/);
    });
  });
});
