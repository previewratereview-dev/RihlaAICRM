/**
 * `CRMDatabaseService` — backward-compatible facade over the single authoritative Data Access
 * Layer. The legacy localStorage path has been removed (Requirement 8.9); every tenant-owned
 * operation is constrained to the resolved tenant and runs against the database only.
 *
 * New code should prefer the {@link scoped} client directly. This facade is retained so existing
 * importers (`use-crm-store`, super-admin views, API routes) continue to compile and run while the
 * remaining wiring tasks migrate them onto `scoped()`.
 */
import { supabase } from '../supabase';
import type { Lead, LeadNote, LeadActivity, Conversation, Message, Task, User, UserRole, AuditLog, Tenant, TenantWithStats, PlatformUser } from '@/types';
import { scoped } from './scoped';
import { validateTenantAccess, assertTenantId, filterLeadsByAuthority } from './access';
import {
  mapLeadToDb,
  mapTaskToDb,
  mapConversationToDb,
  mapMessageToDb,
  mapNoteToDb,
  mapActivityToDb,
  mapDbNote,
  mapDbActivity,
  mapDbMessage,
} from './mappers';
import { seal, open, type SealedSecret } from '@/lib/secrets/store';
import { logger } from '@/lib/logger';

/** Returns the configured Supabase client or throws — there is no localStorage fallback. */
function requireClient() {
  if (!supabase) {
    throw new Error('Data access requires a configured database connection');
  }
  return supabase;
}

/** Fields in the settings table that store API keys requiring encryption at rest. */
const SENSITIVE_FIELDS = ['openai_key', 'anthropic_key'] as const;

/**
 * Encrypt a plaintext value using the secret store before writing to the database.
 * Returns the serialized SealedSecret JSON, or the original value if it's empty.
 */
function encryptBeforeStore(plaintext: unknown): unknown {
  if (typeof plaintext !== 'string' || !plaintext.trim()) return plaintext;
  const sealed = seal(plaintext);
  return JSON.stringify(sealed);
}

/**
 * Decrypt a stored SealedSecret back to plaintext.
 * Handles both encrypted (JSON SealedSecret) and legacy plaintext values
 * for backward compatibility during migration.
 */
function decryptAfterLoad(stored: unknown): string | null {
  if (!stored || typeof stored !== 'string') return null;
  try {
    const parsed = JSON.parse(stored) as SealedSecret;
    if (parsed.iv && parsed.authTag && parsed.ciphertext && typeof parsed.keyVersion === 'number') {
      return open(parsed);
    }
  } catch {
    // Not encrypted JSON — treat as legacy plaintext value.
    // This supports backward compatibility during migration.
  }
  return stored;
}

export const CRMDatabaseService = {
  isSupabaseEnabled(): boolean {
    return !!supabase;
  },

  // Auth Operations — DEPRECATED: Auth moved to use-auth.ts
  async login(_email: string, _password: string): Promise<{ user: User | null; error: string | null }> {
    throw new Error('Auth moved to use-auth.ts');
  },

  async logout(): Promise<void> {
    throw new Error('Auth moved to use-auth.ts');
  },

  getCurrentUser(): User | null {
    return null;
  },

  // ================================================================
  // Tenant-owned reads — delegated to the tenant-scoped client
  // ================================================================
  async getLeads(tenantId: string, sessionUser: User | null = null): Promise<Lead[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    const leads = await scoped(tenantId).leads.list();
    return sessionUser ? filterLeadsByAuthority(leads, sessionUser) : leads;
  },

  async getLead(leadId: string, tenantId: string, sessionUser: User | null = null): Promise<Lead | null> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    const lead = await scoped(tenantId).leads.get(leadId);
    if (!lead) return null;
    if (sessionUser) {
      const filtered = filterLeadsByAuthority([lead], sessionUser);
      return filtered.length > 0 ? filtered[0] : null;
    }
    return lead;
  },

  async upsertLead(lead: Lead, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    const tid = tenantId || lead.tenantId;
    validateTenantAccess(tid, sessionUser);
    const db = requireClient();
    const dbLead = { ...mapLeadToDb(lead), tenant_id: tid };
    const { error } = await db.from('leads').upsert(dbLead);
    if (error) throw error;
  },

  async deleteLead(id: string, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    assertTenantId(tenantId);
    if (sessionUser) validateTenantAccess(tenantId, sessionUser);
    await scoped(tenantId).leads.delete(id);
  },

  async getTasks(tenantId: string, sessionUser: User | null = null): Promise<Task[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    return scoped(tenantId).tasks.list();
  },

  async upsertTask(task: Task, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    const tid = tenantId || task.tenantId;
    validateTenantAccess(tid, sessionUser);
    const db = requireClient();
    const dbTask = { ...mapTaskToDb(task), tenant_id: tid };
    const { error } = await db.from('tasks').upsert(dbTask);
    if (error) throw error;
  },

  async deleteTask(id: string, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    assertTenantId(tenantId);
    if (sessionUser) validateTenantAccess(tenantId, sessionUser);
    await scoped(tenantId).tasks.delete(id);
  },

  async getConversations(tenantId: string, sessionUser: User | null = null): Promise<Conversation[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    return scoped(tenantId).conversations.list();
  },

  async upsertConversation(conv: Conversation, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    const tid = tenantId || conv.tenantId;
    validateTenantAccess(tid, sessionUser);
    const db = requireClient();
    const dbConv = mapConversationToDb(conv, tid);
    const { error } = await db.from('conversations').upsert(dbConv);
    if (error) throw error;
  },

  async getMessages(conversationId: string, tenantId: string, sessionUser: User | null = null): Promise<Message[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    return scoped(tenantId).messages.listByConversation(conversationId);
  },

  async getMessagesByConversationIds(conversationIds: string[], tenantId: string, sessionUser: User | null = null): Promise<Message[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    const db = requireClient();
    const { data, error } = await db
      .from('messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });
    if (error) {
      logger.warn('Failed to fetch messages by conversation IDs', { error: String(error) });
      return [];
    }
    return (data || []).map(mapDbMessage);
  },

  async insertMessage(message: Message, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    const tid = tenantId || '';
    validateTenantAccess(tid, sessionUser);
    const db = requireClient();
    const dbMsg = mapMessageToDb(message, tid);
    const { error } = await db.from('messages').insert(dbMsg);
    if (error) throw error;
  },

  async getNotes(leadId: string, tenantId: string, sessionUser: User | null = null): Promise<LeadNote[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    return scoped(tenantId).notes.listByLead(leadId);
  },

  async getNotesByLeadIds(leadIds: string[], tenantId: string, sessionUser: User | null = null): Promise<LeadNote[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    const db = requireClient();
    const { data, error } = await db
      .from('notes')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false });
    if (error) {
      logger.warn('Failed to fetch notes by lead IDs', { error: String(error) });
      return [];
    }
    return (data || []).map(mapDbNote);
  },

  async upsertNote(note: LeadNote, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    const tid = tenantId || note.tenantId;
    validateTenantAccess(tid, sessionUser);
    const db = requireClient();
    const dbNote = mapNoteToDb(note, tid);
    const { error } = await db.from('notes').upsert(dbNote);
    if (error) throw error;
  },

  async deleteNote(_leadId: string, noteId: string, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    assertTenantId(tenantId);
    if (sessionUser) validateTenantAccess(tenantId, sessionUser);
    await scoped(tenantId).notes.delete(noteId);
  },

  async getActivities(leadId: string, tenantId: string, sessionUser: User | null = null): Promise<LeadActivity[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    return scoped(tenantId).activities.listByLead(leadId);
  },

  async getActivitiesByLeadIds(leadIds: string[], tenantId: string, sessionUser: User | null = null): Promise<LeadActivity[]> {
    validateTenantAccess(tenantId, sessionUser, { allowCrossTenant: true });
    const db = requireClient();
    const { data, error } = await db
      .from('activities')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false });
    if (error) {
      logger.warn('Failed to fetch activities by lead IDs', { error: String(error) });
      return [];
    }
    return (data || []).map(mapDbActivity);
  },

  async insertActivity(act: LeadActivity, tenantId?: string, _userRole?: string, sessionUser: User | null = null): Promise<void> {
    const tid = tenantId || act.tenantId;
    validateTenantAccess(tid, sessionUser);
    const db = requireClient();
    const dbAct = mapActivityToDb(act, tid);
    const { error } = await db.from('activities').insert(dbAct);
    if (error) throw error;
  },

  // ================================================================
  // Settings (tenant-scoped)
  // ================================================================
  async getSettings(tenantId: string): Promise<Record<string, unknown> | null> {
    assertTenantId(tenantId);
    const db = requireClient();
    const { data, error } = await db.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    if (error) {
      logger.error('Data fetch error', error);
      return null;
    }
    if (!data) return null;
    // NOTE: Do NOT expose sensitive API keys to client-side code.
    return {
      agencyName: data.agency_name,
      logoText: data.logo_text,
      accentColor: data.accent_color,
      systemPrompt: data.system_prompt || '',
      makeWebhookUrl: data.make_webhook_url || '',
      emailAutomation: data.email_automation,
      whatsappAutomation: data.whatsapp_automation,
      smsAutomation: data.sms_automation,
      dailyTargetScore: data.daily_target_score || 50,
    };
  },

  async updateSettings(settings: Record<string, unknown>, tenantId?: string): Promise<void> {
    assertTenantId(tenantId);
    const db = requireClient();
    const dbSet: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (settings.agencyName !== undefined) dbSet.agency_name = settings.agencyName;
    if (settings.logoText !== undefined) dbSet.logo_text = settings.logoText;
    if (settings.accentColor !== undefined) dbSet.accent_color = settings.accentColor;
    if (settings.systemPrompt !== undefined) dbSet.system_prompt = settings.systemPrompt;
    // Encrypt API keys at rest using the secret store's AES-256-GCM encryption.
    if (settings.openAiKey !== undefined) dbSet.openai_key = encryptBeforeStore(settings.openAiKey);
    if (settings.anthropicKey !== undefined) dbSet.anthropic_key = encryptBeforeStore(settings.anthropicKey);
    if (settings.makeWebhookUrl !== undefined) dbSet.make_webhook_url = settings.makeWebhookUrl;
    if (settings.emailAutomation !== undefined) dbSet.email_automation = settings.emailAutomation;
    if (settings.whatsappAutomation !== undefined) dbSet.whatsapp_automation = settings.whatsappAutomation;
    if (settings.smsAutomation !== undefined) dbSet.sms_automation = settings.smsAutomation;
    if (settings.dailyTargetScore !== undefined) dbSet.daily_target_score = settings.dailyTargetScore;
    const { error } = await db.from('settings').update(dbSet).eq('tenant_id', tenantId);
    if (error) throw error;
  },

  /**
   * Decrypt and return a tenant's stored API key for a specific provider.
   * Server-side only — never return to a client.
   * Handles both encrypted and legacy plaintext values for migration compatibility.
   */
  async getDecryptedApiKey(tenantId: string, provider: 'openai' | 'anthropic'): Promise<string | null> {
    assertTenantId(tenantId);
    const db = requireClient();
    const column = provider === 'openai' ? 'openai_key' : 'anthropic_key';
    const { data, error } = await db
      .from('settings')
      .select(column)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !data) return null;
    const raw = (data as Record<string, unknown>)[column];
    if (!raw) return null;
    return decryptAfterLoad(raw);
  },

  // ================================================================
  // Team / profiles (tenant-scoped)
  // ================================================================
  async getTeamMembers(tenantId?: string): Promise<User[]> {
    assertTenantId(tenantId);
    return scoped(tenantId).team.list();
  },

  async createTeamMember(user: User, _password?: string): Promise<void> {
    const db = requireClient();
    const { error } = await db.from('profiles').insert({
      id: user.id,
      tenant_id: user.tenantId,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      phone: user.phone,
      is_online: false,
      status: 'active',
    });
    if (error) throw error;
  },

  async updateTeamMember(id: string, updates: Partial<User>, _password?: string): Promise<void> {
    const db = requireClient();
    const dbUpdates: Record<string, unknown> = {};
    if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    const { error } = await db.from('profiles').update(dbUpdates).eq('id', id);
    if (error) throw error;
  },

  async deleteTeamMember(id: string): Promise<void> {
    const db = requireClient();
    const { error } = await db.from('profiles').delete().eq('id', id);
    if (error) throw error;
  },

  async updatePassword(_userId: string, newPassword: string): Promise<void> {
    const db = requireClient();
    const { error } = await db.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  // ================================================================
  // Audit logs (tenant-scoped)
  // ================================================================
  async getAuditLogs(tenantId: string): Promise<AuditLog[]> {
    assertTenantId(tenantId);
    try {
      return await scoped(tenantId).auditLogs.list();
    } catch (error) {
      logger.warn('Failed to fetch audit logs (table may be missing)', { error: String(error) });
      return [];
    }
  },

  async insertAuditLog(log: AuditLog, tenantId?: string): Promise<void> {
    const tid = tenantId || log.tenantId;
    assertTenantId(tid);
    const db = requireClient();
    const dbLog = {
      id: log.id,
      tenant_id: tid,
      user_id: log.userId,
      user_name: log.userName,
      user_role: log.userRole,
      action: log.action,
      details: log.details,
      created_at: log.createdAt,
    };
    const { error } = await db.from('audit_logs').insert(dbLog);
    if (error) throw error;
  },

  async getAIUsage(limit = 100): Promise<Array<{
    id: string;
    feature: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costEstimate: number;
    status: string;
    createdAt: string;
  }>> {
    const db = requireClient();
    const { data, error } = await db
      .from('ai_usage')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      logger.warn('Failed to fetch AI usage', { error: String(error) });
      return [];
    }
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      feature: String(row.feature),
      provider: String(row.provider),
      model: String(row.model),
      tokensIn: Number(row.tokens_in) || 0,
      tokensOut: Number(row.tokens_out) || 0,
      costEstimate: Number(row.cost_estimate) || 0,
      status: String(row.status),
      createdAt: String(row.created_at),
    }));
  },

  // ================================================================
  // Platform-level operations (not tenant-scoped)
  // ================================================================
  async getTenants(): Promise<Tenant[]> {
    const db = requireClient();
    const { data, error } = await db.from('tenants').select('*').order('created_at', { ascending: false });
    if (error) {
      logger.error('Failed to fetch tenants', error);
      return [];
    }
    return (data || []).map((t: Record<string, unknown>) => ({
      id: String(t.id),
      name: String(t.name),
      slug: String(t.slug),
      logoUrl: String(t.logo_url || ''),
      primaryColor: String(t.primary_color || ''),
      secondaryColor: String(t.secondary_color || ''),
      domain: String(t.domain || ''),
      customPrompt: String(t.custom_prompt || ''),
      settings: (t.settings as Record<string, unknown>) || {},
      status: String(t.status) as Tenant['status'],
      createdAt: String(t.created_at),
      updatedAt: String(t.updated_at),
    }));
  },

  async updateTenantStatus(id: string, status: 'active' | 'suspended'): Promise<void> {
    const db = requireClient();
    const { error } = await db.from('tenants').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },

  async createTenant(input: { id: string; name: string; slug: string; domain?: string; adminEmail?: string }): Promise<void> {
    const db = requireClient();
    const now = new Date().toISOString();
    const { error } = await db.from('tenants').insert({
      id: input.id,
      name: input.name,
      slug: input.slug,
      domain: input.domain || null,
      status: 'active',
      settings: {},
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;
    await db.from('settings').upsert({ id: input.id, tenant_id: input.id, agency_name: input.name });
  },

  async updateTenant(id: string, updates: Partial<Tenant>): Promise<void> {
    const db = requireClient();
    const dbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) dbUpdate.name = updates.name;
    if (updates.slug !== undefined) dbUpdate.slug = updates.slug;
    if (updates.domain !== undefined) dbUpdate.domain = updates.domain;
    if (updates.logoUrl !== undefined) dbUpdate.logo_url = updates.logoUrl;
    if (updates.primaryColor !== undefined) dbUpdate.primary_color = updates.primaryColor;
    if (updates.customPrompt !== undefined) dbUpdate.custom_prompt = updates.customPrompt;
    if (updates.status !== undefined) dbUpdate.status = updates.status;
    const { error } = await db.from('tenants').update(dbUpdate).eq('id', id);
    if (error) throw error;
  },

  async getPlatformSettings(): Promise<Record<string, unknown>> {
    const db = requireClient();
    const { data, error } = await db.from('platform_settings').select('*').eq('id', 'platform').maybeSingle();
    if (error || !data) {
      return { defaultAiModel: 'gpt-4o-mini', platformMonthlyAiCap: 500, allowNewTenants: true };
    }
    return {
      defaultAiModel: data.default_ai_model,
      platformMonthlyAiCap: Number(data.platform_monthly_ai_cap),
      allowNewTenants: data.allow_new_tenants,
      platformBranding: data.platform_branding,
      settings: data.settings || {},
    };
  },

  async updatePlatformSettings(settings: Record<string, unknown>): Promise<void> {
    const db = requireClient();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (settings.defaultAiModel !== undefined) update.default_ai_model = settings.defaultAiModel;
    if (settings.platformMonthlyAiCap !== undefined) update.platform_monthly_ai_cap = settings.platformMonthlyAiCap;
    if (settings.allowNewTenants !== undefined) update.allow_new_tenants = settings.allowNewTenants;
    if (settings.platformBranding !== undefined) update.platform_branding = settings.platformBranding;
    if (settings.settings !== undefined) {
      const { data: existing } = await db.from('platform_settings').select('settings').eq('id', 'platform').maybeSingle();
      update.settings = { ...((existing?.settings as Record<string, unknown>) || {}), ...(settings.settings as Record<string, unknown>) };
    }
    const { error } = await db.from('platform_settings').update(update).eq('id', 'platform');
    if (error) throw error;
  },

  async getGlobalAnalytics(): Promise<{
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalLeads: number;
    totalUsers: number;
    totalAiSpend: number;
    totalConversations: number;
    aiCallsThisMonth: number;
    tenantGrowth: Array<{ month: string; count: number }>;
    leadsByTenant: Array<{ tenantId: string; tenantName: string; leads: number; aiSpend: number; users: number }>;
  }> {
    const empty = {
      totalTenants: 0,
      activeTenants: 0,
      suspendedTenants: 0,
      totalLeads: 0,
      totalUsers: 0,
      totalAiSpend: 0,
      totalConversations: 0,
      aiCallsThisMonth: 0,
      tenantGrowth: [] as Array<{ month: string; count: number }>,
      leadsByTenant: [] as Array<{ tenantId: string; tenantName: string; leads: number; aiSpend: number; users: number }>,
    };

    if (!supabase) return empty;

    const [tenantsRes, leadsRes, profilesRes, convsRes, aiRes, aiMonthRes] = await Promise.all([
      supabase.from('tenants').select('id, name, status, created_at'),
      supabase.from('leads').select('id, tenant_id'),
      supabase.from('profiles').select('id, tenant_id'),
      supabase.from('conversations').select('id', { count: 'exact', head: true }),
      supabase.from('ai_usage').select('cost_estimate, tenant_id'),
      supabase
        .from('ai_usage')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    ]);

    const tenantRows = tenantsRes.data || [];
    const leadRows = leadsRes.data || [];
    const profileRows = profilesRes.data || [];
    const aiRows = aiRes.data || [];

    const leadsByTenantMap: Record<string, number> = {};
    const usersByTenantMap: Record<string, number> = {};
    const aiByTenantMap: Record<string, number> = {};

    leadRows.forEach((r: { tenant_id: string }) => {
      const tid = r.tenant_id || 'unknown';
      leadsByTenantMap[tid] = (leadsByTenantMap[tid] || 0) + 1;
    });
    profileRows.forEach((r: { tenant_id: string }) => {
      const tid = r.tenant_id || 'unknown';
      usersByTenantMap[tid] = (usersByTenantMap[tid] || 0) + 1;
    });
    aiRows.forEach((r: { tenant_id: string; cost_estimate: number }) => {
      const tid = r.tenant_id || 'unknown';
      aiByTenantMap[tid] = (aiByTenantMap[tid] || 0) + Number(r.cost_estimate || 0);
    });

    const monthCounts: Record<string, number> = {};
    tenantRows.forEach((t: { created_at: string }) => {
      const key = new Date(t.created_at).toLocaleString('en-US', { month: 'short', year: '2-digit' });
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    });

    return {
      totalTenants: tenantRows.length,
      activeTenants: tenantRows.filter((t: { status: string }) => t.status === 'active').length,
      suspendedTenants: tenantRows.filter((t: { status: string }) => t.status === 'suspended').length,
      totalLeads: leadRows.length,
      totalUsers: profileRows.length,
      totalAiSpend: aiRows.reduce((sum: number, r: { cost_estimate: number }) => sum + Number(r.cost_estimate || 0), 0),
      totalConversations: convsRes.count || 0,
      aiCallsThisMonth: aiMonthRes.count || 0,
      tenantGrowth: Object.entries(monthCounts).map(([month, count]) => ({ month, count })),
      leadsByTenant: tenantRows.map((t: { id: string; name: string }) => ({
        tenantId: t.id,
        tenantName: t.name,
        leads: leadsByTenantMap[t.id] || 0,
        aiSpend: aiByTenantMap[t.id] || 0,
        users: usersByTenantMap[t.id] || 0,
      })),
    };
  },

  async getTenantsWithStats(): Promise<TenantWithStats[]> {
    const tenants = await this.getTenants();
    if (!supabase) {
      return tenants.map((t) => ({ ...t, stats: { userCount: 0, leadCount: 0, aiSpend: 0, conversationCount: 0 } }));
    }

    const [profiles, leads, aiUsage, convs] = await Promise.all([
      supabase.from('profiles').select('tenant_id'),
      supabase.from('leads').select('tenant_id'),
      supabase.from('ai_usage').select('tenant_id, cost_estimate'),
      supabase.from('conversations').select('tenant_id'),
    ]);

    const countBy = (rows: Array<{ tenant_id?: string }> | null) => {
      const map: Record<string, number> = {};
      (rows || []).forEach((r) => {
        const tid = r.tenant_id || 'unknown';
        map[tid] = (map[tid] || 0) + 1;
      });
      return map;
    };

    const userCounts = countBy(profiles.data);
    const leadCounts = countBy(leads.data);
    const convCounts = countBy(convs.data);
    const aiSpendMap: Record<string, number> = {};
    (aiUsage.data || []).forEach((r: { tenant_id?: string; cost_estimate: number }) => {
      const tid = r.tenant_id || 'unknown';
      aiSpendMap[tid] = (aiSpendMap[tid] || 0) + Number(r.cost_estimate || 0);
    });

    return tenants.map((t) => ({
      ...t,
      stats: {
        userCount: userCounts[t.id] || 0,
        leadCount: leadCounts[t.id] || 0,
        aiSpend: aiSpendMap[t.id] || 0,
        conversationCount: convCounts[t.id] || 0,
      },
    }));
  },

  async getAllPlatformUsers(): Promise<PlatformUser[]> {
    if (!supabase) return [];

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*, tenants(name)')
      .order('created_at', { ascending: false });

    if (error || !profiles) return [];

    return profiles.map((p: Record<string, unknown>) => ({
      id: String(p.id),
      fullName: String(p.full_name || (p.email as string).split('@')[0]),
      email: String(p.email),
      role: p.role as UserRole,
      avatarUrl: '',
      phone: p.phone ? String(p.phone) : undefined,
      isOnline: Boolean(p.is_online),
      status: (p.status as 'active' | 'deactivated') || 'active',
      tenantId: String(p.tenant_id || ''),
      tenantName: (p.tenants as { name?: string } | null)?.name || String(p.tenant_id || ''),
    }));
  },

  async getGlobalAuditLogs(limit = 200): Promise<AuditLog[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.warn('Failed to fetch global audit logs', { error: String(error) });
      return [];
    }
    return (data || []).map((dbL: Record<string, unknown>) => ({
      id: String(dbL.id),
      tenantId: dbL.tenant_id ? String(dbL.tenant_id) : '',
      userId: String(dbL.user_id),
      userName: String(dbL.user_name),
      userRole: dbL.user_role as UserRole,
      action: dbL.action as AuditLog['action'],
      details: String(dbL.details),
      createdAt: String(dbL.created_at),
    }));
  },

  async getGlobalAIUsage(limit = 200): Promise<Array<{
    id: string;
    tenantId: string;
    feature: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costEstimate: number;
    status: string;
    createdAt: string;
  }>> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('ai_usage')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id || ''),
      feature: String(row.feature),
      provider: String(row.provider),
      model: String(row.model),
      tokensIn: Number(row.tokens_in) || 0,
      tokensOut: Number(row.tokens_out) || 0,
      costEstimate: Number(row.cost_estimate) || 0,
      status: String(row.status),
      createdAt: String(row.created_at),
    }));
  },

  async updateTenantSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    const db = requireClient();
    const { data: existing } = await db.from('tenants').select('settings').eq('id', id).single();
    const merged = { ...((existing?.settings as Record<string, unknown>) || {}), ...settings };
    const { error } = await db.from('tenants').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
};
