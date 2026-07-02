/**
 * The single authoritative tenant-scoped data-access path (Requirement 8).
 *
 * `scoped(tenantId)` returns a {@link TenantClient} whose every query is constrained to the
 * resolved `tenantId`. There is no localStorage path — all tenant-owned data flows through
 * Supabase with mandatory tenant filtering (Requirement 8.1, 8.9). Primary identifiers for
 * new records are generated server-side and any client-supplied identifier is rejected
 * (Requirement 10.3).
 */
import { supabase } from '../supabase';
import type { Lead, LeadNote, LeadActivity, Conversation, Message, Task, User, AuditLog } from '@/types';
import { newRecordId, rejectClientId } from './ids';
import { assertTenantId } from './access';
import {
  mapDbLead,
  mapLeadToDb,
  mapDbTask,
  mapTaskToDb,
  mapDbConversation,
  mapConversationToDb,
  mapDbMessage,
  mapMessageToDb,
  mapDbNote,
  mapNoteToDb,
  mapDbActivity,
  mapActivityToDb,
  mapDbProfile,
  mapDbAuditLog,
} from './mappers';

/** Returns the configured Supabase client or throws — the DAL has no localStorage fallback. */
function requireClient() {
  if (!supabase) {
    throw new Error('Data access requires a configured database connection');
  }
  return supabase;
}

/** A tenant-owned resource is anything carrying a `tenant_id`; `T` is the domain shape. */
export interface TenantClient {
  /** The resolved, server-side tenant identifier every query is constrained to. */
  readonly tenantId: string;

  leads: {
    list(): Promise<Lead[]>;
    get(id: string): Promise<Lead | null>;
    /** Inserts a new lead with a server-generated identifier; rejects client-supplied ids. */
    create(data: Partial<Lead>): Promise<Lead>;
    update(id: string, data: Partial<Lead>): Promise<void>;
    delete(id: string): Promise<void>;
  };
  tasks: {
    list(): Promise<Task[]>;
    create(data: Partial<Task>): Promise<Task>;
    update(id: string, data: Partial<Task>): Promise<void>;
    delete(id: string): Promise<void>;
  };
  conversations: {
    list(): Promise<Conversation[]>;
    create(data: Conversation): Promise<Conversation>;
    update(id: string, data: Conversation): Promise<void>;
  };
  messages: {
    listByConversation(conversationId: string): Promise<Message[]>;
    create(data: Message): Promise<Message>;
  };
  notes: {
    listByLead(leadId: string): Promise<LeadNote[]>;
    create(data: LeadNote): Promise<LeadNote>;
    update(id: string, data: LeadNote): Promise<void>;
    delete(id: string): Promise<void>;
  };
  activities: {
    listByLead(leadId: string): Promise<LeadActivity[]>;
    create(data: LeadActivity): Promise<LeadActivity>;
  };
  team: {
    list(): Promise<User[]>;
  };
  auditLogs: {
    list(): Promise<AuditLog[]>;
    create(data: AuditLog): Promise<AuditLog>;
  };
}

/**
 * Builds a tenant-scoped data-access client. The `tenantId` MUST be a server-resolved value
 * (Requirement 8.5) and is required (Requirement 8.6); a blank tenant is rejected.
 */
export function scoped(tenantId: string): TenantClient {
  assertTenantId(tenantId);

  return {
    tenantId,

    leads: {
      async list() {
        const db = requireClient();
        const { data, error } = await db
          .from('leads')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapDbLead);
      },
      async get(id) {
        const db = requireClient();
        const { data, error } = await db
          .from('leads')
          .select('*')
          .eq('id', id)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (error) throw error;
        return data ? mapDbLead(data) : null;
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'leads');
        const id = newRecordId();
        const payload = { ...mapLeadToDb(data), id, tenant_id: tenantId };
        const { data: row, error } = await db.from('leads').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbLead(row);
      },
      async update(id, data) {
        const db = requireClient();
        const payload = mapLeadToDb(data);
        delete payload.id;
        delete payload.tenant_id;
        const { error } = await db.from('leads').update(payload).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
      async delete(id) {
        const db = requireClient();
        const { error } = await db.from('leads').delete().eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
    },

    tasks: {
      async list() {
        const db = requireClient();
        const { data, error } = await db
          .from('tasks')
          .select('*, profiles!tasks_assigned_to_fkey(full_name)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapDbTask);
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'tasks');
        const id = newRecordId();
        const payload = { ...mapTaskToDb(data), id, tenant_id: tenantId };
        const { data: row, error } = await db.from('tasks').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbTask(row);
      },
      async update(id, data) {
        const db = requireClient();
        const payload = mapTaskToDb(data);
        delete payload.id;
        delete payload.tenant_id;
        const { error } = await db.from('tasks').update(payload).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
      async delete(id) {
        const db = requireClient();
        const { error } = await db.from('tasks').delete().eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
    },

    conversations: {
      async list() {
        const db = requireClient();
        const { data, error } = await db
          .from('conversations')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapDbConversation);
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'conversations');
        const id = newRecordId();
        const payload = { ...mapConversationToDb(data, tenantId), id };
        const { data: row, error } = await db.from('conversations').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbConversation(row);
      },
      async update(id, data) {
        const db = requireClient();
        const payload = mapConversationToDb(data, tenantId);
        delete payload.id;
        delete payload.tenant_id;
        const { error } = await db.from('conversations').update(payload).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
    },

    messages: {
      async listByConversation(conversationId) {
        const db = requireClient();
        const { data, error } = await db
          .from('messages')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []).map(mapDbMessage);
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'messages');
        const id = newRecordId();
        const payload = { ...mapMessageToDb(data, tenantId), id };
        const { data: row, error } = await db.from('messages').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbMessage(row);
      },
    },

    notes: {
      async listByLead(leadId) {
        const db = requireClient();
        const { data, error } = await db
          .from('notes')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapDbNote);
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'notes');
        const id = newRecordId();
        const payload = { ...mapNoteToDb(data, tenantId), id };
        const { data: row, error } = await db.from('notes').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbNote(row);
      },
      async update(id, data) {
        const db = requireClient();
        const payload = mapNoteToDb(data, tenantId);
        delete payload.id;
        delete payload.tenant_id;
        const { error } = await db.from('notes').update(payload).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
      async delete(id) {
        const db = requireClient();
        const { error } = await db.from('notes').delete().eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      },
    },

    activities: {
      async listByLead(leadId) {
        const db = requireClient();
        const { data, error } = await db
          .from('activities')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapDbActivity);
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'activities');
        const id = newRecordId();
        const payload = { ...mapActivityToDb(data, tenantId), id };
        const { data: row, error } = await db.from('activities').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbActivity(row);
      },
    },

    team: {
      async list() {
        const db = requireClient();
        const { data, error } = await db
          .from('profiles')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('full_name', { ascending: true });
        if (error) throw error;
        return (data || []).map(mapDbProfile);
      },
    },

    auditLogs: {
      async list() {
        const db = requireClient();
        const { data, error } = await db
          .from('audit_logs')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapDbAuditLog);
      },
      async create(data) {
        const db = requireClient();
        rejectClientId(data, 'audit_logs');
        const id = newRecordId();
        const payload = {
          id,
          tenant_id: tenantId,
          user_id: data.userId,
          user_name: data.userName,
          user_role: data.userRole,
          action: data.action,
          details: data.details,
          created_at: data.createdAt || new Date().toISOString(),
        };
        const { data: row, error } = await db.from('audit_logs').insert(payload).select('*').single();
        if (error) throw error;
        return mapDbAuditLog(row);
      },
    },
  };
}
