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

    // Use admin client to insert the lead since webhooks don't have user session
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    if (!supabaseServiceKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const adminDb = createClient(supabaseUrl, supabaseServiceKey);
    
    // Ensure tenant exists (optional but good practice)
    const { data: tenant } = await adminDb
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .single();
      
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Map payload to Lead structure
    const now = new Date().toISOString();
    const leadId = `lead-${generateId()}`;
    
    const leadData = {
      id: leadId,
      tenant_id: tenantId,
      full_name: body.fullName || body.name || 'Unknown Lead',
      email: body.email || null,
      phone: body.phone || (body.whatsapp ? body.whatsapp : null),
      business_name: body.businessName || body.company || null,
      destination: body.destination || null,
      lead_source: body.leadSource || body.source || 'inbound_webhook',
      status: 'new',
      created_at: now,
      updated_at: now,
      ai_score: 0,
    };

    const { error } = await adminDb.from('leads').insert(leadData);

    if (error) {
      console.error('[Inbound Webhook] Database error', error);
      return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
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
