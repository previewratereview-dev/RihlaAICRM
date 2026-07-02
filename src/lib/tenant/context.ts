import { resolveTenantFromRequest, type TenantResolution } from './resolver';

export type TenantContext = TenantResolution & {
  userId?: string;
  userRole?: string;
};

export function getTenantContextFromRequest(input: { 
  host?: string | null; 
  header?: string | null; 
  userId?: string | null; 
  userRole?: string | null; 
  sessionTenantId?: string | null;
  allowMismatch?: boolean;
  fallback?: string; 
} = {}): TenantContext {
  const resolution = resolveTenantFromRequest({
    host: input.host ?? null,
    header: input.header ?? null,
    sessionTenantId: input.sessionTenantId ?? null,
    allowMismatch: input.allowMismatch ?? false,
    fallback: input.fallback ?? 'global',
  });

  return {
    ...resolution,
    userId: input.userId ?? undefined,
    userRole: input.userRole ?? undefined,
  };
}