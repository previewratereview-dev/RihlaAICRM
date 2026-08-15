import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { generateId } from '@/lib/utils';

export const smartFollowUpCron = inngest.createFunction(
  { id: 'state-ai-crm-smart-followup', triggers: [{ cron: '0 10 * * *' }] }, // Runs every day at 10 AM
  async ({ step }) => {
    // 1. Fetch leads that have been in 'contacted' or 'quoted' status for > 3 days with no recent activity
    const leadsToFollowUp = await step.run('fetch-stale-leads', async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const db = createClient(supabaseUrl, supabaseServiceKey);

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const { data: leads } = await db
        .from('leads')
        .select('*')
        .in('status', ['contacted', 'quoted'])
        .lt('updated_at', threeDaysAgo.toISOString())
        .limit(50); // Process in batches

      return leads || [];
    });

    if (leadsToFollowUp.length === 0) {
      return { status: 'no_stale_leads' };
    }

    // 2. For each lead, evaluate if we should prepare a follow-up recommendation
    const results = [];
    for (const lead of leadsToFollowUp) {
      const result = await step.run(`process-followup-${lead.id}`, async () => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const db = createClient(supabaseUrl, supabaseServiceKey);

        // IDEMPOTENCY CHECK: Do not create duplicate unresolved follow-up tasks.
        // If an open AI-generated follow-up task already exists for this lead, skip.
        const { data: existingTasks } = await db
          .from('tasks')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('tenant_id', lead.tenant_id)
          .in('status', ['pending', 'in_progress'])
          .like('title', '[AI Follow-up]%')
          .limit(1);

        if (existingTasks && existingTasks.length > 0) {
          return { leadId: lead.id, status: 'skipped', reason: 'existing_open_followup_task' };
        }

        const prompt = `You are a professional travel agent. 
This lead (${lead.full_name}, Destination: ${lead.destination || 'Unknown'}) was last contacted 3+ days ago.
Draft a short, engaging follow-up email asking if they have any questions about their trip or quote. Keep it under 3 sentences.`;

        const { content, blocked } = await executeAIRequest({
          supabase: db,
          tenantId: lead.tenant_id,
          feature: 'smart_followup',
          prompt,
          maxTokens: 200,
          userId: null
        });

        if (blocked) return { leadId: lead.id, status: 'blocked' };

        if (lead.email) {
          // AI-0 SAFETY: Do NOT call sendLeadFollowUpEmail.
          // AI-generated content must not be automatically transmitted to customers.

          const now = new Date().toISOString();

          // Calculate days since last update for context
          const lastUpdate = new Date(lead.updated_at);
          const daysSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));

          // Save AI-generated follow-up draft as internal note
          await db.from('notes').insert({
            id: `note-${generateId()}`,
            lead_id: lead.id,
            tenant_id: lead.tenant_id,
            author_id: 'system',
            author_name: 'AI Agent',
            content: `📝 **[AI Follow-up Draft (not sent)]**\n\nThis lead has been inactive for ${daysSinceUpdate} days. AI prepared the following follow-up email for your review:\n\n---\n\n${content}`,
            created_at: now,
            updated_at: now,
          });

          // Create actionable follow-up task assigned to lead owner
          await db.from('tasks').insert({
            id: `task-${generateId()}`,
            lead_id: lead.id,
            lead_name: lead.full_name,
            tenant_id: lead.tenant_id,
            title: `[AI Follow-up] Follow up with ${lead.full_name} — stale ${daysSinceUpdate} days`,
            description: `This lead has been inactive for ${daysSinceUpdate} days in "${lead.status}" status. AI prepared a follow-up email draft — see the lead's notes. Review and send via email composer if appropriate.\n\nDestination: ${lead.destination || 'Not specified'}`,
            type: 'follow_up',
            priority: 'medium',
            status: 'pending',
            due_date: now.split('T')[0],
            assigned_to: lead.assigned_to || null,
            created_by: null,
            created_at: now,
            updated_at: now,
          });

          // Log activity reflecting recommendation, not email delivery
          await db.from('activities').insert({
            id: `act-${generateId()}`,
            lead_id: lead.id,
            tenant_id: lead.tenant_id,
            user_id: 'system',
            user_name: 'AI Agent',
            type: 'ai_followup_recommended',
            title: 'AI Follow-up Recommended',
            description: `AI detected ${daysSinceUpdate} days of inactivity and prepared a follow-up draft. No email was sent.`,
            created_at: now
          });

          // AI-0 SAFETY: Do NOT update leads.updated_at here.
          // AI recommending a follow-up is NOT genuine customer/business activity.
          // The stale detection query uses updated_at to find inactive leads.
          // Mutating it here would suppress future stale detection without real activity.
          // Instead, the idempotency check on existing open tasks prevents duplicate spam.

          return { leadId: lead.id, status: 'draft_prepared' };
        }
        
        return { leadId: lead.id, status: 'no_email' };
      });
      results.push(result);
    }

    return { status: 'completed', processed: results.length, results };
  }
);
