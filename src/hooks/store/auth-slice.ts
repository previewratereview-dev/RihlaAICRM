import type { SetState, GetState } from './types';
import type { User, AuditLog } from '@/types';
import { CRMDatabaseService } from '@/lib/db-service';
import { generateId } from '@/lib/utils';
import { can } from '@/lib/permissions';
import { enrichLeadsWithAIScores } from '@/lib/ai/score-integration';
import { getActiveTenantId } from './helpers';
import { logger } from '@/lib/logger';

import { useNotificationStore } from '../use-notification-store';

const DEFAULT_SESSION_SETTINGS: import('./types').Settings = {
  agencyName: 'Rihla',
  logoText: 'RIHLA',
  accentColor: '#FF6B35',
  systemPrompt: '',
  makeWebhookUrl: '',
  emailAutomation: true,
  emailStatusAutomation: false,
  emailFromName: '',
  emailReplyTo: '',
  emailFollowUpTemplate: '',
  whatsappAutomation: true,
  smsAutomation: false,
  dailyTargetScore: 50,
};

const DEFAULT_SESSION_BRANDING = {
  agencyName: 'Rihla',
  primaryColor: '#FF6B35',
};

export interface AuthAdapter {
  login: (email: string, password: string) => Promise<{ success: boolean; error: string | null; user?: User }>;
  logout: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<void>;
  loadSession: () => Promise<void>;
  user: User | null;
  loading: boolean;
}

let authAdapter: AuthAdapter | null = null;

export function getAuthAdapter(): AuthAdapter | null { return authAdapter; }

export function createAuthSlice(set: SetState, get: GetState) {
  return {
    currentUser: null as User | null,
    sessionLoading: true,
    auditLogs: [] as AuditLog[],
    tenants: [] as import('@/types').Tenant[],
    tenantsWithStats: [] as import('@/types').TenantWithStats[],
    platformUsers: [] as import('@/types').PlatformUser[],

    resetSessionState: () => {
      set({
        currentUser: null,
        tenantId: null,
        sessionLoading: false,
        dataLoading: false,
        leads: [],
        tasks: [],
        conversations: [],
        notes: {},
        activities: {},
        messages: {},
        auditLogs: [],
        team: [],
        settings: { ...DEFAULT_SESSION_SETTINGS },
        tenantBranding: { ...DEFAULT_SESSION_BRANDING },
        tenantFeatures: {},
        impersonateTenantId: null,
        impersonateTenantName: null,
        impersonationStartedAt: null,
        impersonationRemainingMs: null,
        tenants: [],
        tenantsWithStats: [],
        platformUsers: [],
        globalSearchQuery: '',
        typingState: {},
      });
    },

    setAuthAdapter: (adapter: AuthAdapter) => {
      authAdapter = adapter;
      if (adapter.user && !get().currentUser) {
        const defaultTab = adapter.user.role === 'super_admin' ? 'sa_dashboard' : 'dashboard';
        set({ currentUser: adapter.user, tenantId: adapter.user.tenantId, activeTab: defaultTab, sessionLoading: false });
        get().syncData();
      } else if (!adapter.loading && get().sessionLoading) {
        // ALWAYS clear sessionLoading once auth adapter finishes loading
        set({ sessionLoading: false });
      }
    },

    login: async (email: string, password: string) => {
      const adapter = getAuthAdapter();
      if (!adapter) {
        return { success: false, error: 'Auth not initialized' };
      }
      const result = await adapter.login(email, password);
      const user = (result as { user?: User }).user || adapter.user;
      if (result.success && user) {
        try {
          const statusRes = await fetch('/api/platform/status');
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (status.maintenanceMode && user.role !== 'super_admin') {
              await adapter.logout();
              return { success: false, error: 'Platform is in maintenance mode. Only super admins can sign in.' };
            }
          }
        } catch (e) {
          logger.warn('Failed to check maintenance mode during login', { error: String(e) });
        }

        const defaultTab = user.role === 'super_admin' ? 'sa_dashboard' : 'dashboard';
        set({ currentUser: user, tenantId: user.tenantId, activeTab: defaultTab });
        await get().syncData();
        await get().logAuditEvent('login', `${user.fullName} logged in successfully.`);
        return { success: true, error: null };
      }
      return { success: false, error: result.error };
    },

    startDemoSession: async () => {
      try {
        const res = await fetch('/api/auth/demo-session', { method: 'POST' });
        const data = await res.json();
        if (!data.success || !data.user) {
          return { success: false, error: data.error || 'Failed to start demo session', code: data.code };
        }
        const adapter = getAuthAdapter();
        if (adapter?.loadSession) {
          await adapter.loadSession();
        }
        set({
          currentUser: data.user,
          tenantId: data.user.tenantId,
          activeTab: 'dashboard',
          sessionLoading: false,
        });
        await get().syncData();
        return { success: true, error: null };
      } catch (err) {
        logger.error('Failed to start demo session', { error: String(err) });
        return { success: false, error: 'Network error establishing demo session' };
      }
    },

    logout: async (options?: { scope?: 'global' | 'local' | 'others'; redirect?: boolean }) => {
      // 1. Best-effort audit event (failure MUST NOT block logout)
      try {
        const user = get().currentUser;
        if (user) {
          await get().logAuditEvent('logout', `${user.fullName} logged out.`);
        }
      } catch (e) {
        logger.warn('Failed to record logout audit event (non-blocking)', { error: String(e) });
      }

      // 2. Clear all session-scoped client state
      get().resetSessionState();
      useNotificationStore.getState().clear();

      // 3. Supabase signOut (defaults to global, or local if specified)
      const adapter = getAuthAdapter();
      if (adapter) {
        try {
          await adapter.logout(options?.scope ? { scope: options.scope } : undefined);
        } catch (e) {
          logger.warn('Failed to sign out via auth adapter', { error: String(e) });
        }
      }

      // 4. Hard navigation to /login unless explicitly disabled (destroys in-memory React/RSC AI context)
      const shouldRedirect = options?.redirect !== false;
      if (shouldRedirect && typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    },

    restoreSession: async () => {
      set({ sessionLoading: true });
      const adapter = getAuthAdapter();
      if (adapter) {
        await adapter.loadSession();
        if (adapter.user) {
          const user = adapter.user;
          const defaultTab = user.role === 'super_admin' ? 'sa_dashboard' : 'dashboard';
          set({ currentUser: user, tenantId: user.tenantId, activeTab: defaultTab });
          await get().syncData();
        }
      }
      set({ sessionLoading: false });
    },

    syncData: async () => {
      const user = get().currentUser;
      if (!user) return;

      set({ dataLoading: true });
      try {
        if (user.role === 'super_admin' && !get().impersonateTenantId) {
          const [tenants, tenantsWithStats, platformUsers, auditLogs] = await Promise.all([
            CRMDatabaseService.getTenants(),
            CRMDatabaseService.getTenantsWithStats(),
            CRMDatabaseService.getAllPlatformUsers(),
            CRMDatabaseService.getGlobalAuditLogs(150),
          ]);
          set({ tenants, tenantsWithStats, platformUsers, auditLogs, dataLoading: false });
          return;
        }

        const activeTenantId = getActiveTenantId(get());

        const team = await CRMDatabaseService.getTeamMembers(activeTenantId);
        const settings = await CRMDatabaseService.getSettings(activeTenantId);
        let rawLeads = enrichLeadsWithAIScores(await CRMDatabaseService.getLeads(activeTenantId, user));
        let rawTasks = await CRMDatabaseService.getTasks(activeTenantId, user);
        let rawConvs = await CRMDatabaseService.getConversations(activeTenantId, user);

        if (user.role === 'specialist' || user.role === 'consultant') {
          rawLeads = rawLeads.filter(l => l.assignedTo === user.id);
          rawTasks = rawTasks.filter(t => t.assignedTo === user.id);
          rawConvs = rawConvs.filter(c => c.assignedTo === user.id);
        }

        let auditLogs: AuditLog[] = [];
        if (can(user.role, 'settings:audit:read')) {
          auditLogs = await CRMDatabaseService.getAuditLogs(activeTenantId);
        }

        const notes: Record<string, import('@/types').LeadNote[]> = {};
        const activities: Record<string, import('@/types').LeadActivity[]> = {};

        const leadIds = rawLeads.map(l => l.id);
        if (leadIds.length > 0) {
          const [allNotes, allActivities] = await Promise.all([
            CRMDatabaseService.getNotesByLeadIds(leadIds, activeTenantId, user),
            CRMDatabaseService.getActivitiesByLeadIds(leadIds, activeTenantId, user),
          ]);
          for (const note of allNotes) {
            if (!notes[note.leadId]) notes[note.leadId] = [];
            notes[note.leadId].push(note);
          }
          for (const act of allActivities) {
            if (!activities[act.leadId]) activities[act.leadId] = [];
            activities[act.leadId].push(act);
          }
        }

        const messages: Record<string, import('@/types').Message[]> = {};
        const convIds = rawConvs.map(c => c.id);
        if (convIds.length > 0) {
          const allMessages = await CRMDatabaseService.getMessagesByConversationIds(convIds, activeTenantId, user);
          for (const msg of allMessages) {
            if (!messages[msg.conversationId]) messages[msg.conversationId] = [];
            messages[msg.conversationId].push(msg);
          }
        }

        const loadedSettings = (settings as unknown as import('./types').Settings) || get().settings;

        set({
          leads: rawLeads,
          tasks: rawTasks,
          conversations: rawConvs,
          team,
          settings: loadedSettings,
          tenantBranding: {
            ...get().tenantBranding,
            primaryColor: loadedSettings.accentColor || get().tenantBranding.primaryColor,
          },
          notes,
          activities,
          messages,
          auditLogs,
          dataLoading: false,
        });
      } catch (e) {
        logger.error('Database synchronization failed', e);
        set({ dataLoading: false });
      }
    },

    logAuditEvent: async (action: AuditLog['action'], details: string) => {
      const user = get().currentUser;
      if (!user) return;
      const now = new Date().toISOString();
      const newLog: AuditLog = {
        id: `audit-${generateId()}`,
        userId: user.id,
        userName: user.fullName,
        userRole: user.role,
        tenantId: user.tenantId,
        action,
        details,
        createdAt: now
      };
      const currentLogs = get().auditLogs;
      set({ auditLogs: [newLog, ...currentLogs] });

      try {
        await CRMDatabaseService.insertAuditLog(newLog);
      } catch (e) {
        logger.warn('Failed to insert audit log', { error: String(e) });
      }
    },
  };
}
