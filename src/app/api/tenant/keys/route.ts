import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { maskedView, type SecretStatus, type SecretStatusFormat } from '@/lib/secrets/store';

/**
 * GET /api/tenant/keys
 *
 * Returns the *status* of a tenant's configured AI API keys — never the
 * plaintext value (Requirement 6.2, 6.4). The plaintext is read only within
 * this server-side execution context to derive the status and is never placed
 * in the response sent to the browser.
 *
 * The client chooses the representation via the `format` query parameter
 * (Requirement 6.3):
 * - `format=boolean` (default) → only a `configured` boolean per key.
 * - `format=masked`            → a `configured` boolean plus a `masked` value
 *                                exposing at most the last 4 characters.
 *
 * Authorization: requires the `settings:integrations:write` permission and a
 * tenant context that matches the session user's tenant.
 */
const KEY_FIELDS = ['openai_key', 'anthropic_key'] as const;
type KeyField = (typeof KEY_FIELDS)[number];

const RESPONSE_KEY: Record<KeyField, 'openai' | 'anthropic'> = {
  openai_key: 'openai',
  anthropic_key: 'anthropic',
};

function parseFormat(request: NextRequest): SecretStatusFormat {
  const raw = request.nextUrl.searchParams.get('format');
  return raw === 'masked' ? 'masked' : 'boolean';
}

/**
 * Derive the client-facing status of a stored secret without ever exposing the
 * plaintext. The plaintext stays inside this function's scope.
 */
function statusFor(value: string | null | undefined, format: SecretStatusFormat): SecretStatus {
  if (!value) {
    return { configured: false };
  }
  if (format === 'boolean') {
    return { configured: true };
  }
  return { configured: true, masked: maskedView(value) };
}

export async function GET(request: NextRequest) {
  // Auth (with permission) + shared rate limit + server-resolved tenant
  // (9.2, 9.4, 9.7, 8.2).
  const guard = await guardRoute(request, {
    scope: 'tenant-keys',
    permission: 'settings:integrations:write',
  });
  if (guard instanceof NextResponse) return guard;

  const format = parseFormat(request);

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Fetch settings scoped to the tenant. Plaintext is used only here, to
    // compute status; it is never returned to the client.
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('openai_key, anthropic_key')
      .eq('tenant_id', guard.tenantId)
      .single();

    if (settingsError || !settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }

    const keys: Record<string, SecretStatus> = {};
    for (const field of KEY_FIELDS) {
      keys[RESPONSE_KEY[field]] = statusFor(settings[field], format);
    }

    return NextResponse.json({ format, keys });
  } catch {
    // Never include secret material in logs (Requirement 6.8).
    console.error('[Tenant Keys API] Error resolving key status');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
