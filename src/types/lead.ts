import { Priority } from './common';
import type { ScoreBreakdown } from './ai';

export type LeadStatus =
  | 'inquiry_received'
  | 'initial_contact'
  | 'options_shared'
  | 'consultation_booked'
  | 'itinerary_sent'
  | 'follow_up'
  | 'customizing_package'
  | 'booking_confirmed'
  | 'booking_lost'
  // Backward-compatible aliases used by existing UI views
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'interested'
  | 'demo_scheduled'
  | 'proposal'
  | 'proposal_sent'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';

export type LeadSource =
  | 'website'
  | 'walk_in'
  | 'referral'
  | 'phone_inquiry'
  | 'email_inquiry'
  | 'travel_agent'
  | 'hotel_partner'
  | 'corporate'
  | 'travel_expo'
  | 'social_media'
  | 'linkedin'
  | 'cold_outreach'
  | 'instagram'
  | 'facebook'
  | 'google_ads'
  | 'event'
  | 'other';

export interface Lead {
  id: string;
  tenantId: string;
  fullName: string;
  email: string;
  phone: string;
  whatsapp: string;
  leadSource: LeadSource;
  // Travel-specific fields
  tripType: string;
  destination: string;
  country: string;
  city: string;
  numberOfTravelers: string;
  departureDate: string;
  returnDate: string;
  duration: string;
  travelClass: string;
  budget: string;
  dealValue: number;
  status: LeadStatus;
  priority: Priority;
  assignedTo: string;
  tags: string[];
  aiScore: number;
  aiSummary: string;
  specialRequests: string;
  sourceOfDiscovery: string;
  lastContacted: string;
  nextFollowUp: string;
  createdAt: string;
  updatedAt: string;
  consultationDate?: string;
  consultationTime?: string;
  meetingLink?: string;
  meetingNotes?: string;
  paymentStatus?: 'pending' | 'partial' | 'completed' | 'cancelled';
  bookingReference?: string;
  assignmentHistory?: LeadAssignmentHistory[];
  // Backward-compatible aliases for existing UI
  businessName?: string;
  industry?: string;
  website?: string;
  linkedin?: string;
  instagram?: string;
  employeeCount?: string;
  monthlyRevenue?: string;
  currentSoftware?: string;
  interestedService?: string;
  painPoints?: string;
  demoDate?: string;
  demoTime?: string;
  googleMeetLink?: string;
  meetingStatus?: 'pending' | 'completed' | 'cancelled' | '';
  followUpStatus?: string;
  aiScoreDetails?: ScoreBreakdown[];
  conversionProbability?: number;
}

export interface LeadAssignmentHistory {
  leadId?: string;
  previousOwnerId?: string;
  previousOwnerName?: string;
  newOwnerId?: string;
  newOwnerName?: string;
  changedById?: string;
  changedByName?: string;
  timestamp?: string;
  assignedTo?: string;
  assignedBy?: string;
  assignedAt?: string;
  note?: string;
  previousAssignee?: string;
  newAssignee?: string;
  changedBy?: string;
  [key: string]: any;
}

export interface LeadNote {
  id: string;
  tenantId: string;
  leadId: string;
  authorId: string;
  authorName: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  id: string;
  tenantId: string;
  leadId: string;
  userId: string;
  userName: string;
  type: 'status_change' | 'note_added' | 'call' | 'email' | 'meeting' | 'message' | 'created' | 'assigned';
  title: string;
  description: string;
  metadata?: Record<string, string>;
  isAutoTracked?: boolean;
  externalProviderId?: string;
  createdAt: string;
}

export interface LeadFilters {
  search: string;
  status: LeadStatus | 'all';
  source: LeadSource | 'all';
  priority: Priority | 'all';
  assignedTo: string | 'all';
}

export type CreateLeadDTO = Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'aiScore' | 'aiSummary'>;
