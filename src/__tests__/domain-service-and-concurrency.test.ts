import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  shapeQuoteVersionDTO,
  preparePricingInputForRole,
} from '../lib/quotes-itineraries/service';
import { calculateQuotePricing } from '../lib/quotes-itineraries/pricing';
import {
  QuoteLineItem,
  InternalQuoteVersionDTO,
  StaffSafeQuoteVersionDTO,
} from '../lib/quotes-itineraries/types';

describe('AI-5B.2 Domain Service Security & Scoped Supplier-Cost Merge', () => {
  const sampleQuoteRow = {
    id: '11111111-2222-3333-4444-555555555555',
    tenant_id: 'agency_test',
    quote_id: '66666666-7777-8888-9999-000000000000',
    quote_number: 'QT-2026-0001',
    version_number: 1,
    itinerary_version_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    status: 'draft',
    frozen_at: null,
    currency: 'INR',
    line_items: [
      {
        id: 'item-1',
        title: 'Luxury Villa',
        category: 'accommodation' as const,
        quantity: 2,
        unitPrice: '50000.00',
        totalPrice: '100000.00',
        supplierCost: '35000.00',
        supplierName: 'Villa Supplier Co',
        markupAmount: '30000.00',
        marginAmount: '30000.00',
        marginPct: 30,
        markupPct: 42.86,
      },
    ],
    quote_schema_version: 1,
    subtotal: '100000.00',
    discount_amount: '0.00',
    tax_amount: '0.00',
    grand_total: '100000.00',
    internal_cost_total: '70000.00',
    gross_margin_amount: '30000.00',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('shapes InternalQuoteVersionDTO for Admin/Manager with internal costs and margins', () => {
    const adminDTO = shapeQuoteVersionDTO(sampleQuoteRow, 'admin') as InternalQuoteVersionDTO;
    expect(adminDTO.internalCostTotal).toBe('70000.00');
    expect(adminDTO.grossMarginAmount).toBe('30000.00');
    expect(adminDTO.lineItems[0].supplierCost).toBe('35000.00');
    expect(adminDTO.lineItems[0].markupAmount).toBe('30000.00');
    expect(adminDTO.lineItems[0].marginPct).toBe(30);

    const managerDTO = shapeQuoteVersionDTO(sampleQuoteRow, 'manager') as InternalQuoteVersionDTO;
    expect(managerDTO.internalCostTotal).toBe('70000.00');
    expect(managerDTO.lineItems[0].supplierCost).toBe('35000.00');
  });

  it('shapes StaffSafeQuoteVersionDTO for Consultant/Specialist/Viewer strictly omitting supplier cost and margins', () => {
    const consultantDTO = shapeQuoteVersionDTO(sampleQuoteRow, 'consultant') as StaffSafeQuoteVersionDTO;
    expect((consultantDTO as unknown as Record<string, unknown>).internalCostTotal).toBeUndefined();
    expect((consultantDTO as unknown as Record<string, unknown>).grossMarginAmount).toBeUndefined();
    expect((consultantDTO.lineItems[0] as unknown as Record<string, unknown>).supplierCost).toBeUndefined();
    expect((consultantDTO.lineItems[0] as unknown as Record<string, unknown>).markupAmount).toBeUndefined();
    expect((consultantDTO.lineItems[0] as unknown as Record<string, unknown>).marginPct).toBeUndefined();
    expect(consultantDTO.lineItems[0].unitPrice).toBe('50000.00');
    expect(consultantDTO.lineItems[0].totalPrice).toBe('100000.00');

    const specialistDTO = shapeQuoteVersionDTO(sampleQuoteRow, 'specialist') as StaffSafeQuoteVersionDTO;
    expect((specialistDTO as unknown as Record<string, unknown>).internalCostTotal).toBeUndefined();
    expect((specialistDTO.lineItems[0] as unknown as Record<string, unknown>).supplierCost).toBeUndefined();

    const viewerDTO = shapeQuoteVersionDTO(sampleQuoteRow, 'viewer') as StaffSafeQuoteVersionDTO;
    expect((viewerDTO as unknown as Record<string, unknown>).internalCostTotal).toBeUndefined();
  });

  it('preserves existing server-side supplier costs strictly within target QuoteVersion', () => {
    const targetDraftItems: QuoteLineItem[] = [
      {
        id: 'line-target-1',
        title: 'Luxury Villa',
        category: 'accommodation',
        quantity: 2,
        unitPrice: '50000.00',
        totalPrice: '100000.00',
        supplierCost: '35000.00',
        supplierName: 'Villa Supplier Co',
      },
    ];

    // Consultant submits updated customer-visible price for line-target-1, plus a new line, plus an alien line ID
    const consultantSubmittedItems = [
      {
        id: 'line-target-1',
        title: 'Luxury Villa - Updated Name',
        category: 'accommodation' as const,
        quantity: 2,
        unitPrice: '55000.00',
        supplierCost: null,
      },
      {
        id: 'line-new-2',
        title: 'New Sightseeing Tour',
        category: 'activity' as const,
        quantity: 2,
        unitPrice: '5000.00',
        supplierCost: null,
      },
      {
        id: 'alien-line-from-other-quote',
        title: 'Alien Line',
        category: 'transfer' as const,
        quantity: 1,
        unitPrice: '2000.00',
        supplierCost: null,
      },
    ];

    const prepared = preparePricingInputForRole(consultantSubmittedItems, targetDraftItems, 'consultant');

    // 1. Target line preserved
    expect(prepared[0].supplierCost).toBe('35000.00');

    // 2. New line has null supplier cost
    expect(prepared[1].supplierCost).toBeNull();

    // 3. Alien line not present in target draft has null supplier cost (no cross-quote leakage)
    expect(prepared[2].supplierCost).toBeNull();

    // Pricing calculation treats unknown items truth-preserving (internalCostTotal = null)
    const recalculated = calculateQuotePricing({ lineItems: prepared });
    expect(recalculated.subtotal).toBe('122000.00'); // 110000 + 10000 + 2000
    expect(recalculated.internalCostTotal).toBeNull();
    expect(recalculated.grossMarginAmount).toBeNull();
  });
});

describe('AI-5B.2 Real Local PostgreSQL Concurrency & Allocator Proofs', () => {
  let clientA: Client;
  let clientB: Client;
  let clientC: Client;
  const testTenant = 'tenant_concurrency_all';
  const adminId = '77777777-7777-7777-7777-777777777777';
  const travelerId = '88888888-8888-8888-8888-888888888888';
  const inquiryId = '99999999-9999-9999-9999-999999999999';

  beforeAll(async () => {
    const dbConfig = {
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    };
    clientA = new Client(dbConfig);
    clientB = new Client(dbConfig);
    clientC = new Client(dbConfig);

    await clientA.connect();
    await clientB.connect();
    await clientC.connect();

    // Clean up test records
    await clientA.query(`
      DO $$ BEGIN
        ALTER TABLE public.quote_versions DISABLE TRIGGER ALL;
        ALTER TABLE public.itinerary_versions DISABLE TRIGGER ALL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      DELETE FROM public.quote_versions WHERE tenant_id = '${testTenant}';
      DELETE FROM public.quotes WHERE tenant_id = '${testTenant}';
      DELETE FROM public.itinerary_versions WHERE tenant_id = '${testTenant}';
      DELETE FROM public.itineraries WHERE tenant_id = '${testTenant}';
      DELETE FROM public.tenant_quote_sequences WHERE tenant_id = '${testTenant}';
      DELETE FROM public.inquiries WHERE tenant_id = '${testTenant}';
      DELETE FROM public.traveler_profiles WHERE tenant_id = '${testTenant}';
      DELETE FROM public.profiles WHERE tenant_id = '${testTenant}';
      DELETE FROM public.tenants WHERE id = '${testTenant}';

      DO $$ BEGIN
        ALTER TABLE public.quote_versions ENABLE TRIGGER ALL;
        ALTER TABLE public.itinerary_versions ENABLE TRIGGER ALL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    // Setup tenant fixtures
    await clientA.query(`
      INSERT INTO public.tenants (id, name, slug) VALUES ('${testTenant}', 'Concurrency All Tenant', 'concurrency-all') ON CONFLICT DO NOTHING;
      INSERT INTO public.profiles (id, tenant_id, role, full_name, email) VALUES ('${adminId}', '${testTenant}', 'admin', 'Admin Concurrency', 'admin@concurrency.com') ON CONFLICT DO NOTHING;
      INSERT INTO public.traveler_profiles (id, tenant_id, display_name) VALUES ('${travelerId}', '${testTenant}', 'Traveler Concurrency') ON CONFLICT DO NOTHING;
      INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination) VALUES ('${inquiryId}', '${testTenant}', '${travelerId}', 'Dubai') ON CONFLICT DO NOTHING;
    `);
  });

  afterAll(async () => {
    try {
      await clientA.query(`
        DO $$ BEGIN
          ALTER TABLE public.quote_versions DISABLE TRIGGER ALL;
          ALTER TABLE public.itinerary_versions DISABLE TRIGGER ALL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;

        DELETE FROM public.quote_versions WHERE tenant_id = '${testTenant}';
        DELETE FROM public.quotes WHERE tenant_id = '${testTenant}';
        DELETE FROM public.itinerary_versions WHERE tenant_id = '${testTenant}';
        DELETE FROM public.itineraries WHERE tenant_id = '${testTenant}';
        DELETE FROM public.tenant_quote_sequences WHERE tenant_id = '${testTenant}';
        DELETE FROM public.inquiries WHERE tenant_id = '${testTenant}';
        DELETE FROM public.traveler_profiles WHERE tenant_id = '${testTenant}';
        DELETE FROM public.profiles WHERE tenant_id = '${testTenant}';
        DELETE FROM public.tenants WHERE id = '${testTenant}';

        DO $$ BEGIN
          ALTER TABLE public.quote_versions ENABLE TRIGGER ALL;
          ALTER TABLE public.itinerary_versions ENABLE TRIGGER ALL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;
      `);
      await clientA.end();
      await clientB.end();
      await clientC.end();
    } catch {
      // Ignored
    }
  });

  it('Allocator A: proves concurrent Itinerary revision creations allocate unique monotonic version numbers without collision', async () => {
    // 1. Create base Itinerary family + v1
    const createRes = await clientA.query(
      `SELECT public.rpc_create_itinerary_family_and_version($1, $2, $3, $4, $5) as result`,
      [testTenant, adminId, inquiryId, 'Concurrent Itin Family', '{}']
    );
    const itinId = createRes.rows[0].result.itineraryId;
    const v1Id = createRes.rows[0].result.versionId;

    // Finalize v1
    await clientA.query(`SELECT public.rpc_finalize_itinerary_version($1, $2, $3)`, [testTenant, adminId, v1Id]);

    // 2. Launch 3 parallel revision allocations from 3 concurrent database connections
    const createRevision = async (client: Client) => {
      const res = await client.query(
        `SELECT public.rpc_create_itinerary_revision($1, $2, $3, $4) as result`,
        [testTenant, adminId, itinId, v1Id]
      );
      return res.rows[0].result.versionNumber;
    };

    const results = await Promise.all([
      createRevision(clientA),
      createRevision(clientB),
      createRevision(clientC),
    ]);

    // All allocated version numbers must be unique integers 2, 3, 4
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([2, 3, 4]);
    expect(new Set(results).size).toBe(3);
  });

  it('Allocator B: proves concurrent Quote revision creations allocate unique monotonic version numbers without collision', async () => {
    // 1. Get finalized itinerary version
    const itinVerRes = await clientA.query(
      `SELECT id FROM public.itinerary_versions WHERE tenant_id = $1 AND status = 'finalized' LIMIT 1`,
      [testTenant]
    );
    const itinVerId = itinVerRes.rows[0].id;

    // Create base quote + v1
    const quoteCreateRes = await clientA.query(
      `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
      [
        testTenant,
        adminId,
        inquiryId,
        itinVerId,
        JSON.stringify({ subtotal: '1000.00', discountAmount: '0.00', taxAmount: '0.00', grandTotal: '1000.00', lineItems: [] }),
      ]
    );
    const quoteId = quoteCreateRes.rows[0].result.quoteId;
    const v1Id = quoteCreateRes.rows[0].result.versionId;

    // Issue v1
    await clientA.query(`SELECT public.rpc_issue_quote_version($1, $2, $3)`, [testTenant, adminId, v1Id]);

    // 2. Launch 3 parallel quote revision allocations
    const createRevision = async (client: Client) => {
      const res = await client.query(
        `SELECT public.rpc_create_quote_revision($1, $2, $3, $4, $5, $6) as result`,
        [
          testTenant,
          adminId,
          quoteId,
          v1Id,
          itinVerId,
          JSON.stringify({ subtotal: '1000.00', discountAmount: '0.00', taxAmount: '0.00', grandTotal: '1000.00', lineItems: [] }),
        ]
      );
      return res.rows[0].result.versionNumber;
    };

    const results = await Promise.all([
      createRevision(clientA),
      createRevision(clientB),
      createRevision(clientC),
    ]);

    // All allocated version numbers must be unique integers 2, 3, 4
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([2, 3, 4]);
    expect(new Set(results).size).toBe(3);
  });

  it('Allocator C: proves concurrent Quote-number allocations allocate strictly unique sequential numbers without collisions', async () => {
    // 1. Get finalized itinerary version
    const itinVerRes = await clientA.query(
      `SELECT id FROM public.itinerary_versions WHERE tenant_id = $1 AND status = 'finalized' LIMIT 1`,
      [testTenant]
    );
    const itinVerId = itinVerRes.rows[0].id;

    // 2. Launch 6 concurrent quote family creations across 3 database clients
    const createQuote = async (client: Client) => {
      const res = await client.query(
        `SELECT public.rpc_create_quote_family_and_version($1, $2, $3, $4, $5) as result`,
        [
          testTenant,
          adminId,
          inquiryId,
          itinVerId,
          JSON.stringify({ subtotal: '500.00', discountAmount: '0.00', taxAmount: '0.00', grandTotal: '500.00', lineItems: [] }),
        ]
      );
      return res.rows[0].result.quoteNumber;
    };

    const results = await Promise.all([
      createQuote(clientA),
      createQuote(clientB),
      createQuote(clientC),
      createQuote(clientA),
      createQuote(clientB),
      createQuote(clientC),
    ]);

    expect(results).toHaveLength(6);
    expect(new Set(results).size).toBe(6);
    results.forEach((qNum) => {
      expect(qNum).toMatch(/^QT-2026-\d{4}$/);
    });
  });
});
