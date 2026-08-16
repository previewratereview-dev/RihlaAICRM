import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  shapeQuoteVersionDTO,
  preparePricingInputForRole,
} from '../lib/quotes-itineraries/service';
import { calculateQuotePricing } from '../lib/quotes-itineraries/pricing';
import { QuoteLineItem } from '../lib/quotes-itineraries/types';

describe('AI-5B.2 Domain Service Security & DTO Shaping', () => {
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

  it('preserves existing server-side supplier costs by line ID when updated by a Consultant without revealing them', () => {
    const existingDraftItems: QuoteLineItem[] = [
      {
        id: 'item-1',
        title: 'Luxury Villa',
        category: 'accommodation',
        quantity: 2,
        unitPrice: '50000.00',
        totalPrice: '100000.00',
        supplierCost: '35000.00',
        supplierName: 'Villa Supplier Co',
      },
    ];

    // Consultant submits updated customer-visible price without supplierCost
    const consultantSubmittedItems = [
      {
        id: 'item-1',
        title: 'Luxury Villa - Updated Note',
        category: 'accommodation' as const,
        quantity: 2,
        unitPrice: '52000.00', // price increased to 52000
        supplierCost: null, // consultant does not submit cost
      },
    ];

    const prepared = preparePricingInputForRole(consultantSubmittedItems, existingDraftItems, 'consultant');
    expect(prepared[0].supplierCost).toBe('35000.00'); // Preserved from server state!

    // Recalculating pricing preserves internal margin correctly on server
    const recalculated = calculateQuotePricing({ lineItems: prepared });
    expect(recalculated.subtotal).toBe('104000.00');
    expect(recalculated.internalCostTotal).toBe('70000.00');
    expect(recalculated.grossMarginAmount).toBe('34000.00');
  });
});

describe('AI-5B.2 Real Local PostgreSQL Concurrency Tests', () => {
  let clientA: Client;
  let clientB: Client;
  let clientC: Client;
  const testTenant = 'tenant_concurrency_test';

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

    // Clean up
    await clientA.query(`
      DELETE FROM public.quotes WHERE tenant_id = '${testTenant}';
      DELETE FROM public.tenant_quote_sequences WHERE tenant_id = '${testTenant}';
      DELETE FROM public.inquiries WHERE tenant_id = '${testTenant}';
      DELETE FROM public.traveler_profiles WHERE tenant_id = '${testTenant}';
      DELETE FROM public.tenants WHERE id = '${testTenant}';
    `);

    // Setup tenant & inquiry
    await clientA.query(`
      INSERT INTO public.tenants (id, name, slug) VALUES ('${testTenant}', 'Concurrency Tenant', 'concurrency-tenant') ON CONFLICT DO NOTHING;
      INSERT INTO public.traveler_profiles (id, tenant_id, display_name) VALUES ('99999999-9999-9999-9999-999999999999', '${testTenant}', 'Traveler Concurrency') ON CONFLICT DO NOTHING;
      INSERT INTO public.inquiries (id, tenant_id, traveler_id, destination) VALUES ('88888888-8888-8888-8888-888888888888', '${testTenant}', '99999999-9999-9999-9999-999999999999', 'Dubai') ON CONFLICT DO NOTHING;
    `);
  });

  afterAll(async () => {
    try {
      await clientA.query(`
        DELETE FROM public.quotes WHERE tenant_id = '${testTenant}';
        DELETE FROM public.tenant_quote_sequences WHERE tenant_id = '${testTenant}';
        DELETE FROM public.inquiries WHERE tenant_id = '${testTenant}';
        DELETE FROM public.traveler_profiles WHERE tenant_id = '${testTenant}';
        DELETE FROM public.tenants WHERE id = '${testTenant}';
      `);
      await clientA.end();
      await clientB.end();
      await clientC.end();
    } catch {
      // Ignored
    }
  });

  it('allocates sequential, race-safe quote numbers across concurrent workers without collisions', async () => {
    // Run 6 concurrent sequence allocations across 3 parallel clients
    const allocateSequence = async (client: Client) => {
      const res = await client.query(`
        INSERT INTO public.tenant_quote_sequences (tenant_id, year, last_number)
        VALUES ('${testTenant}', 2026, 1)
        ON CONFLICT (tenant_id, year)
        DO UPDATE SET last_number = tenant_quote_sequences.last_number + 1
        RETURNING last_number;
      `);
      return res.rows[0].last_number;
    };

    const results = await Promise.all([
      allocateSequence(clientA),
      allocateSequence(clientB),
      allocateSequence(clientC),
      allocateSequence(clientA),
      allocateSequence(clientB),
      allocateSequence(clientC),
    ]);

    // All allocated numbers must be unique integers from 1 to 6
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(results).size).toBe(6);
  });
});
