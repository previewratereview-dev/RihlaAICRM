import { Inngest, eventType, staticSchema } from "inngest";

export const leadCreatedEvent = eventType("app/lead.created", {
  schema: staticSchema<{
    leadId: string;
    tenantId: string;
  }>(),
});

export const inngest = new Inngest({
  id: "state-ai-crm",
});
