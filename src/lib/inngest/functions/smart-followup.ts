import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { executeAIRequest } from '@/lib/ai/route-helper';
import { generateId } from '@/lib/utils';
import { sendLeadFollowUpEmail } from '@/lib/integrations/email';

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

    // 2. For each lead, evaluate if we should send a smart follow up
    const results = [];
    for (const lead of leadsToFollowUp) {
      const result = await step.run(`process-followup-${lead.id}`, async () => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const db = createClient(supabaseUrl, supabaseServiceKey);

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
          // Send Email
          await sendLeadFollowUpEmail({
            tenantId: lead.tenant_id,
            fullName: lead.full_name,
            email: lead.email,
            destination: lead.destination,
            template: content
          });

          // Log in CRM
          const now = new Date().toISOString();
          
          await db.from('activities').insert({
            id: `act-${generateId()}`,
            lead_id: lead.id,
            tenant_id: lead.tenant_id,
            user_id: 'system',
            user_name: 'AI Agent',
            type: 'status_change',
            title: 'Smart Follow-up Sent',
            description: 'AI sent automated follow-up email after 3 days of inactivity.',
            created_at: now
          });

          // Update lead updated_at so it doesn't get followed up tomorrow
          await db.from('leads').update({ updated_at: now }).eq('id', lead.id);

          return { leadId: lead.id, status: 'sent' };
        }
        
        return { leadId: lead.id, status: 'no_email' };
      });
      results.push(result);
    }

    return { status: 'completed', processed: results.length, results };
  }
);
