import type { Lead } from '@/types';
import { dispatchWebhook, buildLeadWebhookPayload } from '@/lib/integrations/webhook';

export interface AutomationSettings {
  makeWebhookUrl?: string;
  emailAutomation?: boolean;
  emailStatusAutomation?: boolean;
  emailFromName?: string;
  emailReplyTo?: string;
  emailFollowUpTemplate?: string;
  whatsappAutomation?: boolean;
}

export interface WorkflowCondition {
  field: string;
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string | number;
}

export interface WorkflowAction {
  type: 'webhook' | 'email' | 'whatsapp' | 'assign' | 'create_task';
  config: Record<string, string>;
}

export interface WorkflowRule {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: 'lead.created' | 'lead.status_changed' | 'lead.score_updated' | 'meeting.booked';
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

function getLeadField(lead: Lead, field: string): unknown {
  const map: Record<string, unknown> = {
    status: lead.status,
    aiScore: lead.aiScore,
    priority: lead.priority,
    dealValue: lead.dealValue,
    destination: lead.destination,
    assignedTo: lead.assignedTo,
  };
  return map[field] ?? (lead as unknown as Record<string, unknown>)[field];
}

function evaluateCondition(lead: Lead, condition: WorkflowCondition): boolean {
  const actual = getLeadField(lead, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'eq':
      return String(actual) === String(expected);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return false;
  }
}

export function evaluateWorkflowRules(
  rules: WorkflowRule[],
  trigger: WorkflowRule['triggerType'],
  lead: Lead,
  context?: Record<string, unknown>
): WorkflowRule[] {
  void context; // reserved for future use
  return rules.filter(
    (rule) =>
      rule.enabled &&
      rule.triggerType === trigger &&
      rule.conditions.every((c) => evaluateCondition(lead, c))
  );
}

export async function executeWorkflowActions(
  rule: WorkflowRule,
  lead: Lead,
  settings: AutomationSettings,
  extraContext?: Record<string, unknown>
) {
  for (const action of rule.actions) {
    switch (action.type) {
      case 'webhook':
        if (settings.makeWebhookUrl) {
          await dispatchWebhook(
            settings.makeWebhookUrl,
            buildLeadWebhookPayload(
              { ...lead, workflowRule: rule.name, ...extraContext } as unknown as Record<string, unknown>,
              'workflow.triggered'
            )
          );
        }
        break;
      case 'email':
        if (lead.email) {
          const { sendLeadFollowUpEmail } = await import('@/lib/integrations/email');
          await sendLeadFollowUpEmail({
            tenantId: lead.tenantId,
            fullName: lead.fullName,
            email: lead.email,
            destination: lead.destination,
          });
        }
        break;
      case 'whatsapp':
        if (lead.phone || lead.whatsapp) {
          const { sendWhatsApp } = await import('@/lib/integrations/whatsapp');
          await sendWhatsApp(lead.tenantId, {
            to: lead.whatsapp || lead.phone,
            body: action.config.message || `Hi ${lead.fullName}, following up on your travel inquiry.`,
          });
        }
        break;
      default:
        break;
    }
  }
}

export async function runLeadCreatedAutomations(lead: Lead, settings: AutomationSettings) {
  if (settings.makeWebhookUrl) {
    await dispatchWebhook(settings.makeWebhookUrl, buildLeadWebhookPayload(lead as unknown as Record<string, unknown>, 'lead.created'));
  }
  if (settings.emailAutomation && lead.email) {
    const { sendLeadFollowUpEmail } = await import('@/lib/integrations/email');
    await sendLeadFollowUpEmail({
      tenantId: lead.tenantId,
      fullName: lead.fullName,
      email: lead.email,
      destination: lead.destination,
      fromName: settings.emailFromName,
      replyTo: settings.emailReplyTo,
      template: settings.emailFollowUpTemplate,
    });
  }
}

export async function runLeadStatusAutomations(
  lead: Lead,
  previousStatus: string,
  settings: AutomationSettings
) {
  if (settings.makeWebhookUrl) {
    await dispatchWebhook(
      settings.makeWebhookUrl,
      buildLeadWebhookPayload(
        { ...lead, previousStatus } as unknown as Record<string, unknown>,
        'lead.status_changed'
      )
    );
  }
  if (settings.emailStatusAutomation && lead.email) {
    const { sendLeadFollowUpEmail } = await import('@/lib/integrations/email');
    await sendLeadFollowUpEmail({
      tenantId: lead.tenantId,
      fullName: lead.fullName,
      email: lead.email,
      destination: lead.destination,
      fromName: settings.emailFromName,
      replyTo: settings.emailReplyTo,
      template: settings.emailFollowUpTemplate,
    });
  }
}

export async function runMeetingBookedAutomations(lead: Lead, settings: AutomationSettings) {
  if (settings.makeWebhookUrl) {
    await dispatchWebhook(settings.makeWebhookUrl, buildLeadWebhookPayload(lead as unknown as Record<string, unknown>, 'meeting.booked'));
  }
}

export async function runWorkflowAutomations(
  trigger: WorkflowRule['triggerType'],
  lead: Lead,
  rules: WorkflowRule[],
  settings: AutomationSettings
) {
  const matched = evaluateWorkflowRules(rules, trigger, lead);
  for (const rule of matched) {
    await executeWorkflowActions(rule, lead, settings);
  }
}

/** Default rules when none configured in DB. */
export const DEFAULT_WORKFLOW_RULES: WorkflowRule[] = [
  {
    id: 'hot-lead-assign',
    name: 'Hot lead alert',
    enabled: true,
    triggerType: 'lead.created',
    conditions: [{ field: 'aiScore', operator: 'gte', value: 80 }],
    actions: [{ type: 'webhook', config: {} }],
  },
  {
    id: 'booking-confirmed-email',
    name: 'Booking confirmed email',
    enabled: true,
    triggerType: 'lead.status_changed',
    conditions: [{ field: 'status', operator: 'eq', value: 'booking_confirmed' }],
    actions: [{ type: 'email', config: {} }],
  },
];
