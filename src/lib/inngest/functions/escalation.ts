import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { sendAdminNotification } from '@/lib/integrations/notifications';
import { generateId } from '@/lib/utils';

function getAdminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const processAITriage = inngest.createFunction(
  { id: 'state-ai-crm-ai-triage', triggers: [{ event: 'crm/ai.triage' }] },
  async ({ event, step }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- conversationId preserved in event schema for future use
    const { tenantId, leadId, conversationId, messageContent } = event.data;

    // 1. Triage the message
    const triageResult = await step.run('triage-message', async () => {
      const db = getAdminDb();
      
      // Get lead info
      const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
      
      const prompt = `You are a helpful travel CRM AI assistant. 
The lead ${lead?.full_name} said: "${messageContent}".
If they are asking for pricing, complex quotes, or something outside basic knowledge, you MUST escalate.
Reply EXACTLY with "ESCALATE: <brief reason>" if human help is needed. 
Otherwise, reply with the helpful response to the user.`;

      const { content, blocked } = await executeAIRequest({
        supabase: db,
        tenantId,
        feature: 'ai_triage',
        prompt,
        maxTokens: 300,
        userId: null
      });

      return { content, blocked, lead };
    });

    if (triageResult.blocked) {
      console.log(`[AI Triage] Blocked for ${tenantId}. Skipping automated reply.`);
      return { status: 'skipped', reason: 'blocked' };
    }

    const { content, lead } = triageResult;
    const isEscalation = content.startsWith('ESCALATE:');

    if (isEscalation) {
      // 2. Notify Admin and Wait for Reply — preserved
      await step.run('notify-admin', async () => {
        const reason = content.replace('ESCALATE:', '').trim();
        const msg = `AI Escalation for Lead ${lead?.full_name}: ${reason}\n\nUser said: "${messageContent}"\n\nPlease reply to this notification with the pricing/details, and the AI will formulate the quote and send it.`;
        
        await sendAdminNotification({
          tenantId,
          message: msg
        });

        // Add an internal note to the CRM so they see it in the UI
        const db = getAdminDb();
        await db.from('notes').insert({
          id: `note-${generateId()}`,
          lead_id: leadId,
          tenant_id: tenantId,
          author_id: 'system',
          author_name: 'AI Agent',
          content: `🚨 **ESCALATION PENDING**: Admin notified via SMS/WhatsApp/Email.\nReason: ${reason}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });

      // 3. Wait for Admin Reply — preserved
      const adminReplyEvent = await step.waitForEvent('wait-for-admin', {
        event: 'crm/admin.replied',
        timeout: '24h',
        match: 'data.conversationId'
      });

      if (!adminReplyEvent) {
        // Admin didn't reply in 24 hours. Fallback — preserved
        await step.run('handle-timeout', async () => {
           const db = getAdminDb();
           await db.from('notes').insert({
             id: `note-${generateId()}`,
             lead_id: leadId,
             tenant_id: tenantId,
             author_id: 'system',
             author_name: 'AI Agent',
             content: `⚠️ **ESCALATION TIMEOUT**: Admin did not reply within 24 hours.`,
             created_at: new Date().toISOString(),
             updated_at: new Date().toISOString(),
           });
        });
        return { status: 'timeout' };
      }

      // 4. Draft Quote/Final Reply based on Admin's input
      // AI-0 SAFETY: Admin provided factual content, but AI reformulates it.
      // The exact generated text was NOT reviewed by the human before insertion.
      // Save as internal draft + quote record instead of inserting as a "sent" message.
      const adminInput = adminReplyEvent.data.content;
      await step.run('prepare-escalated-reply', async () => {
        const db = getAdminDb();
        const prompt = `You are a helpful travel CRM AI assistant. 
The lead asked: "${messageContent}".
The human travel agent provided this information to answer them: "${adminInput}".
Write a professional, friendly response to the lead incorporating the human agent's details (like pricing/quotes). Do not mention that you are an AI passing along a message.`;

        const { content: finalReply } = await executeAIRequest({
          supabase: db,
          tenantId,
          feature: 'ai_escalation_reply',
          prompt,
          maxTokens: 500,
          userId: null
        });

        const now = new Date().toISOString();
        
        // AI-0/AI-4 SAFETY: Do NOT insert into quotes_itineraries.
        // AI must not autonomously create Quote or Itinerary database rows.
        // Save the AI-synthesized content exclusively as an internal draft note for human review.

        // AI-0 SAFETY: Do NOT insert into messages table.
        // The AI reformulated the admin's input — the exact generated text was not
        // reviewed by the human. Save as internal draft note instead.
        await db.from('notes').insert({
          id: `note-${generateId()}`,
          lead_id: leadId,
          tenant_id: tenantId,
          author_id: 'system',
          author_name: 'AI Agent',
          content: `📝 **[AI Draft — Escalation Reply (not sent)]**\n\nAdmin provided pricing/details. AI prepared the following response for your review:\n\n---\n\n${finalReply}`,
          created_at: now,
          updated_at: now,
        });
      });

      return { status: 'escalation_draft_prepared' };

    } else {
      // 5. Non-urgent AI response
      // AI-0 SAFETY: This was previously auto-inserting AI content into the
      // conversation as sender_type 'agent'. The customer would see AI-generated
      // text as if an agent wrote it, with no human review.
      // Save as internal draft note instead.
      await step.run('prepare-ai-reply', async () => {
        const db = getAdminDb();
        const now = new Date().toISOString();
        
        await db.from('notes').insert({
          id: `note-${generateId()}`,
          lead_id: leadId,
          tenant_id: tenantId,
          author_id: 'system',
          author_name: 'AI Agent',
          content: `📝 **[AI Draft — Triage Reply (not sent)]**\n\nAI prepared the following response to an inbound message. Review and send via the conversation view if appropriate.\n\n---\n\n${content}`,
          created_at: now,
          updated_at: now,
        });
      });

      return { status: 'draft_prepared' };
    }
  }
);
