-- ====================================================================
-- Migration 008: Stage A Additive Schema (Traveler, Inquiry, Booking)
-- ====================================================================
-- ADDITIVE ONLY: Creates new entity tables (traveler_profiles, inquiries,
-- bookings), composite tenant-aware foreign keys, indexes, triggers, and
-- RLS policies. Reuses existing public.get_user_tenant_id() and profiles.
-- DOES NOT backfill data, modify existing leads, or alter application reads/writes.
-- ====================================================================

-- 1. Ensure composite unique key on profiles for tenant-aware FKs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_profiles_tenant_composite'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT uq_profiles_tenant_composite UNIQUE (tenant_id, id);
  END IF;
END $$;

-- 2. Traveler Profiles (Customer Directory Entity)
CREATE TABLE IF NOT EXISTS public.traveler_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  normalized_phone text,
  preferred_language text DEFAULT 'en',
  special_notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_traveler_profiles_composite UNIQUE (tenant_id, id),
  CONSTRAINT chk_traveler_email_lowercase CHECK (email IS NULL OR email = lower(email))
);

CREATE INDEX IF NOT EXISTS idx_traveler_profiles_tenant ON public.traveler_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_traveler_profiles_tenant_email ON public.traveler_profiles(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traveler_profiles_tenant_phone ON public.traveler_profiles(tenant_id, normalized_phone) WHERE normalized_phone IS NOT NULL;

DROP TRIGGER IF EXISTS update_traveler_profiles_updated_at ON public.traveler_profiles;
CREATE TRIGGER update_traveler_profiles_updated_at
  BEFORE UPDATE ON public.traveler_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Inquiries (Sales Opportunity Entity)
CREATE TABLE IF NOT EXISTS public.inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  traveler_id uuid NOT NULL,
  legacy_lead_id text, -- Migration tracking & dual-write reconciliation
  destination text,   -- Nullable for intake
  lead_source text NOT NULL DEFAULT 'website',
  priority text NOT NULL DEFAULT 'medium',
  pipeline_stage text NOT NULL DEFAULT 'inquiry_received',
  expected_value numeric(12, 2),
  currency text NOT NULL DEFAULT 'INR',
  assigned_agent_id uuid,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_inquiries_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_inquiries_legacy_lead UNIQUE (tenant_id, legacy_lead_id),
  CONSTRAINT fk_inquiries_traveler FOREIGN KEY (tenant_id, traveler_id)
    REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_inquiries_agent FOREIGN KEY (assigned_agent_id)
    REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT chk_inquiry_priority CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  CONSTRAINT chk_inquiry_stage CHECK (pipeline_stage IN (
    'inquiry_received', 'initial_contact', 'options_shared',
    'consultation_booked', 'itinerary_sent', 'follow_up',
    'customizing_package', 'booking_confirmed', 'booking_lost'
  )),
  CONSTRAINT chk_inquiry_expected_value CHECK (expected_value IS NULL OR expected_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_inquiries_tenant_stage ON public.inquiries(tenant_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_inquiries_tenant_agent ON public.inquiries(tenant_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_tenant_traveler ON public.inquiries(tenant_id, traveler_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_follow_up ON public.inquiries(tenant_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_inquiries_updated_at ON public.inquiries;
CREATE TRIGGER update_inquiries_updated_at
  BEFORE UPDATE ON public.inquiries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Bookings (Operational Fulfillment Entity)
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  traveler_id uuid NOT NULL,
  inquiry_id uuid,
  legacy_lead_id text, -- Migration tracking & dual-write reconciliation
  booking_reference text NOT NULL,
  departure_date date,
  return_date date,
  passenger_count int,
  total_amount numeric(12, 2),
  paid_amount numeric(12, 2),
  
  -- Derived Always Stored Balance Due
  balance_due numeric(12, 2) GENERATED ALWAYS AS (
    CASE 
      WHEN total_amount IS NULL OR paid_amount IS NULL THEN NULL
      ELSE total_amount - paid_amount
    END
  ) STORED,
  
  currency text NOT NULL DEFAULT 'INR',
  booking_status text NOT NULL DEFAULT 'confirmed',
  payment_status text NOT NULL DEFAULT 'unknown',
  fulfillment_status text NOT NULL DEFAULT 'unknown',
  financial_data_complete boolean NOT NULL DEFAULT false,
  assigned_agent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_bookings_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_tenant_booking_reference UNIQUE (tenant_id, booking_reference),
  CONSTRAINT uq_tenant_inquiry_booking UNIQUE (tenant_id, inquiry_id),
  CONSTRAINT uq_bookings_legacy_lead UNIQUE (tenant_id, legacy_lead_id),
  CONSTRAINT fk_bookings_traveler FOREIGN KEY (tenant_id, traveler_id)
    REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_inquiry FOREIGN KEY (inquiry_id)
    REFERENCES public.inquiries(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_agent FOREIGN KEY (assigned_agent_id)
    REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT chk_booking_status CHECK (booking_status IN ('confirmed', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT chk_payment_status CHECK (payment_status IN ('pending', 'partial', 'completed', 'refunded', 'unknown')),
  CONSTRAINT chk_fulfillment_status CHECK (fulfillment_status IN (
    'unknown', 'vouchers_pending', 'documents_pending', 'payment_overdue',
    'visa_pending', 'ticketing_pending', 'ready_to_travel', 'completed'
  )),
  CONSTRAINT chk_booking_dates CHECK (
    departure_date IS NULL OR return_date IS NULL OR return_date >= departure_date
  ),
  CONSTRAINT chk_booking_passengers CHECK (passenger_count IS NULL OR passenger_count > 0),
  CONSTRAINT chk_booking_amounts CHECK (
    (total_amount IS NULL OR total_amount >= 0) AND
    (paid_amount IS NULL OR paid_amount >= 0) AND
    (paid_amount IS NULL OR total_amount IS NULL OR paid_amount <= total_amount)
  ),
  CONSTRAINT chk_financial_completeness CHECK (
    financial_data_complete = false OR (total_amount IS NOT NULL AND paid_amount IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_status ON public.bookings(tenant_id, booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_traveler ON public.bookings(tenant_id, traveler_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_agent ON public.bookings(tenant_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_bookings_departure ON public.bookings(tenant_id, departure_date) WHERE departure_date IS NOT NULL;

DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Add Relationship Columns to Existing Activity Tables
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS traveler_id uuid,
  ADD COLUMN IF NOT EXISTS inquiry_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conv_traveler') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT fk_conv_traveler FOREIGN KEY (tenant_id, traveler_id)
        REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conv_inquiry') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT fk_conv_inquiry FOREIGN KEY (tenant_id, inquiry_id)
        REFERENCES public.inquiries(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conv_booking') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT fk_conv_booking FOREIGN KEY (tenant_id, booking_id)
        REFERENCES public.bookings(tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_traveler ON public.conversations(tenant_id, traveler_id) WHERE traveler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_inquiry ON public.conversations(tenant_id, inquiry_id) WHERE inquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_booking ON public.conversations(tenant_id, booking_id) WHERE booking_id IS NOT NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS traveler_id uuid,
  ADD COLUMN IF NOT EXISTS inquiry_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_traveler') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_traveler FOREIGN KEY (tenant_id, traveler_id)
        REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_inquiry') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_inquiry FOREIGN KEY (tenant_id, inquiry_id)
        REFERENCES public.inquiries(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_booking') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_booking FOREIGN KEY (tenant_id, booking_id)
        REFERENCES public.bookings(tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_traveler ON public.tasks(tenant_id, traveler_id) WHERE traveler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_inquiry ON public.tasks(tenant_id, inquiry_id) WHERE inquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_booking ON public.tasks(tenant_id, booking_id) WHERE booking_id IS NOT NULL;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS traveler_id uuid,
  ADD COLUMN IF NOT EXISTS inquiry_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_act_traveler') THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT fk_act_traveler FOREIGN KEY (tenant_id, traveler_id)
        REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_act_inquiry') THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT fk_act_inquiry FOREIGN KEY (tenant_id, inquiry_id)
        REFERENCES public.inquiries(tenant_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_act_booking') THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT fk_act_booking FOREIGN KEY (tenant_id, booking_id)
        REFERENCES public.bookings(tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activities_traveler ON public.activities(tenant_id, traveler_id) WHERE traveler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_inquiry ON public.activities(tenant_id, inquiry_id) WHERE inquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_booking ON public.activities(tenant_id, booking_id) WHERE booking_id IS NOT NULL;

-- 6. Row-Level Security (RLS) Policies reusing public.get_user_tenant_id()
ALTER TABLE public.traveler_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation on traveler_profiles" ON public.traveler_profiles;
CREATE POLICY "Tenant isolation on traveler_profiles" ON public.traveler_profiles
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Tenant isolation on inquiries" ON public.inquiries;
CREATE POLICY "Tenant isolation on inquiries" ON public.inquiries
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Tenant isolation on bookings" ON public.bookings;
CREATE POLICY "Tenant isolation on bookings" ON public.bookings
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.get_user_role() = 'super_admin'
  );

-- 7. Secured Transactional RPC Functions
CREATE OR REPLACE FUNCTION public.create_inquiry_transactional(
  p_traveler_id uuid,
  p_destination text,
  p_lead_source text,
  p_priority text,
  p_expected_value numeric,
  p_assigned_agent_id uuid
) RETURNS uuid AS $$
DECLARE
  v_tenant_id text;
  v_inquiry_id uuid;
  v_legacy_lead_id text;
  v_traveler_name text;
BEGIN
  -- Derive tenant_id server-side via public.get_user_tenant_id()
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RAISE EXCEPTION 'Unauthenticated or invalid tenant request';
  END IF;

  v_inquiry_id := gen_random_uuid();
  v_legacy_lead_id := gen_random_uuid()::text;

  -- 1. Write to new entity table
  INSERT INTO public.inquiries (
    id, tenant_id, traveler_id, legacy_lead_id, destination, lead_source, priority, expected_value, assigned_agent_id
  ) VALUES (
    v_inquiry_id, v_tenant_id, p_traveler_id, v_legacy_lead_id, p_destination, p_lead_source, p_priority, p_expected_value, p_assigned_agent_id
  );

  -- 2. Fetch display_name for legacy lead synchronization
  SELECT display_name INTO v_traveler_name FROM public.traveler_profiles WHERE tenant_id = v_tenant_id AND id = p_traveler_id;

  -- 3. Synchronously write to legacy leads table in same DB transaction
  INSERT INTO public.leads (
    id, tenant_id, full_name, destination, lead_source, priority, deal_value, assigned_to, status, created_at, updated_at
  ) VALUES (
    v_legacy_lead_id, v_tenant_id, COALESCE(v_traveler_name, 'Unnamed Traveler'), p_destination, p_lead_source, p_priority, p_expected_value, p_assigned_agent_id, 'inquiry_received', now(), now()
  );

  RETURN v_inquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.create_inquiry_transactional FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_inquiry_transactional TO authenticated;

-- 8. Transactional Inquiry-to-Booking Conversion RPC (Prepared for future use)
CREATE OR REPLACE FUNCTION public.convert_inquiry_to_booking_transactional(
  p_inquiry_id uuid,
  p_departure_date date DEFAULT NULL,
  p_return_date date DEFAULT NULL,
  p_passenger_count int DEFAULT 1,
  p_total_amount numeric DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_tenant_id text;
  v_inquiry RECORD;
  v_booking_id uuid;
  v_booking_ref text;
BEGIN
  v_tenant_id := public.get_user_tenant_id();
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RAISE EXCEPTION 'Unauthenticated tenant request';
  END IF;

  SELECT * INTO v_inquiry FROM public.inquiries WHERE id = p_inquiry_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inquiry not found or access denied';
  END IF;

  v_booking_id := gen_random_uuid();
  v_booking_ref := 'BK-' || upper(replace(v_booking_id::text, '-', ''));

  -- 1. Create Booking
  INSERT INTO public.bookings (
    id, tenant_id, traveler_id, inquiry_id, legacy_lead_id, booking_reference,
    departure_date, return_date, passenger_count, total_amount, paid_amount,
    currency, booking_status, payment_status, fulfillment_status, financial_data_complete,
    assigned_agent_id, created_at, updated_at
  ) VALUES (
    v_booking_id, v_tenant_id, v_inquiry.traveler_id, p_inquiry_id, v_inquiry.legacy_lead_id, v_booking_ref,
    p_departure_date, p_return_date, p_passenger_count, COALESCE(p_total_amount, v_inquiry.expected_value), NULL,
    v_inquiry.currency, 'confirmed', 'unknown', 'vouchers_pending', (p_total_amount IS NOT NULL),
    v_inquiry.assigned_agent_id, now(), now()
  );

  -- 2. Update Inquiry stage
  UPDATE public.inquiries
  SET pipeline_stage = 'booking_confirmed', updated_at = now()
  WHERE id = p_inquiry_id AND tenant_id = v_tenant_id;

  -- 3. Synchronize legacy lead status if legacy_lead_id exists
  IF v_inquiry.legacy_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET status = 'booking_confirmed', updated_at = now()
    WHERE id = v_inquiry.legacy_lead_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN v_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.convert_inquiry_to_booking_transactional FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_inquiry_to_booking_transactional TO authenticated;
