import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { faqEngine } from '@/lib/chatbot/faq-engine';
import { FAQUpsertSchema, validateRequest } from '@/lib/validation/schemas';

export async function GET(request: NextRequest) {
  // Auth + shared rate limit + server-resolved tenant (9.2, 9.4, 9.7, 8.2).
  const guard = await guardRoute(request, { scope: 'faq' });
  if (guard instanceof NextResponse) return guard;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from('faq_entries')
    .select('*')
    .eq('tenant_id', guard.tenantId)
    .order('created_at', { ascending: true });

  if (error || !data?.length) {
    return NextResponse.json({
      faqs: faqEngine.getAllEntries?.() || [],
      source: 'builtin',
    });
  }

  return NextResponse.json({
    faqs: data.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      category: String(row.category),
      question: String(row.question),
      answer: String(row.answer),
      keywords: (row.keywords as string[]) || [],
    })),
    source: 'database',
  });
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardRoute(request, { scope: 'faq' });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateRequest(FAQUpsertSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { faqs } = validation.data;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  for (const faq of faqs) {
    await supabase.from('faq_entries').upsert({
      id: faq.id,
      tenant_id: guard.tenantId,
      category: faq.category,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords || [],
      updated_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ ok: true, count: faqs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FAQ save failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
