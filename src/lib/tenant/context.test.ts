import { describe, it, expect } from 'vitest';
import { getTenantContextFromRequest } from './context';

describe('getTenantContextFromRequest', () => {
  describe('with sessionTenantId parameter', () => {
    it('should return session tenant when sessionTenantId is provided', () => {
      const result = getTenantContextFromRequest({
        sessionTenantId: 'agency-a',
        host: 'app.agency-a.com',
        allowMismatch: true, // Allow mismatches for this test
        header: 'agency-b',
      });

      expect(result.tenantId).toBe('agency-a');
      expect(result.source).toBe('user_profile');
    });

    it('should throw error when subdomain mismatches session tenant and allowMismatch is false', () => {
      expect(() => {
        getTenantContextFromRequest({
          sessionTenantId: 'agency-a',
          host: 'app.agency-b.com',
          allowMismatch: false,
        });
      }).toThrow('Tenant mismatch: subdomain=agency-b, session=agency-a');
    });

    it('should throw error when header mismatches session tenant and allowMismatch is false', () => {
      expect(() => {
        getTenantContextFromRequest({
          sessionTenantId: 'agency-a',
          header: 'agency-b',
          allowMismatch: false,
        });
      }).toThrow('Tenant mismatch: header=agency-b, session=agency-a');
    });

    it('should allow mismatch when allowMismatch is true', () => {
      const result = getTenantContextFromRequest({
        sessionTenantId: 'agency-a',
        host: 'app.agency-b.com',
        header: 'agency-c',
        allowMismatch: true,
      });

      expect(result.tenantId).toBe('agency-a');
      expect(result.source).toBe('user_profile');
    });
  });

  describe('without sessionTenantId parameter', () => {
    it('should extract tenant from subdomain when no session provided', () => {
      const result = getTenantContextFromRequest({
        host: 'app.agency-a.com',
      });

      expect(result.tenantId).toBe('agency-a');
      expect(result.source).toBe('subdomain');
    });

    it('should extract tenant from header when no subdomain and no session', () => {
      const result = getTenantContextFromRequest({
        header: 'agency-b',
      });

      expect(result.tenantId).toBe('agency-b');
      expect(result.source).toBe('header');
    });

    it('should use fallback when no tenant sources available', () => {
      const result = getTenantContextFromRequest({
        fallback: 'default-tenant',
      });

      expect(result.tenantId).toBe('default-tenant');
      expect(result.source).toBe('default');
    });
  });

  describe('userId and userRole passthrough', () => {
    it('should pass through userId and userRole to context', () => {
      const result = getTenantContextFromRequest({
        sessionTenantId: 'agency-a',
        userId: 'user-123',
        userRole: 'admin',
      });

      expect(result.userId).toBe('user-123');
      expect(result.userRole).toBe('admin');
      expect(result.tenantId).toBe('agency-a');
    });
  });
});
