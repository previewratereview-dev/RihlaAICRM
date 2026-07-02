import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth, requirePermission, type SessionUser } from './api-guard';
import {
  buildRateLimitKey,
  checkRateLimit,
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
} from '@/lib/rate-limit';
import { getTenantContextFromRequest } from '@/lib/tenant/context';
import type { Permission } from '@/types/common';

/**
 * guardRoute — the single, consistent entry gate for protected API routes
 * (Requirements 9.2, 9.4, 9.7, 8.2).
 *
 * Every protected application/API route runs three controls, in order, before
 * its handler logic executes:
 *
 *  1. **API_Guard authorization** — server-side authentication on every request
 *     (9.4), optionally extended with a permission check. This complements the
 *     {@link middleware} authentication gate that already runs before the
 *     handler (9.2): even if the middleware is bypassed (e.g. matcher gaps, or a
 *     handler invoked outside the request pipeline), the guard re-validates the
 *     session here.
 *  2. **Shared rate limiter** — a fixed-window limit keyed per-User+Tenant_Id
 *     using the shared store, so limits are consistent across serverless
 *     instances (9.7). Fails closed with a 503 when the store is unavailable
 *     (9.12) and returns a 429 once the window limit is exceeded.
 *  3. **Server-resolved tenant scope** — the Tenant_Id is resolved from the
 *     authenticated session, never trusted from the client (8.2, 8.5). A
 *     client-supplied subdomain/header that disagrees with the session tenant,
 *     or a request that cannot be associated with a tenant, is denied with a
 *     403 authorization error rather than throwing (8.6).
 *
 * On success it returns the resolved {@link SessionUser} and server-resolved
 * `tenantId`; on any failure it returns the {@link NextResponse} the caller
 * should return as-is.
 */
export interface GuardOptions {
  /**
   * Rate-limit scope label (e.g. `'ai-complete'`, `'faq'`). Distinct scopes
   * keep per-route windows independent.
   */
  scope: string;
  /**
   * Permission required for the route. When omitted, only authentication is
   * required (any authenticated tenant user may proceed).
   */
  permission?: Permission;
  /** Fixed-window request limit. Defaults to the platform default (100). */
  limit?: number;
  /** Window size in milliseconds. Defaults to the platform default (60s). */
  windowMs?: number;
  /**
   * Allow a client-supplied tenant hint to differ from the session tenant. Only
   * platform-level endpoints that legitimately operate cross-tenant set this;
   * tenant-scoped routes leave it `false` so a mismatch is denied (8.5).
   */
  allowTenantMismatch?: boolean;
}

export interface GuardSuccess {
  user: SessionUser;
  /** Server-resolved Tenant_Id — safe to scope every query by (8.2). */
  tenantId: string;
}

export type GuardResult = GuardSuccess | NextResponse;

export async function guardRoute(
  request: NextRequest,
  options: GuardOptions,
): Promise<GuardResult> {
  // 1. Authentication + (optional) authorization on every request (9.4).
  const auth = options.permission
    ? await requirePermission(request, options.permission)
    : await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // 2. Shared-store rate limiting (9.7), failing closed when unavailable (9.12).
  const key = buildRateLimitKey({
    scope: options.scope,
    userId: auth.user.id,
    tenantId: auth.user.tenantId,
    ip: request.headers.get('x-forwarded-for'),
  });
  const limit = await checkRateLimit(
    key,
    options.limit ?? DEFAULT_RATE_LIMIT,
    options.windowMs ?? DEFAULT_WINDOW_MS,
  );
  if (limit.storeUnavailable) {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: limit.retryAfterMs
          ? { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) }
          : undefined,
      },
    );
  }

  // 3. Server-resolved tenant scope (8.2, 8.5, 8.6). Resolution failures and
  // client/session mismatches become a 403 authorization error, never an
  // uncaught 500.
  try {
    const context = getTenantContextFromRequest({
      host: request.headers.get('host'),
      header: request.headers.get('x-tenant-id'),
      sessionTenantId: auth.user.tenantId,
      allowMismatch: options.allowTenantMismatch ?? false,
    });

    if (!context.tenantId || !context.tenantId.trim()) {
      return NextResponse.json(
        { error: 'Tenant context could not be resolved' },
        { status: 403 },
      );
    }

    return { user: auth.user, tenantId: context.tenantId };
  } catch {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }
}
