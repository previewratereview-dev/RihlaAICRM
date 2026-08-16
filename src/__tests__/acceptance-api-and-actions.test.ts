import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as acceptQuoteRoute, resetAcceptanceRateLimit } from '../app/api/p/quote/[token]/accept/route';

describe('Public Quote Acceptance API Route (/api/p/quote/[token]/accept)', () => {
  beforeEach(() => {
    resetAcceptanceRateLimit();
    vi.clearAllMocks();
  });

  function createAcceptRequest(
    token: string,
    body: Record<string, unknown>,
    ip = '127.0.0.1'
  ): NextRequest {
    return new NextRequest(`https://rihla.app/api/p/quote/${token}/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        'user-agent': 'Vitest-Test-Agent',
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects invalid token format with 404 and security headers', async () => {
    const req = createAcceptRequest('too-short', {
      travelerName: 'Jane Doe',
      travelerEmail: 'jane@example.com',
      confirmed: true,
    });
    const res = await acceptQuoteRoute(req, { params: Promise.resolve({ token: 'too-short' }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Not found');

    // Security headers check
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('rejects unconfirmed payload with 400', async () => {
    const validToken = 'a'.repeat(43);
    const req = createAcceptRequest(validToken, {
      travelerName: 'Jane Doe',
      travelerEmail: 'jane@example.com',
      confirmed: false,
    });
    const res = await acceptQuoteRoute(req, { params: Promise.resolve({ token: validToken }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Explicit commercial confirmation is required');
  });

  it('rejects missing traveler name with 400', async () => {
    const validToken = 'a'.repeat(43);
    const req = createAcceptRequest(validToken, {
      travelerName: '   ',
      travelerEmail: 'jane@example.com',
      confirmed: true,
    });
    const res = await acceptQuoteRoute(req, { params: Promise.resolve({ token: validToken }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Full name is required');
  });

  it('rejects invalid traveler email with 400', async () => {
    const validToken = 'a'.repeat(43);
    const req = createAcceptRequest(validToken, {
      travelerName: 'Jane Doe',
      travelerEmail: 'not-an-email',
      confirmed: true,
    });
    const res = await acceptQuoteRoute(req, { params: Promise.resolve({ token: validToken }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('A valid email address is required');
  });

  it('enforces rate limiting on repeated requests from same IP (429)', async () => {
    const validToken = 'a'.repeat(43);
    const testIp = '10.0.0.99';

    // First 10 requests pass format validation
    for (let i = 0; i < 10; i++) {
      const req = createAcceptRequest(
        validToken,
        { travelerName: 'Jane', travelerEmail: 'jane@test.com', confirmed: true },
        testIp
      );
      const res = await acceptQuoteRoute(req, { params: Promise.resolve({ token: validToken }) });
      // Might be 503 or handled, but NOT 429
      expect(res.status).not.toBe(429);
    }

    // 11th request MUST be 429
    const req11 = createAcceptRequest(
      validToken,
      { travelerName: 'Jane', travelerEmail: 'jane@test.com', confirmed: true },
      testIp
    );
    const res11 = await acceptQuoteRoute(req11, { params: Promise.resolve({ token: validToken }) });
    expect(res11.status).toBe(429);
    expect(res11.headers.get('retry-after')).toBeDefined();
    const json = await res11.json();
    expect(json.error).toContain('Too many acceptance requests');
  });
});
