import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateId } from '@/lib/utils';
import { inngest } from '@/lib/inngest/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    if (!supabaseServiceKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const adminDb = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: tenant } = await adminDb
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .single();
      
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check Server-Side Runtime Write Freeze Status
    const { data: freezeActive } = await adminDb.rpc('is_write_freeze_active');
    if (freezeActive) {
      // Durable Event Queue: Persist inbound event for processing post-freeze
      await adminDb.from('inbound_event_queue').insert({
        tenant_id: tenantId,
        event_type: 'form_webhook',
        payload: body,
        status: 'pending',
      });
      // Return HTTP 202 Accepted to provider with queue confirmation
      return NextResponse.json({ success: true, queued: true, message: 'Inbound event accepted and queued during database maintenance' }, { status: 202 });
    }

    const leadId = `lead-${generateId()}`;
    
    const payload = {
      full_name: body.fullName || body.name || 'Unknown Lead',
      email: body.email || null,
      phone: body.phone || (body.whatsapp ? body.whatsapp : null),
      destination: body.destination || null,
      lead_source: body.leadSource || body.source || 'inbound_webhook',
      status: 'new',
      external_source: 'webhook:form',
      external_event_id: body.submissionId || body.eventId || `evt-${Date.now()}`,
    };

    // Invoke Stage C0 Dual-Write RPC
    const { error } = await adminDb.rpc('sync_lead_service_role', {
      p_tenant_id: tenantId,
      p_lead_id: leadId,
      p_payload: payload,
    });

    if (error) {
      console.error('[Inbound Webhook] RPC error', error);
      return NextResponse.json({ error: 'Failed to process lead dual-write' }, { status: 500 });
    }

    // Trigger Autonomous AI Workflow
    await inngest.send({
      name: 'app/lead.created',
      data: {
        leadId,
        tenantId,
      },
    });

    return NextResponse.json({ success: true, leadId });
  } catch (error) {
    console.error('[Inbound Webhook] Error processing request', error);
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
}
