import { Lead } from '@/types';
import { isClosedStatus } from '@/lib/pipeline-status';

/**
 * Centralized Typed Metrics Engine for Rihla CRM (Phase 1).
 * Ensures Dashboard, Analytics, Header, Pipeline, and Directory views
 * derive metrics consistently from canonical logic without inventing data.
 */

export interface CRMMetricsSummary {
  totalInquiries: number;
  openInquiries: number;
  confirmedBookings: number;
  activeBookingsLabel: string;
  uniqueTravelersCount: number;
  repeatClientsCount: number;
  recognizedRevenue: number;
  pipelineEstimatedValue: number;
  overdueFollowUpsCount: number;
  conversionRate: number;
  avgDealSize: number;
}

/**
 * Normalizes email or phone for unique traveler identification in current schema.
 */
export function getTravelerKey(lead: Lead): string {
  if (lead.email && lead.email.trim()) {
    return lead.email.trim().toLowerCase();
  }
  if (lead.phone && lead.phone.trim()) {
    return lead.phone.trim().replace(/\D/g, '');
  }
  return lead.fullName.trim().toLowerCase();
}

/**
 * Calculates canonical CRM metrics from current store leads.
 */
export function calculateCRMMetrics(leads: Lead[]): CRMMetricsSummary {
  const totalInquiries = leads.length;

  const openInquiriesLeads = leads.filter((l) => !isClosedStatus(l.status));
  const openInquiries = openInquiriesLeads.length;

  const confirmedLeads = leads.filter(
    (l) => l.status === 'booking_confirmed' || l.status === 'closed_won'
  );
  const confirmedBookings = confirmedLeads.length;

  const lostLeads = leads.filter(
    (l) => l.status === 'booking_lost' || l.status === 'closed_lost'
  );
  const totalClosed = confirmedBookings + lostLeads.length;
  const conversionRate = totalClosed > 0 ? Math.round((confirmedBookings / totalClosed) * 100) : 0;

  const recognizedRevenue = confirmedLeads.reduce(
    (sum, l) => sum + (typeof l.dealValue === 'number' ? l.dealValue : 0),
    0
  );

  const avgDealSize = confirmedBookings > 0 ? Math.round(recognizedRevenue / confirmedBookings) : 0;

  const pipelineEstimatedValue = openInquiriesLeads.reduce(
    (sum, l) => sum + (typeof l.dealValue === 'number' ? l.dealValue : 0),
    0
  );

  // Unique traveler deduplication
  const travelerKeys = new Set<string>();
  const travelerCounts: Record<string, number> = {};

  leads.forEach((l) => {
    const key = getTravelerKey(l);
    if (key) {
      travelerKeys.add(key);
      travelerCounts[key] = (travelerCounts[key] || 0) + 1;
    }
  });

  const uniqueTravelersCount = travelerKeys.size;
  const repeatClientsCount = Object.values(travelerCounts).filter((c) => c > 1).length;

  const now = new Date();
  const overdueFollowUpsCount = openInquiriesLeads.filter(
    (l) => l.nextFollowUp && new Date(l.nextFollowUp) < now
  ).length;

  return {
    totalInquiries,
    openInquiries,
    confirmedBookings,
    activeBookingsLabel: `${confirmedBookings} Confirmed`,
    uniqueTravelersCount,
    repeatClientsCount,
    recognizedRevenue,
    pipelineEstimatedValue,
    overdueFollowUpsCount,
    conversionRate,
    avgDealSize,
  };
}
