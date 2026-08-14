export interface TravelerProfile {
  id: string;
  tenantId: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  normalizedPhone?: string | null;
  preferredLanguage?: string | null;
  specialNotes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryEntity {
  id: string;
  tenantId: string;
  travelerId: string;
  legacyLeadId?: string | null;
  destination?: string | null;
  leadSource: string;
  priority: string;
  pipelineStage: string;
  expectedValue?: number | null;
  currency: string;
  assignedAgentId?: string | null;
  lastContactedAt?: string | null;
  nextFollowUpAt?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  externalSource?: string | null;
  externalEventId?: string | null;
  identityReviewRequired: boolean;
  identityReviewReason?: string | null;
  proposedDisplayName?: string | null;
  proposedEmail?: string | null;
  proposedPhone?: string | null;
}

export interface BookingEntity {
  id: string;
  tenantId: string;
  travelerId: string;
  inquiryId?: string | null;
  legacyLeadId?: string | null;
  bookingReference: string;
  departureDate?: string | null;
  returnDate?: string | null;
  passengerCount?: number | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  balanceDue?: number | null;
  currency: string;
  bookingStatus: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  financialDataComplete: boolean;
  assignedAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface TravelerDirectoryItem {
  id: string;
  tenantId: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  normalizedPhone?: string | null;
  inquiriesCount: number;
  bookingsCount: number;
  latestDestination?: string | null;
  customerValue?: number | null; // null if no financial_data_complete = true bookings
  hasIdentityReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TravelerKPIs {
  totalTravelers: number;
  repeatTravelers: number;
  activeCustomers: number;
}

export interface InquiryDirectoryItem {
  inquiryId: string;
  legacyLeadId: string | null;
  travelerId: string;
  travelerDisplayName: string;
  travelerEmail: string | null;
  travelerPhone: string | null;
  destination: string | null;
  pipelineStage: string;
  priority: string;
  expectedValue: number | null;
  currency: string;
  leadSource: string;
  assignedAgentId: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  identityReviewRequired: boolean;
  identityReviewReason: string | null;
  createdAt: string;
}
