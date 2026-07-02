import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { AILeadActionSchema, validateRequest } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  try {
    const guard = await guardRoute(request, { scope: 'lead-action', limit: 40 });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateRequest(AILeadActionSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { action, leadContext, extra } = validation.data;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    let prompt = '';
    switch (action) {
      case 'draft_email':
        prompt = `Write a professional follow-up email for this travel lead. Keep it under 150 words, warm and actionable.\n\n${leadContext}\n\n${extra || ''}`;
        break;
      case 'next_action':
        prompt = `Based on this lead, suggest ONE specific next action for the travel agent (call, email, send itinerary, book consultation). Format: ACTION: ... REASON: ...\n\n${leadContext}`;
        break;
      case 'meeting_prep':
        prompt = `Create a meeting prep brief for a travel consultation. Sections: Summary, Key Questions, Objections to Address, Recommended Packages. Max 250 words.\n\n${leadContext}`;
        break;
      case 'contact_reply':
        prompt = `You are the traveler/customer in this scenario. Reply naturally in 1-3 sentences as the lead would respond to their travel agent.\n\n${leadContext}\n\nAgent message: ${extra}`;
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const maxTokens = action === 'meeting_prep' ? 400 : 250;
    const { content } = await executeAIRequest({
      supabase,
      tenantId: guard.tenantId,
      feature: `lead_${action}`,
      prompt,
      maxTokens,
      userId: guard.user.id,
    });

    if (content.includes('budget limit') || content.includes('travel specialists')) {
      const fallback = action === 'draft_email'
        ? `Hi,\n\nThank you for your inquiry. We'd love to help plan your trip. When would be a good time for a quick call?\n\nBest regards`
        : content;
      return NextResponse.json({ content: fallback });
    }

    return NextResponse.json({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
