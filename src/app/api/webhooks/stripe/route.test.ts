/**
 * Tests for the Stripe inbound webhook route (task 15.3).
 *
 * Validates that the route resolves the tenant from the connected-account id and
 * verifies against that tenant's webhook secret, rejecting unresolved or
 * unverified payloads WITHOUT processing them (Requirements 5.6, 5.7).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// --- Dependency mocks -------------------------------------------------------

vi.mock('@/lib/integrations/runtime', () => ({
  ensureIntegrationRuntime: vi.fn(),
}));

class InboundResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InboundResolutionError';
  }
}
const resolveInboundTenant = vi.fn();
vi.mock('@/lib/integrations/credential-service', () => ({
  resolveInboundTenant: (...args: unknown[]) => resolveInboundTenant(...args),
  InboundResolutionError,
}));

const revealSecret = vi.fn();
vi.mock('@/lib/secrets/store', () => ({
  revealSecret: (...args: unknown[]) => revealSecret(...args),
}));

const verifyStripeSignature = vi.fn();
vi.mock('@/lib/webhooks/verify', () => ({
  verifyStripeSignature: (...args: unknown[]) => verifyStripeSignature(...args),
}));

let updates: Array<{ table: string; payload: unknown }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const builder = {
        update: (payload: unknown) => {
          updates.push({ table, payload });
          return builder;
        },
        eq: () => builder,
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      };
      return builder;
    },
  }),
}));

// --- Helpers ----------------------------------------------------------------

function buildRequest(event: Record<string, unknown>): NextRequest {
  return new NextRequest('https://app.example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 't=1,v1=sig',
    },
    body: JSON.stringify(event),
  });
}

async function loadRoute() {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
  return import('./route');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  updates = [];
});

const checkoutEvent = (account?: string) => ({
  type: 'checkout.session.completed',
  account,
  data: { object: { metadata: { leadId: 'lead-1', tenantId: 'tenant-a' } } },
});

// --- Tests ------------------------------------------------------------------

describe('Stripe webhook — per-tenant inbound resolution (5.6, 5.7)', () => {
  it('rejects malformed JSON without resolving a tenant', async () => {
    const { POST } = await loadRoute();
    const req = new NextRequest('https://app.example.com/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=sig' },
      body: 'not-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(resolveInboundTenant).not.toHaveBeenCalled();
  });

  it('rejects without processing when no connected-account id is present', async () => {
    const { POST } = await loadRoute();
    const res = await POST(buildRequest(checkoutEvent(undefined)));

    expect(res.status).toBe(401);
    expect(resolveInboundTenant).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('rejects without processing when the account resolves to no/ambiguous tenant', async () => {
    resolveInboundTenant.mockRejectedValue(new InboundResolutionError('ambiguous'));
    const { POST } = await loadRoute();

    const res = await POST(buildRequest(checkoutEvent('acct_123')));

    expect(res.status).toBe(401);
    expect(revealSecret).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('rejects without processing when the tenant has no configured webhook secret', async () => {
    resolveInboundTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      cred: { webhookSecretRef: null },
    });
    const { POST } = await loadRoute();

    const res = await POST(buildRequest(checkoutEvent('acct_123')));

    expect(res.status).toBe(401);
    expect(verifyStripeSignature).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('rejects without processing when the signature fails verification', async () => {
    resolveInboundTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      cred: { webhookSecretRef: 'ref-a' },
    });
    revealSecret.mockResolvedValue('tenant-a-secret');
    verifyStripeSignature.mockReturnValue(false);
    const { POST } = await loadRoute();

    const res = await POST(buildRequest(checkoutEvent('acct_123')));

    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('processes the payload scoped to the resolved tenant on a verified request', async () => {
    resolveInboundTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      cred: { webhookSecretRef: 'ref-a' },
    });
    revealSecret.mockResolvedValue('tenant-a-secret');
    verifyStripeSignature.mockReturnValue(true);
    const { POST } = await loadRoute();

    const res = await POST(buildRequest(checkoutEvent('acct_123')));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(revealSecret).toHaveBeenCalledWith('ref-a');
    expect(resolveInboundTenant).toHaveBeenCalledWith('acct_123');
    const leadUpdate = updates.find((u) => u.table === 'leads');
    expect(leadUpdate).toBeTruthy();
  });
});
