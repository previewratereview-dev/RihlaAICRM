-- ====================================================================
-- Super Admin Setup Script
-- Run this AFTER creating the user in Supabase Dashboard > Auth > Users
-- ====================================================================

-- Step 1: Create the user in Supabase Dashboard:
--   - Go to Authentication > Users > Add User
--   - Email: rayees@stateai.in
--   - Password: Sabr4lyf@2
--   - Auto Confirm: Yes
--   - Copy the User UUID

-- Step 2: Run this SQL (replace THE_USER_UUID with the actual UUID from Step 1)

-- Insert profile for super admin (uses 'global' tenant as placeholder)
INSERT INTO public.profiles (id, email, full_name, role, is_online, tenant_id)
VALUES (
  'THE_USER_UUID',           -- Replace with actual UUID from Supabase Auth
  'rayees@stateai.in',
  'Rayees Amin',
  'super_admin',
  false,
  'global'
)
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  full_name = 'Rayees Amin';
