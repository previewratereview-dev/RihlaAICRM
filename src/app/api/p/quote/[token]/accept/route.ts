/**
 * Phase AI-5B.4: Public Quote Acceptance API Route
 *
 * POST /api/p/quote/[token]/accept
 *
 * Link-holder commercial quote acceptance endpoint.
 * No agency authentication required — authorized by capability token possession.
 *
 * Security:
 * - Token validated against /^[A-Za-z0-9_-]{43}$/
 * - Single SHA-256 hash passed to DB RPC
 * - Dedicated in-memory rate limiter (10 requests/min per IP)
 * - Server-observed client_ip and user_agent
 * - Strict defensive security headers
 * - Generic error mappings (zero information leakage)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import {
  isValidShareTokenFormat,
} from '@/lib/quotes-itineraries/sharing';
import {
  recordPortalQuoteAcceptance,
  PortalAcceptanceInput,
} from '@/lib/quotes-itineraries/acceptance';

// In-memory rate limiter for public acceptance POST (10 req/min per IP)
const acceptanceRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const ACCEPTANCE_RATE_LIMIT_WINDOW_MS = 60_000;
const ACCEPTANCE_RATE_LIMIT_MAX = 10;

function isAcceptanceRateLimited(ip: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = acceptanceRateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    acceptanceRateLimitMap.set(ip, { count: 1, resetAt: now + ACCEPTANCE_RATE_LIMIT_WINDOW_MS });
    return { limited: false };
  }

  entry.count++;
  if (entry.count > ACCEPTANCE_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }

  return { limited: false };
}

export function resetAcceptanceRateLimit(): void {
  acceptanceRateLimitMap.clear();
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // 1. Extract network provenance
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  // 2. Rate limit check
  const rateLimit = isAcceptanceRateLimited(ip);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many acceptance requests. Please try again later.' },
      {
        status: 429,
        headers: {
          ...securityHeaders(),
          'Retry-After': String(rateLimit.retryAfter ?? 60),
        },
      }
    );
  }

  // 3. Token format validation (fail fast, zero DB lookups)
  if (!isValidShareTokenFormat(token)) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404, headers: securityHeaders() }
    );
  }

  // 4. Parse and validate JSON body
  let body: PortalAcceptanceInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400, headers: securityHeaders() }
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400, headers: securityHeaders() }
    );
  }

  if (!body.confirmed) {
    return NextResponse.json(
      { error: 'Explicit commercial confirmation is required' },
      { status: 400, headers: securityHeaders() }
    );
  }

  if (!body.travelerName || typeof body.travelerName !== 'string' || !body.travelerName.trim()) {
    return NextResponse.json(
      { error: 'Full name is required' },
      { status: 400, headers: securityHeaders() }
    );
  }

  if (
    !body.travelerEmail ||
    typeof body.travelerEmail !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.travelerEmail.trim())
  ) {
    return NextResponse.json(
      { error: 'A valid email address is required' },
      { status: 400, headers: securityHeaders() }
    );
  }

  // 5. Connect and execute domain acceptance
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('[PublicAcceptance] DATABASE_URL not configured');
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503, headers: securityHeaders() }
    );
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();

    const result = await recordPortalQuoteAcceptance(
      {
        query: async (sql, queryParams) => {
          const res = await client.query(sql, queryParams as unknown[]);
          return { rows: res.rows };
        },
      },
      token,
      {
        travelerName: body.travelerName,
        travelerEmail: body.travelerEmail,
        confirmed: body.confirmed,
      },
      ip,
      userAgent
    );

    return NextResponse.json(
      {
        success: true,
        acceptanceId: result.acceptanceId,
        quoteVersionId: result.quoteVersionId,
        acceptedGrandTotal: result.acceptedGrandTotal,
        currency: result.currency,
        acceptedAt: result.acceptedAt,
        idempotent: result.idempotent,
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

    if (message.includes('CONFLICT_ACTIVE_ACCEPTANCE_EXISTS')) {
      return NextResponse.json(
        { error: 'An active acceptance already exists for this inquiry with a different quote version' },
        { status: 409, headers: securityHeaders() }
      );
    }

    if (message.includes('EXPIRED_QUOTE_OFFER')) {
      return NextResponse.json(
        { error: 'This quote offer has expired and can no longer be accepted' },
        { status: 410, headers: securityHeaders() }
      );
    }

    if (message.includes('LIFECYCLE_VIOLATION') || message.includes('VALIDATION_ERROR')) {
      return NextResponse.json(
        { error: message.replace(/^[^:]+:\s*/, '') },
        { status: 400, headers: securityHeaders() }
      );
    }

    console.error('[PublicAcceptance] Acceptance error:', message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: securityHeaders() }
    );
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
