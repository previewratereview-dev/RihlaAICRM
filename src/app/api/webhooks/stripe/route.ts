import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyStripeSignature } from '@/lib/webhooks/verify';
import { ensureIntegrationRuntime } from '@/lib/integrations/runtime';
import {
  resolveInboundTenant,
  InboundResolutionError,
} from '@/lib/integrations/credential-service';
import { revealSecret } from '@/lib/secrets/store';
import { logger } from '@/lib/logger';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getServiceClient() {
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey);
}

// Idempotency: track processed event IDs to prevent duplicate processing
// NOTE: In serverless, this Map is per-invocation. For production, use a
// DB-backed idempotency store (e.g., processed_webhook_events table).
const processedEvents = new Map<string, number>();
const EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();
  // Clean up expired entries
  for (const [key, timestamp] of processedEvents) {
    if (now - timestamp > EVENT_TTL_MS) processedEvents.delete(key);
  }
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

interface StripeEvent {
  id?: string;
  type: string;
  /** Connected-account id for Stripe Connect events; routes the event to a tenant. */
  account?: string;
  data: { object: Record<string, unknown> };
}

export async function POST(request: NextRequest) {
  try {
    ensureIntegrationRuntime();

    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    // Parse the raw body only to extract routing information (the connected
    // account id). The payload is NOT acted upon until the request is verified
    // against the resolved tenant's webhook secret (Requirements 5.6, 5.7).
    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Resolve the target tenant from the connected-account id, matching exactly
    // one tenant's configured credentials (Requirement 5.6). Missing, ambiguous,
    // or zero matches are rejected without processing (Requirement 5.7).
    const destinationIdentifier = (event.account ?? '').trim();
    if (!destinationIdentifier) {
      return NextResponse.json(
        { error: 'Webhook could not be resolved to a tenant' },
        { status: 401 },
      );
    }

    let resolvedTenantId: string;
    let webhookSecretRef: string | null;
    try {
      const resolution = await resolveInboundTenant(destinationIdentifier);
      resolvedTenantId = resolution.tenantId;
      webhookSecretRef = resolution.cred.webhookSecretRef;
    } catch (err) {
      if (err instanceof InboundResolutionError) {
        return NextResponse.json(
          { error: 'Webhook could not be resolved to a tenant' },
          { status: 401 },
        );
      }
      throw err;
    }

    // Verify against the resolved tenant's configured webhook secret before
    // processing (Requirement 5.6). No configured secret or a failed signature
    // ⇒ reject without processing (Requirement 5.7).
    const webhookSecret = webhookSecretRef
      ? await revealSecret(webhookSecretRef)
      : null;
    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'Webhook verification failed' },
        { status: 401 },
      );
    }

    if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { error: 'Webhook verification failed' },
        { status: 401 },
      );
    }

    // --- Verified: process the payload, scoped to the resolved tenant. ---
    // Idempotency check: skip if this event was already processed
    if (event.id && isDuplicateEvent(event.id)) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const metadata = session.metadata as Record<string, string> | undefined;
      const leadId = metadata?.leadId;

      const supabase = getServiceClient();
      if (leadId && supabase) {
        await supabase
          .from('leads')
          .update({ payment_status: 'partial', updated_at: new Date().toISOString() })
          .eq('id', leadId)
          .eq('tenant_id', resolvedTenantId);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook error', err);
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 });
  }
}
