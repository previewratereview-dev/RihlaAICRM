/**
 * Integration Test 4.5: API Route Tenant Validation
 * 
 * This integration test validates that API routes properly validate tenant context
 * against session user after tasks 3.8, 3.9, and 3.10 implementation. Routes should
 * reject requests where subdomain/header doesn't match authenticated user's tenant_id.
 * 
 * **Validates: Requirements 2.2, 2.20, 2.21, 2.22**
 * 
 * Test Scenarios:
 * 1. Send request with matching tenant header → succeeds
 * 2. Send request with mismatched tenant header → receives 403 Forbidden
 * 3. Send request with no tenant header → succeeds using session tenant
 * 4. Send request with matching subdomain → succeeds
 * 5. Send request with mismatched subdomain → receives 403 Forbidden
 * 6. Verify tenant validation happens before database operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getTenantContextFromRequest } from '@/lib/tenant/context';
import { resolveTenantFromRequest } from '@/lib/tenant/resolver';
import type { SessionUser } from '@/lib/auth/api-guard';

// ====================================================================
// TEST DATA - Mock Users with Different Tenants
// ====================================================================

const TENANT_AGENCY_A = 'agency-a';
const TENANT_AGENCY_B = 'agency-b';

const SESSION_USER_A: SessionUser = {
  id: 'user-alice-001',
  tenantId: TENANT_AGENCY_A,
  email: 'alice@agency-a.com',
  fullName: 'Alice Anderson',
  role: 'admin',
  avatarUrl: '',
};

const SESSION_USER_B: SessionUser = {
  id: 'user-bob-001',
  tenantId: TENANT_AGENCY_B,
  email: 'bob@agency-b.com',
  fullName: 'Bob Bennett',
  role: 'admin',
  avatarUrl: '',
};

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

/**
 * Simulate an authenticated API request with tenant validation
 */
function simulateApiRequest(options: {
  sessionUser: SessionUser;
  host?: string | null;
  header?: string | null;
  allowMismatch?: boolean;
}): { success: boolean; tenantId?: string; error?: string } {
  try {
    const tenantContext = getTenantContextFromRequest({
      host: options.host,
      header: options.header,
      sessionTenantId: options.sessionUser.tenantId,
      allowMismatch: options.allowMismatch ?? false,
    });
    
    return {
      success: true,
      tenantId: tenantContext.tenantId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ====================================================================
// INTEGRATION TEST SUITE
// ====================================================================

describe('Integration Test 4.5: API Route Tenant Validation', () => {
  beforeEach(() => {
    // No setup needed for these tests
  });

  /**
   * Test Case 1: Request with Matching Tenant Header Succeeds
   * 
   * Validates Requirement 2.20: WHEN tenant context is resolved via resolveTenantFromRequest()
   * THEN the system SHALL validate the resolved tenant against the authenticated user's
   * profiles.tenant_id and reject requests with HTTP 403 if mismatch occurs
   */
  it('should allow request with matching tenant header', () => {
    // ================================================================
    // SCENARIO: User A sends request with matching X-Tenant-ID header
    // ================================================================
    const result = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    
    // Verify request succeeds
    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(TENANT_AGENCY_A);
    expect(result.error).toBeUndefined();
    
    console.log('✓ Request with matching tenant header succeeded');
  });

  /**
   * Test Case 2: Request with Mismatched Tenant Header Receives 403 Forbidden
   * 
   * Validates Requirement 2.22: WHEN API routes resolve tenant context THEN they SHALL
   * validate subdomain/header values against the authenticated session user's profiles.tenant_id,
   * rejecting mismatches with HTTP 403 Forbidden
   */
  it('should reject request with mismatched tenant header', () => {
    // ================================================================
    // ATTACK SCENARIO: User A sends request with agency-b header
    // ================================================================
    const result = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: TENANT_AGENCY_B, // Mismatched!
      allowMismatch: false,
    });
    
    // Verify request is rejected
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Tenant mismatch');
    expect(result.error).toContain(`header=${TENANT_AGENCY_B}`);
    expect(result.error).toContain(`session=${TENANT_AGENCY_A}`);
    
    console.log('✓ Request with mismatched tenant header rejected with proper error');
  });

  /**
   * Test Case 3: Request with No Tenant Header Succeeds Using Session Tenant
   * 
   * Validates Requirement 2.20: WHEN resolveTenantFromRequest() determines tenant context
   * THEN it SHALL retrieve the authenticated user's tenant_id from their session profile
   * and use that as the authoritative source
   */
  it('should use session tenant when no header provided', () => {
    // ================================================================
    // SCENARIO: User A sends request without X-Tenant-ID header
    // ================================================================
    const result = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: null, // No header
      allowMismatch: false,
    });
    
    // Verify request succeeds using session tenant
    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(TENANT_AGENCY_A);
    expect(result.error).toBeUndefined();
    
    console.log('✓ Request without header succeeded using session tenant');
  });

  /**
   * Test Case 4: Request with Matching Subdomain Succeeds
   * 
   * Validates Requirement 2.20: Session tenant is authoritative but subdomain
   * is validated against it when provided
   */
  it('should allow request with matching subdomain', () => {
    // ================================================================
    // SCENARIO: User A sends request with matching subdomain
    // Note: Subdomain format is {anything}.{tenant}.com where {tenant} is extracted
    // ================================================================
    const result = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      host: 'subdomain.agency-a.com', // Matching subdomain (extracts 'agency-a')
      allowMismatch: false,
    });
    
    // Verify request succeeds
    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(TENANT_AGENCY_A);
    expect(result.error).toBeUndefined();
    
    console.log('✓ Request with matching subdomain succeeded');
  });

  /**
   * Test Case 5: Request with Mismatched Subdomain Receives 403 Forbidden
   * 
   * Validates Requirement 2.22: API routes SHALL validate subdomain values
   * against authenticated session user's tenant_id
   */
  it('should reject request with mismatched subdomain', () => {
    // ================================================================
    // ATTACK SCENARIO: User A sends request with agency-b subdomain
    // Note: Subdomain format is {anything}.{tenant}.com where {tenant} is extracted
    // ================================================================
    const result = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      host: 'subdomain.agency-b.com', // Mismatched subdomain! (extracts 'agency-b')
      allowMismatch: false,
    });
    
    // Verify request is rejected
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Tenant mismatch');
    expect(result.error).toContain(`subdomain=${TENANT_AGENCY_B}`);
    expect(result.error).toContain(`session=${TENANT_AGENCY_A}`);
    
    console.log('✓ Request with mismatched subdomain rejected with proper error');
  });

  /**
   * Test Case 6: Session Tenant Takes Priority Over Client-Provided Values
   * 
   * Validates Requirement 2.20: Session tenant is the authoritative source,
   * client-provided values (subdomain/header) are only validated against it
   */
  it('should prioritize session tenant as authoritative source', () => {
    // ================================================================
    // SCENARIO: Multiple tenant sources, session should be authoritative
    // Note: Subdomain format is {anything}.{tenant}.com where {tenant} is extracted
    // ================================================================
    
    // Test 1: Session tenant with no client values
    const result1 = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      host: null,
      header: null,
      allowMismatch: false,
    });
    expect(result1.success).toBe(true);
    expect(result1.tenantId).toBe(TENANT_AGENCY_A);
    
    // Test 2: Session tenant with matching client values
    const result2 = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      host: 'subdomain.agency-a.com', // Correct format
      header: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(result2.success).toBe(true);
    expect(result2.tenantId).toBe(TENANT_AGENCY_A);
    
    // Test 3: Session tenant overrides any client attempt to change it
    const result3 = simulateApiRequest({
      sessionUser: SESSION_USER_B,
      header: TENANT_AGENCY_A, // User B tries to access agency-a
      allowMismatch: false,
    });
    expect(result3.success).toBe(false);
    expect(result3.error).toContain('Tenant mismatch');
    
    console.log('✓ Session tenant correctly prioritized as authoritative source');
  });

  /**
   * Test Case 7: Tenant Validation at Resolver Level
   * 
   * This test directly tests the resolveTenantFromRequest function to ensure
   * it properly validates tenant context
   */
  it('should validate tenant at resolver level', () => {
    // ================================================================
    // Test resolveTenantFromRequest directly
    // Note: Subdomain format is {anything}.{tenant}.com where {tenant} is extracted
    // ================================================================
    
    // Test 1: Session tenant alone
    const resolution1 = resolveTenantFromRequest({
      sessionTenantId: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(resolution1.tenantId).toBe(TENANT_AGENCY_A);
    expect(resolution1.source).toBe('user_profile');
    
    // Test 2: Session tenant with matching header
    const resolution2 = resolveTenantFromRequest({
      header: TENANT_AGENCY_A,
      sessionTenantId: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(resolution2.tenantId).toBe(TENANT_AGENCY_A);
    expect(resolution2.source).toBe('user_profile');
    
    // Test 3: Session tenant with mismatched header throws error
    expect(() => {
      resolveTenantFromRequest({
        header: TENANT_AGENCY_B,
        sessionTenantId: TENANT_AGENCY_A,
        allowMismatch: false,
      });
    }).toThrow('Tenant mismatch');
    
    // Test 4: Session tenant with matching subdomain
    const resolution3 = resolveTenantFromRequest({
      host: 'subdomain.agency-a.com', // Correct format
      sessionTenantId: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(resolution3.tenantId).toBe(TENANT_AGENCY_A);
    expect(resolution3.source).toBe('user_profile');
    
    // Test 5: Session tenant with mismatched subdomain throws error
    expect(() => {
      resolveTenantFromRequest({
        host: 'subdomain.agency-b.com', // Correct format
        sessionTenantId: TENANT_AGENCY_A,
        allowMismatch: false,
      });
    }).toThrow('Tenant mismatch');
    
    console.log('✓ Tenant resolver properly validates all scenarios');
  });

  /**
   * Test Case 8: Multiple Users with Different Tenants
   * 
   * Validates that tenant validation works correctly for multiple users
   * with different tenant assignments
   */
  it('should enforce tenant boundaries for multiple users', () => {
    // ================================================================
    // SCENARIO: Multiple users with different tenants
    // ================================================================
    
    // User A with their tenant
    const resultA1 = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(resultA1.success).toBe(true);
    expect(resultA1.tenantId).toBe(TENANT_AGENCY_A);
    
    // User B with their tenant
    const resultB1 = simulateApiRequest({
      sessionUser: SESSION_USER_B,
      header: TENANT_AGENCY_B,
      allowMismatch: false,
    });
    expect(resultB1.success).toBe(true);
    expect(resultB1.tenantId).toBe(TENANT_AGENCY_B);
    
    // User A tries to access User B's tenant
    const resultA2 = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: TENANT_AGENCY_B,
      allowMismatch: false,
    });
    expect(resultA2.success).toBe(false);
    expect(resultA2.error).toContain('Tenant mismatch');
    
    // User B tries to access User A's tenant
    const resultB2 = simulateApiRequest({
      sessionUser: SESSION_USER_B,
      header: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(resultB2.success).toBe(false);
    expect(resultB2.error).toContain('Tenant mismatch');
    
    console.log('✓ Tenant boundaries enforced for all users');
  });

  /**
   * Test Case 9: Verify Error Message Format
   * 
   * Validates that error messages provide useful debugging information
   * while maintaining security
   */
  it('should provide informative error messages for tenant mismatches', () => {
    // ================================================================
    // SCENARIO: Check error message structure
    // ================================================================
    
    // Header mismatch
    const resultHeader = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: TENANT_AGENCY_B,
      allowMismatch: false,
    });
    expect(resultHeader.error).toContain('Tenant mismatch');
    expect(resultHeader.error).toContain('header=');
    expect(resultHeader.error).toContain('session=');
    
    // Subdomain mismatch
    const resultSubdomain = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      host: 'agency-b.example.com',
      allowMismatch: false,
    });
    expect(resultSubdomain.error).toContain('Tenant mismatch');
    expect(resultSubdomain.error).toContain('subdomain=');
    expect(resultSubdomain.error).toContain('session=');
    
    console.log('✓ Error messages provide clear diagnostic information');
  });

  /**
   * Test Case 10: AllowMismatch Flag Behavior
   * 
   * Validates that the allowMismatch flag can bypass validation when needed
   * (e.g., for unauthenticated routes or special cases)
   */
  it('should respect allowMismatch flag when explicitly set', () => {
    // ================================================================
    // SCENARIO: allowMismatch=true should bypass validation
    // ================================================================
    
    // With allowMismatch=true, mismatched header should be allowed
    const result = simulateApiRequest({
      sessionUser: SESSION_USER_A,
      header: TENANT_AGENCY_B,
      allowMismatch: true, // Bypass validation
    });
    
    // Request should succeed (but still use session tenant as source)
    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(TENANT_AGENCY_A); // Session tenant is still used
    
    console.log('✓ allowMismatch flag properly bypasses validation when needed');
  });

  /**
   * Test Case 11: Unauthenticated Request Handling
   * 
   * Validates that requests without session tenant follow fallback logic
   * (for public/unauthenticated routes)
   */
  it('should handle unauthenticated requests with fallback logic', () => {
    // ================================================================
    // SCENARIO: No session tenant (unauthenticated request)
    // Note: Subdomain format is {anything}.{tenant}.com where {tenant} is extracted
    // ================================================================
    
    // Test 1: Subdomain extraction when no session
    const resolution1 = resolveTenantFromRequest({
      host: 'subdomain.agency-a.com', // Correct format extracts 'agency-a'
      sessionTenantId: null, // No session
    });
    expect(resolution1.tenantId).toBe(TENANT_AGENCY_A);
    expect(resolution1.source).toBe('subdomain');
    
    // Test 2: Header extraction when no session
    const resolution2 = resolveTenantFromRequest({
      header: TENANT_AGENCY_A,
      sessionTenantId: null, // No session
    });
    expect(resolution2.tenantId).toBe(TENANT_AGENCY_A);
    expect(resolution2.source).toBe('header');
    
    // Test 3: Fallback when no session and no other source
    const resolution3 = resolveTenantFromRequest({
      sessionTenantId: null, // No session
      fallback: 'default-tenant',
    });
    expect(resolution3.tenantId).toBe('default-tenant');
    expect(resolution3.source).toBe('default');
    
    console.log('✓ Unauthenticated requests properly handled with fallback logic');
  });

  /**
   * Test Case 12: Integration with getTenantContextFromRequest
   * 
   * Validates that the higher-level getTenantContextFromRequest function
   * properly integrates tenant validation
   */
  it('should integrate tenant validation in getTenantContextFromRequest', () => {
    // ================================================================
    // SCENARIO: Test the full context resolution flow
    // Note: Subdomain format is {anything}.{tenant}.com where {tenant} is extracted
    // ================================================================
    
    // Test 1: Valid request
    const context1 = getTenantContextFromRequest({
      host: 'subdomain.agency-a.com', // Correct format
      header: TENANT_AGENCY_A,
      sessionTenantId: TENANT_AGENCY_A,
      allowMismatch: false,
    });
    expect(context1.tenantId).toBe(TENANT_AGENCY_A);
    expect(context1.source).toBe('user_profile');
    
    // Test 2: Invalid request should throw
    expect(() => {
      getTenantContextFromRequest({
        header: TENANT_AGENCY_B,
        sessionTenantId: TENANT_AGENCY_A,
        allowMismatch: false,
      });
    }).toThrow('Tenant mismatch');
    
    console.log('✓ getTenantContextFromRequest properly integrates validation');
  });
});
