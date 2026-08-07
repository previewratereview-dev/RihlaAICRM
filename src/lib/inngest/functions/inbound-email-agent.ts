import { inngest, emailInboundReceivedEvent } from "../client";
import { executeAIRequest } from "@/lib/ai/route-helper";
import { createClient } from "@supabase/supabase-js";
import { sendLeadFollowUpEmail } from "@/lib/integrations/email";

export const processInboundEmail = inngest.createFunction(
  { id: "process-inbound-email", triggers: [emailInboundReceivedEvent] },
  async ({ event, step }) => {
    const { leadId, conversationId, tenantId, emailContent } = event.data;

    return await step.run("analyze-and-respond", async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const adminDb = createClient(supabaseUrl, supabaseServiceKey);

      // Fetch lead details
      const { data: lead } = await adminDb
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();
        
      if (!lead) return { status: "failed", reason: "lead_not_found" };

      // Fetch conversation history
      const { data: messages } = await adminDb
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(10); // get last 10 messages for context

      const historyContext = (messages || []).map(m => 
        `[${m.sender_type === 'agent' || m.sender_type === 'system' ? 'AI Agent' : 'Lead'}]: ${m.content}`
      ).join('\n\n');

      const leadContext = `Lead Name: ${lead.full_name}\nDestination: ${lead.destination || 'Unknown'}\nStatus: ${lead.status}`;
      
      const prompt = `You are a highly intelligent and autonomous travel CRM agent.
Below is the details of a lead and their conversation history.
They have just sent a new inbound email.

${leadContext}

Conversation History:
${historyContext}

Latest Inbound Email from Lead:
${emailContent}

Instructions:
Evaluate the latest email. 
1. If it is an angry complaint, highly complex custom request, or explicitly asks for a human, reply ONLY with the word "ESCALATE: " followed by a brief summary of why.
2. If it is a standard inquiry, a follow-up question, or something you can confidently handle, write a warm, personalized, and concise email reply. Do NOT include placeholder brackets. Sign off as "The Travel Specialist Team". 

Your response will be processed automatically. If you write a reply, it will be emailed directly to the lead.`;

      const { content, blocked, blockReason } = await executeAIRequest({
        supabase: adminDb,
        tenantId,
        feature: 'autonomous_reply',
        prompt,
        maxTokens: 800,
        userId: null // System action
      });

      if (blocked) {
        console.log(`[Inbound Email Agent] Blocked for ${tenantId}. Reason: ${blockReason}`);
        return { status: "skipped", reason: blockReason };
      }

      const now = new Date().toISOString();

      if (content.trim().startsWith('ESCALATE')) {
        // Escalate by leaving a note
        await adminDb.from('notes').insert({
          id: `note-${Date.now()}`,
          lead_id: leadId,
          tenant_id: tenantId,
          author_id: 'system',
          author_name: 'AI Agent',
          content: `**[Requires Human Attention]**\n\nThe AI decided to escalate this email instead of auto-replying. Reason:\n${content.replace('ESCALATE:', '').trim()}`,
          created_at: now,
          updated_at: now,
        });

        // Update lead status to require attention
        await adminDb.from('leads').update({ status: 'action_required' }).eq('id', leadId);

        return { status: "escalated" };
      }

      // If not escalated, send the generated reply
      if (lead.email) {
        await sendLeadFollowUpEmail({
          tenantId: tenantId,
          fullName: lead.full_name,
          email: lead.email,
          destination: lead.destination,
          fromName: 'Travel Specialist Team',
          template: content,
        });
      }

      // Record the AI's reply in the conversation
      await adminDb.from('messages').insert({
        id: `msg-${Date.now()}`,
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: 'system',
        sender_name: 'AI Agent',
        content,
        message_type: 'email',
        is_read: true,
        tenant_id: tenantId,
        created_at: now,
      });

      // Update conversation last_message
      await adminDb.from('conversations').update({
        last_message: 'AI Auto-Reply Sent',
        last_message_at: now,
        updated_at: now,
      }).eq('id', conversationId);

      return { status: "auto-replied" };
    });
  }
);
