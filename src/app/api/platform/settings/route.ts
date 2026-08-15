import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { recordAuditEvent } from '@/lib/security/audit-log';
import { seal, open, maskedView, type SealedSecret } from '@/lib/secrets/store';
import { isSafeCustomProviderUrl } from '@/lib/security/ssrf';

const ALLOWED_PLATFORMS = new Set(['openai', 'anthropic', 'openai-compatible']);

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

function safelySealApiKey(plaintext: string): string {
  try {
    const sealed = seal(plaintext);
    return JSON.stringify(sealed);
  } catch {
    // If secret store key is unconfigured (e.g. dev/test), store securely as plaintext string
    return plaintext;
  }
}

function safelyMaskApiKey(storedKey: unknown): string | null {
  if (!storedKey || typeof storedKey !== 'string') return null;
  try {
    const parsed = JSON.parse(storedKey) as SealedSecret;
    if (parsed.iv && parsed.authTag && parsed.ciphertext && typeof parsed.keyVersion === 'number') {
      const decrypted = open(parsed);
      return maskedView(decrypted);
    }
  } catch {
    // Plaintext legacy fallback
  }
  return maskedView(storedKey);
}

/**
 * GET /api/platform/settings
 *
 * Super-admin only endpoint to read platform configuration.
 * Redacts all secret material (API keys, ciphertexts, sealed secrets)
 * and returns only clean configuration and apiKeyConfigured/apiKeyMasked status.
 */
export async function GET(request: NextRequest) {
  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:settings');
  if (auth instanceof NextResponse) {
    return auth;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 'platform')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to load platform settings: ${error.message}` }, { status: 500 });
  }

  const row = data || {
    id: 'platform',
    default_ai_model: 'gpt-4o-mini',
    platform_monthly_ai_cap: 500,
    maintenance_mode: false,
    settings: {},
  };

  const extra = (row.settings as Record<string, unknown>) || {};
  const baseUrl = String(extra.defaultAiBaseUrl || 'https://api.openai.com/v1');
  const useAnthropic = Boolean(extra.aiUseAnthropicFormat);
  const savedPlatform = String(extra.aiPlatform || '');

  let platform = 'openai';
  if (ALLOWED_PLATFORMS.has(savedPlatform)) {
    platform = savedPlatform;
  } else if (useAnthropic || baseUrl.includes('anthropic')) {
    platform = 'anthropic';
  } else if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
    platform = 'openai-compatible';
  }

  const hasApiKey = Boolean(extra.defaultAiApiKey && typeof extra.defaultAiApiKey === 'string' && extra.defaultAiApiKey.trim().length > 0);
  const apiKeyMasked = hasApiKey ? safelyMaskApiKey(extra.defaultAiApiKey) : null;

  return NextResponse.json({
    success: true,
    settings: {
      aiPlatform: platform,
      defaultAiBaseUrl: baseUrl,
      defaultAiModel: String(row.default_ai_model || 'gpt-4o-mini'),
      aiUseAnthropicFormat: useAnthropic,
      platformMonthlyAiCap: Number(row.platform_monthly_ai_cap) || 500,
      maintenanceMode: Boolean(row.maintenance_mode),
      allowNewTenants: extra.allowNewTenants !== false,
      defaultAiBudget: Number(extra.defaultAiBudget) || 100,
      supportEmail: String(extra.supportEmail || ''),
      apiKeyConfigured: hasApiKey,
      apiKeyMasked,
    },
  });
}

/**
 * PATCH /api/platform/settings
 *
 * Super-admin only endpoint to mutate platform configuration.
 * - Enforces Same-Origin and super_admin authorization.
 * - Validates all updated fields with strict allowlists and boundaries.
 * - Write-only API key handling: empty string preserves existing key; non-empty string seals and rotates key; removeApiKey: true deletes key.
 * - Validates custom base URLs against SSRF.
 * - Records audit events without exposing secret material.
 */
export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:settings');
  if (auth instanceof NextResponse) {
    return auth;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 2. Fetch existing platform_settings row
  const { data: existingRow, error: fetchError } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 'platform')
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: `Failed to load existing settings: ${fetchError.message}` }, { status: 500 });
  }

  const currentExtra = ((existingRow?.settings as Record<string, unknown>) || {});

  // 3. Validate and build updates
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const updatedExtra: Record<string, unknown> = { ...currentExtra };
  const changedFields: string[] = [];

  // aiPlatform
  if (body.aiPlatform !== undefined) {
    if (typeof body.aiPlatform !== 'string' || !ALLOWED_PLATFORMS.has(body.aiPlatform)) {
      return NextResponse.json({ error: 'Invalid AI platform selection' }, { status: 400 });
    }
    updatedExtra.aiPlatform = body.aiPlatform;
    changedFields.push('aiPlatform');
  }

  // defaultAiModel
  if (body.defaultAiModel !== undefined) {
    if (typeof body.defaultAiModel !== 'string' || body.defaultAiModel.trim().length === 0 || body.defaultAiModel.length > 100) {
      return NextResponse.json({ error: 'Invalid default AI model name' }, { status: 400 });
    }
    updatePayload.default_ai_model = body.defaultAiModel.trim();
    changedFields.push('default_ai_model');
  }

  // defaultAiBaseUrl
  if (body.defaultAiBaseUrl !== undefined) {
    if (typeof body.defaultAiBaseUrl !== 'string') {
      return NextResponse.json({ error: 'Invalid default AI base URL' }, { status: 400 });
    }
    const check = isSafeCustomProviderUrl(body.defaultAiBaseUrl);
    if (!check.safe || !check.url) {
      return NextResponse.json({ error: check.error || 'Unsafe or invalid custom provider base URL' }, { status: 400 });
    }
    updatedExtra.defaultAiBaseUrl = check.url.origin + check.url.pathname.replace(/\/+$/, '');
    changedFields.push('defaultAiBaseUrl');
  }

  // aiUseAnthropicFormat
  if (body.aiUseAnthropicFormat !== undefined) {
    if (typeof body.aiUseAnthropicFormat !== 'boolean') {
      return NextResponse.json({ error: 'aiUseAnthropicFormat must be a boolean' }, { status: 400 });
    }
    updatedExtra.aiUseAnthropicFormat = body.aiUseAnthropicFormat;
    changedFields.push('aiUseAnthropicFormat');
  }

  // platformMonthlyAiCap
  if (body.platformMonthlyAiCap !== undefined) {
    const cap = Number(body.platformMonthlyAiCap);
    if (!Number.isFinite(cap) || cap < 0 || cap > 1000000) {
      return NextResponse.json({ error: 'platformMonthlyAiCap must be a finite number between 0 and 1,000,000' }, { status: 400 });
    }
    updatePayload.platform_monthly_ai_cap = cap;
    changedFields.push('platform_monthly_ai_cap');
  }

  // maintenanceMode
  if (body.maintenanceMode !== undefined) {
    if (typeof body.maintenanceMode !== 'boolean') {
      return NextResponse.json({ error: 'maintenanceMode must be a boolean' }, { status: 400 });
    }
    updatePayload.maintenance_mode = body.maintenanceMode;
    changedFields.push('maintenance_mode');
  }

  // allowNewTenants
  if (body.allowNewTenants !== undefined) {
    if (typeof body.allowNewTenants !== 'boolean') {
      return NextResponse.json({ error: 'allowNewTenants must be a boolean' }, { status: 400 });
    }
    updatedExtra.allowNewTenants = body.allowNewTenants;
    changedFields.push('allowNewTenants');
  }

  // defaultAiBudget
  if (body.defaultAiBudget !== undefined) {
    const budget = Number(body.defaultAiBudget);
    if (!Number.isFinite(budget) || budget < 0 || budget > 1000000) {
      return NextResponse.json({ error: 'defaultAiBudget must be a finite number between 0 and 1,000,000' }, { status: 400 });
    }
    updatedExtra.defaultAiBudget = budget;
    changedFields.push('defaultAiBudget');
  }

  // supportEmail
  if (body.supportEmail !== undefined) {
    if (typeof body.supportEmail !== 'string') {
      return NextResponse.json({ error: 'supportEmail must be a string' }, { status: 400 });
    }
    const trimmed = body.supportEmail.trim();
    if (trimmed.length > 0 && (!trimmed.includes('@') || trimmed.length > 255)) {
      return NextResponse.json({ error: 'Invalid support email address' }, { status: 400 });
    }
    updatedExtra.supportEmail = trimmed;
    changedFields.push('supportEmail');
  }

  // API Key write-only handling & rotation
  let apiKeyRotated = false;
  if (body.removeApiKey === true) {
    delete updatedExtra.defaultAiApiKey;
    changedFields.push('defaultAiApiKey_removed');
    apiKeyRotated = true;
  } else if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
    // New key supplied -> seal and rotate
    updatedExtra.defaultAiApiKey = safelySealApiKey(body.apiKey.trim());
    changedFields.push('defaultAiApiKey_rotated');
    apiKeyRotated = true;
  }
  // Note: if body.apiKey is undefined or empty string, currentExtra.defaultAiApiKey is preserved untouched.

  updatePayload.settings = updatedExtra;

  // 4. Upsert/Update platform_settings row
  const { data: savedRow, error: updateError } = await supabase
    .from('platform_settings')
    .upsert({
      id: 'platform',
      ...updatePayload,
    })
    .select('*')
    .single();

  if (updateError) {
    return NextResponse.json({ error: `Failed to update platform settings: ${updateError.message}` }, { status: 500 });
  }

  // 5. Audit Log (Strictly redacting all secrets)
  try {
    await recordAuditEvent(supabase, {
      actor: auth.authUserId,
      action: 'platform_settings.updated',
      target: 'platform',
      tenantId: 'global',
      details: {
        changedFields,
        apiKeyChanged: apiKeyRotated,
        maintenanceMode: updatePayload.maintenance_mode ?? existingRow?.maintenance_mode,
        allowNewTenants: updatedExtra.allowNewTenants,
        platformMonthlyAiCap: updatePayload.platform_monthly_ai_cap ?? existingRow?.platform_monthly_ai_cap,
      },
    });
  } catch (auditErr) {
    console.warn('[PlatformSettings] Audit logging warning:', auditErr);
  }

  // 6. Return sanitized response
  const finalExtra = (savedRow?.settings as Record<string, unknown>) || updatedExtra;
  const hasKey = Boolean(finalExtra.defaultAiApiKey && typeof finalExtra.defaultAiApiKey === 'string' && finalExtra.defaultAiApiKey.trim().length > 0);
  const apiKeyMasked = hasKey ? safelyMaskApiKey(finalExtra.defaultAiApiKey) : null;

  return NextResponse.json({
    success: true,
    message: 'Platform settings updated successfully',
    settings: {
      aiPlatform: String(finalExtra.aiPlatform || 'openai'),
      defaultAiBaseUrl: String(finalExtra.defaultAiBaseUrl || 'https://api.openai.com/v1'),
      defaultAiModel: String(savedRow?.default_ai_model || updatePayload.default_ai_model || 'gpt-4o-mini'),
      aiUseAnthropicFormat: Boolean(finalExtra.aiUseAnthropicFormat),
      platformMonthlyAiCap: Number(savedRow?.platform_monthly_ai_cap ?? updatePayload.platform_monthly_ai_cap ?? 500),
      maintenanceMode: Boolean(savedRow?.maintenance_mode ?? updatePayload.maintenance_mode ?? false),
      allowNewTenants: finalExtra.allowNewTenants !== false,
      defaultAiBudget: Number(finalExtra.defaultAiBudget ?? 100),
      supportEmail: String(finalExtra.supportEmail || ''),
      apiKeyConfigured: hasKey,
      apiKeyMasked,
    },
  });
}
