/**
 * Phase AI-5B.3: Public Quote Share Portal API
 *
 * GET /api/p/quote/[token]
 *
 * Resolves a share token to a customer-safe quote view (READ-ONLY).
 * No authentication required — capability-based access via the token itself.
 *
 * Security:
 * - Token is hashed server-side before DB lookup (never stored raw)
 * - Response headers: no-store, no-cache, noindex, no-referrer
 * - Rate limited: 30 requests per minute per IP
 * - Returns 404 for all error types (no information leakage)
 *
 * Invariant:
 * - This is a READ-ONLY view. VIEW != ACCEPTANCE.
 * - The public Quote page contains isAcceptable but NO acceptance endpoint in AI-5B.3.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { SHARE_TOKEN_REGEX } from '@/lib/quotes-itineraries/sharing';

// Simple in-memory rate limiter (per-IP, sliding window)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
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

  // 2. Validate token format
  if (!token || !SHARE_TOKEN_REGEX.test(token)) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404, headers: securityHeaders() }
    );
  }

  // 3. Resolve via sharing service
  let client: Client | null = null;
  try {
    const { hashShareToken, shapeCustomerQuoteDTO, shapeCustomerItineraryDTO } = await import(
      '@/lib/quotes-itineraries/sharing'
    );
    const tokenHash = hashShareToken(token);

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
      `SELECT public.resolve_quote_share_token($1) as result`,
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
    const quote = shapeCustomerQuoteDTO({
      quote_number: data.quote_number,
      version_number: data.version_number,
      currency: data.currency,
      line_items: data.line_items,
      subtotal: data.subtotal,
      discount_amount: data.discount_amount,
      tax_amount: data.tax_amount,
      grand_total: data.grand_total,
      valid_until: data.valid_until,
      terms_and_conditions: data.terms_and_conditions,
      customer_notes: data.customer_notes,
      is_acceptable: data.is_acceptable,
      itinerary: data.itinerary,
    });

    // Suppress any unused import warning
    void shapeCustomerItineraryDTO;

    return NextResponse.json(
      {
        shareId: data.share_id,
        quoteVersionId: data.quote_version_id,
        agencyName: data.agency_name,
        expiresAt: data.expires_at,
        quote,
      },
      { status: 200, headers: securityHeaders() }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

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

    console.error('[PublicPortal] Quote share resolution error:', message);
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
