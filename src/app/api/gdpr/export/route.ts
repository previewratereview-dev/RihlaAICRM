import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

/**
 * GET /api/gdpr/export
 *
 * Exports all data associated with the authenticated user's tenant.
 * Returns a JSON archive containing leads, tasks, conversations, messages,
 * activities, notes, and audit logs — structured for GDPR data portability.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRoute(request, { scope: 'gdpr-export' });
  if (guard instanceof NextResponse) return guard;

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const tenantId = guard.tenantId;

    // Fetch all tenant data in parallel
    const [leadsRes, tasksRes, conversationsRes, messagesRes, activitiesRes, notesRes, auditRes, settingsRes] =
      await Promise.all([
        supabase.from('leads').select('*').eq('tenant_id', tenantId),
        supabase.from('tasks').select('*').eq('tenant_id', tenantId),
        supabase.from('conversations').select('*').eq('tenant_id', tenantId),
        supabase.from('messages').select('*').eq('tenant_id', tenantId),
        supabase.from('activities').select('*').eq('tenant_id', tenantId),
        supabase.from('notes').select('*').eq('tenant_id', tenantId),
        supabase.from('audit_logs').select('*').eq('tenant_id', tenantId),
        supabase.from('settings').select('*').eq('tenant_id', tenantId).single(),
      ]);

    // Strip sensitive fields before export
    const settings = settingsRes.data
      ? { ...settingsRes.data, openai_key: '[REDACTED]', anthropic_key: '[REDACTED]' }
      : null;

    const exportData = {
      exportedAt: new Date().toISOString(),
      tenantId,
      counts: {
        leads: leadsRes.data?.length ?? 0,
        tasks: tasksRes.data?.length ?? 0,
        conversations: conversationsRes.data?.length ?? 0,
        messages: messagesRes.data?.length ?? 0,
        activities: activitiesRes.data?.length ?? 0,
        notes: notesRes.data?.length ?? 0,
        auditLogs: auditRes.data?.length ?? 0,
      },
      data: {
        leads: leadsRes.data ?? [],
        tasks: tasksRes.data ?? [],
        conversations: conversationsRes.data ?? [],
        messages: messagesRes.data ?? [],
        activities: activitiesRes.data ?? [],
        notes: notesRes.data ?? [],
        auditLogs: auditRes.data ?? [],
        settings,
      },
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="crm-export-${tenantId}-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
