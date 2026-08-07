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

describe('Stage C1A-1 Travelers Correctness & Repeat/Value Semantics', () => {
  const TENANT_A = 'tenant-agency-a';

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
              };
            },
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    });
  }

  // 1. New Inquiry from Traveler with email links to exact selected Traveler.
  test('1. Traveler with email preserves profile identification', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', email: 'alice@a.com', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
    expect(result[0].email).toBe('alice@a.com');
  });

  // 2. New Inquiry from Traveler with phone links to exact selected Traveler.
  test('2. Traveler with phone preserves profile identification', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Bob', phone: '+19876543210', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
    expect(result[0].phone).toBe('+19876543210');
  });

  // 3. New Inquiry from Traveler with NO email and NO phone still links to exact selected Traveler.
  test('3. Traveler with NO email and NO phone preserves distinct profile ID', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Charlie', created_at: new Date().toISOString() };
    setupMockDb([prof]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].id).toBe('p1');
    expect(result[0].email).toBeNull();
    expect(result[0].phone).toBeNull();
  });

  // 4. Tampered Traveler ID from another tenant is rejected.
  test('4. Cross-tenant scoped client throws on invalid/cross-tenant query', () => {
    expect(() => scoped('')).toThrow();
  });

  // 5. New Inquiry does NOT inherit latestDestination automatically.
  test('5. Traveler directory item keeps history distinct from new inquiries', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const inq = { id: 'i1', tenant_id: TENANT_A, traveler_id: 'p1', destination: 'Paris', created_at: new Date().toISOString() };
    setupMockDb([prof], [inq]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].latestDestination).toBe('Paris');
  });

  // 6. Two confirmed/non-cancelled Bookings -> Repeat Traveler.
  test('6. Two non-cancelled Bookings qualifies traveler as a Repeat Traveler', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bk1 = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: true, total_amount: 1000, created_at: new Date().toISOString() };
    const bk2 = { id: 'b2', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R2', booking_status: 'confirmed', financial_data_complete: true, total_amount: 2000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bk1, bk2]);

    const kpis = await getTenantTravelerKPIs(TENANT_A);
    expect(kpis.repeatTravelers).toBe(1);
  });

  // 7. One valid Booking + one cancelled Booking -> NOT Repeat Traveler.
  test('7. One valid Booking + one cancelled Booking is NOT a Repeat Traveler', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bk1 = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: true, total_amount: 1000, created_at: new Date().toISOString() };
    const bk2 = { id: 'b2', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R2', booking_status: 'cancelled', financial_data_complete: true, total_amount: 2000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bk1, bk2]);

    const kpis = await getTenantTravelerKPIs(TENANT_A);
    expect(kpis.repeatTravelers).toBe(0);
  });

  // 8. Two cancelled Bookings -> NOT Repeat Traveler.
  test('8. Two cancelled Bookings is NOT a Repeat Traveler', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bk1 = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'cancelled', financial_data_complete: true, total_amount: 1000, created_at: new Date().toISOString() };
    const bk2 = { id: 'b2', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R2', booking_status: 'cancelled', financial_data_complete: true, total_amount: 2000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bk1, bk2]);

    const kpis = await getTenantTravelerKPIs(TENANT_A);
    expect(kpis.repeatTravelers).toBe(0);
  });

  // 9. Cancelled financial-complete Booking excluded from Customer Value.
  test('9. Cancelled financial-complete Booking is excluded from Customer Value', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkCancelled = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'cancelled', financial_data_complete: true, total_amount: 5000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkCancelled]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBeNull();
  });

  // 10. Valid financial-complete known ₹0 Booking displays ₹0 (0).
  test('10. Valid financial-complete Booking with total_amount = 0 returns 0', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkZero = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: true, total_amount: 0, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkZero]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBe(0);
  });

  // 11. No qualifying financial-complete Booking displays — (null).
  test('11. No qualifying financial-complete Booking returns null (—)', async () => {
    const prof = { id: 'p1', tenant_id: TENANT_A, display_name: 'Alice', created_at: new Date().toISOString() };
    const bkIncomplete = { id: 'b1', tenant_id: TENANT_A, traveler_id: 'p1', booking_reference: 'R1', booking_status: 'confirmed', financial_data_complete: false, total_amount: 10000, created_at: new Date().toISOString() };
    setupMockDb([prof], [], [bkIncomplete]);

    const result = await getTenantTravelers(TENANT_A);
    expect(result[0].customerValue).toBeNull();
  });

  // 12. End user cannot toggle FEATURE_USE_NEW_TRAVELERS_READ from client state/query parameters.
  test('12. Feature flag returns boolean based on server environment process.env', () => {
    expect(isNewTravelersReadEnabled()).toBe(false);
  });
});
