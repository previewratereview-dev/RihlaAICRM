export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'specialist'
  | 'setter'
  | 'closer'
  | 'consultant'
  | 'viewer';

export type Permission =
  | 'leads:read'
  | 'leads:write'
  | 'leads:delete'
  | 'tasks:read'
  | 'tasks:write'
  | 'conversations:read'
  | 'conversations:write'
  | 'team:read'
  | 'team:write'
  | 'analytics:read'
  | 'settings:profile:write'
  | 'settings:agency:read'
  | 'settings:agency:write'
  | 'settings:ai:write'
  | 'settings:integrations:write'
  | 'settings:users:write'
  | 'settings:audit:read'
  | 'platform:tenants:write'
  | 'platform:users:write'
  | 'platform:analytics:read'
  | 'platform:settings:write';

export interface User {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
  tenantId: string;
  phone?: string;
  isOnline?: boolean;
  status?: 'active' | 'deactivated';
}

export interface SelectOption {
  label: string;
  value: string;
}

export type DateRange = {
  from: Date;
  to: Date;
};

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: 'login' | 'logout' | 'create_lead' | 'edit_lead' | 'delete_lead' | 'update_status' | 'complete_task' | 'book_meeting' | 'import_leads' | 'outreach' | 'reset_password' | 'settings_change' | 'tenant_created' | 'tenant_suspended' | 'tenant_updated' | 'cross_tenant_access';
  details: string;
  createdAt: string;
  tenantId: string;
}

export interface TenantStats {
  userCount: number;
  leadCount: number;
  aiSpend: number;
  conversationCount: number;
}

export interface TenantWithStats extends Tenant {
  stats: TenantStats;
}

export interface PlatformUser extends User {
  tenantId: string;
  tenantName: string;
}

export interface TenantFeatureFlags {
  pipeline?: boolean;
  chatbot?: boolean;
  analytics?: boolean;
  payments?: boolean;
  email?: boolean;
  whatsapp?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  domain?: string;
  customPrompt?: string;
  settings: Record<string, unknown>;
  /** Authoritative subscription tier, resolved from the `subscriptions` table. */
  plan: 'free' | 'starter' | 'pro' | 'premium';
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}
