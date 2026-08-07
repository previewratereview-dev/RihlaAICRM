import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { generateId } from '@/lib/utils';

// Helper to get admin Supabase client
function getAdminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const processInboundMessage = inngest.createFunction(
  { id: 'state-ai-crm-process-inbound', triggers: [{ event: 'crm/message.received' }] },
  async ({ event, step }) => {
    const { tenantId, provider, channel, senderPhone, senderName, content } = event.data;
    
    // Deduplication & Lead Matching
    const lead = await step.run('find-or-create-lead', async () => {
      const db = getAdminDb();
      // Search for an existing lead by phone
      const { data: existingLeads } = await db
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone', senderPhone);
        
      if (existingLeads && existingLeads.length > 0) {
        return existingLeads[0];
      }
      
      // If no lead exists, create a new one
      const newLead = {
        id: `lead-${generateId()}`,
        tenant_id: tenantId,
        full_name: senderName || 'Unknown Lead',
        phone: senderPhone,
        lead_source: provider,
        status: 'new',
        ai_score: 0,
      };
      
      await db.from('leads').insert(newLead);
      return newLead;
    });

    // Create or find Conversation
    const conversation = await step.run('find-or-create-conversation', async () => {
      const db = getAdminDb();
      let { data: existingConv } = await db
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('lead_id', lead.id)
        .eq('channel', channel)
        .maybeSingle();
        
      if (!existingConv) {
        existingConv = {
          id: `conv-${generateId()}`,
          tenant_id: tenantId,
          lead_id: lead.id,
          channel: channel,
          status: 'open',
          unread_count: 0,
        };
        await db.from('conversations').insert(existingConv);
      }
      return existingConv;
    });

    // Insert Message
    await step.run('insert-message', async () => {
      const db = getAdminDb();
      const message = {
        id: `msg-${generateId()}`,
        tenant_id: tenantId,
        conversation_id: conversation.id,
        sender_type: 'contact',
        sender_id: lead.id,
        sender_name: senderName || 'Unknown',
        content: content,
        message_type: 'text',
      };
      
      await db.from('messages').insert(message);
      
      // Update Conversation unread count and last message
      await db.from('conversations').update({
        unread_count: (conversation.unread_count || 0) + 1,
        last_message: content,
        last_message_at: new Date().toISOString()
      }).eq('id', conversation.id);
    });

    // Fire AI Triage Event
    await step.sendEvent('trigger-ai-triage', {
      name: 'crm/ai.triage',
      data: {
        tenantId,
        leadId: lead.id,
        conversationId: conversation.id,
        messageContent: content,
      }
    });

    return { success: true, leadId: lead.id, conversationId: conversation.id };
  }
);
