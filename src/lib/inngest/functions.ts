import { processNewLead } from "./functions/autonomous-lead-agent";
import { processInboundMessage } from "./functions/omnichannel";
import { processAITriage } from "./functions/escalation";
import { smartFollowUpCron } from "./functions/smart-followup";
import { processInboundEmail } from "./functions/inbound-email-agent";

export const functions = [
  processNewLead,
  processInboundMessage,
  processAITriage,
  smartFollowUpCron,
  processInboundEmail,
];
