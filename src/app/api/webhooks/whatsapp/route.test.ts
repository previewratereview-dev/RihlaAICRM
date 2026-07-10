/**
 * Tests for the WhatsApp inbound webhook route (task 15.3).
 *
 * Validates that the route resolves the tenant from the destination identifier
 * and verifies against that tenant's webhook secret, rejecting unresolved or
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

const verifyTwilioSignature = vi.fn();
vi.mock('@/lib/webhooks/verify', () => ({
  verifyTwilioSignature: (...args: unknown[]) => verifyTwilioSignature(...args),
}));

// Mutable supabase mock the route's createClient call returns.
let inserts: Array<{ table: string; payload: unknown }>;
let updates: Array<{ table: string; payload: unknown }>;
let conversations: unknown[];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        limit: () => builder,
        update: (payload: unknown) => {
          updates.push({ table, payload });
          return builder;
        },
        insert: (payload: unknown) => {
          inserts.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: unknown) => void) =>
          resolve(
            table === 'conversations'
              ? { data: conversations, error: null }
              : { data: null, error: null },
          ),
      };
      return builder;
    },
  }),
}));

// --- Helpers ----------------------------------------------------------------

function buildRequest(params: Record<string, string>): NextRequest {
  const body = new URLSearchParams(params).toString();
  return new NextRequest('https://app.example.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'sig',
    },
    body,
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
  inserts = [];
  updates = [];
  conversations = [{ id: 'conv-1', lead_id: 'lead-1', tenant_id: 'tenant-a' }];
});

// --- Tests ------------------------------------------------------------------

describe('WhatsApp webhook — per-tenant inbound resolution (5.6, 5.7)', () => {
  it('rejects without processing when no destination identifier is present', async () => {
    const { POST } = await loadRoute();
    const res = await POST(buildRequest({ From: 'whatsapp:+19999999999', Body: 'hi' }));

    expect(res.status).toBe(401);
    expect(resolveInboundTenant).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('rejects without processing when the destination resolves to no/ambiguous tenant', async () => {
    resolveInboundTenant.mockRejectedValue(new InboundResolutionError('ambiguous'));
    const { POST } = await loadRoute();

    const res = await POST(
      buildRequest({ To: 'whatsapp:+14155238886', From: 'whatsapp:+19999999999', Body: 'hi' }),
    );

    expect(res.status).toBe(401);
    expect(revealSecret).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('rejects without processing when the tenant has no configured webhook secret', async () => {
    resolveInboundTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      cred: { webhookSecretRef: null },
    });
    const { POST } = await loadRoute();

    const res = await POST(
      buildRequest({ To: 'whatsapp:+14155238886', From: 'whatsapp:+19999999999', Body: 'hi' }),
    );

    expect(res.status).toBe(401);
    expect(verifyTwilioSignature).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('rejects without processing when the signature fails verification', async () => {
    resolveInboundTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      cred: { webhookSecretRef: 'ref-a' },
    });
    revealSecret.mockResolvedValue('tenant-a-secret');
    verifyTwilioSignature.mockReturnValue(false);
    const { POST } = await loadRoute();

    const res = await POST(
      buildRequest({ To: 'whatsapp:+14155238886', From: 'whatsapp:+19999999999', Body: 'hi' }),
    );

    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it('processes the payload scoped to the resolved tenant on a verified request', async () => {
    resolveInboundTenant.mockResolvedValue({
      tenantId: 'tenant-a',
      cred: { webhookSecretRef: 'ref-a' },
    });
    revealSecret.mockResolvedValue('tenant-a-secret');
    verifyTwilioSignature.mockReturnValue(true);
    const { POST } = await loadRoute();

    const res = await POST(
      buildRequest({ To: 'whatsapp:+14155238886', From: 'whatsapp:+19999999999', Body: 'hello' }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    // Verifies against the resolved tenant's secret, not a shared env token.
    expect(revealSecret).toHaveBeenCalledWith('ref-a');
    // Destination scheme prefix stripped before resolution.
    expect(resolveInboundTenant).toHaveBeenCalledWith('+14155238886');
    // Message persisted under the resolved tenant.
    const messageInsert = inserts.find((i) => i.table === 'messages');
    expect(messageInsert).toBeTruthy();
    expect((messageInsert!.payload as { tenant_id: string }).tenant_id).toBe('tenant-a');
  });
});
