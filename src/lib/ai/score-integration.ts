import { calculateLeadScore } from '@/lib/ai/lead-scoring';
import { predictConversionProbability } from '@/lib/ai/conversion';
import type { Lead } from '@/types';

export function enrichLeadWithAIScore(lead: Lead): Lead {
  const scoreResult = calculateLeadScore({
    dealValue: lead.dealValue || 0,
    departureDate: lead.departureDate,
    returnDate: lead.returnDate,
    numberOfTravelers: parseInt(lead.numberOfTravelers) || 1,
    specialRequests: lead.specialRequests,
    phone: lead.phone,
    tripType: lead.tripType,
    travelClass: lead.travelClass,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt || new Date().toISOString(),
  });

  const conversionProbability = predictConversionProbability({
    ...lead,
    aiScore: scoreResult.score,
  });

  return {
    ...lead,
    aiScore: scoreResult.score,
    aiSummary: buildAISummary(scoreResult),
    aiScoreDetails: scoreResult.breakdown,
    conversionProbability: Math.round(conversionProbability * 100),
  } as Lead;
}

export function enrichLeadsWithAIScores(leads: Lead[]): Lead[] {
  return leads.map((lead) => enrichLeadWithAIScore(lead));
}

function buildAISummary(scoreResult: ReturnType<typeof calculateLeadScore>): string {
  const topFactors = scoreResult.breakdown
    .filter((b) => b.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((b) => b.label)
    .join(', ');

  if (scoreResult.percentage >= 85) {
    return `Hot lead with strong signals: ${topFactors}. High conversion probability - prioritize immediately.`;
  }

  if (scoreResult.percentage >= 70) {
    return `Warm lead with good potential. Key factors: ${topFactors}. Follow up within 24 hours.`;
  }

  if (scoreResult.percentage >= 60) {
    return `Moderate lead. Factors: ${topFactors}. Nurture with targeted follow-up.`;
  }

  return `Lower priority lead. Factors: ${topFactors || 'missing key information'}. Add to nurture sequence.`;
}

/** Fetch LLM summary for high-value leads; falls back to template on failure. */
export async function fetchLLMSummaryForLead(
  lead: Lead,
  scoreResult: ReturnType<typeof calculateLeadScore>
): Promise<string> {
  if (scoreResult.percentage < 80) {
    return buildAISummary(scoreResult);
  }

  try {
    const { buildLeadContextBlock } = await import('@/lib/ai/lead-context');
    const res = await fetch('/api/ai/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'lead_summary',
        leadContext: buildLeadContextBlock(lead),
      }),
    });
    const data = await res.json();
    if (data.content && !data.content.includes('travel specialists')) {
      return data.content;
    }
  } catch {
    // fall through to template
  }
  return buildAISummary(scoreResult);
}