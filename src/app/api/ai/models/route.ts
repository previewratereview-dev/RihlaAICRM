import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  // Authorize logged-in users and restrict strictly to Super Admins (tenant_id 'global' or role 'super_admin')
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const cookieStore = await cookies();
      const supabase = createClient(cookieStore);
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized: Please log in.' }, { status: 401 });
      }

      const isSuper = user.user_metadata?.role === 'super_admin' || user.user_metadata?.role === 'platform_super_admin' || user.user_metadata?.tenant_id === 'global';
      if (!isSuper) {
        return NextResponse.json({ error: 'Model selection is restricted to platform administrators.' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Unauthorized: Session check failed.' }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { endpoint, apiKey } = body;

    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json({ error: 'Endpoint URL is required.' }, { status: 400 });
    }

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'API Key is required.' }, { status: 400 });
    }

    let baseUrl = endpoint.trim().replace(/\/+$/, '');
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = `https://${baseUrl}`;
    }

    if (baseUrl.endsWith('/chat/completions')) {
      baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
    } else if (baseUrl.endsWith('/completions')) {
      baseUrl = baseUrl.replace(/\/completions$/, '');
    }

    let rawModelsUrl = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;
    const urlObj = new URL(rawModelsUrl);
    if (!urlObj.searchParams.has('limit')) urlObj.searchParams.set('limit', '1000');
    if (!urlObj.searchParams.has('pageSize')) urlObj.searchParams.set('pageSize', '1000');
    if (!urlObj.searchParams.has('page_size')) urlObj.searchParams.set('page_size', '1000');
    const modelsUrl = urlObj.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

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
            extractFromPayload(item, depth + 1);
          }
        }
      } else if (typeof node === 'object') {
        for (const value of Object.values(node as Record<string, unknown>)) {
          extractFromPayload(value, depth + 1);
        }
      }
    }

    extractFromPayload(data);

    // If provider is Z.ai / Zhipu AI, ensure full known GLM model catalog is present
    if (baseUrl.includes('z.ai') || baseUrl.includes('zhipuai')) {
      const zaiModels = [
        'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo',
        'glm-4.7', 'glm-4.7-flash', 'glm-4.6', 'glm-4.6-flash',
        'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash',
        'glm-4-plus', 'glm-4-0520', 'glm-4', 'glm-4-air', 'glm-4-airx',
        'glm-4-long', 'glm-4-flashx', 'glm-4-flash', 'glm-4-voice',
        'glm-4-32b-0414-128k',
        'glm-5v-turbo', 'glm-4.6v', 'glm-4v-plus', 'glm-4v', 'glm-4v-flash',
        'glm-ocr', 'glm-zero-preview',
        'cogview-3-plus', 'cogview-3', 'cogview-3-flash', 'cogvideox-flash',
        'embedding-3', 'embedding-2'
      ];
      zaiModels.forEach((m) => extractedSet.add(m));
    }

    const models = Array.from(extractedSet).sort();
    console.log(`\n=================== [AI MODELS FETCHED] ===================`);
    console.log(`Endpoint: ${modelsUrl}`);
    console.log(`Total Models Found (${models.length}):`, models);
    console.log(`===========================================================\n`);

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n=================== [AI MODELS FETCH ERROR] ===================`);
    console.error(`Error details:`, message);
    console.error(`===============================================================\n`);
    return NextResponse.json(
      { error: `Failed to connect to endpoint: ${message}` },
      { status: 500 }
    );
  }
}

