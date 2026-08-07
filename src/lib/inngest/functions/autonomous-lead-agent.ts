import { inngest, leadCreatedEvent } from "../client";
import { executeAIRequest } from "@/lib/ai/route-helper";
import { createClient } from "@supabase/supabase-js";
import { buildAiRuntime } from "@/lib/ai/runtime";
import { sendLeadFollowUpEmail } from "@/lib/integrations/email";

export const processNewLead = inngest.createFunction(
  { id: "process-new-lead", triggers: [leadCreatedEvent] },
  async ({ event, step }) => {
    const { leadId, tenantId } = event.data;

    // Simulate human delay before responding
    await step.sleep("simulate-delay", "30s");

    return await step.run("process-lead", async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const adminDb = createClient(supabaseUrl, supabaseServiceKey);

      // Check paywall
      const runtime = await buildAiRuntime(adminDb, tenantId);
      if (tenantId !== 'global' && runtime.tier === 'free') {
        console.log(`[Autonomous AI] Tenant ${tenantId} is on free tier. Skipping.`);
        return { status: "skipped", reason: "free_tier" };
      }

      // Fetch lead details
      const { data: lead } = await adminDb
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();
        
      if (!lead) return { status: "failed", reason: "lead_not_found" };

      const leadContext = `Lead: ${lead.full_name}, Destination: ${lead.destination || 'Unknown'}, Source: ${lead.lead_source}`;
      
      // Generate AI reply using the multi-provider BYOK logic built into executeAIRequest
      const prompt = `Write a personalized welcome email for this travel lead. Acknowledge their destination and let them know a travel specialist will be in touch shortly to help plan their trip. Make it highly engaging, warm, and professional. Keep it concise. Do NOT include an itinerary. Sign off as "The Travel Specialist Team". Do not include any placeholder brackets like [Your Name].\nInclude a simple, non-promotional Subject line at the top (e.g., "Subject: Following up on your trip to ${lead.destination || 'your destination'}"). Avoid all marketing buzzwords in the subject.\n\n${leadContext}`;
      
      const { content, blocked, blockReason } = await executeAIRequest({
        supabase: adminDb,
        tenantId,
        feature: 'autonomous_reply',
        prompt,
        maxTokens: 500,
        userId: null // System action
      });

      if (blocked) {
        console.log(`[Autonomous AI] Blocked for ${tenantId}. Reason: ${blockReason}`);
        return { status: "skipped", reason: blockReason };
      }

      // Save as draft note to the lead in CRM
      // Save as draft note to the lead in CRM
      const now = new Date().toISOString();
      await adminDb.from('notes').insert({
        id: `note-${Date.now()}`,
        lead_id: leadId,
        tenant_id: tenantId,
        author_id: 'system',
        author_name: 'AI Agent',
        content: `**[Generated Auto-Reply / Itinerary]**\n\n${content}`,
        created_at: now,
        updated_at: now,
      });

      // Also record this outreach in conversations
      const convId = `conv-${Date.now()}`;
      await adminDb.from('conversations').insert({
        id: convId,
        lead_id: leadId,
        lead_name: lead.full_name,
        lead_email: lead.email,
        channel: 'email',
        status: 'open',
        last_message: 'Automated Welcome Email Sent',
        last_message_at: now,
        tenant_id: tenantId,
        created_at: now,
        updated_at: now,
      });

      await adminDb.from('messages').insert({
        id: `msg-${Date.now()}`,
        conversation_id: convId,
        sender_type: 'agent',
        sender_id: 'system',
        sender_name: 'AI Agent',
        content,
        message_type: 'email',
        is_read: true,
        tenant_id: tenantId,
        created_at: now,
      });

      // True Automation: Actually send the email if they have one
      if (lead.email) {
        await sendLeadFollowUpEmail({
          tenantId,
          fullName: lead.full_name,
          email: lead.email,
          destination: lead.destination,
          template: content
        });

        // Advance pipeline status from 'new' to 'contacted'
        await adminDb.from('leads').update({ status: 'contacted', updated_at: now }).eq('id', leadId);

        // Record Activity Log
        await adminDb.from('activities').insert({
          id: `act-${Date.now()}`,
          lead_id: leadId,
          tenant_id: tenantId,
          user_id: 'system',
          user_name: 'AI Agent',
          type: 'status_change',
          title: 'Automated Outreach Sent',
          description: 'AI sent automated welcome email and moved lead to Contacted.',
          created_at: now
        });
      }

      return { status: "processed", leadId };
    });
  }
);
