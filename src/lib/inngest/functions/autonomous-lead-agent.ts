import { inngest, leadCreatedEvent } from "../client";
import { executeAIRequest } from "@/lib/ai/route-helper";
import { createClient } from "@supabase/supabase-js";
import { buildAiRuntime } from "@/lib/ai/runtime";
import { generateId } from "@/lib/utils";

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

      // Save AI-generated welcome draft as internal note (NOT a sent message)
      const now = new Date().toISOString();
      await adminDb.from('notes').insert({
        id: `note-${Date.now()}`,
        lead_id: leadId,
        tenant_id: tenantId,
        author_id: 'system',
        author_name: 'AI Agent',
        content: `📝 **[AI Draft — Welcome Email (not sent)]**\n\nThe following welcome email was prepared by AI for your review. Copy it into the email composer to send it to the lead.\n\n---\n\n${content}`,
        created_at: now,
        updated_at: now,
      });

      // AI-0 SAFETY: Do NOT insert into messages table.
      // An unsent AI draft must not appear in conversation history as if the customer received it.

      // AI-0 SAFETY: Do NOT call sendLeadFollowUpEmail.
      // AI-generated content must not be automatically transmitted to customers.

      // AI-0 SAFETY: Do NOT set lead.status to 'contacted'.
      // A prepared draft is NOT customer contact. Status must only advance
      // when a human actually sends a message to the customer.

      // Create a follow-up task so an agent reviews and sends the draft
      if (lead.email) {
        await adminDb.from('tasks').insert({
          id: `task-${generateId()}`,
          lead_id: leadId,
          lead_name: lead.full_name,
          tenant_id: tenantId,
          title: `[AI Draft] Review & send welcome email to ${lead.full_name}`,
          description: `AI prepared a welcome email draft for this new lead. Review the draft in the lead\'s notes and send via email composer if appropriate.\n\nDestination: ${lead.destination || 'Not specified'}\nSource: ${lead.lead_source || 'Website'}`,
          type: 'email',
          priority: 'high',
          status: 'pending',
          due_date: now.split('T')[0],
          assigned_to: lead.assigned_to || null,
          created_by: null,
          created_at: now,
          updated_at: now,
        });
      }

      // Record activity reflecting draft preparation, not email delivery
      await adminDb.from('activities').insert({
        id: `act-${Date.now()}`,
        lead_id: leadId,
        tenant_id: tenantId,
        user_id: 'system',
        user_name: 'AI Agent',
        type: 'ai_draft_prepared',
        title: 'AI Welcome Draft Prepared',
        description: `AI prepared a welcome email draft for review. No email was sent to the customer.`,
        created_at: now
      });

      return { status: "processed", leadId };
    });
  }
);
