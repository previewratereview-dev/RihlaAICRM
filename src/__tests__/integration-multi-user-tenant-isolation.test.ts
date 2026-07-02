/**
 * Integration Test 4.1: Multi-User Tenant Isolation
 * 
 * This integration test validates complete tenant isolation after the RBAC security fixes.
 * It verifies that two tenants (agency-a, agency-b) with their own users and leads
 * maintain complete data isolation at localStorage, database, and UI layers.
 * 
 * **Validates: Requirements 2.1, 2.2, 2.5, 2.16, 3.10, 3.11**
 * 
 * Test Scenario:
 * 1. Create two tenants with different users
 * 2. User A (agency-a) creates leads
 * 3. User B (agency-b) creates leads
 * 4. Verify User A cannot see User B's leads
 * 5. Verify User B cannot see User A's leads
 * 6. Verify localStorage isolation (if in LocalStorage mode)
 * 7. Verify database-level isolation (if in Supabase mode)
 * 8. Verify application-layer validation rejects cross-tenant access
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CRMDatabaseService } from '@/lib/db-service';
import type { User, Lead } from '@/types';

// The single authoritative DAL has no localStorage fallback (Requirement 8.9). Application-layer
// authorization (cross-tenant / unauthenticated rejection) is pure logic and runs in the fast
// suite; tests that genuinely round-trip data through Postgres/RLS are gated to a DB-backed run.
const HAS_DB = CRMDatabaseService.isSupabaseEnabled();

// ====================================================================
// TEST SETUP - Mock localStorage for Node.js test environment
// ====================================================================

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

global.localStorage = localStorageMock as Storage;

// Mock window object for browser-specific code
if (typeof window === 'undefined') {
  (global as Window & typeof globalThis).window = { localStorage: localStorageMock } as unknown as Window & typeof globalThis;
}

// ====================================================================
// TEST DATA - Tenants and Users
// ====================================================================

const TENANT_AGENCY_A = 'agency-a';
const TENANT_AGENCY_B = 'agency-b';

const USER_A: User = {
  id: 'user-alice-001',
  tenantId: TENANT_AGENCY_A,
  email: 'alice@agency-a.com',
  fullName: 'Alice Anderson',
  role: 'admin',
  avatarUrl: '',
  isOnline: true,
  status: 'active',
};

const USER_B: User = {
  id: 'user-bob-001',
  tenantId: TENANT_AGENCY_B,
  email: 'bob@agency-b.com',
  fullName: 'Bob Bennett',
  role: 'admin',
  avatarUrl: '',
  isOnline: true,
  status: 'active',
};

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

/**
 * Create a test lead for a specific tenant and user
 */
function createTestLead(
  tenantId: string,
  createdBy: User,
  leadName: string
): Lead {
  const leadId = `lead-${leadName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  
  return {
    id: leadId,
    tenantId,
    fullName: leadName,
    businessName: `${leadName}'s Business`,
    email: `${leadName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    phone: '+1234567890',
    whatsapp: '+1234567890',
    website: `https://${leadName.toLowerCase().replace(/\s+/g, '')}.com`,
    industry: 'Technology',
    country: 'USA',
    city: 'New York',
    linkedin: '',
    instagram: '',
    leadSource: 'website',
    employeeCount: '1-10',
    monthlyRevenue: '$0-$10k',
    currentSoftware: '',
    interestedService: 'CRM',
    painPoints: 'Need better lead management',
    budget: '$1000',
    status: 'new',
    priority: 'medium',
    dealValue: 1000,
    assignedTo: createdBy.id,
    tags: [`created-by-${createdBy.fullName}`],
    aiScore: 75,
    aiSummary: `Lead from ${createdBy.fullName}'s tenant`,
    lastContacted: '',
    nextFollowUp: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tripType: '',
    destination: '',
    numberOfTravelers: '1',
    departureDate: '',
    returnDate: '',
    duration: '',
    travelClass: 'economy',
    specialRequests: '',
    sourceOfDiscovery: 'referral',
    demoDate: '',
    demoTime: '',
    googleMeetLink: '',
    meetingStatus: '',
    followUpStatus: '',
    assignmentHistory: [{
      assignedTo: createdBy.id,
      assignedBy: createdBy.id,
      assignedAt: new Date().toISOString(),
      note: 'Initial assignment',
    }],
  };
}

/**
 * Simulate authentication by returning the current session user
 */
function mockAuthenticateAs(user: User): User {
  return user;
}

/**
 * Clear all localStorage data for a clean slate
 */
function clearAllStorage(): void {
  localStorage.clear();
}

// ====================================================================
// INTEGRATION TEST SUITE
// ====================================================================

describe('Integration Test 4.1: Multi-User Tenant Isolation', () => {
  beforeEach(() => {
    // Clear localStorage before each test to ensure clean state
    clearAllStorage();
  });

  afterEach(() => {
    // Clean up after each test
    clearAllStorage();
  });

  /**
   * Test Case 1: Complete Tenant Isolation - User A creates lead, User B cannot see it
   * 
   * This is the core integration test that validates the fix for tenant isolation violations.
   */
  it.skipIf(!HAS_DB)('should enforce complete tenant isolation between agency-a and agency-b', async () => {
    // ================================================================
    // STEP 1: User A creates leads in agency-a
    // ================================================================
    const userA = mockAuthenticateAs(USER_A);
    
    const leadA1 = createTestLead(TENANT_AGENCY_A, userA, 'Lead Alpha');
    const leadA2 = createTestLead(TENANT_AGENCY_A, userA, 'Lead Bravo');
    
    // User A creates leads in their tenant
    await CRMDatabaseService.upsertLead(leadA1, TENANT_AGENCY_A, userA.role, userA);
    await CRMDatabaseService.upsertLead(leadA2, TENANT_AGENCY_A, userA.role, userA);
    
    // Verify User A can see their own leads
    const userALeads = await CRMDatabaseService.getLeads(TENANT_AGENCY_A, userA);
    expect(userALeads.length).toBeGreaterThanOrEqual(2);
    expect(userALeads.some(l => l.id === leadA1.id)).toBe(true);
    expect(userALeads.some(l => l.id === leadA2.id)).toBe(true);
    
    console.log(`✓ User A created ${userALeads.length} leads in agency-a`);

    // ================================================================
    // STEP 2: User B creates leads in agency-b
    // ================================================================
    const userB = mockAuthenticateAs(USER_B);
    
    const leadB1 = createTestLead(TENANT_AGENCY_B, userB, 'Lead Charlie');
    const leadB2 = createTestLead(TENANT_AGENCY_B, userB, 'Lead Delta');
    
    // User B creates leads in their tenant
    await CRMDatabaseService.upsertLead(leadB1, TENANT_AGENCY_B, userB.role, userB);
    await CRMDatabaseService.upsertLead(leadB2, TENANT_AGENCY_B, userB.role, userB);
    
    // Verify User B can see their own leads
    const userBLeads = await CRMDatabaseService.getLeads(TENANT_AGENCY_B, userB);
    expect(userBLeads.length).toBeGreaterThanOrEqual(2);
    expect(userBLeads.some(l => l.id === leadB1.id)).toBe(true);
    expect(userBLeads.some(l => l.id === leadB2.id)).toBe(true);
    
    console.log(`✓ User B created ${userBLeads.length} leads in agency-b`);

    // ================================================================
    // STEP 3: Verify User A CANNOT see User B's leads
    // ================================================================
    const userALeadsAfterB = await CRMDatabaseService.getLeads(TENANT_AGENCY_A, userA);
    
    // User A should NOT see any of User B's leads
    expect(userALeadsAfterB.some(l => l.id === leadB1.id)).toBe(false);
    expect(userALeadsAfterB.some(l => l.id === leadB2.id)).toBe(false);
    
    // User A should still see only their own leads
    expect(userALeadsAfterB.some(l => l.id === leadA1.id)).toBe(true);
    expect(userALeadsAfterB.some(l => l.id === leadA2.id)).toBe(true);
    
    console.log('✓ User A cannot see User B\'s leads (tenant isolation working)');

    // ================================================================
    // STEP 4: Verify User B CANNOT see User A's leads
    // ================================================================
    const userBLeadsAfterA = await CRMDatabaseService.getLeads(TENANT_AGENCY_B, userB);
    
    // User B should NOT see any of User A's leads
    expect(userBLeadsAfterA.some(l => l.id === leadA1.id)).toBe(false);
    expect(userBLeadsAfterA.some(l => l.id === leadA2.id)).toBe(false);
    
    // User B should still see only their own leads
    expect(userBLeadsAfterA.some(l => l.id === leadB1.id)).toBe(true);
    expect(userBLeadsAfterA.some(l => l.id === leadB2.id)).toBe(true);
    
    console.log('✓ User B cannot see User A\'s leads (tenant isolation working)');

    // ================================================================
    // STEP 5: Database-level isolation is enforced by the tenant-scoped DAL.
    // The legacy per-tenant localStorage key checks have been removed along with
    // the localStorage data path (Requirement 8.9); isolation is verified above
    // through the DAL returning only the requester's tenant rows.
    // ================================================================
  });

  /**
   * Test Case 2: Application-Layer Validation Rejects Cross-Tenant Access
   * 
   * This test verifies that the validateTenantAccess() function properly
   * rejects attempts to access data from a different tenant.
   */
  it('should reject cross-tenant access at application layer', async () => {
    const userA = mockAuthenticateAs(USER_A);

    // ================================================================
    // ATTACK SCENARIO: User A tries to read agency-b's leads.
    // Authorization is resolved before any database access, so this is verified
    // without a live database connection.
    // ================================================================
    try {
      // This should throw "Tenant access denied" error
      await CRMDatabaseService.getLeads(TENANT_AGENCY_B, userA);
      
      // If we reach here, the validation failed (bug not fixed)
      throw new Error('SECURITY VIOLATION: Cross-tenant access was not blocked!');
    } catch (error) {
      // Verify it's the correct authorization error
      if (error instanceof Error) {
        expect(error.message).toContain('Tenant access denied');
        expect(error.message).toContain(`requested=${TENANT_AGENCY_B}`);
        expect(error.message).toContain(`session=${TENANT_AGENCY_A}`);
        console.log('✓ Application-layer validation blocked cross-tenant access');
      } else {
        throw error;
      }
    }
  });

  /**
   * Test Case 3: Cross-Tenant Write Attempt is Blocked
   * 
   * This test verifies that users cannot create or update leads in other tenants.
   */
  it('should block cross-tenant lead creation attempts', async () => {
    const userA = mockAuthenticateAs(USER_A);
    
    // ================================================================
    // ATTACK SCENARIO: User A tries to create a lead in agency-b
    // ================================================================
    const maliciousLead = createTestLead(TENANT_AGENCY_B, userA, 'Malicious Lead');
    
    try {
      // This should throw "Tenant access denied" error
      await CRMDatabaseService.upsertLead(maliciousLead, TENANT_AGENCY_B, userA.role, userA);
      
      // If we reach here, the validation failed (bug not fixed)
      throw new Error('SECURITY VIOLATION: Cross-tenant write was not blocked!');
    } catch (error) {
      // Verify it's the correct authorization error
      if (error instanceof Error) {
        expect(error.message).toContain('Tenant access denied');
        console.log('✓ Application-layer validation blocked cross-tenant write');
      } else {
        throw error;
      }
    }
    
    // Verify the malicious lead was NOT created in agency-b (DB-backed verification only)
    if (HAS_DB) {
      const userB = mockAuthenticateAs(USER_B);
      const agencyBLeads = await CRMDatabaseService.getLeads(TENANT_AGENCY_B, userB);
      expect(agencyBLeads.some(l => l.id === maliciousLead.id)).toBe(false);
      console.log('✓ Malicious lead was not created in target tenant');
    } else {
      console.log('ℹ Skipping target-tenant DB verification - no database connection configured');
    }
  });

  /**
   * Test Case 4: Verify Tenant Isolation After Multiple Operations
   * 
   * This test performs a series of CRUD operations and verifies that
   * tenant isolation is maintained throughout.
   */
  it.skipIf(!HAS_DB)('should maintain tenant isolation through CRUD operations', async () => {
    const userA = mockAuthenticateAs(USER_A);
    const userB = mockAuthenticateAs(USER_B);
    
    // ================================================================
    // STEP 1: Create initial leads
    // ================================================================
    const leadA1 = createTestLead(TENANT_AGENCY_A, userA, 'Lead Foxtrot');
    const leadB1 = createTestLead(TENANT_AGENCY_B, userB, 'Lead Golf');
    
    await CRMDatabaseService.upsertLead(leadA1, TENANT_AGENCY_A, userA.role, userA);
    await CRMDatabaseService.upsertLead(leadB1, TENANT_AGENCY_B, userB.role, userB);
    
    // ================================================================
    // STEP 2: Update leads within their own tenants
    // ================================================================
    const updatedLeadA1 = { ...leadA1, status: 'contacted' as const, aiScore: 85 };
    const updatedLeadB1 = { ...leadB1, status: 'qualified' as const, aiScore: 90 };
    
    await CRMDatabaseService.upsertLead(updatedLeadA1, TENANT_AGENCY_A, userA.role, userA);
    await CRMDatabaseService.upsertLead(updatedLeadB1, TENANT_AGENCY_B, userB.role, userB);
    
    // ================================================================
    // STEP 3: Verify updates are isolated
    // ================================================================
    const userALeads = await CRMDatabaseService.getLeads(TENANT_AGENCY_A, userA);
    const userBLeads = await CRMDatabaseService.getLeads(TENANT_AGENCY_B, userB);
    
    const foundLeadA = userALeads.find(l => l.id === leadA1.id);
    const foundLeadB = userBLeads.find(l => l.id === leadB1.id);
    
    expect(foundLeadA).toBeDefined();
    expect(foundLeadA?.status).toBe('contacted');
    expect(foundLeadA?.aiScore).toBe(85);
    
    expect(foundLeadB).toBeDefined();
    expect(foundLeadB?.status).toBe('qualified');
    expect(foundLeadB?.aiScore).toBe(90);
    
    // ================================================================
    // STEP 4: Delete leads within their own tenants
    // ================================================================
    await CRMDatabaseService.deleteLead(leadA1.id, TENANT_AGENCY_A, userA.role, userA);
    await CRMDatabaseService.deleteLead(leadB1.id, TENANT_AGENCY_B, userB.role, userB);
    
    // ================================================================
    // STEP 5: Verify deletions are isolated
    // ================================================================
    const userALeadsAfterDelete = await CRMDatabaseService.getLeads(TENANT_AGENCY_A, userA);
    const userBLeadsAfterDelete = await CRMDatabaseService.getLeads(TENANT_AGENCY_B, userB);
    
    expect(userALeadsAfterDelete.some(l => l.id === leadA1.id)).toBe(false);
    expect(userBLeadsAfterDelete.some(l => l.id === leadB1.id)).toBe(false);
    
    console.log('✓ Tenant isolation maintained through CREATE, UPDATE, DELETE operations');
  });

  /**
   * Test Case 5: Verify Session User Context is Required
   * 
   * This test verifies that operations without a valid session user are rejected.
   */
  it('should reject operations without valid session user', async () => {
    try {
      // Attempt to get leads without session user (null)
      await CRMDatabaseService.getLeads(TENANT_AGENCY_A, null);
      
      // If we reach here, authentication check failed
      throw new Error('SECURITY VIOLATION: Operation without authentication was not blocked!');
    } catch (error) {
      // Verify it's the correct authentication error
      if (error instanceof Error) {
        expect(error.message).toContain('Authentication required');
        console.log('✓ Operations without session user are properly blocked');
      } else {
        throw error;
      }
    }
  });

  /**
   * Test Case 6: Verify Lead Retrieval by ID Respects Tenant Boundaries
   * 
   * This test verifies that retrieving a specific lead by ID enforces tenant validation.
   */
  it('should block getLead() for a lead in a different tenant (application layer)', async () => {
    const userB = mockAuthenticateAs(USER_B);
    const someLeadId = 'lead-from-agency-a';

    // User B (agency-b) attempts to read a lead scoped to agency-a. Authorization is resolved
    // before any database access, so the rejection is verified without a live database.
    try {
      await CRMDatabaseService.getLead(someLeadId, TENANT_AGENCY_A, userB);
      throw new Error('SECURITY VIOLATION: Cross-tenant lead retrieval was not blocked!');
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).toContain('Tenant access denied');
        console.log('✓ getLead() properly enforces tenant boundaries');
      } else {
        throw error;
      }
    }
  });

  /**
   * Test Case 6 (DB-backed): Verify Lead Retrieval by ID Respects Tenant Boundaries
   *
   * Verifies that an owner can retrieve their own lead while cross-tenant retrieval is blocked.
   * Requires a live database connection.
   */
  it.skipIf(!HAS_DB)('should block getLead() calls for leads in different tenants', async () => {
    const userA = mockAuthenticateAs(USER_A);
    const userB = mockAuthenticateAs(USER_B);
    
    // User A creates a lead
    const leadA = createTestLead(TENANT_AGENCY_A, userA, 'Lead Hotel');
    await CRMDatabaseService.upsertLead(leadA, TENANT_AGENCY_A, userA.role, userA);
    
    // Verify User A can retrieve their own lead
    const retrievedLeadA = await CRMDatabaseService.getLead(leadA.id, TENANT_AGENCY_A, userA);
    expect(retrievedLeadA).not.toBeNull();
    expect(retrievedLeadA?.id).toBe(leadA.id);
    
    // ================================================================
    // ATTACK SCENARIO: User B tries to retrieve User A's lead
    // ================================================================
    try {
      // This should throw "Tenant access denied" error
      await CRMDatabaseService.getLead(leadA.id, TENANT_AGENCY_A, userB);
      
      // If we reach here, the validation failed
      throw new Error('SECURITY VIOLATION: Cross-tenant lead retrieval was not blocked!');
    } catch (error) {
      // Verify it's the correct authorization error
      if (error instanceof Error) {
        expect(error.message).toContain('Tenant access denied');
        console.log('✓ getLead() properly enforces tenant boundaries');
      } else {
        throw error;
      }
    }
  });
});
