import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { AICompleteSchema, validateRequest } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const guard = await guardRoute(request, { scope: 'ai-complete', limit: 60 });
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await request.json();
    const validation = validateRequest(AICompleteSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { prompt, maxTokens } = validation.data;
    const feature = (body.feature as string) || 'chatbot_fallback';
    const model = body.model as string | undefined;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { content, usage } = await executeAIRequest({
      supabase,
      tenantId: guard.tenantId,
      feature,
      prompt,
      model,
      maxTokens: maxTokens || 150,
      userId: guard.user.id,
    });

    return NextResponse.json({
      content,
      usage: { total_tokens: usage ? usage.tokensIn + usage.tokensOut : 0 },
    });
  } catch (error) {
    logger.error('AI complete error', error);
    const message = error instanceof Error ? error.message : 'AI request failed';
    const isBudgetError = message.toLowerCase().includes('budget');
    return NextResponse.json(
      {
        error: message,
        content: isBudgetError
          ? 'AI quota exceeded. Please try again later.'
          : 'Something went wrong. Please try again.',
        usage: { total_tokens: 0 },
      },
      { status: isBudgetError ? 429 : 500 }
    );
  }
}
