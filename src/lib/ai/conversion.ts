import type { Lead } from '@/types';

export interface HistoricalStats {
  totalClosed: number;
  winRate: number;
  avgDealValue: number;
  sourceWinRates: Record<string, number>;
}

/** Compute historical stats from closed leads for ML-style weighting. */
export function computeHistoricalStats(leads: Lead[]): HistoricalStats {
  const closed = leads.filter(
    (l) => l.status === 'booking_confirmed' || l.status === 'closed_won' || l.status === 'booking_lost' || l.status === 'closed_lost'
  );
  const won = closed.filter((l) => l.status === 'booking_confirmed' || l.status === 'closed_won');
  const totalClosed = closed.length;
  const winRate = totalClosed > 0 ? won.length / totalClosed : 0.25;
  const avgDealValue = won.length > 0 ? won.reduce((s, l) => s + l.dealValue, 0) / won.length : 5000;

  const sourceWinRates: Record<string, number> = {};
  const sources = [...new Set(leads.map((l) => l.leadSource))];
  for (const source of sources) {
    const sourceLeads = closed.filter((l) => l.leadSource === source);
    const sourceWon = sourceLeads.filter((l) => l.status === 'booking_confirmed' || l.status === 'closed_won');
    sourceWinRates[source] = sourceLeads.length > 0 ? sourceWon.length / sourceLeads.length : winRate;
  }

  return { totalClosed, winRate, avgDealValue, sourceWinRates };
}

/** Heuristic conversion probability with historical data weighting. */
export function predictConversionProbability(lead: Lead, historical?: HistoricalStats): number {
  let prob = 0.15;

  if (lead.aiScore >= 85) prob += 0.35;
  else if (lead.aiScore >= 70) prob += 0.22;
  else if (lead.aiScore >= 60) prob += 0.12;

  const stageBoost: Record<string, number> = {
    closed_won: 1,
    booking_confirmed: 0.85,
    customizing_package: 0.7,
    itinerary_sent: 0.55,
    consultation_booked: 0.5,
    demo_scheduled: 0.45,
    proposal_sent: 0.4,
    negotiation: 0.35,
    interested: 0.3,
    contacted: 0.2,
    inquiry_received: 0.15,
    new: 0.12,
    closed_lost: 0,
    booking_lost: 0,
  };
  prob += stageBoost[lead.status] ?? 0.1;

  if (lead.priority === 'urgent') prob += 0.08;
  if (lead.priority === 'high') prob += 0.05;
  if (lead.departureDate) {
    const days = Math.ceil((new Date(lead.departureDate).getTime() - Date.now()) / 86400000);
    if (days > 0 && days <= 30) prob += 0.1;
    if (days > 0 && days <= 14) prob += 0.08;
  }
  if (lead.email) prob += 0.03;
  if (lead.phone || lead.whatsapp) prob += 0.03;

  if (historical && historical.totalClosed >= 5) {
    const sourceRate = historical.sourceWinRates[lead.leadSource] ?? historical.winRate;
    prob = prob * 0.7 + sourceRate * 0.3;

    if (lead.dealValue >= historical.avgDealValue) {
      prob += 0.05;
    }
  }

  return Math.min(0.98, Math.max(0.02, prob));
}
