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
import { resolvePublicQuoteCapability } from '@/lib/quotes-itineraries/sharing';

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

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const result = await resolvePublicQuoteCapability(token, ip);

  if (result.status === 'rate_limited') {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          ...securityHeaders(),
          'Retry-After': String(result.retryAfter ?? 60),
        },
      }
    );
  }

  if (result.status === 'error') {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503, headers: securityHeaders() }
    );
  }

  if (result.status !== 'ok' || !result.data) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404, headers: securityHeaders() }
    );
  }

  return NextResponse.json(
    {
      shareId: result.data.shareId,
      quoteVersionId: result.data.quoteVersionId,
      agencyName: result.data.agencyName,
      expiresAt: result.data.expiresAt,
      quote: result.data.quote,
    },
    { status: 200, headers: securityHeaders() }
  );
}
