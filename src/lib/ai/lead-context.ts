import type { Lead, LeadActivity, Message } from '@/types';

export function buildLeadContextBlock(lead: Lead, activities?: LeadActivity[], recentMessages?: Message[]): string {
  const parts = [
    `Lead: ${lead.fullName}`,
    `Email: ${lead.email}`,
    `Destination: ${lead.destination || 'not set'}`,
    `Trip: ${lead.tripType || 'general'} · ${lead.numberOfTravelers} travelers`,
    `Budget: ${lead.budget} · Deal value: $${lead.dealValue}`,
    `Status: ${lead.status} · Priority: ${lead.priority}`,
    `AI Score: ${lead.aiScore}%`,
    `Special requests: ${lead.specialRequests || 'none'}`,
    `Departure: ${lead.departureDate || 'TBD'}`,
  ];
  if (lead.painPoints) parts.push(`Pain points: ${lead.painPoints}`);
  if (lead.interestedService) parts.push(`Interested in: ${lead.interestedService}`);
  if (activities?.length) {
    parts.push('Recent activity: ' + activities.slice(0, 3).map((a) => a.title).join('; '));
  }
  if (recentMessages?.length) {
    parts.push(
      'Recent messages:\n' +
        recentMessages
          .slice(-6)
          .map((m) => `${m.senderName}: ${m.content}`)
          .join('\n')
    );
  }
  return parts.join('\n');
}

export async function fetchAIComplete(prompt: string, feature: string, maxTokens = 200): Promise<string> {
  try {
    const res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, feature, maxTokens }),
    });
    const data = await res.json();
    return data.content || '';
  } catch {
    return '';
  }
}
