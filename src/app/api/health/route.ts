import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, string> = {};

  // Supabase connectivity
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const start = Date.now();
    const { error } = await supabase.from('tenants').select('id').limit(1);
    checks.supabase = error ? `error: ${error.message}` : `ok (${Date.now() - start}ms)`;
  } catch (e) {
    checks.supabase = `error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  // Environment checks (never expose values)
  checks.env_supabase_url = process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'missing';
  checks.env_supabase_anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'set' : 'missing';
  checks.env_razorpay = process.env.RAZORPAY_KEY_SECRET ? 'set' : 'missing';
  checks.env_openai = process.env.OPENAI_API_KEY ? 'set' : 'missing';
  checks.env_anthropic = process.env.ANTHROPIC_API_KEY ? 'set' : 'missing';

  const healthy = checks.supabase?.startsWith('ok');

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
}
