import { Inngest, eventType, staticSchema } from "inngest";

export const leadCreatedEvent = eventType("app/lead.created", {
  schema: staticSchema<{
    leadId: string;
    tenantId: string;
  }>(),
});

export const emailInboundReceivedEvent = eventType("app/email.inbound.received", {
  schema: staticSchema<{
    leadId: string;
    conversationId: string;
    tenantId: string;
    messageId: string;
    emailContent: string;
  }>(),
});

export const inngest = new Inngest({
  id: "state-ai-crm",
});
