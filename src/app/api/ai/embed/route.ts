import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/ai/rag';
import { generateId } from '@/lib/utils';
import { AIEmbedSchema, validateRequest } from '@/lib/validation/schemas';
import { buildAiRuntime, getSubscriptionBlockedMessage } from '@/lib/ai/runtime';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getServiceClient() {
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey);
}

export async function POST(request: NextRequest) {
  const guard = await guardRoute(request, { scope: 'ai-embed', limit: 30 });
  if (guard instanceof NextResponse) return guard;

  if (guard.tenantId !== 'global') {
    const supabaseService = getServiceClient();
    if (supabaseService) {
      const runtime = await buildAiRuntime(supabaseService, guard.tenantId);
      if (runtime.tier === 'free') {
        const blockedMsg = getSubscriptionBlockedMessage(runtime);
        return NextResponse.json({ error: blockedMsg }, { status: 403 });
      }
    }
  }

  const body = await request.json();
  const validation = validateRequest(AIEmbedSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
  }

  const { title, content, sourceType } = validation.data;
  const sourceId = body.sourceId as string | undefined;

  const embedding = await embedText(`${title}\n${content}`);
  const supabase = getServiceClient();

  if (!supabase) {
    return NextResponse.json({ id: generateId(), embedded: true, mode: 'local' });
  }

  const id = `doc-${generateId()}`;
  const { error } = await supabase.from('knowledge_documents').upsert({
    id,
    tenant_id: guard.tenantId,
    title,
    content,
    source_type: sourceType,
    source_id: sourceId || null,
    embedding,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id, embedded: true });
}
