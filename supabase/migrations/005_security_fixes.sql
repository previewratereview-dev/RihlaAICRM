-- ====================================================================
-- Migration 005: Security Fixes (Phase 1)
-- ====================================================================
-- Critical security hardening:
-- 1. get_user_role() reads from profiles.role (server-set, NOT client-settable)
-- 2. Profiles RLS is tenant-scoped (prevents cross-tenant data exposure)
-- 3. Audit logs are append-only (no UPDATE/DELETE policies)
-- 4. Admin profile operations are tenant-scoped
-- Run on: Any database using the base schema.

-- 1. Fix get_user_role() — secure version
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  SELECT coalesce(
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    'viewer'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. Fix profiles RLS — tenant-scoped read
DROP POLICY IF EXISTS "Allow all users to read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Tenant scoped profile read" ON public.profiles;
CREATE POLICY "Tenant scoped profile read" ON public.profiles
  FOR SELECT USING (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  );

-- 3. Fix admin profile update — tenant-scoped
DROP POLICY IF EXISTS "Tenant admins can update tenant profiles" ON public.profiles;
DROP POLICY IF EXISTS "Tenant scoped admin profile update" ON public.profiles;
CREATE POLICY "Tenant scoped admin profile update" ON public.profiles
  FOR UPDATE USING (
    public.get_user_role() IN ('super_admin', 'admin')
    AND (
      public.get_user_role() = 'super_admin'
      OR tenant_id = public.get_user_tenant_id()
    )
  );

-- 4. Fix admin profile delete — tenant-scoped
DROP POLICY IF EXISTS "Tenant admins can delete tenant profiles" ON public.profiles;
CREATE POLICY "Tenant admins can delete tenant profiles" ON public.profiles
  FOR DELETE USING (
    public.get_user_role() IN ('super_admin', 'admin')
    AND (
      public.get_user_role() = 'super_admin'
      OR tenant_id = public.get_user_tenant_id()
    )
  );

-- 5. Make audit logs append-only
DROP POLICY IF EXISTS "Tenant isolation on audit_logs" ON public.audit_logs;
CREATE POLICY "Tenant isolation on audit_logs" ON public.audit_logs
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit_logs" ON public.audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- No UPDATE or DELETE policies — audit logs are immutable once written.
