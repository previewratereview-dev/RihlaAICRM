# Database Migrations

## Fresh Install

Run **one file** in Supabase SQL Editor:

```
supabase_schema.sql   (root of project)
```

This creates ALL 17 tables, 6 functions, 9 triggers, RLS policies, and indexes.

## Existing Database (Incremental Updates)

Run these in order **only if you haven't already run `supabase_schema.sql`**:

| # | File | Purpose |
|---|------|---------|
| 001 | `001_email_verification_otps.sql` | OTP verification table |
| 002 | `002_rate_limit_counters.sql` | Rate limiting table + function |
| 003 | `003_subscriptions.sql` | Billing & trial management table |
| 004 | `004_provision_agency.sql` | Self-service tenant signup function |
| 005 | `005_security_fixes.sql` | Security hardening (role source, tenant-scoped RLS) |
| 006 | `006_infrastructure.sql` | updated_at triggers + performance indexes |

## Super Admin Setup

After running the schema, create the super admin:

1. Create user in Supabase Dashboard > Auth > Users
2. Run `setup_super_admin.sql` with the user's UUID

## Order Dependencies

- Migration 003 (subscriptions) MUST run before 004 (provision_agency)
- Migration 005 (security fixes) should run after the base schema
- Migration 006 (infrastructure) should run after all tables exist

## Files Deleted

- `fix_rls_recursion.sql` — DELETED. Used insecure `auth.users.raw_user_meta_data` for role lookup. Superseded by migration 005 which reads from `profiles.role` (server-set).
