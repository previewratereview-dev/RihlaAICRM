import { describe, it, expect } from 'vitest';
import { resolveTenantFromRequest, resolveTenantFromSubdomain } from './resolver';

describe('resolveTenantFromSubdomain', () => {
  it('should extract second-level domain part as tenant', () => {
    // The function extracts the second part of the domain (after the first subdomain)
    // For 'acme.example.com', it returns 'example' (the app name)
    expect(resolveTenantFromSubdomain('acme.example.com')).toBe('example');
  });

  it('should return null for invalid hosts', () => {
    expect(resolveTenantFromSubdomain(null)).toBe(null);
    expect(resolveTenantFromSubdomain('example.com')).toBe(null);
  });

  it('should filter out www and api prefixes', () => {
    // When the second-level part is 'www' or 'api', return null
    expect(resolveTenantFromSubdomain('tenant.www.example.com')).toBe(null);
    expect(resolveTenantFromSubdomain('tenant.api.example.com')).toBe(null);
  });
});

describe('resolveTenantFromRequest', () => {
  describe('with sessionTenantId provided', () => {
    it('should return sessionTenantId with user_profile source', () => {
      const result = resolveTenantFromRequest({
        sessionTenantId: 'agency-a',
        host: 'subdomain.agency-a.com',
      });
      expect(result).toEqual({
        tenantId: 'agency-a',
        source: 'user_profile',
      });
    });

    it('should throw error when subdomain mismatches sessionTenantId and allowMismatch is false', () => {
      expect(() => {
        resolveTenantFromRequest({
          sessionTenantId: 'agency-a',
          host: 'subdomain.agency-b.com',
          allowMismatch: false,
        });
      }).toThrow('Tenant mismatch: subdomain=agency-b, session=agency-a');
    });

    it('should throw error when header mismatches sessionTenantId and allowMismatch is false', () => {
      expect(() => {
        resolveTenantFromRequest({
          sessionTenantId: 'agency-a',
          header: 'agency-b',
          allowMismatch: false,
        });
      }).toThrow('Tenant mismatch: header=agency-b, session=agency-a');
    });

    it('should allow mismatch when allowMismatch is true', () => {
      const result = resolveTenantFromRequest({
        sessionTenantId: 'agency-a',
        host: 'subdomain.agency-b.com',
        allowMismatch: true,
      });
      expect(result).toEqual({
        tenantId: 'agency-a',
        source: 'user_profile',
      });
    });

    it('should not throw when subdomain/header are not provided', () => {
      const result = resolveTenantFromRequest({
        sessionTenantId: 'agency-a',
        allowMismatch: false,
      });
      expect(result).toEqual({
        tenantId: 'agency-a',
        source: 'user_profile',
      });
    });
  });

  describe('without sessionTenantId (unauthenticated flow)', () => {
    it('should extract tenant from subdomain', () => {
      const result = resolveTenantFromRequest({
        host: 'subdomain.acme.com',
      });
      expect(result).toEqual({
        tenantId: 'acme',
        source: 'subdomain',
      });
    });

    it('should extract tenant from header when subdomain is not available', () => {
      const result = resolveTenantFromRequest({
        header: 'acme-tenant',
      });
      expect(result).toEqual({
        tenantId: 'acme-tenant',
        source: 'header',
      });
    });

    it('should use fallback when no subdomain or header', () => {
      const result = resolveTenantFromRequest({
        fallback: 'default-tenant',
      });
      expect(result).toEqual({
        tenantId: 'default-tenant',
        source: 'default',
      });
    });

    it('should use global fallback by default when allowMismatch is true', () => {
      const result = resolveTenantFromRequest({
        allowMismatch: true,
      });
      expect(result).toEqual({
        tenantId: 'global',
        source: 'default',
      });
    });

    it('should throw error when fallback is global and allowMismatch is false', () => {
      expect(() => {
        resolveTenantFromRequest({
          allowMismatch: false,
        });
      }).toThrow('Tenant resolution failed: no valid tenant source and global fallback not allowed');
    });

    it('should allow custom fallback even when allowMismatch is false', () => {
      const result = resolveTenantFromRequest({
        fallback: 'custom-tenant',
        allowMismatch: false,
      });
      expect(result).toEqual({
        tenantId: 'custom-tenant',
        source: 'default',
      });
    });
  });

  describe('priority chain', () => {
    it('should prioritize subdomain over header', () => {
      const result = resolveTenantFromRequest({
        host: 'sub.subdomain-tenant.com',
        header: 'header-tenant',
      });
      expect(result).toEqual({
        tenantId: 'subdomain-tenant',
        source: 'subdomain',
      });
    });

    it('should prioritize sessionTenantId over subdomain and header', () => {
      const result = resolveTenantFromRequest({
        sessionTenantId: 'session-tenant',
        host: 'sub.subdomain-tenant.com',
        header: 'header-tenant',
        allowMismatch: true,
      });
      expect(result).toEqual({
        tenantId: 'session-tenant',
        source: 'user_profile',
      });
    });
  });
});
