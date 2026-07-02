import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { AIConversationSchema, validateRequest } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const guard = await guardRoute(request, { scope: 'ai-conversation', limit: 60 });
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await request.json();
    const validation = validateRequest(AIConversationSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { action, messages } = validation.data;
    const leadContext = body.leadContext as string | undefined;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const thread = Array.isArray(messages)
      ? messages.map((m) => `${m.role}: ${m.content}`).join('\n')
      : '';

    let prompt = '';
    let feature = 'conversation_ai';
    let maxTokens = 300;

    switch (action) {
      case 'summarize':
        prompt = `Summarize this travel CRM conversation in 3-5 bullet points. Note booking intent, objections, and next steps.\n\n${thread}`;
        maxTokens = 250;
        break;
      case 'suggest_replies':
        prompt = `Suggest 3 short reply options for the travel agent responding to this thread. Format as numbered list.\n\n${thread}`;
        maxTokens = 200;
        break;
      case 'lead_summary':
        prompt = `Write a 2-sentence AI lead summary for this travel lead. Be specific and actionable.\n\n${leadContext}`;
        feature = 'lead_summary';
        maxTokens = 120;
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const { content } = await executeAIRequest({
      supabase,
      tenantId: guard.tenantId,
      feature,
      prompt,
      maxTokens,
      userId: guard.user.id,
    });

    return NextResponse.json({ content });
  } catch (error) {
    logger.error('AI conversation error', error);
    return NextResponse.json(
      { error: 'Failed to process AI request' },
      { status: 500 }
    );
  }
}
