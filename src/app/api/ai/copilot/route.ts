import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { embedText, rankBySimilarity, buildRAGContext } from '@/lib/ai/rag';
import { AICopilotSchema, validateRequest } from '@/lib/validation/schemas';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getServiceClientInstance() {
  if (!serviceKey || !supabaseUrl) return null;
  return createServiceClient(supabaseUrl, serviceKey);
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardRoute(request, { scope: 'copilot', limit: 30 });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateRequest(AICopilotSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { message, context } = validation.data;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    let ragContext = '';
    const serviceClient = getServiceClientInstance();

    if (serviceClient) {
      const queryEmbedding = await embedText(message);
      const { data: docs } = await serviceClient
        .from('knowledge_documents')
        .select('id, title, content, source_type, embedding')
        .eq('tenant_id', guard.tenantId)
        .limit(50);

      const { data: faqs } = await serviceClient
        .from('faq_entries')
        .select('id, question, answer, category')
        .eq('tenant_id', guard.tenantId)
        .limit(30);

      // Batch embed all FAQs in parallel
      const faqTexts = (faqs || []).map((f) => `${f.question}\n${f.answer}`);
      const faqEmbeddings = await Promise.all(faqTexts.map((t) => embedText(t)));

      const faqDocs = (faqs || []).map((f, i) => ({
        id: String(f.id),
        title: String(f.question),
        content: String(f.answer),
        sourceType: 'faq',
        embedding: faqEmbeddings[i],
      }));

      const allDocs = [
        ...(docs || []).map((d) => ({
          id: String(d.id),
          title: String(d.title),
          content: String(d.content),
          sourceType: String(d.source_type),
          embedding: d.embedding as number[] | null,
        })),
        ...faqDocs,
      ];

      const ranked = rankBySimilarity(queryEmbedding, allDocs, 4);
      ragContext = buildRAGContext(ranked);
    }

    const contextBlock = context
      ? `\n\nCurrent CRM context:\n${JSON.stringify(context, null, 2)}`
      : '';

    const prompt = ragContext
      ? `Use the knowledge base below to answer the user's question. If unsure, say so and suggest next steps.\n\nKnowledge base:\n${ragContext}${contextBlock}\n\nUser: ${message}`
      : `You are a CRM copilot for a travel agency. Help the agent with their question.${contextBlock}\n\nUser: ${message}`;

    const { content } = await executeAIRequest({
      supabase,
      tenantId: guard.tenantId,
      feature: 'global_copilot',
      prompt,
      maxTokens: 400,
      userId: guard.user.id,
    });

    return NextResponse.json({ content, hasRag: !!ragContext });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Copilot request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
