import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// Mock the API_Guard so we can drive auth/permission outcomes deterministically.
vi.mock('./api-guard', () => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
}));

import { requireAuth, requirePermission } from './api-guard';
import { guardRoute } from './route-guard';
import {
  setRateLimitStore,
  type RateLimitStore,
  type RateLimitOutcome,
} from '@/lib/rate-limit';

const requireAuthMock = vi.mocked(requireAuth);
const requirePermissionMock = vi.mocked(requirePermission);

/** Minimal NextRequest stub exposing only the headers the guard reads. */
function makeRequest(headers: Record<string, string | null> = {}): NextRequest {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

const SESSION_USER = {
  id: 'user-1',
  email: 'a@example.com',
  fullName: 'A',
  role: 'agency_admin',
  tenantId: 'agency-a',
  avatarUrl: '',
} as const;

function authOk() {
  requireAuthMock.mockResolvedValue({ user: { ...SESSION_USER }, tenantId: 'agency-a' } as never);
  requirePermissionMock.mockResolvedValue({ user: { ...SESSION_USER }, tenantId: 'agency-a' } as never);
}

/** Fake shared store: returns a fixed count, or throws to simulate an outage. */
class FakeStore implements RateLimitStore {
  constructor(private outcome: RateLimitOutcome | Error) {}
  async hit(): Promise<RateLimitOutcome> {
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: under limit.
  setRateLimitStore(new FakeStore({ count: 1, resetAt: Date.now() + 60_000 }));
});

describe('guardRoute — consistent auth + rate limit + tenant scope (9.2, 9.4, 9.7, 8.2)', () => {
  it('returns the session user and server-resolved tenant on success', async () => {
    authOk();
    const result = await guardRoute(makeRequest(), { scope: 'test' });
    expect(result).toEqual({ user: expect.objectContaining({ id: 'user-1' }), tenantId: 'agency-a' });
  });

  it('uses requirePermission when a permission is supplied (9.4)', async () => {
    authOk();
    await guardRoute(makeRequest(), { scope: 'test', permission: 'settings:agency:read' });
    expect(requirePermissionMock).toHaveBeenCalledWith(expect.anything(), 'settings:agency:read');
    expect(requireAuthMock).not.toHaveBeenCalled();
  });

  it('propagates the guard 401 for an unauthenticated request', async () => {
    requireAuthMock.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const result = await guardRoute(makeRequest(), { scope: 'test' });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('propagates the guard 403 when a permission check fails (9.4)', async () => {
    requirePermissionMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as never,
    );
    const result = await guardRoute(makeRequest(), { scope: 'test', permission: 'settings:agency:read' });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('returns 429 when the shared-window limit is exceeded (9.7)', async () => {
    authOk();
    setRateLimitStore(new FakeStore({ count: 101, resetAt: Date.now() + 60_000 }));
    const result = await guardRoute(makeRequest(), { scope: 'test', limit: 100 });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(429);
  });

  it('fails closed with 503 when the shared store is unavailable (9.12)', async () => {
    authOk();
    setRateLimitStore(new FakeStore(new Error('store down')));
    const result = await guardRoute(makeRequest(), { scope: 'test' });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(503);
  });

  it('denies with 403 when a client tenant hint disagrees with the session (8.2/8.5)', async () => {
    authOk();
    const result = await guardRoute(makeRequest({ 'x-tenant-id': 'agency-b' }), { scope: 'test' });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('tolerates a cross-tenant hint when allowTenantMismatch is set (platform endpoints)', async () => {
    authOk();
    const result = await guardRoute(
      makeRequest({ 'x-tenant-id': 'agency-b' }),
      { scope: 'test', allowTenantMismatch: true },
    );
    expect(result).toEqual({ user: expect.objectContaining({ id: 'user-1' }), tenantId: 'agency-a' });
  });
});
