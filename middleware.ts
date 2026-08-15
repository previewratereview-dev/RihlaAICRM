import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareClient, copyResponseCookies } from '@/lib/supabase/middleware';
import {
  DEFAULT_SESSION_POLICY,
  SESSION_ACTIVITY_COOKIE,
  evaluateSession,
  parseActivity,
  serializeActivity,
  startSession,
  touchSession,
  type SessionExpiryReason,
} from '@/lib/security/session-manager';

/**
 * Route_Protection_Middleware (Requirements 9.1, 9.2, 9.3, 9.4).
 *
 * Runs before every application and API route handler (per the matcher below)
 * and:
 *  - verifies authentication using a server-validated Supabase session
 *    (9.2); unauthenticated requests to protected routes are denied before the
 *    handler executes (9.3) — 401 for API routes, redirect to /login for pages;
 *  - enforces the session manager's 30-minute inactivity timeout and 24-hour
 *    absolute lifetime, requiring re-authentication once either is exceeded
 *    (9.1).
 *
 * Per-request authorization (permissions + server-resolved tenant) remains the
 * responsibility of the API_Guard inside each handler (9.4); this middleware is
 * the authentication gate that precedes it.
 */

/**
 * Public page routes reachable without authentication.
 * Includes marketing/landing pages and auth routes.
 */
const PUBLIC_PAGE_PREFIXES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/auth',
  '/pricing',
  '/about',
  '/privacy',
  '/terms',
];

/**
 * Public API prefixes. Inbound provider webhooks authenticate via per-tenant
 * signature verification (Requirement 5.6/5.7), not a user session, so they are
 * not gated by this authentication middleware.
 */
const PUBLIC_API_PREFIXES = [
  '/api/webhooks',
  '/api/register',
  '/api/auth',
  '/api/inngest',
  '/api/health',
];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isPublicPath(pathname: string): boolean {
  return (
    matchesPrefix(pathname, PUBLIC_PAGE_PREFIXES) || matchesPrefix(pathname, PUBLIC_API_PREFIXES)
  );
}

/** Validate that a redirect path is relative (no protocol/host). */
function safeRedirectPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return '/';
  }
  return path;
}

/** Deny an unauthenticated request to a protected route (9.3). */
function denyUnauthenticated(request: NextRequest, pathname: string): NextResponse {
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('redirect', safeRedirectPath(pathname));
  return NextResponse.redirect(url);
}

/** Deny a request whose session has exceeded an inactivity/absolute limit (9.1). */
function denyExpired(
  request: NextRequest,
  pathname: string,
  reason: SessionExpiryReason | null,
): NextResponse {
  if (isApiPath(pathname)) {
    return NextResponse.json(
      { error: 'Session expired', reason: reason ?? 'expired' },
      { status: 401 },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('reason', reason ?? 'expired');
  url.searchParams.set('redirect', safeRedirectPath(pathname));
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const { supabase, holder } = createMiddlewareClient(request);
  // Server-validated authentication check — getUser revalidates with Supabase
  // rather than trusting an unverified cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const publicRoute = isPublicPath(pathname);

  if (!user) {
    // Unauthenticated: public routes pass through; protected routes are denied
    // before any handler runs (9.3).
    return publicRoute ? holder.response : denyUnauthenticated(request, pathname);
  }

  // Authenticated. Enforce the session lifetime policy (9.1) on protected
  // routes. Public routes (e.g. /login) are not lifetime-gated so an expired
  // user can reach the login screen.
  if (!publicRoute) {
    const now = Date.now();
    const existing = await parseActivity(request.cookies.get(SESSION_ACTIVITY_COOKIE)?.value);

    if (existing) {
      const evaluation = evaluateSession(existing, now, DEFAULT_SESSION_POLICY);
      if (!evaluation.valid) {
        // Inactivity or absolute lifetime exceeded — terminate the session and
        // require re-authentication.
        try {
          await supabase.auth.signOut();
        } catch {
          // Even if remote sign-out fails, we still deny and clear local state.
        }
        const denied = denyExpired(request, pathname, evaluation.reason);
        copyResponseCookies(holder.response, denied);
        denied.cookies.delete(SESSION_ACTIVITY_COOKIE);
        return denied;
      }
    }

    // Enforce subscription expiration for non-admin, non-super-admin users
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', user.id)
      .single();

    if (profile && profile.tenant_id !== 'global' && profile.role !== 'admin' && profile.role !== 'super_admin') {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, plan, trial_end')
        .eq('tenant_id', profile.tenant_id)
        .single();

      // A subscription is considered expired if it has no row, is past-due/cancelled,
      // or is a trial that has passed its trial_end date. Active trials (not yet
      // expired) and active/paid subscriptions are allowed through.
      const trialExpired =
        sub?.status === 'trialing' && sub.trial_end && new Date(sub.trial_end).getTime() < Date.now();
      const isExpiredOrFree =
        !sub
        || sub.status === 'past_due'
        || sub.status === 'expired'
        || sub.status === 'cancelled'
        || trialExpired
        || sub.plan === 'free';

      if (isExpiredOrFree) {
        try {
          await supabase.auth.signOut();
        } catch {}
        const denied = denyExpired(request, pathname, 'subscription_expired');
        copyResponseCookies(holder.response, denied);
        denied.cookies.delete(SESSION_ACTIVITY_COOKIE);
        return denied;
      }
    }

    // Valid (or brand-new) session: advance the inactivity anchor and persist
    // the activity cookie on the (possibly cookie-refreshed) Supabase response.
    const activity = existing ? touchSession(existing, now) : startSession(now);
    const signedValue = await serializeActivity(activity);
    holder.response.cookies.set(SESSION_ACTIVITY_COOKIE, signedValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(DEFAULT_SESSION_POLICY.absoluteLifetimeMs / 1000),
    });
  }

  return holder.response;
}

export const config = {
  /**
   * Run on every route except Next.js internals and static assets, so the
   * authentication gate covers all application pages and API routes while
   * leaving public static files untouched.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff|woff2|ttf)$).*)',
  ],
};
