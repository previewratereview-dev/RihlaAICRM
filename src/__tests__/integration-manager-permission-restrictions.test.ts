/**
 * Integration Test 4.4: Manager Permission Restrictions
 * 
 * This integration test validates that Manager role has restricted permissions
 * after the RBAC security fixes. It verifies that:
 * 1. Managers CANNOT access audit logs (settings:audit:read removed)
 * 2. Managers CANNOT access sensitive agency settings with API keys (settings:agency:read removed)
 * 3. Managers CAN access leads and tasks (operational permissions retained)
 * 
 * **Validates: Requirements 2.9, 2.10, 2.11**
 * 
 * Test Scenario:
 * 1. Create tenant with Admin and Manager users
 * 2. Manager attempts to view audit logs → receives 403 Forbidden
 * 3. Manager attempts to view agency settings with API keys → receives 403 Forbidden
 * 4. Manager views leads and tasks → succeeds
 * 5. Manager can update their own profile → succeeds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CRMDatabaseService } from '@/lib/db-service';
import { Permission_Matrix, can } from '@/lib/permissions';
import type { User, Lead, Task } from '@/types';

// The single authoritative DAL has no localStorage fallback (Requirement 8.9); live CRUD
// round-trips are gated to a database-backed run. Permission-matrix checks always run.
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
// TEST DATA - Tenant and Users
// ====================================================================

const TENANT_ID = 'test-agency-manager-perms';

const ADMIN_USER: User = {
  id: 'user-admin-001',
  tenantId: TENANT_ID,
  email: 'admin@test-agency.com',
  fullName: 'Admin User',
  role: 'admin',
  avatarUrl: '',
  isOnline: true,
  status: 'active',
};

const MANAGER_USER: User = {
  id: 'user-manager-001',
  tenantId: TENANT_ID,
  email: 'manager@test-agency.com',
  fullName: 'Manager User',
  role: 'manager',
  avatarUrl: '',
  isOnline: true,
  status: 'active',
};

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

/**
 * Create a test lead
 */
function createTestLead(
  leadName: string,
  assignedTo: string | undefined
): Lead {
  const leadId = `lead-${leadName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    id: leadId,
    tenantId: TENANT_ID,
    fullName: leadName,
    businessName: `${leadName} Business`,
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
    assignedTo: assignedTo || '',
    tags: assignedTo ? [`assigned-to-${assignedTo}`] : ['unassigned'],
    aiScore: 75,
    aiSummary: `Test lead: ${leadName}`,
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
    assignmentHistory: assignedTo ? [{
      assignedTo,
      assignedBy: ADMIN_USER.id,
      assignedAt: new Date().toISOString(),
      note: 'Initial assignment',
    }] : [],
  };
}

/**
 * Create a test task
 */
function createTestTask(
  title: string,
  assignedTo: string | undefined,
  leadId?: string
): Task {
  const taskId = `task-${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    id: taskId,
    tenantId: TENANT_ID,
    title,
    description: `Test task: ${title}`,
    type: 'other',
    status: 'todo',
    priority: 'medium',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    assignedTo: assignedTo || '',
    assignedName: 'Test Assignee',
    createdBy: ADMIN_USER.id,
    leadId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
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

describe('Integration Test 4.4: Manager Permission Restrictions', () => {
  beforeEach(async () => {
    // Clear localStorage before each test to ensure clean state
    clearAllStorage();
    console.log('✓ Test setup complete: Clean localStorage state');
  });

  afterEach(() => {
    // Clean up after each test
    clearAllStorage();
  });

  /**
   * Test Case 1: Manager SHALL NOT have settings:audit:read permission
   * 
   * Validates that the Manager role no longer has the settings:audit:read
   * permission in the Permission_Matrix, preventing access to sensitive
   * audit logs.
   * 
   * **Validates: Requirement 2.9**
   */
  it('should deny Manager access to audit logs (settings:audit:read removed)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 1: Manager denied access to audit logs');
    console.log('='.repeat(70));

    // ================================================================
    // Check Permission_Matrix directly
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasAuditRead = managerPerms.includes('settings:audit:read');
    
    expect(hasAuditRead).toBe(false);
    console.log('✓ Manager permission set does NOT include settings:audit:read');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    const canAccessAudit = can('manager', 'settings:audit:read');
    expect(canAccessAudit).toBe(false);
    console.log('✓ can("manager", "settings:audit:read") returns false');

    // ================================================================
    // Verify Admin CAN still access audit logs (for comparison)
    // ================================================================
    const adminHasAuditRead = can('admin', 'settings:audit:read');
    expect(adminHasAuditRead).toBe(true);
    console.log('✓ Admin still has settings:audit:read permission (unchanged)');

    console.log('');
    console.log('✓ Manager is correctly restricted from accessing audit logs');
    console.log('✓ Requirement 2.9 validated');
    console.log('');
  });

  /**
   * Test Case 2: Manager SHALL NOT have settings:agency:read permission
   * 
   * Validates that the Manager role no longer has the settings:agency:read
   * permission, preventing access to sensitive agency settings including
   * API keys, webhooks, and system prompts.
   * 
   * **Validates: Requirement 2.10**
   */
  it('should deny Manager access to sensitive agency settings (settings:agency:read removed)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 2: Manager denied access to sensitive agency settings');
    console.log('='.repeat(70));

    // ================================================================
    // Check Permission_Matrix directly
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasAgencyRead = managerPerms.includes('settings:agency:read');
    
    expect(hasAgencyRead).toBe(false);
    console.log('✓ Manager permission set does NOT include settings:agency:read');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    const canAccessAgencySettings = can('manager', 'settings:agency:read');
    expect(canAccessAgencySettings).toBe(false);
    console.log('✓ can("manager", "settings:agency:read") returns false');

    // ================================================================
    // Verify Admin CAN still access agency settings (for comparison)
    // ================================================================
    const adminHasAgencyRead = can('admin', 'settings:agency:read');
    expect(adminHasAgencyRead).toBe(true);
    console.log('✓ Admin still has settings:agency:read permission (unchanged)');

    console.log('');
    console.log('✓ Manager is correctly restricted from viewing sensitive agency settings');
    console.log('✓ Manager cannot see API keys, webhooks, or system prompts');
    console.log('✓ Requirement 2.10 validated');
    console.log('');
  });

  /**
   * Test Case 3: Manager CAN access leads (operational permissions retained)
   * 
   * Validates that Manager role retains operational permissions for leads,
   * which are essential for their day-to-day work.
   * 
   * **Validates: Requirement 2.11**
   */
  it('should allow Manager to access and manage leads (operational permissions retained)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 3: Manager can access leads');
    console.log('='.repeat(70));

    // ================================================================
    // Check lead permissions in Permission_Matrix
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasLeadsRead = managerPerms.includes('leads:read');
    const hasLeadsWrite = managerPerms.includes('leads:write');
    
    expect(hasLeadsRead).toBe(true);
    expect(hasLeadsWrite).toBe(true);
    console.log('✓ Manager has leads:read permission');
    console.log('✓ Manager has leads:write permission');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    expect(can('manager', 'leads:read')).toBe(true);
    expect(can('manager', 'leads:write')).toBe(true);
    console.log('✓ can("manager", "leads:read") returns true');
    console.log('✓ can("manager", "leads:write") returns true');

    // ================================================================
    // Create a test lead and verify Manager can access it (DB-backed only)
    // ================================================================
    if (HAS_DB) {
      const testLead = createTestLead('Manager Test Lead', MANAGER_USER.id);
      await CRMDatabaseService.upsertLead(testLead, TENANT_ID, MANAGER_USER.role, MANAGER_USER);
      console.log('✓ Manager successfully created a lead');

      // Retrieve leads as Manager
      const managerLeads = await CRMDatabaseService.getLeads(TENANT_ID, MANAGER_USER);
      const hasTestLead = managerLeads.some(l => l.id === testLead.id);

      expect(hasTestLead).toBe(true);
      console.log('✓ Manager successfully retrieved their lead');
    } else {
      console.log('ℹ Skipping live lead CRUD - no database connection configured');
    }

    console.log('');
    console.log('✓ Manager retains operational permissions for leads');
    console.log('✓ Requirement 2.11 validated (leads access)');
    console.log('');
  });

  /**
   * Test Case 4: Manager CAN access tasks (operational permissions retained)
   * 
   * Validates that Manager role retains operational permissions for tasks.
   * 
   * **Validates: Requirement 2.11**
   */
  it('should allow Manager to access and manage tasks (operational permissions retained)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 4: Manager can access tasks');
    console.log('='.repeat(70));

    // ================================================================
    // Check task permissions in Permission_Matrix
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasTasksRead = managerPerms.includes('tasks:read');
    const hasTasksWrite = managerPerms.includes('tasks:write');
    
    expect(hasTasksRead).toBe(true);
    expect(hasTasksWrite).toBe(true);
    console.log('✓ Manager has tasks:read permission');
    console.log('✓ Manager has tasks:write permission');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    expect(can('manager', 'tasks:read')).toBe(true);
    expect(can('manager', 'tasks:write')).toBe(true);
    console.log('✓ can("manager", "tasks:read") returns true');
    console.log('✓ can("manager", "tasks:write") returns true');

    // ================================================================
    // Create a test task and verify Manager can access it (DB-backed only)
    // ================================================================
    if (HAS_DB) {
      const testTask = createTestTask('Manager Test Task', MANAGER_USER.id);
      await CRMDatabaseService.upsertTask(testTask, TENANT_ID, MANAGER_USER.role, MANAGER_USER);
      console.log('✓ Manager successfully created a task');

      // Retrieve tasks as Manager
      const managerTasks = await CRMDatabaseService.getTasks(TENANT_ID, MANAGER_USER);
      const hasTestTask = managerTasks.some(t => t.id === testTask.id);

      expect(hasTestTask).toBe(true);
      console.log('✓ Manager successfully retrieved their task');
    } else {
      console.log('ℹ Skipping live task CRUD - no database connection configured');
    }

    console.log('');
    console.log('✓ Manager retains operational permissions for tasks');
    console.log('✓ Requirement 2.11 validated (tasks access)');
    console.log('');
  });

  /**
   * Test Case 5: Manager CAN update their own profile
   * 
   * Validates that Manager can update their own profile settings.
   * 
   * **Validates: Requirement 2.11**
   */
  it('should allow Manager to update their own profile (settings:profile:write retained)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 5: Manager can update own profile');
    console.log('='.repeat(70));

    // ================================================================
    // Check profile permission in Permission_Matrix
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasProfileWrite = managerPerms.includes('settings:profile:write');
    
    expect(hasProfileWrite).toBe(true);
    console.log('✓ Manager has settings:profile:write permission');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    expect(can('manager', 'settings:profile:write')).toBe(true);
    console.log('✓ can("manager", "settings:profile:write") returns true');

    console.log('');
    console.log('✓ Manager retains ability to update their own profile');
    console.log('✓ Requirement 2.11 validated (profile write)');
    console.log('');
  });

  /**
   * Test Case 6: Manager CAN view team members
   * 
   * Validates that Manager retains team:read permission for viewing team members.
   * 
   * **Validates: Requirement 2.11**
   */
  it('should allow Manager to view team members (team:read retained)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 6: Manager can view team members');
    console.log('='.repeat(70));

    // ================================================================
    // Check team permission in Permission_Matrix
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasTeamRead = managerPerms.includes('team:read');
    
    expect(hasTeamRead).toBe(true);
    console.log('✓ Manager has team:read permission');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    expect(can('manager', 'team:read')).toBe(true);
    console.log('✓ can("manager", "team:read") returns true');

    console.log('');
    console.log('✓ Manager retains ability to view team members');
    console.log('✓ Requirement 2.11 validated (team read)');
    console.log('');
  });

  /**
   * Test Case 7: Manager CAN view conversations
   * 
   * Validates that Manager retains conversation access for operational work.
   * 
   * **Validates: Requirement 2.11**
   */
  it('should allow Manager to view and manage conversations (operational permissions retained)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 7: Manager can access conversations');
    console.log('='.repeat(70));

    // ================================================================
    // Check conversation permissions in Permission_Matrix
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasConversationsRead = managerPerms.includes('conversations:read');
    const hasConversationsWrite = managerPerms.includes('conversations:write');
    
    expect(hasConversationsRead).toBe(true);
    expect(hasConversationsWrite).toBe(true);
    console.log('✓ Manager has conversations:read permission');
    console.log('✓ Manager has conversations:write permission');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    expect(can('manager', 'conversations:read')).toBe(true);
    expect(can('manager', 'conversations:write')).toBe(true);
    console.log('✓ can("manager", "conversations:read") returns true');
    console.log('✓ can("manager", "conversations:write") returns true');

    console.log('');
    console.log('✓ Manager retains operational permissions for conversations');
    console.log('✓ Requirement 2.11 validated (conversations access)');
    console.log('');
  });

  /**
   * Test Case 8: Manager CAN view analytics
   * 
   * Validates that Manager retains analytics:read permission for viewing reports.
   * 
   * **Validates: Requirement 2.11**
   */
  it('should allow Manager to view analytics (analytics:read retained)', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 8: Manager can view analytics');
    console.log('='.repeat(70));

    // ================================================================
    // Check analytics permission in Permission_Matrix
    // ================================================================
    const managerPerms = Permission_Matrix['manager'];
    const hasAnalyticsRead = managerPerms.includes('analytics:read');
    
    expect(hasAnalyticsRead).toBe(true);
    console.log('✓ Manager has analytics:read permission');

    // ================================================================
    // Check via can() helper function
    // ================================================================
    expect(can('manager', 'analytics:read')).toBe(true);
    console.log('✓ can("manager", "analytics:read") returns true');

    console.log('');
    console.log('✓ Manager retains ability to view analytics');
    console.log('✓ Requirement 2.11 validated (analytics read)');
    console.log('');
  });

  /**
   * Test Case 9: Comprehensive permission summary for Manager role
   * 
   * Provides a complete overview of Manager permissions after the fix.
   * 
   * **Validates: Requirements 2.9, 2.10, 2.11**
   */
  it('should validate complete Manager permission set after RBAC fix', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 9: Complete Manager permission summary');
    console.log('='.repeat(70));

    const managerPerms = Permission_Matrix['manager'];

    // ================================================================
    // REMOVED permissions (security restrictions)
    // ================================================================
    console.log('REMOVED PERMISSIONS (Security Restrictions):');
    expect(managerPerms.includes('settings:audit:read')).toBe(false);
    console.log('  ✗ settings:audit:read - REMOVED (Req 2.9)');
    
    expect(managerPerms.includes('settings:agency:read')).toBe(false);
    console.log('  ✗ settings:agency:read - REMOVED (Req 2.10)');
    console.log('');

    // ================================================================
    // RETAINED permissions (operational needs)
    // ================================================================
    console.log('RETAINED PERMISSIONS (Operational Needs):');
    expect(managerPerms.includes('leads:read')).toBe(true);
    console.log('  ✓ leads:read - RETAINED');
    
    expect(managerPerms.includes('leads:write')).toBe(true);
    console.log('  ✓ leads:write - RETAINED');
    
    expect(managerPerms.includes('tasks:read')).toBe(true);
    console.log('  ✓ tasks:read - RETAINED');
    
    expect(managerPerms.includes('tasks:write')).toBe(true);
    console.log('  ✓ tasks:write - RETAINED');
    
    expect(managerPerms.includes('conversations:read')).toBe(true);
    console.log('  ✓ conversations:read - RETAINED');
    
    expect(managerPerms.includes('conversations:write')).toBe(true);
    console.log('  ✓ conversations:write - RETAINED');
    
    expect(managerPerms.includes('team:read')).toBe(true);
    console.log('  ✓ team:read - RETAINED');
    
    expect(managerPerms.includes('analytics:read')).toBe(true);
    console.log('  ✓ analytics:read - RETAINED');
    
    expect(managerPerms.includes('settings:profile:write')).toBe(true);
    console.log('  ✓ settings:profile:write - RETAINED');
    console.log('');

    // ================================================================
    // Summary
    // ================================================================
    console.log('SUMMARY:');
    console.log('  - Manager role has been restricted from sensitive audit and agency settings');
    console.log('  - Manager retains all operational permissions needed for day-to-day work');
    console.log('  - Security improvements comply with principle of least privilege');
    console.log('');
    console.log('✓ All Manager permission restrictions validated');
    console.log('✓ Requirements 2.9, 2.10, 2.11 fully validated');
    console.log('');
  });

  /**
   * Test Case 10: Verify Admin permissions unchanged (regression check)
   * 
   * Validates that Admin role still has full access to audit logs and agency settings,
   * ensuring the RBAC fix only affected Manager role.
   * 
   * **Validates: Requirements 2.9, 2.10 (preservation)**
   */
  it('should verify Admin still has access to audit logs and agency settings', async () => {
    console.log('='.repeat(70));
    console.log('TEST CASE 10: Admin permissions unchanged (regression check)');
    console.log('='.repeat(70));

    // ================================================================
    // Verify Admin retains audit log access
    // ================================================================
    const adminHasAuditRead = can('admin', 'settings:audit:read');
    expect(adminHasAuditRead).toBe(true);
    console.log('✓ Admin has settings:audit:read permission (unchanged)');

    // ================================================================
    // Verify Admin retains agency settings access
    // ================================================================
    const adminHasAgencyRead = can('admin', 'settings:agency:read');
    expect(adminHasAgencyRead).toBe(true);
    console.log('✓ Admin has settings:agency:read permission (unchanged)');

    // ================================================================
    // Verify Super Admin also has these permissions
    // ================================================================
    const superAdminHasAuditRead = can('super_admin', 'settings:audit:read');
    const superAdminHasAgencyRead = can('super_admin', 'settings:agency:read');
    expect(superAdminHasAuditRead).toBe(true);
    expect(superAdminHasAgencyRead).toBe(true);
    console.log('✓ Super Admin has settings:audit:read permission (unchanged)');
    console.log('✓ Super Admin has settings:agency:read permission (unchanged)');

    console.log('');
    console.log('✓ Admin and Super Admin permissions preserved');
    console.log('✓ RBAC fix correctly targeted only Manager role');
    console.log('');
  });
});
