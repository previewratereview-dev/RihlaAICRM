import type { UserRole, Permission } from '@/types/common';

export type { UserRole, Permission };

export const Permission_Matrix: Record<UserRole, Permission[]> = {
  super_admin: [
    'leads:read', 'leads:write', 'leads:delete',
    'tasks:read', 'tasks:write',
    'conversations:read', 'conversations:write',
    'team:read', 'team:write',
    'analytics:read',
    'settings:profile:write', 'settings:agency:read', 'settings:agency:write',
    'settings:ai:write', 'settings:integrations:write',
    'settings:users:write', 'settings:audit:read',
    'platform:tenants:write', 'platform:users:write',
    'platform:analytics:read', 'platform:settings:write',
  ],
  admin: [
    'leads:read', 'leads:write', 'leads:delete',
    'tasks:read', 'tasks:write',
    'conversations:read', 'conversations:write',
    'team:read', 'team:write',
    'analytics:read',
    'settings:profile:write', 'settings:agency:read', 'settings:agency:write',
    'settings:ai:write', 'settings:integrations:write',
    'settings:users:write', 'settings:audit:read',
  ],
  manager: [
    'leads:read', 'leads:write',
    'tasks:read', 'tasks:write',
    'conversations:read', 'conversations:write',
    'team:read',
    'analytics:read',
    'settings:profile:write',
  ],
  specialist: [
    'leads:read', 'leads:write',
    'tasks:read', 'tasks:write',
    'conversations:read', 'conversations:write',
    'settings:profile:write',
  ],
  consultant: [
    'leads:read', 'leads:write',
    'tasks:read', 'tasks:write',
    'conversations:read',
    'settings:profile:write',
  ],
  viewer: [
    'leads:read', 'tasks:read', 'conversations:read',
    'analytics:read', 'settings:profile:write',
  ],
  // Legacy roles — mapped to empty permission sets; use normaliseRole() before calling can()
  setter: [],
  closer: [],
};

/** Returns true iff the role holds the permission.
 *  Returns false (never throws) for unrecognised role values. */
export function can(role: string, permission: Permission): boolean {
  const perms = Permission_Matrix[role as UserRole];
  if (!perms) return false;
  return perms.includes(permission);
}
