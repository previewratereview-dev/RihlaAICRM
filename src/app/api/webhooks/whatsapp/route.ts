import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateId } from '@/lib/utils';
import { verifyTwilioSignature } from '@/lib/webhooks/verify';
import { ensureIntegrationRuntime } from '@/lib/integrations/runtime';
import {
  resolveInboundTenant,
  InboundResolutionError,
} from '@/lib/integrations/credential-service';
import { revealSecret } from '@/lib/secrets/store';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getServiceClient() {
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey);
}

/**
 * Derive the inbound destination identifier from a Twilio `To` value. Twilio
 * sends the tenant's own number as `To` (e.g. `whatsapp:+14155238886`); the
 * channel scheme prefix is stripped so it matches a tenant's configured
 * `sending_identifiers` (Requirement 5.6).
 */
function destinationIdentifierFromTo(to: string): string {
  return to.replace(/^whatsapp:/i, '').replace(/^sms:/i, '').trim();
}

export async function POST(request: NextRequest) {
  try {
    ensureIntegrationRuntime();

    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = value.toString();
    });

    // Resolve the target tenant from the inbound destination number, matching
    // exactly one tenant's configured credentials (Requirement 5.6). Ambiguous
    // or zero matches are rejected without processing (Requirement 5.7).
    const destinationIdentifier = destinationIdentifierFromTo(params.To || '');
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

    // Verify the request against the resolved tenant's configured webhook secret
    // before processing the payload (Requirement 5.6). A tenant without a
    // configured secret, or a request that fails verification, is rejected
    // without processing (Requirement 5.7).
    const webhookSecret = webhookSecretRef
      ? await revealSecret(webhookSecretRef)
      : null;
    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'Webhook verification failed' },
        { status: 401 },
      );
    }

    const signature = request.headers.get('x-twilio-signature');
    const url = request.nextUrl.origin + request.nextUrl.pathname;
    if (!verifyTwilioSignature(webhookSecret, signature, url, params)) {
      return NextResponse.json(
        { error: 'Webhook verification failed' },
        { status: 401 },
      );
    }

    // --- Verified: process the payload, scoped to the resolved tenant. ---
    const from = params.From || '';
    const body = params.Body || '';
    // Strictly validate phone number format: digits and optional leading '+'
    const phone = from.replace('whatsapp:', '').trim();
    if (!/^\+?\d{7,15}$/.test(phone)) {
      return NextResponse.json({ received: true, note: 'Invalid phone format' });
    }
    const phoneWithoutPlus = phone.replace(/^\+/, '');
    const phoneWithPlus = phone.startsWith('+') ? phone : `+${phone}`;

    const supabase = getServiceClient();
    if (!supabase || !body) {
      return NextResponse.json({ received: true, note: 'No service client or empty body' });
    }

    // Query conversation by phone — use two validated queries to avoid
    // SQL injection via unsanitized string interpolation in .or().
    let convs = null;
    const { data: convsByExact } = await supabase
      .from('conversations')
      .select('id, lead_id, tenant_id, unread_count')
      .eq('tenant_id', resolvedTenantId)
      .eq('phone', phoneWithPlus)
      .limit(1);
    convs = convsByExact;

    if (!convs || convs.length === 0) {
      const { data: convsByStripped } = await supabase
        .from('conversations')
        .select('id, lead_id, tenant_id, unread_count')
        .eq('tenant_id', resolvedTenantId)
        .eq('phone', phoneWithoutPlus)
        .limit(1);
      convs = convsByStripped;
    }

    const conv = convs?.[0];
    if (!conv) {
      return NextResponse.json({ received: true, note: 'No matching conversation' });
    }

    const msgId = `msg-${generateId()}`;
    const now = new Date().toISOString();

    await supabase.from('messages').insert({
      id: msgId,
      conversation_id: conv.id,
      sender_type: 'contact',
      sender_id: conv.lead_id,
      sender_name: 'WhatsApp Contact',
      content: body,
      message_type: 'text',
      is_read: false,
      tenant_id: resolvedTenantId,
      created_at: now,
    });

    const currentUnread = Number(conv.unread_count) || 0;
    await supabase.from('conversations').update({
      last_message: body,
      last_message_at: now,
      unread_count: currentUnread + 1,
      updated_at: now,
    }).eq('id', conv.id).eq('tenant_id', resolvedTenantId);

    return NextResponse.json({ received: true, conversationId: conv.id });
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
}
