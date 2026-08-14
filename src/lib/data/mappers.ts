/**
 * Snake_case (database) <-> camelCase (domain) mapping for tenant-owned records.
 * Extracted from the legacy `db-service.ts` monolith as part of the Data Access Layer refactor.
 */
import type {
  Lead,
  LeadNote,
  LeadActivity,
  Conversation,
  Message,
  Task,
  User,
  UserRole,
  AuditLog,
} from '@/types';
import type { TaskType, TaskStatus } from '@/types/task';
import type { Channel, ConversationStatus, MessageType, SenderType } from '@/types/conversation';
import type { ScoreBreakdown } from '@/types/ai';

// ====================================================================
// TYPED DB ROW INTERFACES
// ====================================================================
export interface DbLeadRow {
  id: string;
  tenant_id?: string | null;
  full_name: string;
  business_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  lead_source?: string | null;
  employee_count?: string | null;
  monthly_revenue?: string | null;
  current_software?: string | null;
  interested_service?: string | null;
  pain_points?: string | null;
  budget?: string | null;
  status?: string | null;
  priority?: string | null;
  deal_value?: number | null;
  assigned_to?: string | null;
  tags?: string[] | null;
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_score_details?: ScoreBreakdown[] | null;
  last_contacted?: string | null;
  next_follow_up?: string | null;
  created_at: string;
  updated_at: string;
  trip_type?: string | null;
  destination?: string | null;
  number_of_travelers?: string | null;
  departure_date?: string | null;
  return_date?: string | null;
  duration?: string | null;
  travel_class?: string | null;
  special_requests?: string | null;
  source_of_discovery?: string | null;
  payment_status?: string | null;
  booking_reference?: string | null;
  consultation_date?: string | null;
  consultation_time?: string | null;
  meeting_link?: string | null;
  meeting_notes?: string | null;
  demo_date?: string | null;
  demo_time?: string | null;
  google_meet_link?: string | null;
  meeting_status?: string | null;
  follow_up_status?: string | null;
  assignment_history?: string | unknown[] | null;
}

// Helper: Translate DB snake_case object to camelCase Lead object
export function mapDbLead(dbLead: DbLeadRow): Lead {
  return {
    id: dbLead.id,
    tenantId: dbLead.tenant_id || '',
    fullName: dbLead.full_name,
    businessName: dbLead.business_name || '',
    email: dbLead.email || '',
    phone: dbLead.phone || '',
    whatsapp: dbLead.phone || '', // Map phone to whatsapp for consistency
    website: dbLead.website || '',
    industry: dbLead.industry || '',
    country: dbLead.country || '',
    city: dbLead.city || '',
    linkedin: dbLead.linkedin || '',
    instagram: dbLead.instagram || '',
    leadSource: (dbLead.lead_source || 'website') as Lead['leadSource'],
    employeeCount: dbLead.employee_count || '1-10',
    monthlyRevenue: dbLead.monthly_revenue || '₹0',
    currentSoftware: dbLead.current_software || '',
    interestedService: dbLead.interested_service || '',
    painPoints: dbLead.pain_points || '',
    budget: dbLead.budget || '₹0',
    status: (dbLead.status || 'new') as Lead['status'],
    priority: (dbLead.priority || 'medium') as Lead['priority'],
    dealValue: Number(dbLead.deal_value) || 0,
    assignedTo: dbLead.assigned_to || '',
    tags: Array.isArray(dbLead.tags) ? dbLead.tags : [],
    aiScore: Number(dbLead.ai_score) || 0,
    aiSummary: dbLead.ai_summary || '',
    aiScoreDetails: Array.isArray(dbLead.ai_score_details) ? (dbLead.ai_score_details as ScoreBreakdown[]) : undefined,
    lastContacted: dbLead.last_contacted || '',
    nextFollowUp: dbLead.next_follow_up || '',
    createdAt: dbLead.created_at,
    updatedAt: dbLead.updated_at,
    tripType: dbLead.trip_type || '',
    destination: dbLead.destination || '',
    numberOfTravelers: dbLead.number_of_travelers || '1',
    departureDate: dbLead.departure_date || '',
    returnDate: dbLead.return_date || '',
    duration: dbLead.duration || '',
    travelClass: dbLead.travel_class || 'economy',
    specialRequests: dbLead.special_requests || '',
    sourceOfDiscovery: dbLead.source_of_discovery || '',
    paymentStatus: (dbLead.payment_status || undefined) as Lead['paymentStatus'],
    bookingReference: dbLead.booking_reference || undefined,
    consultationDate: dbLead.consultation_date || undefined,
    consultationTime: dbLead.consultation_time || undefined,
    meetingLink: dbLead.meeting_link || undefined,
    meetingNotes: dbLead.meeting_notes || undefined,
    demoDate: dbLead.demo_date || '',
    demoTime: dbLead.demo_time || '',
    googleMeetLink: dbLead.google_meet_link || '',
    meetingStatus: (dbLead.meeting_status || '') as Lead['meetingStatus'],
    followUpStatus: (dbLead.follow_up_status || '') as Lead['followUpStatus'],
    assignmentHistory: dbLead.assignment_history
      ? typeof dbLead.assignment_history === 'string'
        ? JSON.parse(dbLead.assignment_history)
        : dbLead.assignment_history
      : [],
  };
}

// Helper: Translate camelCase Lead object to DB snake_case object
export function mapLeadToDb(lead: Partial<Lead>): Record<string, unknown> {
  const dbObj: Record<string, unknown> = {};
  if (lead.id !== undefined) dbObj.id = lead.id;
  if (lead.tenantId !== undefined) dbObj.tenant_id = lead.tenantId;
  if (lead.fullName !== undefined) dbObj.full_name = lead.fullName;
  if (lead.businessName !== undefined) dbObj.business_name = lead.businessName;
  if (lead.email !== undefined) dbObj.email = lead.email;
  if (lead.phone !== undefined) dbObj.phone = lead.phone;
  if (lead.website !== undefined) dbObj.website = lead.website;
  if (lead.industry !== undefined) dbObj.industry = lead.industry;
  if (lead.country !== undefined) dbObj.country = lead.country;
  if (lead.city !== undefined) dbObj.city = lead.city;
  if (lead.linkedin !== undefined) dbObj.linkedin = lead.linkedin;
  if (lead.instagram !== undefined) dbObj.instagram = lead.instagram;
  if (lead.leadSource !== undefined) dbObj.lead_source = lead.leadSource;
  if (lead.employeeCount !== undefined) dbObj.employee_count = lead.employeeCount;
  if (lead.monthlyRevenue !== undefined) dbObj.monthly_revenue = lead.monthlyRevenue;
  if (lead.currentSoftware !== undefined) dbObj.current_software = lead.currentSoftware;
  if (lead.interestedService !== undefined) dbObj.interested_service = lead.interestedService;
  if (lead.painPoints !== undefined) dbObj.pain_points = lead.painPoints;
  if (lead.budget !== undefined) dbObj.budget = lead.budget;
  if (lead.status !== undefined) dbObj.status = lead.status;
  if (lead.priority !== undefined) dbObj.priority = lead.priority;
  if (lead.dealValue !== undefined) dbObj.deal_value = lead.dealValue;
  if (lead.assignedTo !== undefined) dbObj.assigned_to = lead.assignedTo || null;
  if (lead.tags !== undefined) dbObj.tags = lead.tags;
  if (lead.aiScore !== undefined) dbObj.ai_score = lead.aiScore;
  if (lead.aiSummary !== undefined) dbObj.ai_summary = lead.aiSummary;
  if (lead.aiScoreDetails !== undefined) dbObj.ai_score_details = lead.aiScoreDetails;
  if (lead.lastContacted !== undefined) dbObj.last_contacted = lead.lastContacted;
  if (lead.nextFollowUp !== undefined) dbObj.next_follow_up = lead.nextFollowUp;
  if (lead.demoDate !== undefined) dbObj.demo_date = lead.demoDate;
  if (lead.demoTime !== undefined) dbObj.demo_time = lead.demoTime;
  if (lead.googleMeetLink !== undefined) dbObj.google_meet_link = lead.googleMeetLink;
  if (lead.selectedTravelerId !== undefined) dbObj.selected_traveler_id = lead.selectedTravelerId;
  if (lead.meetingStatus !== undefined) dbObj.meeting_status = lead.meetingStatus;
  if (lead.meetingNotes !== undefined) dbObj.meeting_notes = lead.meetingNotes;
  if (lead.followUpStatus !== undefined) dbObj.follow_up_status = lead.followUpStatus;
  if (lead.tripType !== undefined) dbObj.trip_type = lead.tripType;
  if (lead.destination !== undefined) dbObj.destination = lead.destination;
  if (lead.numberOfTravelers !== undefined) dbObj.number_of_travelers = lead.numberOfTravelers;
  if (lead.departureDate !== undefined) dbObj.departure_date = lead.departureDate;
  if (lead.returnDate !== undefined) dbObj.return_date = lead.returnDate;
  if (lead.duration !== undefined) dbObj.duration = lead.duration;
  if (lead.travelClass !== undefined) dbObj.travel_class = lead.travelClass;
  if (lead.specialRequests !== undefined) dbObj.special_requests = lead.specialRequests;
  if (lead.sourceOfDiscovery !== undefined) dbObj.source_of_discovery = lead.sourceOfDiscovery;
  if (lead.paymentStatus !== undefined) dbObj.payment_status = lead.paymentStatus;
  if (lead.bookingReference !== undefined) dbObj.booking_reference = lead.bookingReference;
  if (lead.consultationDate !== undefined) dbObj.consultation_date = lead.consultationDate;
  if (lead.consultationTime !== undefined) dbObj.consultation_time = lead.consultationTime;
  if (lead.meetingLink !== undefined) dbObj.meeting_link = lead.meetingLink;
  if (lead.assignmentHistory !== undefined) dbObj.assignment_history = lead.assignmentHistory;
  return dbObj;
}

// Helper: Translate DB snake_case Task
export function mapDbTask(dbTask: Record<string, unknown>): Task {
  return {
    id: String(dbTask.id),
    tenantId: String(dbTask.tenant_id || ''),
    title: String(dbTask.title),
    description: String(dbTask.description || ''),
    type: String(dbTask.type || 'follow_up') as TaskType,
    priority: String(dbTask.priority || 'medium') as Task['priority'],
    status: String(dbTask.status || 'pending') as TaskStatus,
    dueDate: String(dbTask.due_date),
    leadId: dbTask.lead_id ? String(dbTask.lead_id) : undefined,
    leadName: dbTask.lead_name ? String(dbTask.lead_name) : undefined,
    assignedTo: String(dbTask.assigned_to || ''),
    assignedName: String((dbTask.profiles as Record<string, unknown>)?.full_name || 'Unassigned'),
    createdBy: String(dbTask.created_by || ''),
    completedAt: dbTask.completed_at ? String(dbTask.completed_at) : undefined,
    createdAt: String(dbTask.created_at),
    updatedAt: String(dbTask.updated_at),
    meetingType: (dbTask.meeting_type || 'follow_up') as Task['meetingType'],
    meetingOutcome: (dbTask.meeting_outcome || 'pending') as Task['meetingOutcome'],
    googleMeetLink: String(dbTask.google_meet_link || ''),
    meetingNotes: String(dbTask.meeting_notes || ''),
    updates: dbTask.updates
      ? typeof dbTask.updates === 'string'
        ? JSON.parse(dbTask.updates)
        : dbTask.updates
      : [],
  };
}

// Helper: Translate Task to DB snake_case
export function mapTaskToDb(task: Partial<Task>): Record<string, unknown> {
  const dbObj: Record<string, unknown> = {};
  if (task.id !== undefined) dbObj.id = task.id;
  if (task.tenantId !== undefined) dbObj.tenant_id = task.tenantId;
  if (task.title !== undefined) dbObj.title = task.title;
  if (task.description !== undefined) dbObj.description = task.description;
  if (task.type !== undefined) dbObj.type = task.type;
  if (task.priority !== undefined) dbObj.priority = task.priority;
  if (task.status !== undefined) dbObj.status = task.status;
  if (task.dueDate !== undefined) dbObj.due_date = task.dueDate;
  if (task.leadId !== undefined) dbObj.lead_id = task.leadId || null;
  if (task.leadName !== undefined) dbObj.lead_name = task.leadName;
  if (task.assignedTo !== undefined) dbObj.assigned_to = task.assignedTo || null;
  if (task.createdBy !== undefined) dbObj.created_by = task.createdBy || null;
  if (task.completedAt !== undefined) dbObj.completed_at = task.completedAt || null;
  if (task.meetingType !== undefined) dbObj.meeting_type = task.meetingType;
  if (task.meetingOutcome !== undefined) dbObj.meeting_outcome = task.meetingOutcome;
  if (task.googleMeetLink !== undefined) dbObj.google_meet_link = task.googleMeetLink;
  if (task.meetingNotes !== undefined) dbObj.meeting_notes = task.meetingNotes;
  if (task.updates !== undefined) dbObj.updates = task.updates;
  return dbObj;
}

// Helper: Translate DB snake_case Conversation
export function mapDbConversation(dbC: Record<string, unknown>): Conversation {
  return {
    id: String(dbC.id),
    tenantId: String(dbC.tenant_id || ''),
    leadId: dbC.lead_id ? String(dbC.lead_id) : null,
    travelerId: dbC.traveler_id ? String(dbC.traveler_id) : null,
    inquiryId: dbC.inquiry_id ? String(dbC.inquiry_id) : null,
    bookingId: dbC.booking_id ? String(dbC.booking_id) : null,
    leadName: String(dbC.lead_name || 'Traveler'),
    leadAvatar: '',
    leadCompany: String(dbC.lead_company || ''),
    leadEmail: dbC.lead_email ? String(dbC.lead_email) : (dbC.email ? String(dbC.email) : undefined),
    channel: String(dbC.channel || 'whatsapp') as Channel,
    assignedTo: String(dbC.assigned_to || ''),
    assignedName: String(dbC.assigned_name || 'Sarah Chen'),
    status: String(dbC.status || 'open') as ConversationStatus,
    lastMessage: String(dbC.last_message || ''),
    lastMessageAt: String(dbC.last_message_at || ''),
    unreadCount: Number(dbC.unread_count) || 0,
    isOnline: true,
    phone: String(dbC.phone || ''),
  };
}

export function mapConversationToDb(conv: Conversation, tenantId: string): Record<string, unknown> {
  const isDemoUser = typeof conv.assignedTo === 'string' && !conv.assignedTo.includes('-');
  return {
    id: conv.id,
    tenant_id: tenantId,
    lead_id: conv.leadId || null,
    traveler_id: conv.travelerId || null,
    inquiry_id: conv.inquiryId || null,
    booking_id: conv.bookingId || null,
    lead_name: conv.leadName,
    lead_company: conv.leadCompany,
    lead_email: conv.leadEmail || null,
    channel: conv.channel,
    assigned_to: isDemoUser ? null : (conv.assignedTo || null),
    assigned_name: conv.assignedName,
    status: conv.status,
    last_message: conv.lastMessage,
    last_message_at: conv.lastMessageAt,
    unread_count: conv.unreadCount,
    phone: conv.phone,
  };
}

// Helper: Translate DB snake_case Message
export function mapDbMessage(dbM: Record<string, unknown>): Message {
  return {
    id: String(dbM.id),
    conversationId: String(dbM.conversation_id),
    senderType: String(dbM.sender_type) as SenderType,
    senderId: String(dbM.sender_id || ''),
    senderName: String(dbM.sender_name || 'System'),
    content: String(dbM.content),
    messageType: String(dbM.message_type || 'text') as MessageType,
    isRead: Boolean(dbM.is_read),
    createdAt: String(dbM.created_at),
  };
}

export function mapMessageToDb(message: Message, tenantId: string): Record<string, unknown> {
  return {
    id: message.id,
    tenant_id: tenantId,
    conversation_id: message.conversationId,
    sender_type: message.senderType,
    sender_id: message.senderId,
    sender_name: message.senderName,
    content: message.content,
    message_type: message.messageType,
    is_read: message.isRead,
    created_at: message.createdAt,
  };
}

// Helper: Translate DB snake_case Note
export function mapDbNote(dbN: Record<string, unknown>): LeadNote {
  return {
    id: String(dbN.id),
    tenantId: String(dbN.tenant_id || ''),
    leadId: String(dbN.lead_id),
    authorId: String(dbN.author_id),
    authorName: String(dbN.author_name),
    content: String(dbN.content),
    isPinned: Boolean(dbN.is_pinned),
    createdAt: String(dbN.created_at),
    updatedAt: String(dbN.updated_at),
  };
}

export function mapNoteToDb(note: LeadNote, tenantId: string): Record<string, unknown> {
  return {
    id: note.id,
    tenant_id: tenantId,
    lead_id: note.leadId,
    author_id: note.authorId,
    author_name: note.authorName,
    content: note.content,
    is_pinned: note.isPinned,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
}

// Helper: Translate DB snake_case Activity
export function mapDbActivity(dbA: Record<string, unknown>): LeadActivity {
  return {
    id: String(dbA.id),
    tenantId: String(dbA.tenant_id || ''),
    leadId: String(dbA.lead_id),
    userId: String(dbA.user_id),
    userName: String(dbA.user_name),
    type: String(dbA.type) as LeadActivity['type'],
    title: String(dbA.title),
    description: String(dbA.description),
    createdAt: String(dbA.created_at),
  };
}

export function mapActivityToDb(act: LeadActivity, tenantId: string): Record<string, unknown> {
  return {
    id: act.id,
    tenant_id: tenantId,
    lead_id: act.leadId,
    user_id: act.userId,
    user_name: act.userName,
    type: act.type,
    title: act.title,
    description: act.description,
    created_at: act.createdAt,
  };
}

// Helper: Translate DB profile row to a User
export function mapDbProfile(profile: Record<string, unknown>): User {
  return {
    id: String(profile.id),
    tenantId: String(profile.tenant_id || ''),
    fullName: String(profile.full_name || (String(profile.email)).split('@')[0]),
    email: String(profile.email),
    role: profile.role as UserRole,
    avatarUrl: '',
    phone: String(profile.phone || ''),
    isOnline: Boolean(profile.is_online),
    status: (String(profile.status || 'active')) as 'active' | 'deactivated',
  };
}

// Helper: Translate DB audit-log row
export function mapDbAuditLog(dbL: Record<string, unknown>): AuditLog {
  return {
    id: String(dbL.id),
    tenantId: String(dbL.tenant_id || ''),
    userId: String(dbL.user_id),
    userName: String(dbL.user_name),
    userRole: dbL.user_role as UserRole,
    action: dbL.action as AuditLog['action'],
    details: String(dbL.details),
    createdAt: String(dbL.created_at),
  };
}
