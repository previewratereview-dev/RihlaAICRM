/**
 * CRM Copilot Prompt Builder (Phase AI-1)
 * 
 * Pure prompt generation for Rihla CRM Copilot.
 */
import type { CopilotContextResolution } from './crm-context-resolver';

/**
 * Builds the CRM Copilot system prompt with server-authoritative context.
 */
export function buildCrmCopilotPrompt(
  userQuery: string,
  context: CopilotContextResolution
): string {
  const { user, agency, page, entity, currentDate } = context;

  let contextDescription = `CURRENT USER:
- Name: ${user?.fullName || 'Agent'}
- Role: ${user?.role || 'agent'}
- Agency: ${agency?.agencyName || 'Travel Agency'}
- Date: ${currentDate || 'Unknown'}

CURRENT CRM VIEW:
- Route: ${page?.pathname || '/app/dashboard'}
- Section: ${page?.section || 'Dashboard'}
`;

  if (entity?.type === 'inquiry') {
    if (entity.recordUnavailable) {
      contextDescription += `\nSELECTED INQUIRY CONTEXT:
- Status: The selected inquiry is unavailable or not found in this workspace.`;
    } else if (entity.data) {
      const inq = entity.data;
      const expectedValStr = inq.expectedValue !== null ? `${inq.currency} ${inq.expectedValue}` : 'Not specified / Unknown';
      contextDescription += `\nSELECTED INQUIRY CONTEXT (Canonical Record):
- Inquiry ID: ${inq.id}
- Destination: ${inq.destination || 'Not specified'}
- Stage: ${inq.stage || 'new'}
- Priority: ${inq.priority || 'medium'}
- Expected Opportunity Value: ${expectedValStr} (Note: Opportunity estimate, not recognized revenue)
- Travelers Count: ${inq.travelersCount !== null ? inq.travelersCount : 'Not specified'}
- Departure Date: ${inq.departureDate || 'Not specified'}
- Return Date: ${inq.returnDate || 'Not specified'}
- Special Requirements: ${inq.requirements || 'None noted'}
- Assigned Agent ID: ${inq.assignedAgentId || 'Unassigned'}
- Created Date: ${inq.createdAt || 'Unknown'}`;

      if (inq.linkedTraveler) {
        contextDescription += `\n- Linked Traveler: ${inq.linkedTraveler.displayName || 'Unknown'} (Email: ${inq.linkedTraveler.emailAvailable ? 'Available' : 'None'}, Phone: ${inq.linkedTraveler.phoneAvailable ? 'Available' : 'None'})`;
      }
    }
  } else if (entity?.type === 'traveler') {
    if (entity.recordUnavailable) {
      contextDescription += `\nSELECTED TRAVELER CONTEXT:
- Status: The selected traveler profile is unavailable or not found in this workspace.`;
    } else if (entity.data) {
      const trav = entity.data;
      contextDescription += `\nSELECTED TRAVELER CONTEXT (Canonical Record):
- Traveler ID: ${trav.id}
- Display Name: ${trav.displayName || 'Unknown'}
- Preferred Language: ${trav.preferredLanguage || 'Not specified'}
- Contact: ${trav.hasEmail ? 'Email on file' : 'No email'}, ${trav.hasPhone ? 'Phone on file' : 'No phone'}
- Profile Created: ${trav.createdAt || 'Unknown'}`;
    }
  } else if (entity?.type === 'booking') {
    if (entity.recordUnavailable) {
      contextDescription += `\nSELECTED BOOKING CONTEXT:
- Status: The selected booking record is unavailable or not found in this workspace.`;
    } else if (entity.data) {
      const bk = entity.data;
      const totalStr = bk.totalAmount !== null ? String(bk.totalAmount) : 'Unknown / Incomplete';
      const paidStr = bk.paidAmount !== null ? String(bk.paidAmount) : 'Unknown / Incomplete';
      const balanceStr = bk.balanceDue !== null ? String(bk.balanceDue) : 'Unknown / Incomplete';

      contextDescription += `\nSELECTED BOOKING CONTEXT (Canonical Record):
- Booking ID: ${bk.id}
- Reference: ${bk.bookingReference || 'None'}
- Booking Status: ${bk.bookingStatus || 'pending'}
- Payment Status: ${bk.paymentStatus || 'pending'}
- Travel Dates: ${bk.departureDate || 'Unknown'} to ${bk.returnDate || 'Unknown'}
- Passengers: ${bk.passengerCount !== null ? bk.passengerCount : 'Unknown'}
- Total Amount: ${totalStr}
- Paid Amount: ${paidStr}
- Balance Due: ${balanceStr}
- Financial Data Complete: ${bk.financialDataComplete ? 'Yes' : 'No'}`;
    }
  } else if (entity?.type === 'conversation') {
    if (entity.recordUnavailable) {
      contextDescription += `\nSELECTED CONVERSATION CONTEXT:
- Status: The selected conversation is unavailable or not found in this workspace.`;
    } else if (entity.data) {
      const conv = entity.data;
      contextDescription += `\nSELECTED CONVERSATION CONTEXT:
- Conversation ID: ${conv.id}
- Channel: ${conv.channel || 'chat'}
- Status: ${conv.status || 'open'}
- Last Message At: ${conv.lastMessageAt || 'Unknown'}`;

      if (conv.recentMessages.length > 0) {
        contextDescription += `\n- Recent Messages:`;
        for (const msg of conv.recentMessages) {
          contextDescription += `\n  [${msg.senderName} (${msg.senderType})]: ${msg.content}`;
        }
      }
    }
  } else {
    contextDescription += `\nSELECTED ENTITY CONTEXT:
- No specific CRM record is currently open. You are viewing the ${page?.section || 'General CRM'} page.`;
  }

  const prompt = `You are Rihla Copilot, an intelligent assistant embedded inside the Rihla Travel CRM.
You assist the authenticated agency team member by reasoning about the CRM data currently visible in their workspace.

STRICT OPERATIONAL GUIDELINES:
1. Ground your answers strictly in the provided CRM CONTEXT below.
2. If the user asks about a specific inquiry, traveler, booking, or conversation:
   - Use the factual values from the provided canonical record.
   - If a specific field is "Not specified", "Unknown", or missing, state truthfully that it is not recorded.
   - Do NOT fabricate or assume details (e.g. do not guess hotel names, flight numbers, or pricing).
3. If no entity is currently selected and the user asks to inspect a specific record by name or ID:
   - State politely that no record is currently open in their view. Suggest navigating to or opening the record.
   - Do NOT claim you searched the entire database across records.
4. READ-ONLY SCOPE (MANDATORY):
   - You CANNOT perform database updates, change stages, create tasks, add notes, or send emails/SMS/WhatsApp.
   - If the user asks you to take an action (e.g. "Send an email to this client", "Update stage to confirmed", "Create a task"):
     - State clearly and concisely that direct action execution is not supported yet in Rihla Copilot.
     - You may provide a helpful text draft or guidance that the user can copy and perform manually.
5. FINANCIAL ACCURACY:
   - "Expected Opportunity Value" represents potential deal size, NOT recognized SaaS or booking revenue.
   - Preserve null/unknown financial states — never treat unknown financial values as ₹0.
6. Keep your answers concise, professional, and directly helpful to the travel agent.

${contextDescription}

USER QUERY:
${userQuery}`;

  return prompt;
}
