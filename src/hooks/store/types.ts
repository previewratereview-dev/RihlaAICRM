import type { Lead, LeadNote, LeadActivity, Conversation, Message, Task, User, AuditLog, TaskStatus, Tenant, TenantWithStats, PlatformUser } from '@/types';
import type { TenantFeatures } from '@/lib/tenant/config';

export interface Settings {
  agencyName: string;
  logoText: string;
  accentColor: string;
  systemPrompt: string;
  makeWebhookUrl: string;
  emailAutomation: boolean;
  emailStatusAutomation: boolean;
  emailFromName: string;
  emailReplyTo: string;
  emailFollowUpTemplate: string;
  whatsappAutomation: boolean;
  smsAutomation: boolean;
  dailyTargetScore: number;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiUseAnthropicFormat?: boolean;
  openAiKey?: string;
  anthropicKey?: string;
  usePlatformAi?: boolean;
  
  // Integrations
  metaSettings?: Record<string, unknown>;
  twilioSettings?: Record<string, unknown>;
  smtpSettings?: Record<string, unknown>;
  resendApiKey?: string;
  resendFromEmail?: string;
  
  // Admin Notification
  adminNotificationPhone?: string;
  adminNotificationEmail?: string;
}

export interface CRMStore {
  activeTab: string;
  sidebarExpanded: boolean;
  density: 'comfortable' | 'compact';
  currentUser: User | null;
  sessionLoading: boolean;
  dataLoading: boolean;
  dbMode: 'local' | 'supabase';
  leads: Lead[];
  notes: Record<string, LeadNote[]>;
  activities: Record<string, LeadActivity[]>;
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  tasks: Task[];
  team: User[];
  auditLogs: AuditLog[];
  tenants: Tenant[];
  tenantsWithStats: TenantWithStats[];
  platformUsers: PlatformUser[];
  settings: Settings;
  typingState: Record<string, boolean>;
  globalSearchQuery: string;
  tenantBranding: { agencyName: string; primaryColor: string; logoUrl?: string };
  tenantFeatures: TenantFeatures;
  tenantId: string | null;

  // Active CRM Selection Context for Global Copilot
  activeContext: {
    type: 'none' | 'inquiry' | 'traveler' | 'booking' | 'conversation';
    id: string | null;
  };
  setActiveContext: (context: { type: 'none' | 'inquiry' | 'traveler' | 'booking' | 'conversation'; id: string | null }) => void;
  clearActiveContext: () => void;

  // Copilot Panel & Trigger State (Phase AI-4D)
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  copilotInitialPrompt: {
    prompt: string;
    requestedIntent?: 'explain_attention' | 'draft_reply' | 'summarize' | 'suggest_next_step' | 'general';
    requestedSignalType?: string;
  } | null;
  setCopilotInitialPrompt: (data: {
    prompt: string;
    requestedIntent?: 'explain_attention' | 'draft_reply' | 'summarize' | 'suggest_next_step' | 'general';
    requestedSignalType?: string;
  } | null) => void;

  // Auth actions
  login: (email: string, password: string) => Promise<{ success: boolean; error: string | null }>;
  startDemoSession: () => Promise<{ success: boolean; error: string | null; code?: string }>;
  logout: (options?: { scope?: 'global' | 'local' | 'others'; redirect?: boolean }) => Promise<void>;
  resetSessionState: () => void;
  restoreSession: () => Promise<void>;
  syncData: () => Promise<void>;
  logAuditEvent: (action: AuditLog['action'], details: string) => Promise<void>;
  setAuthAdapter: (adapter: {
    login: (email: string, password: string) => Promise<{ success: boolean; error: string | null; user?: User }>;
    logout: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<void>;
    loadSession: () => Promise<void>;
    user: User | null;
    loading: boolean;
  }) => void;

  // Navigation actions
  setActiveTab: (tab: string) => void;
  toggleSidebar: () => void;
  setDensity: (density: 'comfortable' | 'compact') => void;
  setGlobalSearchQuery: (query: string) => void;

  // Leads actions
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'aiScore' | 'aiSummary'> & { id?: string }) => Promise<void>;
  updateLead: (id: string, updates: Partial<Lead>) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;
  addLeadNote: (leadId: string, authorId: string, authorName: string, content: string) => Promise<void>;
  deleteLeadNote: (leadId: string, noteId: string) => Promise<void>;
  addLeadActivity: (leadId: string, userId: string, userName: string, type: LeadActivity['type'], title: string, description: string) => Promise<void>;

  // Tasks actions
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'assignedName' | 'status'>) => Promise<void>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addTaskUpdate: (taskId: string, note: string, nextStatus?: TaskStatus) => Promise<void>;
  adminUpdateTask: (id: string, updates: Partial<Task>) => Promise<void>;

  // Calendar actions
  addMeeting: (meeting: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'type' | 'status' | 'assignedName'>) => Promise<void>;

  // Messaging actions
  startConversation: (
    leadId: string | null | undefined,
    channel?: 'whatsapp' | 'sms' | 'email',
    context?: {
      travelerId?: string | null;
      inquiryId?: string | null;
      bookingId?: string | null;
      travelerName?: string;
      travelerEmail?: string;
      phone?: string;
      tenantId?: string;
    }
  ) => Promise<string>;
  sendMessage: (conversationId: string, content: string, senderType: 'user' | 'contact' | 'system', senderId: string, senderName: string) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, newContent: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  setTyping: (conversationId: string, isTyping: boolean) => void;
  clearUnreadCount: (conversationId: string) => Promise<void>;

  // Settings actions
  updateSettings: (settings: Partial<Settings>, password?: string) => Promise<void>;

  // Team actions
  fetchTeam: () => Promise<void>;
  createTeamMember: (user: User, password?: string) => Promise<void>;
  updateTeamMember: (id: string, updates: Partial<User>, password?: string) => Promise<void>;
  deleteTeamMember: (id: string) => Promise<void>;
  updatePassword: (userId: string, newPassword: string) => Promise<void>;
}

export type SetState = (partial: Partial<CRMStore> | ((state: CRMStore) => Partial<CRMStore>)) => void;
export type GetState = () => CRMStore;
