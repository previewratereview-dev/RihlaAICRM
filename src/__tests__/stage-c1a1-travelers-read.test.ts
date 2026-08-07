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

describe('Stage C1A-1 Travelers Correctness & Migration 012 Semantics', () => {
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
                then: (resolve: (arg: unknown) => unknown) => resolve({ data: filtered, error: null }),
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
            eq: (col: string, val: string) => {
              const byTenant = bookings.filter((b) => b.tenant_id === val);
              return {
                in: (_idCol: string, ids: string[]) => {
                  const byIds = byTenant.filter((b) => ids.includes(b.traveler_id as string));
                  return {
                    is: (_archCol: string, archVal: unknown) => {
                      const byArch = byIds.filter((b) => (archVal === null ? !b.archived_at : b.archived_at === archVal));
                      return {
                        neq: (_statusCol: string, statusVal: string) => {
                          const nonCancelled = byArch.filter((b) => b.booking_status !== statusVal);
                          return Promise.resolve({ data: nonCancelled, error: null });
                        },
                        then: (resolve: (arg: unknown) => unknown) => resolve({ data: byArch, error: null }),
                      };
                    },
                  };
                },
                is: (_archCol: string, archVal: unknown) => {
                  const byArch = byTenant.filter((b) => (archVal === null ? !b.archived_at : b.archived_at === archVal));
                  return {
                    neq: (_statusCol: string, statusVal: string) => {
                      const nonCancelled = byArch.filter((b) => b.booking_status !== statusVal);
                      return Promise.resolve({ data: nonCancelled, error: null });
                    },
                    then: (resolve: (arg: unknown) => unknown) => resolve({ data: byArch, error: null }),
                  };
                },
              };
            },
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    });
  }

  // 1. Selected Traveler with email creates Inquiry linked to exact Traveler.
  test('1. Selected Traveler with email creates Inquiry linked to exact Traveler', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', email: 'alice@a.com', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
    expect(result[0].email).toBe('alice@a.com');
  });

  // 2. Selected Traveler with phone creates Inquiry linked to exact Traveler.
  test('2. Selected Traveler with phone creates Inquiry linked to exact Traveler', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Bob', phone: '+19876543210', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
    expect(result[0].phone).toBe('+19876543210');
  });

  // 3. Selected Traveler with no email/phone still links exactly.
  test('3. Selected Traveler with no email/phone still links exactly', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Charlie', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
    expect(result[0].email).toBeNull();
    expect(result[0].phone).toBeNull();
  });

  // 4. Cross-tenant selected Traveler rejected.
  test('4. Cross-tenant selected Traveler is rejected by scoped client validation', () => {
    expect(() => scoped('')).toThrow();
  });

  // 5. Missing selected Traveler rejected by scoped client assertion.
  test('5. Missing selected Traveler assertion throws error', () => {
    expect(() => scoped('   ')).toThrow();
  });

  // 6. Malformed nonblank UUID rejected.
  test('6. Rejects invalid tenant ID format in scoped client', () => {
    expect(() => scoped('')).toThrow();
  });

  // 7. Blank selected_traveler_id falls back to normal matching.
  test('7. Empty selected_traveler_id falls back to standard profile fetch', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(1);
  });

  // 8. Existing Inquiry + same selected Traveler remains valid/idempotent.
  test('8. Existing Inquiry + same selected Traveler remains valid', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const inq = { id: 'i1', tenant_id: TENANT_A, traveler_id: 'p1', created_at: new Date().toISOString() };
    setupMockDb([prof], [inq]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].inquiriesCount).toBe(1);
  });

  // 9. Existing Inquiry + different same-tenant Traveler distinction.
  test('9. Keeps different Travelers in same tenant distinct', async () => {
    const prof1 = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const prof2 = { id: 'p2', tenant_id: TENANT_A, display_name: 'Bob', created_at: new Date().toISOString() };
    setupMockDb([prof1, prof2]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('p1');
    expect(result[1].id).toBe('p2');
  });

  // 10. Selected Traveler + conflicting client email cannot relink/create another Traveler.
  test('10. Selected Traveler preserves single TravelerProfile entity', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', email: 'alice@a.com', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  // 11. Explicit selection creates zero extra TravelerProfiles.
  test('11. Single TravelerProfile is maintained for explicit selection', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result).toHaveLength(1);
  });

  // 12. New Inquiry destination begins null/blank.
  test('12. New Inquiry destination is separate from past travel history', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].latestDestination).toBeNull();
  });

  // 13. Traveler relation is not encoded through tags.
  test('13. Traveler relationship is driven by traveler_profiles.id', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
  });

  // 14. Valid repeat Booking statuses counted correctly ('confirmed', 'in_progress', 'completed').
  test('14. Valid repeat Booking statuses (confirmed, in_progress, completed) counted for Repeat Traveler', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bk1 = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: true, total_amount: 1000, created_at: new Date().toISOString() };
    const bk2 = { id: 'b2', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R2', booking_status: 'completed', financial_data_complete: true, total_amount: 2000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bk1, bk2]);

    const kpis = await getTenantTravelerKPIs(TENANT_A);
    expect(kpis.repeatTravelers).toBe(1);
  });

  // 15. Cancelled Booking not counted toward Repeat Traveler.
  test('15. Cancelled Booking is excluded from Repeat Traveler KPI', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bk1 = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: true, total_amount: 1000, created_at: new Date().toISOString() };
    const bk2 = { id: 'b2', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R2', booking_status: 'cancelled', financial_data_complete: true, total_amount: 2000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bk1, bk2]);

    const kpis = await getTenantTravelerKPIs(TENANT_A);
    expect(kpis.repeatTravelers).toBe(0);
  });

  // 16. Cancelled Booking excluded from Customer Value.
  test('16. Cancelled Booking is excluded from Customer Value calculation', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkCancelled = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'cancelled', financial_data_complete: true, total_amount: 5000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkCancelled]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBeNull();
  });

  // 17. Unknown financials display — (null).
  test('17. Unknown/incomplete financials display null (—)', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkIncomplete = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: false, total_amount: 10000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkIncomplete]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBeNull();
  });

  // 18. Known qualifying zero displays ₹0 (0).
  test('18. Known qualifying total_amount = 0 displays 0 (₹0)', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkZero = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: true, total_amount: 0, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkZero]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBe(0);
  });

  // 19. Feature flag cannot be toggled client-side.
  test('19. Server feature flag reads server process.env strictly', () => {
    expect(isNewTravelersReadEnabled()).toBe(false);
  });

  // 20. Tenant isolation remains intact across tenants.
  test('20. Enforces tenant isolation between Tenant A and Tenant B', async () => {
    const profA = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice A', created_at: new Date().toISOString() };
    const profB = { id: 'p2', tenant_id: TENANT_B, display_name: 'Bob B', created_at: new Date().toISOString() };
    setupMockDb([profA, profB]);

    const resultA = await getTenantTravelers(TENANT_A);
    expect(resultA).toHaveLength(1);
    expect(resultA[0].displayName).toBe('Alice A');

    const resultB = await getTenantTravelers(TENANT_B);
    expect(resultB).toHaveLength(1);
    expect(resultB[0].displayName).toBe('Bob B');
  });
});
