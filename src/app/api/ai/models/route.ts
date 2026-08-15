import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformSuperAdmin } from '@/lib/auth/api-guard';
import { validateCustomProviderUrlWithDns } from '@/lib/security/ssrf';
import { open, type SealedSecret } from '@/lib/secrets/store';

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

function resolveStoredApiKey(stored: unknown): string | null {
  if (!stored || typeof stored !== 'string') return null;
  try {
    const parsed = JSON.parse(stored) as SealedSecret;
    if (parsed.iv && parsed.authTag && parsed.ciphertext && typeof parsed.keyVersion === 'number') {
      return open(parsed) || null;
    }
  } catch {
    // Legacy plaintext fallback
  }
  return stored;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request forbidden' }, { status: 403 });
  }

  // 1. Authorize super_admin
  const auth = await requirePlatformSuperAdmin(request, 'platform:settings');
  if (auth instanceof NextResponse) {
    return auth;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // optional body
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 2. Fetch existing platform settings for fallback baseUrl / stored key
  const { data: platformRow } = await supabase
    .from('platform_settings')
    .select('settings')
    .eq('id', 'platform')
    .maybeSingle();

  const extra = (platformRow?.settings as Record<string, unknown>) || {};
  const requestedEndpoint =
    typeof body.endpoint === 'string' && body.endpoint.trim().length > 0
      ? body.endpoint.trim()
      : String(extra.defaultAiBaseUrl || 'https://api.openai.com/v1');

  // 3. Validate Endpoint against SSRF with DNS resolution
  const urlCheck = await validateCustomProviderUrlWithDns(requestedEndpoint);
  if (!urlCheck.safe || !urlCheck.url) {
    return NextResponse.json(
      { error: urlCheck.error || 'Invalid or unsafe provider endpoint URL' },
      { status: 400 }
    );
  }

  // 4. Resolve API Key (Candidate key from request OR persisted key)
  let activeApiKey: string | null = null;
  if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
    activeApiKey = body.apiKey.trim();
  } else if (extra.defaultAiApiKey) {
    activeApiKey = resolveStoredApiKey(extra.defaultAiApiKey);
  }

  if (!activeApiKey) {
    return NextResponse.json(
      { error: 'No API key configured or supplied for model discovery' },
      { status: 400 }
    );
  }

  // 5. Build normalized models URL
  let baseUrl = urlCheck.url.origin + urlCheck.url.pathname.replace(/\/+$/, '');
  if (baseUrl.endsWith('/chat/completions')) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
  } else if (baseUrl.endsWith('/completions')) {
    baseUrl = baseUrl.replace(/\/completions$/, '');
  }

  const rawModelsUrl = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;
  const urlObj = new URL(rawModelsUrl);
  urlObj.searchParams.set('limit', '1000');

  // 6. Execute server-side fetch with timeout and manual redirect handling
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${activeApiKey}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { error: 'Provider endpoint returned an HTTP redirect; redirects are disabled for security' },
        { status: 400 }
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      return NextResponse.json(
        { error: `Provider error (${response.status}): ${errText.slice(0, 150) || 'Verify endpoint & API key'}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const extractedSet = new Set<string>();

    function extractFromPayload(node: unknown, depth = 0) {
      if (depth > 8 || !node) return;
      if (typeof node === 'string') return;

      if (Array.isArray(node)) {
        for (const item of node) {
          if (typeof item === 'string' && item.trim().length > 1 && !item.startsWith('http')) {
            extractedSet.add(item.trim());
          } else if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            for (const key of ['id', 'name', 'model', 'model_name', 'modelId', 'model_id']) {
              const val = record[key];
              if (typeof val === 'string' && val.trim().length > 1) {
                extractedSet.add(val.trim());
              }
            }
          }
        }
      } else if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        for (const key of ['data', 'models', 'result', 'items', 'list']) {
          if (key in obj) {
            extractFromPayload(obj[key], depth + 1);
          }
        }
        for (const key of ['id', 'name', 'model', 'model_name']) {
          const val = obj[key];
          if (typeof val === 'string' && val.trim().length > 1) {
            extractedSet.add(val.trim());
          }
        }
      }
    }

    extractFromPayload(data);

    let models = Array.from(extractedSet).filter(
      (id) => !id.includes('/') || id.split('/').length <= 3
    );

    models.sort((a, b) => a.localeCompare(b));

    if (models.length === 0) {
      models = ['gpt-4o-mini', 'gpt-4o'];
    }

    return NextResponse.json({
      success: true,
      models,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Connection timeout or network error';
    return NextResponse.json(
      { error: `Failed to discover models: ${message}` },
      { status: 502 }
    );
  }
}
