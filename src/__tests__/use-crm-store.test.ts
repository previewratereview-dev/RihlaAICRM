import { describe, it, expect } from 'vitest';

/**
 * Property 9: CRM store auth delegation
 * Validates: Requirements 9.2, 9.3, 9.4, 9.6
 */
describe('CRM store auth delegation', () => {
  it('auth-slice.ts references getAuthAdapter() in login/logout/restoreSession', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../hooks/store/auth-slice.ts'),
      'utf-8'
    );

    // Should call getAuthAdapter() in the auth actions
    expect(source).toMatch(/getAuthAdapter\(\)/);
    // Should NOT call CRMDatabaseService.login directly
    expect(source).not.toMatch(/CRMDatabaseService\.login\(/);
    expect(source).not.toMatch(/CRMDatabaseService\.logout\(/);
    expect(source).not.toMatch(/CRMDatabaseService\.getCurrentUser\(/);
  });

  it('login action stores tenantId from user', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../hooks/store/auth-slice.ts'),
      'utf-8'
    );

    // Should set tenantId from user object
    expect(source).toMatch(/tenantId:\s*user\.tenantId/);
  });
});

/**
 * Property 10: tenantId threading through DB calls
 * Validates: Requirements 9.6, 7.2, 7.3
 */
describe('tenantId threading through DB calls', () => {
  it('syncData uses getActiveTenantId() for DB calls', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../hooks/store/auth-slice.ts'),
      'utf-8'
    );

    expect(source).toMatch(/getActiveTenantId\(get\(\)\)/);
  });

  it('getActiveTenantId returns tenantId without impersonation override', async () => {
    const { getActiveTenantId } = await import('../hooks/store/helpers');
    expect(getActiveTenantId({ tenantId: 'tenant-123' })).toBe('tenant-123');
    expect(() => getActiveTenantId({ tenantId: null })).toThrow('Tenant context is required');
  });
});
