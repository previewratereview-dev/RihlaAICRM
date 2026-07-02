import { AIScore, ScoreBreakdown } from '@/types/ai';

export interface LeadData {
  dealValue: number;
  departureDate?: string;
  returnDate?: string;
  numberOfTravelers: number;
  specialRequests?: string;
  phone?: string;
  tripType?: string;
  travelClass?: string;
  leadSource?: string;
  createdAt: string;
}

export function calculateLeadScore(lead: LeadData): AIScore {
  const breakdown: ScoreBreakdown[] = [];
  let score = 50; // Base score
  const maxScore = 100;

  // 1. Budget/Value Signals (max +20)
  if (lead.dealValue >= 10000) {
    score += 20;
    breakdown.push({ label: 'High Value', points: 20, reason: `$${lead.dealValue.toLocaleString()} booking` });
  } else if (lead.dealValue >= 5000) {
    score += 15;
    breakdown.push({ label: 'Medium-High Value', points: 15, reason: `$${lead.dealValue.toLocaleString()} booking` });
  } else if (lead.dealValue >= 3000) {
    score += 10;
    breakdown.push({ label: 'Medium Value', points: 10, reason: `$${lead.dealValue.toLocaleString()} booking` });
  } else if (lead.dealValue >= 1000) {
    score += 5;
    breakdown.push({ label: 'Standard Value', points: 5, reason: `$${lead.dealValue.toLocaleString()} booking` });
  }

  // 2. Urgency/Time Signals (max +25)
  if (lead.departureDate) {
    const departure = new Date(lead.departureDate);
    const now = new Date();
    const daysUntilTrip = Math.ceil((departure.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilTrip <= 14 && daysUntilTrip > 0) {
      score += 25;
      breakdown.push({ label: 'Urgent Booking', points: 25, reason: `Departing in ${String(daysUntilTrip)} days` });
    } else if (daysUntilTrip <= 30 && daysUntilTrip > 0) {
      score += 15;
      breakdown.push({ label: 'Near-Term', points: 15, reason: `Departing in ${String(daysUntilTrip)} days` });
    } else if (daysUntilTrip <= 60 && daysUntilTrip > 0) {
      score += 10;
      breakdown.push({ label: 'Planned Ahead', points: 10, reason: `Departing in ${String(daysUntilTrip)} days` });
    } else if (daysUntilTrip > 60) {
      breakdown.push({ label: 'Long-Term Planning', points: 0, reason: `Departing in ${String(daysUntilTrip)} days (planning phase)` });
    }
  } else {
    breakdown.push({ label: 'No Dates Set', points: 0, reason: 'Missing departure date' });
  }

  // 3. Group Size/Family Signals (max +10)
  const travelers = lead.numberOfTravelers || 1;
  if (travelers >= 6) {
    score += 10;
    breakdown.push({ label: 'Large Group', points: 10, reason: `${travelers} travelers` });
  } else if (travelers >= 4) {
    score += 8;
    breakdown.push({ label: 'Family/Group', points: 8, reason: `${travelers} travelers` });
  } else if (travelers >= 2) {
    score += 5;
    breakdown.push({ label: 'Couple', points: 5, reason: `${travelers} travelers` });
  } else {
    breakdown.push({ label: 'Solo Traveler', points: 0, reason: '1 traveler' });
  }

  // 4. Engagement/Quality Signals (max +20)
  if (lead.specialRequests && lead.specialRequests.trim().length > 20) {
    score += 10;
    breakdown.push({ label: 'Detailed Request', points: 10, reason: 'Provided specific requirements' });
  }

  if (lead.phone && lead.phone.trim().length > 0) {
    score += 5;
    breakdown.push({ label: 'Phone Provided', points: 5, reason: 'Direct contact available' });
  }

  // Source quality
  if (lead.leadSource === 'referral') {
    score += 5;
    breakdown.push({ label: 'Referral', points: 5, reason: 'High-intent source' });
  } else if (lead.leadSource === 'website' || lead.leadSource === 'social_media') {
    breakdown.push({ label: 'Digital Source', points: 0, reason: 'Standard inquiry channel' });
  }

  // 5. Trip Type Premium (max +5)
  const tripType = (lead.tripType || '').toLowerCase();
  if (tripType.includes('honeymoon') || tripType.includes('luxury') || tripType.includes('premium')) {
    score += 5;
    breakdown.push({ label: 'Premium Trip', points: 5, reason: tripType });
  } else if (tripType.includes('family') || tripType.includes('group')) {
    score += 3;
    breakdown.push({ label: 'Group Trip', points: 3, reason: tripType });
  }

  // 6. Cabin/Service Class (max +5)
  const travelClass = (lead.travelClass || '').toLowerCase();
  if (travelClass === 'first' || travelClass === 'business') {
    score += 5;
    breakdown.push({ label: 'Premium Class', points: 5, reason: `${travelClass} class preference` });
  }

  // Ensure score is within bounds
  score = Math.max(50, Math.min(100, score));

  // Calculate percentage
  const percentage = Math.round((score / maxScore) * 100);

  // Add "Excellent Lead" note for high scores
  if (score >= 85) {
    breakdown.push({ label: 'Hot Lead', points: 0, reason: 'High conversion probability - prioritize immediately!' });
  } else if (score >= 70) {
    breakdown.push({ label: 'Warm Lead', points: 0, reason: 'Good potential - follow up within 24 hours' });
  } else if (score < 60) {
    breakdown.push({ label: 'Nurture', points: 0, reason: 'Low urgency - add to nurture sequence' });
  }

  return {
    score,
    maxScore,
    percentage,
    breakdown,
    calculatedAt: new Date().toISOString(),
    model: 'rule-based-v1',
  };
}

// Helper to get score color
export function getScoreColor(percentage: number): string {
  if (percentage >= 85) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (percentage >= 70) return 'text-blue-600 bg-blue-50 border-blue-200';
  if (percentage >= 60) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

// Helper to get score label
export function getScoreLabel(percentage: number): string {
  if (percentage >= 85) return 'Hot';
  if (percentage >= 70) return 'Warm';
  if (percentage >= 60) return 'Cool';
  return 'Cold';
}