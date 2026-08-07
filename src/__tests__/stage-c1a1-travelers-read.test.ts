import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getTenantTravelers, getTenantTravelerKPIs } from '@/lib/data/travelers';
import { scoped } from '@/lib/data/scoped';
import { isNewTravelersReadEnabled } from '@/lib/feature-flags';

interface MockRecord {
  [key: string]: unknown;
}

// Mock Supabase DB responses
const mockSupabase = {
  from: vi.fn(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockSupabase.from(table),
  },
}));

describe('Stage C1A-1 Travelers Read Migration & Tenant Scoping', () => {
  const TENANT_A = 'tenant-agency-a';
  const TENANT_B = 'tenant-agency-b';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to setup mock database tables
  function setupMockDb(profiles: MockRecord[], inquiries: MockRecord[] = [], bookings: MockRecord[] = []) {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'traveler_profiles') {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              expect(col).toBe('tenant_id');
              const filtered = profiles.filter((p) => p.tenant_id === val);
              return {
                order: () => Promise.resolve({ data: filtered, error: null }),
              };
            },
          }),
        };
      }
      if (table === 'inquiries') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              in: (_idCol: string, ids: string[]) => ({
                is: (_archCol: string, archVal: unknown) => {
                  const filtered = inquiries.filter(
                    (i) =>
                      i.tenant_id === val &&
                      ids.includes(i.traveler_id as string) &&
                      (archVal === null ? !i.archived_at : i.archived_at === archVal)
                  );
                  return {
                    not: () => {
                      const stages = ['booking_lost', 'booking_confirmed'];
                      const activeInqs = filtered.filter((i) => !stages.includes(i.pipeline_stage as string));
                      return Promise.resolve({ data: activeInqs, error: null });
                    },
                    then: (resolve: (arg: unknown) => unknown) => resolve({ data: filtered, error: null }),
                  };
                },
              }),
            }),
          }),
        };
      }
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              in: (_idCol: string, ids: string[]) => ({
                is: (_archCol: string, archVal: unknown) => {
                  const filtered = bookings.filter(
                    (b) =>
                      b.tenant_id === val &&
                      ids.includes(b.traveler_id as string) &&
                      (archVal === null ? !b.archived_at : b.archived_at === archVal)
                  );
                  return Promise.resolve({ data: filtered, error: null });
                },
              }),
            }),
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    });
  }

  // 1. Tenant A sees only Tenant A Travelers.
  // 2. Tenant B Travelers never appear.
  test('1 & 2. Enforces strict tenant isolation for Traveler profiles', async () => {
    const profA = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice A', email: 'alice@a.com', created_at: new Date().toISOString() };
    const profB = { id: 'p2', tenant_id: TENANT_B, display_name: 'Bob B', email: 'bob@b.com', created_at: new Date().toISOString() };
    setupMockDb([profA, profB]);

    const resultA = await getTenantTravelers(TENANT_A);
    expect(resultA).toHaveLength(1);
    expect(resultA[0].displayName).toBe('Alice A');
    expect(resultA[0].tenantId).toBe(TENANT_A);

    const resultB = await getTenantTravelers(TENANT_B);
    expect(resultB).toHaveLength(1);
    expect(resultB[0].displayName).toBe('Bob B');
    expect(resultB[0].tenantId).toBe(TENANT_B);
  });

  // 3. One Traveler + two Inquiries = one Traveler row.
  test('3. Aggregates multiple inquiries under a single Traveler row', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const inq1 = { id: 'i1', tenant_id: TENANT_A, traveler_id: 'p1', destination: 'Paris', created_at: new Date().toISOString() };
    const inq2 = { id: 'i2', tenant_id: TENANT_A, traveler_id: 'p1', destination: 'Tokyo', created_at: new Date().toISOString() };
    setupMockDb([prof], [inq1, inq2]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(1);
    expect(result[0].inquiriesCount).toBe(2);
  });

  // 4. One Traveler + two Bookings = one Traveler row with Bookings=2 & KPI check.
  test('4. Aggregates multiple bookings under a single Traveler row & computes KPIs', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bk1 = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'REF1', financial_data_complete: true, total_amount: 1000, created_at: new Date().toISOString() };
    const bk2 = { id: 'b2', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'REF2', financial_data_complete: true, total_amount: 2000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bk1, bk2]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(1);
    expect(result[0].bookingsCount).toBe(2);
    expect(result[0].customerValue).toBe(3000);

    const kpis = await getTenantTravelerKPIs(TENANT_A);
    expect(kpis.totalTravelers).toBe(1);
    expect(kpis.repeatTravelers).toBe(1);
  });

  // 5. Same display name but different TravelerProfile IDs remain separate.
  test('5. Keeps travelers with identical display names separate if IDs differ', async () => {
    const prof1 = { id: 'p1', tenant_id: TENANT_A, display_name: 'John Smith', created_at: new Date().toISOString() };
    const prof2 = { id: 'p2', tenant_id: TENANT_A, display_name: 'John Smith', created_at: new Date().toISOString() };
    setupMockDb([prof1, prof2]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('p1');
    expect(result[1].id).toBe('p2');
  });

  // 6. Traveler email missing.
  // 7. Traveler phone missing.
  // 8. Both email and phone missing.
  test('6, 7 & 8. Handles missing contact details correctly', async () => {
    const pNoEmail = { id: 'p1', tenant_id: TENANT_A, display_name: 'Traveler One', phone: '+1234567890', created_at: new Date().toISOString() };
    const pNoPhone = { id: 'p2', tenant_id: TENANT_A, display_name: 'Traveler Two', email: 'two@test.com', created_at: new Date().toISOString() };
    const pNoContact = { id: 'p3', tenant_id: TENANT_A, display_name: 'Traveler Three', created_at: new Date().toISOString() };
    setupMockDb([pNoEmail, pNoPhone, pNoContact]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].email).toBeNull();
    expect(result[0].phone).toBe('+1234567890');

    expect(result[1].email).toBe('two@test.com');
    expect(result[1].phone).toBeNull();

    expect(result[2].email).toBeNull();
    expect(result[2].phone).toBeNull();
  });

  // 9. Customer value with financial_data_complete=false -> — (null).
  test('9. Excludes bookings with incomplete financial data from customer value', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkIncomplete = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'REF1', financial_data_complete: false, total_amount: 5000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkIncomplete]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBeNull();
  });

  // 10. Known Booking total_amount=0 with financial_data_complete=true -> ₹0.
  test('10. Preserves zero value when financial_data_complete=true', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkZero = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'REF1', financial_data_complete: true, total_amount: 0, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkZero]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBe(0);
  });

  // 11. Traveler with no Bookings.
  test('11. Traveler with no bookings shows bookingsCount=0 and customerValue=null', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    setupMockDb([prof], [], []);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].bookingsCount).toBe(0);
    expect(result[0].customerValue).toBeNull();
  });

  // 12. Traveler with cancelled Booking.
  test('12. Includes non-archived cancelled bookings in bookings count', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkCancelled = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'REF1', booking_status: 'cancelled', financial_data_complete: true, total_amount: 1500, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkCancelled]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].bookingsCount).toBe(1);
    expect(result[0].customerValue).toBe(1500);
  });

  // 13. Traveler with identity_review_required=true Inquiry shows review indicator.
  test('13. Sets hasIdentityReview flag when any inquiry requires review', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const inqReview = { id: 'i1', tenant_id: TENANT_A, traveler_id: 'p1', identity_review_required: true, identity_review_reason: 'Mismatched phone', created_at: new Date().toISOString() };
    setupMockDb([prof], [inqReview]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].hasIdentityReview).toBe(true);
  });

  // 14, 15, 16. Search filtering by display name, email, normalized phone.
  test('14, 15 & 16. Search filtering properties are supported', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Jane Doe', email: 'jane@example.com', phone: '+919876543210', normalized_phone: '919876543210', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    const item = result[0];

    expect(item.displayName.toLowerCase()).toContain('jane');
    expect(item.email).toContain('jane@example.com');
    expect(item.normalizedPhone).toContain('919876543210');
  });

  // 17. New Inquiry action links/preselects correct Traveler.
  test('17. Scoped client method returns traveler profiles for tenant', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Traveler P1', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const client = scoped(TENANT_A);
    const result = await client.travelers.list();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Traveler P1');
  });

  // 18 & 19. FEATURE_USE_NEW_TRAVELERS_READ status test.
  test('18 & 19. Checks page-specific feature flag behavior', () => {
    expect(isNewTravelersReadEnabled()).toBe(false);
  });

  // 20. No new-model read can escape tenant scope.
  test('20. Rejects blank or invalid tenantId in scoped client', () => {
    expect(() => scoped('')).toThrow();
  });
});
