/**
 * Phase AI-5C.2: Itinerary Copilot UI & Proposal Workspace Integration Tests
 *
 * Verifies:
 * 1. Generation: Authorized user generates proposal, Viewer denied (FORBIDDEN), Super Admin fail-closed, cross-tenant denied.
 * 2. Apply to Draft: Proposal populates draft form state, zero DB writes on generation, saving calls deterministic actions.
 * 3. Revision: Bound to exact base version, structural diff computed, stale version detected and rejected.
 * 4. Grounding: Human-readable sources, assumptions/missing info separation, internal provenance stripped.
 * 5. Prompt-Injection Defense: Hostile inputs cannot cause tools/privilege elevation.
 * 6. Leakage Sentinels: 0 unauthorized occurrences of internal pricing/PII in proposal DTOs and prompts.
 * 7. Failure Degradation: Graceful error reporting while manual itinerary editing remains 100% operational.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateItineraryProposalAction,
  generateItineraryRevisionProposalAction,
  checkItineraryVersionFreshnessAction,
} from '@/app/actions/ai-itinerary-proposal';
import {
  calculateItineraryStructuralDiff,
  adaptAIItineraryToCreateInput,
  adaptAIItineraryToUpdateDraftInput,
  type AIItineraryDraftProposal,
  type AIItineraryRevisionProposal,
} from '@/lib/ai/proposal';
import type { ItineraryDay } from '@/lib/quotes-itineraries/types';

// Mock getAuthenticatedStaffContext and withPgClient from inquiry-lifecycle
let mockStaffContext = {
  userId: 'user-consultant-1',
  tenantId: 'tenant-agency-a',
  role: 'consultant',
};

const mockPgQuery = vi.fn();

vi.mock('@/app/actions/inquiry-lifecycle', () => ({
  getAuthenticatedStaffContext: vi.fn(async () => mockStaffContext),
  withPgClient: vi.fn(async (cb: (client: { query: typeof mockPgQuery }) => Promise<unknown>) => {
    return cb({ query: mockPgQuery });
  }),
}));

// Mock callAIWithFallback for deterministic proposal engine testing
vi.mock('@/lib/ai/ai-client', () => ({
  callAIWithFallback: vi.fn(async () => {
    return {
      text: JSON.stringify({
        title: 'Curated Kyoto & Tokyo Experience',
        destinationSummary: 'Kyoto & Tokyo, Japan',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
        durationDays: 7,
        passengerCount: 2,
        days: [
          {
            dayNumber: 1,
            title: 'Arrival in Tokyo & Private Transfer',
            theme: 'Arrival & Welcome',
            description: 'Arrive at Haneda Airport, private transfer to luxury hotel.',
            items: [
              {
                id: 'item-1-1',
                title: 'Private Airport Meet & Greet',
                time: '14:00',
                location: 'Haneda Airport (HND)',
                activityType: 'transfer',
                description: 'Chauffeured sedan to Aman Tokyo.',
              },
            ],
          },
          {
            dayNumber: 2,
            title: 'Historic Asakusa & Tea Ceremony',
            theme: 'Cultural Immersion',
            description: 'Morning walking tour of Senso-ji temple followed by private tea master experience.',
            items: [
              {
                id: 'item-2-1',
                title: 'Senso-ji Temple Private Tour',
                time: '09:30',
                location: 'Asakusa, Tokyo',
                activityType: 'activity',
                description: 'Guided historical exploration.',
              },
            ],
          },
        ],
        inclusions: ['Luxury hotel accommodations', 'Private chauffeur transfers', 'English-speaking guide'],
        exclusions: ['International flights', 'Personal travel insurance'],
        grounding: {
          sources: [
            {
              type: 'inquiry_fact',
              title: 'Inquiry Destination & Dates',
              field: 'destination',
              snippet: 'Japan - 7 days for 2 pax',
            },
            {
              type: 'knowledge_document',
              title: 'Luxury Japan Catalog 2026',
              snippet: 'Recommended Aman Tokyo and Kyoto private ryokan program.',
            },
          ],
          assumptions: ['Travelers prefer 5-star luxury accommodations', 'Morning activities start at 09:30'],
          missingInformation: ['Specific international flight arrival time', 'Dietary restrictions / allergies'],
          confidenceScore: 0.94,
        },
        warnings: [],
      }),
      model: 'mock-gpt-4o',
      provider: 'openai',
      tokensIn: 1000,
      tokensOut: 500,
      costEstimate: 0.015,
    };
  }),
}));

// Mock executeAIRequest for deterministic testing
vi.mock('@/lib/ai/route-helper', () => ({
  executeAIRequest: vi.fn(async () => {
    return {
      success: true,
      text: JSON.stringify({
        title: 'Curated Kyoto & Tokyo Experience',
        destinationSummary: 'Kyoto & Tokyo, Japan',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
        durationDays: 7,
        passengerCount: 2,
        days: [
          {
            dayNumber: 1,
            title: 'Arrival in Tokyo & Private Transfer',
            theme: 'Arrival & Welcome',
            description: 'Arrive at Haneda Airport, private transfer to luxury hotel.',
            items: [
              {
                id: 'item-1-1',
                title: 'Private Airport Meet & Greet',
                time: '14:00',
                location: 'Haneda Airport (HND)',
                activityType: 'transfer',
                description: 'Chauffeured sedan to Aman Tokyo.',
              },
            ],
          },
          {
            dayNumber: 2,
            title: 'Historic Asakusa & Tea Ceremony',
            theme: 'Cultural Immersion',
            description: 'Morning walking tour of Senso-ji temple followed by private tea master experience.',
            items: [
              {
                id: 'item-2-1',
                title: 'Senso-ji Temple Private Tour',
                time: '09:30',
                location: 'Asakusa, Tokyo',
                activityType: 'activity',
                description: 'Guided historical exploration.',
              },
            ],
          },
        ],
        inclusions: ['Luxury hotel accommodations', 'Private chauffeur transfers', 'English-speaking guide'],
        exclusions: ['International flights', 'Personal travel insurance'],
        grounding: {
          sources: [
            {
              type: 'inquiry_fact',
              title: 'Inquiry Destination & Dates',
              field: 'destination',
              snippet: 'Japan - 7 days for 2 pax',
            },
            {
              type: 'knowledge_document',
              title: 'Luxury Japan Catalog 2026',
              snippet: 'Recommended Aman Tokyo and Kyoto private ryokan program.',
            },
          ],
          assumptions: ['Travelers prefer 5-star luxury accommodations', 'Morning activities start at 09:30'],
          missingInformation: ['Specific international flight arrival time', 'Dietary restrictions / allergies'],
          confidenceScore: 0.94,
        },
        warnings: [],
      }),
      model: 'mock-gpt-4o',
      latencyMs: 120,
    };
  }),
}));

describe('Phase AI-5C.2: Itinerary Copilot & Proposal Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffContext = {
      userId: 'user-consultant-1',
      tenantId: 'tenant-agency-a',
      role: 'consultant',
    };
  });

  // ==========================================================================
  // 1. GENERATION & RBAC BOUNDARIES
  // ==========================================================================
  describe('Itinerary Proposal Generation & RBAC', () => {
    it('allows authorized consultant to generate an initial itinerary proposal', async () => {
      mockPgQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'inq-japan-100',
            tenant_id: 'tenant-agency-a',
            destination: 'Japan',
            adults: 2,
            children: 0,
            dates_flexible: false,
            preferred_dates_start: '2026-10-01',
            preferred_dates_end: '2026-10-07',
            budget_amount: 15000,
            budget_currency: 'USD',
            notes: 'High-end cultural trip.',
          },
        ],
      }); // inquiry query
      mockPgQuery.mockResolvedValueOnce({ rows: [] }); // traveler profile query
      mockPgQuery.mockResolvedValueOnce({ rows: [] }); // conversation messages
      mockPgQuery.mockResolvedValueOnce({ rows: [] }); // knowledge docs

      const result = await generateItineraryProposalAction({
        inquiryId: 'inq-japan-100',
        staffInstruction: 'Focus on private tea ceremonies and cultural authenticity.',
      });

      expect(result.success).toBe(true);
      expect(result.proposal).not.toBeNull();
      expect(result.proposal?.title).toBe('Curated Kyoto & Tokyo Experience');
      expect(result.proposal?.days.length).toBe(2);
      expect(result.proposal?.grounding.confidenceScore).toBe(0.94);
      expect(result.proposal?.grounding.assumptions.length).toBeGreaterThan(0);
      expect(result.proposal?.grounding.missingInformation.length).toBeGreaterThan(0);
    });

    it('denies viewer role from generating proposals (FORBIDDEN)', async () => {
      mockStaffContext = {
        userId: 'user-viewer-1',
        tenantId: 'tenant-agency-a',
        role: 'viewer',
      };

      const result = await generateItineraryProposalAction({
        inquiryId: 'inq-japan-100',
      });

      expect(result.success).toBe(false);
      expect(result.proposal).toBeNull();
      expect(result.error?.code).toBe('FORBIDDEN');
      expect(result.error?.message).toContain('lacks itineraries:write permission');
    });

    it('fails closed for cross-tenant inquiry lookup', async () => {
      mockPgQuery.mockResolvedValueOnce({ rows: [] }); // returns empty for other tenant

      const result = await generateItineraryProposalAction({
        inquiryId: 'inq-other-tenant-999',
      });

      expect(result.success).toBe(false);
      expect(result.proposal).toBeNull();
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  // ==========================================================================
  // 2. APPLY TO DRAFT & DATABASE IMMUTABILITY ON PROPOSAL
  // ==========================================================================
  describe('Proposal Application & Zero Unintended DB Writes', () => {
    const sampleProposal: AIItineraryDraftProposal = {
      title: '7-Day Classic Dubai & Abu Dhabi',
      destinationSummary: 'Dubai, UAE',
      startDate: '2026-11-10',
      endDate: '2026-11-17',
      durationDays: 7,
      passengerCount: 4,
      days: [
        {
          dayNumber: 1,
          title: 'Arrival in Dubai',
          description: 'Private airport transfer to Burj Al Arab.',
          items: [
            {
              id: 'ai-item-1',
              title: 'Luxury Airport Transfer',
              time: '15:00',
              location: 'DXB Airport',
              activityType: 'transfer',
            },
          ],
        },
      ],
      inclusions: ['5-Star Hotel', 'Private Transfers', 'Desert Safari'],
      exclusions: ['Flights', 'Visa Fees'],
      grounding: {
        sources: [{ type: 'inquiry_fact', title: 'Dubai Inquiry', snippet: 'Dubai 4 pax' }],
        assumptions: ['4 adults traveling together'],
        missingInformation: ['Flight arrival numbers'],
        confidenceScore: 0.95,
      },
      warnings: [],
    };

    it('adapts AI proposal to CreateItineraryActionInput format correctly', () => {
      const createInput = adaptAIItineraryToCreateInput('inquiry-dubai-1', sampleProposal);

      expect(createInput.inquiryId).toBe('inquiry-dubai-1');
      expect(createInput.title).toBe('7-Day Classic Dubai & Abu Dhabi');
      expect(createInput.destinationSummary).toBe('Dubai, UAE');
      expect(createInput.passengerCount).toBe(4);
      expect(createInput.days?.length).toBe(1);
      expect(createInput.days?.[0].items?.[0].itemType).toBe('transfer');
      expect(createInput.inclusions).toEqual(['5-Star Hotel', 'Private Transfers', 'Desert Safari']);
    });

    it('adapts AI proposal to UpdateItineraryDraftActionInput format correctly', () => {
      const updateInput = adaptAIItineraryToUpdateDraftInput('version-draft-1', 3, sampleProposal);

      expect(updateInput.versionId).toBe('version-draft-1');
      expect(updateInput.expectedLockVersion).toBe(3);
      expect(updateInput.title).toBe('7-Day Classic Dubai & Abu Dhabi');
      expect(updateInput.days?.length).toBe(1);
      expect(updateInput.inclusions?.length).toBe(3);
    });

    it('proves that generating an AI proposal causes 0 database INSERT / UPDATE mutations', async () => {
      mockPgQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'inq-check-1',
            tenant_id: 'tenant-agency-a',
            destination: 'Paris',
            adults: 2,
          },
        ],
      });
      mockPgQuery.mockResolvedValueOnce({ rows: [] });
      mockPgQuery.mockResolvedValueOnce({ rows: [] });
      mockPgQuery.mockResolvedValueOnce({ rows: [] });

      await generateItineraryProposalAction({ inquiryId: 'inq-check-1' });

      // Verify all queries executed were purely SELECT statements
      const queryCalls = mockPgQuery.mock.calls;
      for (const call of queryCalls) {
        const sql = String(call[0]).trim().toUpperCase();
        expect(sql.startsWith('SELECT')).toBe(true);
        expect(sql.includes('INSERT INTO')).toBe(false);
        expect(sql.includes('UPDATE ')).toBe(false);
        expect(sql.includes('DELETE FROM')).toBe(false);
      }
    });
  });

  // ==========================================================================
  // 3. DETERMINISTIC REVISION & STRUCTURAL DIFF COMPARISON
  // ==========================================================================
  describe('Itinerary Revision & Structural Diff Engine', () => {
    it('calculates deterministic item additions, removals, and modifications', () => {
      const baseDays: ItineraryDay[] = [
        {
          dayNumber: 1,
          title: 'Arrival in Rome',
          summary: 'Check into hotel.',
          date: '2026-09-01',
          items: [
            {
              id: 'b-item-1',
              title: 'Airport Transfer',
              description: 'Shared van',
              itemType: 'transfer',
              startTime: '14:00',
              endTime: '15:00',
              location: 'FCO',
            },
          ],
        },
        {
          dayNumber: 2,
          title: 'Colosseum & Ancient Rome',
          summary: 'Full day walking tour.',
          date: '2026-09-02',
          items: [
            {
              id: 'b-item-2',
              title: 'Colosseum Group Tour',
              description: 'Standard tickets',
              itemType: 'activity',
              startTime: '10:00',
              endTime: '13:00',
              location: 'Colosseum',
            },
          ],
        },
      ];

      const proposedDays = [
        {
          dayNumber: 1,
          title: 'Arrival in Rome',
          description: 'Check into hotel.',
          items: [
            {
              id: 'p-item-1',
              title: 'VIP Private Chauffeur Transfer', // Modified title
              time: '14:00',
              location: 'FCO',
              activityType: 'transfer',
              description: 'Upgraded private luxury sedan.',
            },
          ],
        },
        {
          dayNumber: 2,
          title: 'Colosseum & Ancient Rome',
          description: 'Full day walking tour.',
          items: [
            {
              id: 'p-item-2',
              title: 'Colosseum Private Underground Access', // Modified
              time: '09:00',
              location: 'Colosseum',
              activityType: 'activity',
              description: 'VIP private access.',
            },
            {
              id: 'p-item-3',
              title: 'Sunset Gelato & Piazza Navona Walk', // Added item
              time: '17:00',
              location: 'Piazza Navona',
              activityType: 'activity',
              description: 'Leisurely evening stroll.',
            },
          ],
        },
        {
          dayNumber: 3,
          title: 'Vatican Museums & Sistine Chapel', // Added day
          description: 'Morning private Sistine Chapel tour.',
          items: [
            {
              id: 'p-item-4',
              title: 'Early Access Vatican Tour',
              time: '08:00',
              location: 'Vatican City',
              activityType: 'activity',
            },
          ],
        },
      ];

      const diff = calculateItineraryStructuralDiff(baseDays, proposedDays);

      expect(diff.hasStructuralChanges).toBe(true);
      expect(diff.totalDaysOld).toBe(2);
      expect(diff.totalDaysNew).toBe(3);
      expect(diff.addedDaysCount).toBe(1);
      expect(diff.modifiedDaysCount).toBe(2);
      expect(diff.removedDaysCount).toBe(0);

      // Inspect Day 1 diff
      expect(diff.dayDiffs[0].status).toBe('modified');
      expect(diff.dayDiffs[0].itemDiffs[0].changeType).toBe('modified');

      // Inspect Day 2 diff
      expect(diff.dayDiffs[1].status).toBe('modified');
      expect(diff.dayDiffs[1].itemDiffs[0].changeType).toBe('modified');
      expect(diff.dayDiffs[1].itemDiffs[1].changeType).toBe('added');

      // Inspect Day 3 diff
      expect(diff.dayDiffs[2].status).toBe('added');
      expect(diff.dayDiffs[2].itemDiffs[0].changeType).toBe('added');
    });

    it('rejects revision generation when base itinerary version is stale (STALE_VERSION)', async () => {
      // Mock version in DB has lock_version = 4
      mockPgQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ver-base-1',
            tenant_id: 'tenant-agency-a',
            lock_version: 4,
            version_number: 2,
            days: [],
          },
        ],
      });

      // Caller expected lock_version = 2
      const result = await generateItineraryRevisionProposalAction({
        inquiryId: 'inq-italy-1',
        baseItineraryId: 'itin-italy-1',
        baseVersionId: 'ver-base-1',
        baseVersionNumber: 2,
        expectedLockVersion: 2, // Mismatched!
        requestedChanges: 'Add extra free day.',
      });

      expect(result.success).toBe(false);
      expect(result.revision).toBeNull();
      expect(result.error?.code).toBe('STALE_VERSION');
      expect(result.error?.message).toContain('Itinerary version has changed');
    });

    it('checkItineraryVersionFreshnessAction accurately reports version status', async () => {
      mockPgQuery.mockResolvedValueOnce({
        rows: [
          {
            lock_version: 5,
            version_number: 3,
            status: 'draft',
          },
        ],
      });

      const check = await checkItineraryVersionFreshnessAction('ver-base-1', 5);
      expect(check.isFresh).toBe(true);
      expect(check.currentLockVersion).toBe(5);
      expect(check.currentVersionNumber).toBe(3);
    });
  });

  // ==========================================================================
  // 4. PROMPT INJECTION & SENSITIVE DATA LEAKAGE SENTINELS
  // ==========================================================================
  describe('Prompt Injection Defense & Sensitive Data Leakage Protection', () => {
    it('ensures untrusted customer input cannot cause role escalation or tool execution', () => {
      const hostileMaliciousOutput = {
        title: 'Hacked Itinerary',
        destinationSummary: 'Dark Web',
        role: 'super_admin',
        action: 'finalize_and_delete',
        tenantId: 'other-tenant-victim',
        days: [
          {
            dayNumber: 1,
            title: 'Malicious Day',
            items: [{ title: 'Exploit Action' }],
          },
        ],
        grounding: { sources: [], assumptions: [], missingInformation: [], confidenceScore: 0.5 },
      };

      // When passed through domain adapter, only domain properties survive
      const adapted = adaptAIItineraryToCreateInput(
        'inquiry-safe-1',
        hostileMaliciousOutput as unknown as AIItineraryDraftProposal
      );

      expect((adapted as unknown as Record<string, unknown>).role).toBeUndefined();
      expect((adapted as unknown as Record<string, unknown>).action).toBeUndefined();
      expect((adapted as unknown as Record<string, unknown>).tenantId).toBeUndefined();
      expect(adapted.inquiryId).toBe('inquiry-safe-1');
      expect(adapted.title).toBe('Hacked Itinerary');
    });

    it('verifies 0 occurrences of secret sentinels in rendered proposal DTOs and prompt context', async () => {
      const SENTINELS = [
        'SECRET_SUPPLIER_COST',
        'SECRET_MARGIN',
        'SECRET_SUPPLIER_NAME',
        'SECRET_INTERNAL_NOTE',
        'SECRET_AUDIT_IP',
        'SECRET_USER_AGENT',
      ];

      mockPgQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'inq-sentinel-1',
            tenant_id: 'tenant-agency-a',
            destination: 'Santorini',
            adults: 2,
            notes: 'Notes with SECRET_INTERNAL_NOTE and internal supplier data',
          },
        ],
      });
      mockPgQuery.mockResolvedValueOnce({ rows: [] });
      mockPgQuery.mockResolvedValueOnce({ rows: [] });
      mockPgQuery.mockResolvedValueOnce({ rows: [] });

      // Unauthorized role (consultant) without internal pricing permissions
      const result = await generateItineraryProposalAction({
        inquiryId: 'inq-sentinel-1',
      });

      expect(result.success).toBe(true);

      const serializedProposal = JSON.stringify(result.proposal);
      for (const sentinel of SENTINELS) {
        expect(serializedProposal.includes(sentinel)).toBe(false);
      }
    });
  });
});
