-- ====================================================================
-- STATE AI CRM — Complete Database Schema
-- ====================================================================
-- FRESH INSTALL: Run this entire file in Supabase SQL Editor.
-- EXISTING DB:   Run migrations in supabase/migrations/ in order.
--
-- Tables:        17 (tenants, profiles, leads, tasks, conversations,
--                     messages, activities, notes, settings, ai_usage,
--                     audit_logs, platform_settings, faq_entries,
--                     knowledge_documents, subscriptions,
--                     email_verification_otps, rate_limit_counters)
-- Extensions:    uuid-ossp, vector
-- Functions:     6 (get_user_role, get_user_tenant_id, handle_new_user,
--                     update_updated_at_column, rate_limit_hit,
--                     provision_agency)
-- Triggers:      9 (on_auth_user_created + 8 updated_at triggers)
-- ====================================================================

-- ====================================================================
-- 0. Extensions
-- ====================================================================
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ====================================================================
-- 1. Tables (in dependency order)
-- ====================================================================

-- 1.0 Tenants
create table if not exists public.tenants (
  id text primary key,
  name text not null,
  slug text unique not null,
  logo_url text,
  primary_color text,
  secondary_color text,
  domain text,
  custom_prompt text,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.tenants (id, name, slug, settings)
values ('global', 'Global Workspace', 'global', '{}'::jsonb)
on conflict (id) do nothing;

-- 1.1 Profiles (extends Supabase Auth Users)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  full_name text,
  role text not null default 'specialist'
    check (role in ('super_admin','admin','manager','consultant','specialist','member','viewer')),
  is_online boolean not null default false,
  phone text,
  tenant_id text not null references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.2 Leads
create table if not exists public.leads (
  id text primary key,
  full_name text not null,
  business_name text,
  email text,
  phone text,
  deal_value integer not null default 0,
  status text not null default 'new',
  priority text not null default 'medium',
  ai_score integer not null default 0,
  ai_summary text,
  lead_source text not null default 'website',
  assigned_to uuid references public.profiles(id) on delete set null,
  last_contacted text,
  next_follow_up text,
  tenant_id text not null default 'global' references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lead extensions
alter table public.leads add column if not exists ai_score_details jsonb;
alter table public.leads add column if not exists is_repeat_client boolean not null default false;
alter table public.leads add column if not exists website text;
alter table public.leads add column if not exists industry text;
alter table public.leads add column if not exists country text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists linkedin text;
alter table public.leads add column if not exists instagram text;
alter table public.leads add column if not exists employee_count text;
alter table public.leads add column if not exists monthly_revenue text;
alter table public.leads add column if not exists current_software text;
alter table public.leads add column if not exists interested_service text;
alter table public.leads add column if not exists pain_points text;
alter table public.leads add column if not exists budget text;
alter table public.leads add column if not exists tags text[] default '{}';
alter table public.leads add column if not exists trip_type text;
alter table public.leads add column if not exists destination text;
alter table public.leads add column if not exists number_of_travelers text;
alter table public.leads add column if not exists departure_date text;
alter table public.leads add column if not exists return_date text;
alter table public.leads add column if not exists duration text;
alter table public.leads add column if not exists travel_class text;
alter table public.leads add column if not exists special_requests text;
alter table public.leads add column if not exists source_of_discovery text;
alter table public.leads add column if not exists payment_status text;
alter table public.leads add column if not exists booking_reference text;
alter table public.leads add column if not exists consultation_date text;
alter table public.leads add column if not exists consultation_time text;
alter table public.leads add column if not exists meeting_link text;
alter table public.leads add column if not exists meeting_notes text;
alter table public.leads add column if not exists demo_date text;
alter table public.leads add column if not exists demo_time text;
alter table public.leads add column if not exists google_meet_link text;
alter table public.leads add column if not exists meeting_status text;
alter table public.leads add column if not exists follow_up_status text;
alter table public.leads add column if not exists assignment_history jsonb default '[]'::jsonb;

-- 1.3 Tasks (Checklist and Meetings)
create table if not exists public.tasks (
  id text primary key,
  title text not null,
  description text,
  type text not null default 'follow_up',
  priority text not null default 'medium',
  status text not null default 'pending',
  due_date text not null,
  lead_id text references public.leads(id) on delete cascade,
  lead_name text,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at text,
  tenant_id text not null default 'global' references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Task extensions
alter table public.tasks add column if not exists meeting_type text default 'follow_up';
alter table public.tasks add column if not exists meeting_outcome text default 'pending';
alter table public.tasks add column if not exists google_meet_link text;
alter table public.tasks add column if not exists meeting_notes text;
alter table public.tasks add column if not exists updates jsonb default '[]'::jsonb;

-- 1.4 Conversations
create table if not exists public.conversations (
  id text primary key,
  lead_id text references public.leads(id) on delete cascade,
  lead_name text not null,
  lead_company text,
  lead_email text,
  channel text not null default 'whatsapp',
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_name text,
  status text not null default 'open',
  last_message text,
  last_message_at text,
  unread_count integer not null default 0,
  phone text,
  tenant_id text not null default 'global' references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.5 Messages
create table if not exists public.messages (
  id text primary key,
  conversation_id text references public.conversations(id) on delete cascade,
  sender_type text not null,
  sender_id text,
  sender_name text,
  content text not null,
  message_type text not null default 'text',
  is_read boolean not null default false,
  tenant_id text not null default 'global' references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- 1.6 Activities
create table if not exists public.activities (
  id text primary key,
  lead_id text references public.leads(id) on delete cascade,
  user_id text,
  user_name text,
  type text not null,
  title text not null,
  description text,
  tenant_id text not null default 'global' references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- 1.7 Notes
create table if not exists public.notes (
  id text primary key,
  lead_id text references public.leads(id) on delete cascade,
  author_id text,
  author_name text,
  content text not null,
  is_pinned boolean not null default false,
  tenant_id text not null default 'global' references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.8 Settings (per-tenant)
create table if not exists public.settings (
  id text primary key default 'global',
  tenant_id text not null default 'global' references public.tenants(id) on delete cascade,
  agency_name text not null default 'WanderBot AI',
  logo_text text not null default 'WANDERBOT.AI',
  accent_color text not null default '#FF6B35',
  system_prompt text,
  openai_key text,
  anthropic_key text,
  make_webhook_url text,
  email_automation boolean not null default true,
  whatsapp_automation boolean not null default true,
  sms_automation boolean not null default false,
  ai_budgets jsonb not null default '{}'::jsonb,
  daily_target_score integer default 50,
  updated_at timestamptz not null default now()
);

insert into public.settings (id, tenant_id, agency_name)
values ('global', 'global', 'WanderBot AI')
on conflict (id) do update set tenant_id = excluded.tenant_id;

-- 1.9 AI Usage Logging
create table if not exists public.ai_usage (
  id text primary key,
  tenant_id text not null default 'global' references public.tenants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  feature text not null,
  provider text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_estimate numeric not null default 0,
  status text not null default 'success',
  request_id text,
  created_at timestamptz not null default now()
);

-- 1.10 Audit Logs (append-only)
create table if not exists public.audit_logs (
  id text primary key,
  tenant_id text not null default 'global' references public.tenants(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  user_role text not null,
  action text not null,
  details text not null,
  created_at timestamptz not null default now()
);

-- 1.11 Platform Settings (super admin)
create table if not exists public.platform_settings (
  id text primary key default 'platform',
  default_ai_model text not null default 'gpt-4o-mini',
  platform_monthly_ai_cap numeric not null default 500,
  maintenance_mode boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values ('platform') on conflict (id) do nothing;

-- 1.12 FAQ Entries (tenant-scoped chatbot)
create table if not exists public.faq_entries (
  id text primary key,
  tenant_id text not null default 'global' references public.tenants(id) on delete cascade,
  category text not null,
  question text not null,
  answer text not null,
  enabled boolean not null default true,
  keywords text[] not null default '{}',
  quick_replies text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.13 Knowledge Documents (pgvector RAG)
create table if not exists public.knowledge_documents (
  id text primary key,
  tenant_id text not null default 'global' references public.tenants(id) on delete cascade,
  title text not null,
  content text not null,
  source_type text not null default 'document',
  source_id text,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.14 Subscriptions (billing & trial management)
create table if not exists public.subscriptions (
  tenant_id text primary key references public.tenants(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','starter','pro','premium')),
  status text not null default 'active' check (status in ('active','trialing','past_due','cancelled')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default now(),
  razorpay_subscription_id text,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.15 Email Verification OTPs
create table if not exists public.email_verification_otps (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  otp text not null,
  token text not null,
  expires_at timestamptz not null,
  used boolean default false,
  created_at timestamptz default now()
);

-- 1.16 Rate Limit Counters
create table if not exists public.rate_limit_counters (
  id uuid default gen_random_uuid() primary key,
  key text not null unique,
  hit_count integer default 1,
  window_start timestamptz default now(),
  created_at timestamptz default now()
);

-- ====================================================================
-- 2. Helper Functions (must exist before RLS policies)
-- ====================================================================

-- 2.0 get_user_role() — reads from profiles.role (server-set, NOT client-settable)
create or replace function public.get_user_role()
returns text as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'viewer'
  );
$$ language sql security definer stable;

-- 2.1 get_user_tenant_id() — reads from profiles.tenant_id
create or replace function public.get_user_tenant_id()
returns text as $$
  select coalesce(
    (select tenant_id from public.profiles where id = auth.uid()),
    ''
  );
$$ language sql security definer stable;

-- 2.2 handle_new_user() — auto-create profile on auth signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_tenant_id text := nullif(new.raw_user_meta_data->>'tenant_id', '');
begin
  if v_tenant_id is null or v_tenant_id = 'global' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, role, is_online, phone, tenant_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'specialist'),
    false,
    new.raw_user_meta_data->>'phone',
    v_tenant_id
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- 2.3 update_updated_at_column() — auto-set updated_at on row update
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 2.4 rate_limit_hit() — atomic rate limiting
create or replace function public.rate_limit_hit(p_key text, p_window_ms bigint)
returns table(hit_count bigint, reset_at bigint)
language plpgsql
security definer
as $$
declare
  v_window_start timestamptz;
  v_count bigint;
begin
  v_window_start := now() - (p_window_ms || ' milliseconds')::interval;

  insert into public.rate_limit_counters (key, hit_count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    hit_count = case
      when rate_limit_counters.window_start < v_window_start then 1
      else rate_limit_counters.hit_count + 1
    end,
    window_start = case
      when rate_limit_counters.window_start < v_window_start then now()
      else rate_limit_counters.window_start
    end;

  select r.hit_count, extract(epoch from r.window_start) * 1000 + p_window_ms
  into v_count, reset_at
  from public.rate_limit_counters r
  where r.key = p_key;

  hit_count := v_count;
  return next;
end;
$$;

-- 2.5 provision_agency() — atomically create new tenant with admin + trial
create or replace function public.provision_agency(
  p_auth_user_id uuid,
  p_email text,
  p_agency_name text
)
returns table(tenant_id text, user_id uuid)
language plpgsql
security definer
as $$
declare
  v_tenant_id text;
  v_slug text;
begin
  v_tenant_id := 'tenant-' || replace(gen_random_uuid()::text, '-', '');
  v_slug := lower(replace(p_agency_name, ' ', '-'));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.tenants (id, name, slug, settings)
  values (v_tenant_id, p_agency_name, v_slug, '{}'::jsonb);

  insert into public.profiles (id, email, full_name, role, is_online, tenant_id)
  values (
    p_auth_user_id,
    p_email,
    split_part(p_email, '@', 1),
    'admin',
    false,
    v_tenant_id
  );

  insert into public.settings (id, tenant_id, agency_name)
  values (v_tenant_id, v_tenant_id, p_agency_name)
  on conflict (id) do nothing;

  insert into public.subscriptions (tenant_id, plan, status, trial_start, trial_end, current_period_start, current_period_end)
  values (
    v_tenant_id,
    'pro',
    'trialing',
    now(),
    now() + interval '7 days',
    now(),
    now() + interval '7 days'
  );

  tenant_id := v_tenant_id;
  user_id := p_auth_user_id;
  return next;
end;
$$;

-- ====================================================================
-- 3. Triggers
-- ====================================================================

-- 3.0 Auto-create profile on auth signup
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3.1-3.8 Auto-set updated_at on row update
create trigger update_tenants_updated_at before update on public.tenants
  for each row execute function public.update_updated_at_column();
create trigger update_profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();
create trigger update_leads_updated_at before update on public.leads
  for each row execute function public.update_updated_at_column();
create trigger update_tasks_updated_at before update on public.tasks
  for each row execute function public.update_updated_at_column();
create trigger update_conversations_updated_at before update on public.conversations
  for each row execute function public.update_updated_at_column();
create trigger update_notes_updated_at before update on public.notes
  for each row execute function public.update_updated_at_column();
create trigger update_settings_updated_at before update on public.settings
  for each row execute function public.update_updated_at_column();
create trigger update_knowledge_documents_updated_at before update on public.knowledge_documents
  for each row execute function public.update_updated_at_column();

-- ====================================================================
-- 4. Row Level Security (RLS)
-- ====================================================================

-- Enable RLS on all tenant-scoped tables
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.tasks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.activities enable row level security;
alter table public.notes enable row level security;
alter table public.settings enable row level security;
alter table public.ai_usage enable row level security;
alter table public.tenants enable row level security;
alter table public.audit_logs enable row level security;
alter table public.platform_settings enable row level security;
alter table public.faq_entries enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.subscriptions enable row level security;

-- --- Tenants ---
drop policy if exists "Allow authenticated users to read tenants" on public.tenants;
create policy "Allow authenticated users to read tenants" on public.tenants
  for select using (auth.role() = 'authenticated');

drop policy if exists "Allow super_admin to manage tenants" on public.tenants;
create policy "Allow super_admin to manage tenants" on public.tenants
  for all using (public.get_user_role() = 'super_admin');

-- --- Profiles ---
drop policy if exists "Tenant scoped profile read" on public.profiles;
create policy "Tenant scoped profile read" on public.profiles
  for select using (
    tenant_id = public.get_user_tenant_id()
    or public.get_user_role() = 'super_admin'
  );

drop policy if exists "Allow users to update own profile" on public.profiles;
create policy "Allow users to update own profile" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "Tenant scoped admin profile update" on public.profiles;
create policy "Tenant scoped admin profile update" on public.profiles
  for update using (
    public.get_user_role() in ('super_admin','admin')
    and (public.get_user_role() = 'super_admin' or tenant_id = public.get_user_tenant_id())
  );

drop policy if exists "Tenant admins can delete tenant profiles" on public.profiles;
create policy "Tenant admins can delete tenant profiles" on public.profiles
  for delete using (
    public.get_user_role() in ('super_admin','admin')
    and (public.get_user_role() = 'super_admin' or tenant_id = public.get_user_tenant_id())
  );

drop policy if exists "Tenant admins can insert tenant profiles" on public.profiles;
create policy "Tenant admins can insert tenant profiles" on public.profiles
  for insert with check (public.get_user_role() in ('super_admin','admin'));

drop policy if exists "Super admin read all profiles" on public.profiles;
create policy "Super admin read all profiles" on public.profiles
  for select using (public.get_user_role() = 'super_admin');

drop policy if exists "Super admin manage all profiles" on public.profiles;
create policy "Super admin manage all profiles" on public.profiles
  for update using (public.get_user_role() = 'super_admin');

-- --- Leads ---
drop policy if exists "Tenant isolation on leads" on public.leads;
create policy "Tenant isolation on leads" on public.leads
  for all using (tenant_id = public.get_user_tenant_id());

drop policy if exists "Super admin read all leads" on public.leads;
create policy "Super admin read all leads" on public.leads
  for select using (public.get_user_role() = 'super_admin');

-- --- Tasks ---
drop policy if exists "Tenant isolation on tasks" on public.tasks;
create policy "Tenant isolation on tasks" on public.tasks
  for all using (tenant_id = public.get_user_tenant_id());

-- --- Conversations ---
drop policy if exists "Tenant isolation on conversations" on public.conversations;
create policy "Tenant isolation on conversations" on public.conversations
  for all using (tenant_id = public.get_user_tenant_id());

drop policy if exists "Super admin read all conversations" on public.conversations;
create policy "Super admin read all conversations" on public.conversations
  for select using (public.get_user_role() = 'super_admin');

-- --- Messages ---
drop policy if exists "Tenant isolation on messages" on public.messages;
create policy "Tenant isolation on messages" on public.messages
  for all using (tenant_id = public.get_user_tenant_id());

-- --- Activities ---
drop policy if exists "Tenant isolation on activities" on public.activities;
create policy "Tenant isolation on activities" on public.activities
  for all using (tenant_id = public.get_user_tenant_id());

-- --- Notes ---
drop policy if exists "Tenant isolation on notes" on public.notes;
create policy "Tenant isolation on notes" on public.notes
  for all using (tenant_id = public.get_user_tenant_id());

-- --- Settings ---
drop policy if exists "Tenant isolation on settings" on public.settings;
create policy "Tenant isolation on settings" on public.settings
  for all using (tenant_id = public.get_user_tenant_id());

-- --- AI Usage ---
drop policy if exists "Tenant isolation on ai_usage" on public.ai_usage;
create policy "Tenant isolation on ai_usage" on public.ai_usage
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists "Service can insert ai_usage" on public.ai_usage;
create policy "Service can insert ai_usage" on public.ai_usage
  for insert with check (true);

drop policy if exists "Super admin read all ai_usage" on public.ai_usage;
create policy "Super admin read all ai_usage" on public.ai_usage
  for select using (public.get_user_role() = 'super_admin');

-- --- Audit Logs (append-only: no UPDATE/DELETE policies) ---
drop policy if exists "Tenant isolation on audit_logs" on public.audit_logs;
create policy "Tenant isolation on audit_logs" on public.audit_logs
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists "Authenticated users can insert audit_logs" on public.audit_logs;
create policy "Authenticated users can insert audit_logs" on public.audit_logs
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Super admin read all audit_logs" on public.audit_logs;
create policy "Super admin read all audit_logs" on public.audit_logs
  for select using (public.get_user_role() = 'super_admin');

-- --- Platform Settings ---
drop policy if exists "Super admin platform settings" on public.platform_settings;
create policy "Super admin platform settings" on public.platform_settings
  for all using (public.get_user_role() = 'super_admin');

-- --- FAQ Entries ---
drop policy if exists "Tenant isolation on faq_entries" on public.faq_entries;
create policy "Tenant isolation on faq_entries" on public.faq_entries
  for all using (tenant_id = public.get_user_tenant_id());

-- --- Knowledge Documents ---
drop policy if exists "Tenant isolation on knowledge_documents" on public.knowledge_documents;
create policy "Tenant isolation on knowledge_documents" on public.knowledge_documents
  for all using (tenant_id = public.get_user_tenant_id());

-- --- Subscriptions ---
drop policy if exists "Tenant isolation on subscriptions" on public.subscriptions;
create policy "Tenant isolation on subscriptions" on public.subscriptions
  for all using (tenant_id = public.get_user_tenant_id());

drop policy if exists "Super admin read all subscriptions" on public.subscriptions;
create policy "Super admin read all subscriptions" on public.subscriptions
  for select using (public.get_user_role() = 'super_admin');

-- ====================================================================
-- 5. Performance Indexes
-- ====================================================================

-- Core lookup indexes
create index if not exists idx_leads_tenant_created on public.leads(tenant_id, created_at);
create index if not exists idx_leads_assigned_to on public.leads(assigned_to);
create index if not exists idx_tasks_tenant_created on public.tasks(tenant_id, created_at);
create index if not exists idx_tasks_lead_assigned on public.tasks(lead_id, assigned_to);
create index if not exists idx_conversations_tenant_updated on public.conversations(tenant_id, updated_at);
create index if not exists idx_conversations_lead_assigned on public.conversations(lead_id, assigned_to);
create index if not exists idx_messages_tenant_created on public.messages(tenant_id, created_at);
create index if not exists idx_messages_conversation_id on public.messages(conversation_id);
create index if not exists idx_activities_tenant_created on public.activities(tenant_id, created_at);
create index if not exists idx_activities_lead_id on public.activities(lead_id);
create index if not exists idx_notes_tenant_created on public.notes(tenant_id, created_at);
create index if not exists idx_notes_lead_id on public.notes(lead_id);
create index if not exists idx_settings_tenant on public.settings(tenant_id);
create index if not exists idx_ai_usage_tenant_created on public.ai_usage(tenant_id, created_at);
create index if not exists idx_audit_logs_tenant_created on public.audit_logs(tenant_id, created_at);
create index if not exists idx_faq_entries_tenant on public.faq_entries(tenant_id);
create index if not exists idx_knowledge_documents_tenant on public.knowledge_documents(tenant_id);
create index if not exists idx_subscriptions_tenant on public.subscriptions(tenant_id);

-- Filter/query indexes
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_priority on public.leads(priority);
create index if not exists idx_leads_lead_source on public.leads(lead_source);
create index if not exists idx_leads_search on public.leads using gin(
  to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(business_name, ''))
);
create index if not exists idx_tasks_status_due on public.tasks(status, due_date);
create index if not exists idx_tasks_assigned_status on public.tasks(assigned_to, status);
create index if not exists idx_tasks_type on public.tasks(type);
create index if not exists idx_tasks_priority on public.tasks(priority);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_conversations_status on public.conversations(status);
create index if not exists idx_conversations_last_message on public.conversations(last_message_at desc nulls last);
create index if not exists idx_conversations_channel on public.conversations(channel);
create index if not exists idx_messages_is_read on public.messages(conversation_id, is_read);
create index if not exists idx_messages_sender_id on public.messages(sender_id);
create index if not exists idx_audit_logs_action on public.audit_logs(action);
create index if not exists idx_audit_logs_user on public.audit_logs(user_id);
create index if not exists idx_ai_usage_provider_model on public.ai_usage(provider, model);
create index if not exists idx_ai_usage_status on public.ai_usage(status);
create index if not exists idx_ai_usage_user_id on public.ai_usage(user_id);
create index if not exists idx_activities_type on public.activities(type);
create index if not exists idx_notes_is_pinned on public.notes(is_pinned);
create index if not exists idx_faq_entries_tenant_enabled on public.faq_entries(tenant_id, enabled);
create index if not exists idx_faq_entries_category on public.faq_entries(category);
create index if not exists idx_knowledge_documents_source_type on public.knowledge_documents(source_type);
create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_profiles_tenant_id on public.profiles(tenant_id);
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_email_verification_otps_email_otp
  on public.email_verification_otps(email, otp, used, expires_at);
create index if not exists idx_email_verification_otps_token
  on public.email_verification_otps(token, used, expires_at);
