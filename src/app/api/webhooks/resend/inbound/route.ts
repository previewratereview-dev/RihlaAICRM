import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateId } from '@/lib/utils';
import { inngest } from '@/lib/inngest/client';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    
    const { from, subject, text, html, email_id, message_id } = payload;
    
    if (!from) {
      return NextResponse.json({ error: 'Missing from address' }, { status: 400 });
    }

    const fromEmailMatch = from.match(/<([^>]+)>/);
    const fromEmail = fromEmailMatch ? fromEmailMatch[1].toLowerCase() : from.toLowerCase().trim();
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const adminDb = createClient(supabaseUrl, supabaseServiceKey);

    const extMessageId = email_id || message_id || payload.headers?.['message-id'] || `msg-${Date.now()}`;
    
    // Check Server-Side Runtime Write Freeze Status
    const { data: freezeActive } = await adminDb.rpc('is_write_freeze_active');
    if (freezeActive) {
      // Deduplicate & Persist in Durable Event Queue
      const { data: existingQueue } = await adminDb
        .from('inbound_event_queue')
        .select('id')
        .eq('event_type', 'resend_email_webhook')
        .eq('payload->>external_message_id', extMessageId)
        .single();

      if (!existingQueue) {
        await adminDb.from('inbound_event_queue').insert({
          tenant_id: 'global',
          event_type: 'resend_email_webhook',
          payload: { ...payload, external_message_id: extMessageId },
          status: 'pending',
        });
      }

      return NextResponse.json({ success: true, queued: true, message: 'Inbound email accepted and queued during database maintenance' }, { status: 202 });
    }
    
    // Attempt to find an existing lead by email across all tenants
    let { data: lead } = await adminDb
      .from('leads')
      .select('*')
      .eq('email', fromEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
      
    let leadId = lead?.id;
    let tenantId = lead?.tenant_id || 'global';
    const now = new Date().toISOString();

    if (!lead) {
      leadId = `lead-${generateId()}`;
      const newLeadData = {
        full_name: from.split('<')[0].trim() || fromEmail,
        email: fromEmail,
        lead_source: 'email',
        status: 'new',
        external_source: 'resend:email',
        external_event_id: extMessageId,
      };

      // Invoke C0 RPC
      const { error: insertError } = await adminDb.rpc('sync_lead_service_role', {
        p_tenant_id: tenantId,
        p_lead_id: leadId,
        p_payload: newLeadData,
      });

      if (insertError) {
        console.error('[Inbound Email] Failed to create new lead:', insertError);
        return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
      }
    }
    
    // Find or create conversation for this lead
    const { data: conversation } = await adminDb
      .from('conversations')
      .select('*')
      .eq('lead_id', leadId)
      .eq('channel', 'email')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();
      
    let conversationId = conversation?.id;
    
    if (!conversation) {
      conversationId = `conv-${Date.now()}`;
      await adminDb.from('conversations').insert({
        id: conversationId,
        lead_id: leadId,
        lead_name: from.split('<')[0].trim() || fromEmail,
        lead_email: fromEmail,
        channel: 'email',
        status: 'open',
        last_message: subject || 'New Inbound Email',
        last_message_at: now,
        external_message_id: extMessageId,
        tenant_id: tenantId,
        created_at: now,
        updated_at: now,
      });
    } else {
      await adminDb.from('conversations').update({
        last_message: subject || 'New Inbound Email',
        last_message_at: now,
        updated_at: now,
        status: 'open'
      }).eq('id', conversationId);
    }
    
    const messageId = `msg-${Date.now()}`;
    const emailContent = text || html || '[No content]';
    
    await adminDb.from('messages').insert({
      id: messageId,
      conversation_id: conversationId,
      sender_type: 'lead',
      sender_id: leadId,
      sender_name: from.split('<')[0].trim() || fromEmail,
      content: emailContent,
      message_type: 'email',
      is_read: false,
      tenant_id: tenantId,
      created_at: now,
    });
    
    await inngest.send({
      name: 'app/email.inbound.received',
      data: {
        leadId,
        conversationId,
        tenantId,
        messageId,
        emailContent
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Inbound Email] Webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
