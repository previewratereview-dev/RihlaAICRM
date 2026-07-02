import { describe, it, expect } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveServiceRouteTenant } from './service-route';

/**
 * Builds a minimal NextRequest-like stub exposing only the headers the resolver reads.
 */
function makeRequest(headers: Record<string, string | null>): NextRequest {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe('resolveServiceRouteTenant', () => {
  it('returns the server-resolved tenant when the session tenant is present and nothing conflicts (8.4)', () => {
    const req = makeRequest({ host: null, 'x-tenant-id': null });
    const result = resolveServiceRouteTenant(req, 'agency-a');
    expect(result).toEqual({ tenantId: 'agency-a' });
  });

  it('trusts the session tenant over a client-supplied header that matches (8.5)', () => {
    const req = makeRequest({ host: null, 'x-tenant-id': 'agency-a' });
    const result = resolveServiceRouteTenant(req, 'agency-a');
    expect(result).toEqual({ tenantId: 'agency-a' });
  });

  it('denies with 403 when no tenant can be resolved from the session (8.6)', () => {
    const req = makeRequest({ host: null, 'x-tenant-id': 'agency-a' });
    const result = resolveServiceRouteTenant(req, null);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('denies with 403 when the session tenant is blank/whitespace (8.6)', () => {
    const req = makeRequest({ host: null, 'x-tenant-id': null });
    const result = resolveServiceRouteTenant(req, '   ');
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('rejects a client header that disagrees with the session tenant (8.5)', () => {
    const req = makeRequest({ host: null, 'x-tenant-id': 'agency-b' });
    const result = resolveServiceRouteTenant(req, 'agency-a');
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('rejects a subdomain hint that disagrees with the session tenant (8.5)', () => {
    const req = makeRequest({ host: 'sub.agency-b.com', 'x-tenant-id': null });
    const result = resolveServiceRouteTenant(req, 'agency-a');
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });
});
