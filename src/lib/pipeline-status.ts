import type { LeadStatus } from '@/types';

/** Maps legacy CRM status values to travel pipeline stages. */
export const LEGACY_STATUS_MAP: Record<string, LeadStatus> = {
  new: 'inquiry_received',
  contacted: 'initial_contact',
  interested: 'options_shared',
  demo_scheduled: 'consultation_booked',
  proposal_sent: 'itinerary_sent',
  negotiation: 'customizing_package',
  closed_won: 'booking_confirmed',
  closed_lost: 'booking_lost',
};

export function normalizeLeadStatus(status: string): LeadStatus {
  return (LEGACY_STATUS_MAP[status] ?? status) as LeadStatus;
}

export function isClosedStatus(status: string): boolean {
  const normalized = normalizeLeadStatus(status);
  return normalized === 'booking_confirmed' || normalized === 'booking_lost';
}
