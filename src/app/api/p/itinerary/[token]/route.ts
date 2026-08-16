/**
 * Phase AI-5B.3: Public Itinerary Share Portal API
 *
 * GET /api/p/itinerary/[token]
 *
 * Resolves a share token to a customer-safe itinerary view.
 * No authentication required — capability-based access via the token itself.
 *
 * Security:
 * - Token is hashed server-side before DB lookup (never stored raw)
 * - Response headers: no-store, no-cache, noindex, no-referrer
 * - Rate limited: 30 requests per minute per IP
 * - Returns 404 for all error types (no information leakage)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { SHARE_TOKEN_REGEX } from '@/lib/quotes-itineraries/sharing';

// Simple in-memory rate limiter (per-IP, sliding window)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodic cleanup of stale rate limit entries
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap.entries()) {
      if (now >= val.resetAt) rateLimitMap.delete(key);
    }
  }, 120_000);
}

function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // 1. Rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: securityHeaders() }
    );
  }

  // 2. Validate token format (fail fast, no DB hit)
  if (!token || !SHARE_TOKEN_REGEX.test(token)) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404, headers: securityHeaders() }
    );
  }

  // 3. Resolve via sharing service
  let client: Client | null = null;
  try {
    const { hashShareToken, shapeCustomerItineraryDTO } = await import(
      '@/lib/quotes-itineraries/sharing'
    );
    const tokenHash = hashShareToken(token);

    // Connect to database via service-role-equivalent connection
    const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      console.error('[PublicPortal] DATABASE_URL not configured');
      return NextResponse.json(
        { error: 'Service unavailable' },
        { status: 503, headers: securityHeaders() }
      );
    }

    client = new Client({ connectionString });
    await client.connect();

    const result = await client.query(
      `SELECT public.resolve_itinerary_share_token($1) as result`,
      [tokenHash]
    );

    const data = result.rows[0]?.result;
    if (!data) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: securityHeaders() }
      );
    }

    // Shape customer-safe DTO (recursive internal-data stripping)
    const itinerary = shapeCustomerItineraryDTO({
      title: data.title,
      destination_summary: data.destination_summary,
      start_date: data.start_date,
      end_date: data.end_date,
      duration_days: data.duration_days,
      passenger_count: data.passenger_count,
      days: data.days,
      inclusions: data.inclusions,
      exclusions: data.exclusions,
    });

    return NextResponse.json(
      {
        shareId: data.share_id,
        versionId: data.version_id,
        versionNumber: data.version_number,
        agencyName: data.agency_name,
        expiresAt: data.expires_at,
        itinerary,
      },
      { status: 200, headers: securityHeaders() }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Map domain errors to generic 404 (no information leakage)
    if (
      message.includes('INVALID_TOKEN') ||
      message.includes('TOKEN_REVOKED') ||
      message.includes('TOKEN_EXPIRED')
    ) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: securityHeaders() }
      );
    }

    console.error('[PublicPortal] Itinerary share resolution error:', message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: securityHeaders() }
    );
  } finally {
    if (client) {
      try { await client.end(); } catch { /* ignore cleanup errors */ }
    }
  }
}
