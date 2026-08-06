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
}

export interface CRMStore {
  activeTab: string;
  sidebarExpanded: boolean;
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
  impersonateTenantId: string | null;
  impersonateTenantName: string | null;
  impersonationStartedAt: number | null;
  impersonationRemainingMs: number | null;
  tenantId: string | null;

  // Auth actions
  login: (email: string, password: string, isPreviewFlow?: boolean) => Promise<{ success: boolean; error: string | null }>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  syncData: () => Promise<void>;
  logAuditEvent: (action: AuditLog['action'], details: string) => Promise<void>;
  setAuthAdapter: (adapter: {
    login: (email: string, password: string) => Promise<{ success: boolean; error: string | null; user?: User }>;
    logout: () => Promise<void>;
    loadSession: () => Promise<void>;
    user: User | null;
    loading: boolean;
  }) => void;

  // Navigation actions
  setActiveTab: (tab: string) => void;
  toggleSidebar: () => void;
  setGlobalSearchQuery: (query: string) => void;
  setImpersonateTenant: (tenantId: string | null, tenantName?: string) => void;

  // Leads actions
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'aiScore' | 'aiSummary'>) => Promise<void>;
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
  startConversation: (leadId: string, channel?: 'whatsapp' | 'sms' | 'email') => Promise<string>;
  sendMessage: (conversationId: string, content: string, senderType: 'user' | 'contact' | 'system', senderId: string, senderName: string) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, newContent: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  setTyping: (conversationId: string, isTyping: boolean) => void;
  clearUnreadCount: (conversationId: string) => Promise<void>;

  // Settings actions
  updateSettings: (settings: Partial<Settings>) => Promise<void>;

  // Team actions
  fetchTeam: () => Promise<void>;
  createTeamMember: (user: User, password?: string) => Promise<void>;
  updateTeamMember: (id: string, updates: Partial<User>, password?: string) => Promise<void>;
  deleteTeamMember: (id: string) => Promise<void>;
  updatePassword: (userId: string, newPassword: string) => Promise<void>;
}

export type SetState = (partial: Partial<CRMStore> | ((state: CRMStore) => Partial<CRMStore>)) => void;
export type GetState = () => CRMStore;
