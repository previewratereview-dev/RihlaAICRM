-- ====================================================================
-- Migration 011: Stage C0 Live Write Compatibility & Synchronization RPC
-- ====================================================================

-- 1. Lock Legacy Mutation Tables At Start of Migration Transaction
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

LOCK TABLE
  public.leads,
  public.tasks,
  public.activities,
  public.conversations
IN EXCLUSIVE MODE;

-- 2. In-Transaction Baseline Drift & Target Entity Count Assertions
DO $$
DECLARE
  v_lead_count int;
  v_inq_count int;
  v_bk_count int;
  v_trav_count int;
  v_unmapped_leads int;
  v_unmapped_confirmed int;
  v_tenant_violations int;
BEGIN
  SELECT COUNT(*) INTO v_lead_count FROM public.leads WHERE archived_at IS NULL;
  SELECT COUNT(*) INTO v_inq_count FROM public.inquiries WHERE archived_at IS NULL;
  SELECT COUNT(*) INTO v_bk_count FROM public.bookings WHERE archived_at IS NULL;
  SELECT COUNT(*) INTO v_trav_count FROM public.traveler_profiles;

  -- Verify baseline target counts for production snapshot
  IF v_lead_count != 93 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: leads count % != 93', v_lead_count;
  END IF;
  IF v_inq_count != 93 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: inquiries count % != 93', v_inq_count;
  END IF;
  IF v_bk_count != 6 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: bookings count % != 6', v_bk_count;
  END IF;
  IF v_trav_count != 92 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: traveler_profiles count % != 92', v_trav_count;
  END IF;

  -- Verify unmapped leads
  SELECT COUNT(*) INTO v_unmapped_leads
  FROM public.leads l
  WHERE l.archived_at IS NULL 
    AND NOT EXISTS (SELECT 1 FROM public.inquiries i WHERE i.tenant_id = l.tenant_id AND i.legacy_lead_id = l.id);

  IF v_unmapped_leads > 0 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: % leads missing mapped Inquiry', v_unmapped_leads;
  END IF;

  -- Verify unmapped confirmed leads
  SELECT COUNT(*) INTO v_unmapped_confirmed
  FROM public.leads l
  WHERE l.archived_at IS NULL 
    AND l.status IN ('booking_confirmed', 'closed_won')
    AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.tenant_id = l.tenant_id AND b.legacy_lead_id = l.id);

  IF v_unmapped_confirmed > 0 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: % confirmed leads missing Booking', v_unmapped_confirmed;
  END IF;

  -- Verify tenant isolation
  SELECT COUNT(*) INTO v_tenant_violations
  FROM public.inquiries i
  JOIN public.traveler_profiles t ON t.id = i.traveler_id
  WHERE t.tenant_id != i.tenant_id;

  IF v_tenant_violations > 0 THEN
    RAISE EXCEPTION 'In-transaction assertion failure: % tenant violations discovered', v_tenant_violations;
  END IF;
END $$;

-- 3. Additive Schema Updates: Maintenance Settings & Durable Event Queue
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_write_freeze_active()
RETURNS boolean AS $$
DECLARE
  v_freeze boolean := false;
BEGIN
  SELECT (value)::text = 'true' OR (value->>0)::text = 'true' INTO v_freeze 
  FROM public.app_settings 
  WHERE key = 'maintenance_write_freeze';

  RETURN COALESCE(v_freeze, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TABLE IF NOT EXISTS public.inbound_event_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.inquiries 
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_event_id text,
  ADD COLUMN IF NOT EXISTS identity_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS identity_review_reason text,
  ADD COLUMN IF NOT EXISTS proposed_display_name text,
  ADD COLUMN IF NOT EXISTS proposed_email text,
  ADD COLUMN IF NOT EXISTS proposed_phone text;

ALTER TABLE public.bookings 
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS external_message_id text;

-- Add Constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_inquiries_external_event') THEN
    ALTER TABLE public.inquiries ADD CONSTRAINT uq_inquiries_external_event UNIQUE (tenant_id, external_source, external_event_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_conversations_external_message') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT uq_conversations_external_message UNIQUE (tenant_id, external_message_id);
  END IF;
END $$;

-- 4. Legacy Table Database-Level Freeze Triggers (Protects Deployed Old Code)
CREATE OR REPLACE FUNCTION public.enforce_legacy_write_freeze()
RETURNS trigger AS $$
BEGIN
  IF public.is_write_freeze_active() THEN
    RAISE EXCEPTION 'Maintenance Write Freeze Active: Database mutations are temporarily suspended.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_freeze_legacy_leads ON public.leads;
CREATE TRIGGER trg_freeze_legacy_leads BEFORE INSERT OR UPDATE OR DELETE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.enforce_legacy_write_freeze();

DROP TRIGGER IF EXISTS trg_freeze_legacy_tasks ON public.tasks;
CREATE TRIGGER trg_freeze_legacy_tasks BEFORE INSERT OR UPDATE OR DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_legacy_write_freeze();

DROP TRIGGER IF EXISTS trg_freeze_legacy_activities ON public.activities;
CREATE TRIGGER trg_freeze_legacy_activities BEFORE INSERT OR UPDATE OR DELETE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.enforce_legacy_write_freeze();

DROP TRIGGER IF EXISTS trg_freeze_legacy_conversations ON public.conversations;
CREATE TRIGGER trg_freeze_legacy_conversations BEFORE INSERT OR UPDATE OR DELETE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_legacy_write_freeze();

-- 5. Deterministic Activity Relationship Pointer Resolver (BEFORE INSERT OR UPDATE)
CREATE OR REPLACE FUNCTION public.resolve_activity_relationship_pointers()
RETURNS trigger AS $$
DECLARE
  v_inquiry_id UUID;
  v_traveler_id UUID;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT i.id, i.traveler_id 
    INTO v_inquiry_id, v_traveler_id
    FROM public.inquiries i
    WHERE i.tenant_id = NEW.tenant_id AND i.legacy_lead_id = NEW.lead_id;

    IF v_inquiry_id IS NULL THEN
      RAISE EXCEPTION 'Invalid lead relationship: No active Inquiry found for lead_id % in tenant %', NEW.lead_id, NEW.tenant_id;
    END IF;

    NEW.inquiry_id := v_inquiry_id;
    NEW.traveler_id := v_traveler_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 6. Null-Safe Activity Relationship Integrity Validator (BEFORE INSERT OR UPDATE - Runs SECOND)
CREATE OR REPLACE FUNCTION public.verify_activity_relationship_integrity()
RETURNS trigger AS $$
DECLARE
  v_inq_traveler UUID;
  v_bk_traveler UUID;
  v_bk_inquiry UUID;
BEGIN
  IF NEW.traveler_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.traveler_profiles WHERE id = NEW.traveler_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Cross-tenant linkage: traveler_id % does not match tenant %', NEW.traveler_id, NEW.tenant_id;
  END IF;

  IF NEW.inquiry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inquiries WHERE id = NEW.inquiry_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Cross-tenant linkage: inquiry_id % does not match tenant %', NEW.inquiry_id, NEW.tenant_id;
  END IF;

  IF NEW.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = NEW.booking_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Cross-tenant linkage: booking_id % does not match tenant %', NEW.booking_id, NEW.tenant_id;
  END IF;

  IF NEW.inquiry_id IS NOT NULL AND NEW.traveler_id IS NOT NULL THEN
    SELECT traveler_id INTO v_inq_traveler FROM public.inquiries WHERE id = NEW.inquiry_id;
    IF v_inq_traveler IS DISTINCT FROM NEW.traveler_id THEN
      RAISE EXCEPTION 'Internal reference mismatch: inquiry traveler % IS DISTINCT FROM supplied traveler %', v_inq_traveler, NEW.traveler_id;
    END IF;
  END IF;

  IF NEW.booking_id IS NOT NULL THEN
    SELECT traveler_id, inquiry_id INTO v_bk_traveler, v_bk_inquiry FROM public.bookings WHERE id = NEW.booking_id;
    IF NEW.traveler_id IS NOT NULL AND v_bk_traveler IS DISTINCT FROM NEW.traveler_id THEN
      RAISE EXCEPTION 'Internal reference mismatch: booking traveler % IS DISTINCT FROM supplied traveler %', v_bk_traveler, NEW.traveler_id;
    END IF;
    IF NEW.inquiry_id IS NOT NULL AND v_bk_inquiry IS DISTINCT FROM NEW.inquiry_id THEN
      RAISE EXCEPTION 'Internal reference mismatch: booking inquiry % IS DISTINCT FROM supplied inquiry %', v_bk_inquiry, NEW.inquiry_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Attach Triggers
DROP TRIGGER IF EXISTS trg_1_resolve_task_pointers ON public.tasks;
CREATE TRIGGER trg_1_resolve_task_pointers BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.resolve_activity_relationship_pointers();

DROP TRIGGER IF EXISTS trg_2_verify_task_integrity ON public.tasks;
CREATE TRIGGER trg_2_verify_task_integrity BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.verify_activity_relationship_integrity();

DROP TRIGGER IF EXISTS trg_1_resolve_activity_pointers ON public.activities;
CREATE TRIGGER trg_1_resolve_activity_pointers BEFORE INSERT OR UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.resolve_activity_relationship_pointers();

DROP TRIGGER IF EXISTS trg_2_verify_activity_integrity ON public.activities;
CREATE TRIGGER trg_2_verify_activity_integrity BEFORE INSERT OR UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.verify_activity_relationship_integrity();

DROP TRIGGER IF EXISTS trg_1_resolve_conversation_pointers ON public.conversations;
CREATE TRIGGER trg_1_resolve_conversation_pointers BEFORE INSERT OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.resolve_activity_relationship_pointers();

DROP TRIGGER IF EXISTS trg_2_verify_conversation_integrity ON public.conversations;
CREATE TRIGGER trg_2_verify_conversation_integrity BEFORE INSERT OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.verify_activity_relationship_integrity();

-- 7. Internal Dual-Write Engine (With Write Freeze Guard, FOR UPDATE, Advisory Lock Concurrency)
CREATE OR REPLACE FUNCTION public.execute_sync_lead_dual_write(
  p_tenant_id text,
  p_lead_id text,
  p_payload jsonb
) RETURNS jsonb AS $$
DECLARE
  v_norm_email text;
  v_norm_phone text;
  v_norm_name text;
  v_advisory_key bigint;
  v_email_matches uuid[];
  v_phone_matches uuid[];
  v_traveler_id uuid;
  v_inquiry_id uuid;
  v_booking_id uuid;
  v_target_stage text;
  v_status text;
  v_ext_source text;
  v_ext_event text;
  v_existing_inq_id uuid;
  v_traveler_inq_count int;
  v_existing_traveler record;
  v_review_req boolean := false;
  v_review_reason text := null;
  v_prop_name text := null;
  v_prop_email text := null;
  v_prop_phone text := null;
  v_is_archived boolean := false;
BEGIN
  -- Server-Side Write Freeze Enforcement Guard
  IF public.is_write_freeze_active() THEN
    RAISE EXCEPTION 'Maintenance Write Freeze Active: Database mutations are temporarily suspended.';
  END IF;

  -- Lock Lead and Inquiry FOR UPDATE to serialize concurrent writes to existing lead
  PERFORM id FROM public.leads WHERE id = p_lead_id AND tenant_id = p_tenant_id FOR UPDATE;
  PERFORM id FROM public.inquiries WHERE legacy_lead_id = p_lead_id AND tenant_id = p_tenant_id FOR UPDATE;

  -- Transaction-First External Idempotency Check
  v_ext_source := NULLIF(trim(p_payload->>'external_source'), '');
  v_ext_event := NULLIF(trim(p_payload->>'external_event_id'), '');
  
  IF v_ext_source IS NOT NULL AND v_ext_event IS NOT NULL THEN
    SELECT id INTO v_existing_inq_id 
    FROM public.inquiries 
    WHERE tenant_id = p_tenant_id AND external_source = v_ext_source AND external_event_id = v_ext_event;

    IF v_existing_inq_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'idempotent_duplicate', 'inquiry_id', v_existing_inq_id);
    END IF;
  END IF;

  -- Contact normalization
  v_norm_email := NULLIF(lower(trim(p_payload->>'email')), '');
  v_norm_phone := NULLIF(regexp_replace(p_payload->>'phone', '\D', '', 'g'), '');
  v_norm_name := COALESCE(NULLIF(trim(p_payload->>'full_name'), ''), 'Unnamed Traveler');

  -- NEW TRAVELER MATCHING CONCURRENCY: Acquire 64-bit Transaction Advisory Lock for Tenant + Contact Key
  IF v_norm_email IS NOT NULL OR v_norm_phone IS NOT NULL THEN
    v_advisory_key := hashtext(p_tenant_id || ':' || COALESCE(v_norm_email, v_norm_phone));
    PERFORM pg_advisory_xact_lock(v_advisory_key);
  END IF;

  v_status := COALESCE(p_payload->>'status', 'new');
  v_is_archived := (p_payload->>'is_archived')::boolean IS TRUE OR p_payload->>'archived_at' IS NOT NULL;

  v_target_stage := CASE v_status
    WHEN 'new' THEN 'inquiry_received'
    WHEN 'inquiry_received' THEN 'inquiry_received'
    WHEN 'contacted' THEN 'initial_contact'
    WHEN 'initial_contact' THEN 'initial_contact'
    WHEN 'interested' THEN 'options_shared'
    WHEN 'options_shared' THEN 'options_shared'
    WHEN 'demo_scheduled' THEN 'consultation_booked'
    WHEN 'consultation_booked' THEN 'consultation_booked'
    WHEN 'proposal_sent' THEN 'itinerary_sent'
    WHEN 'itinerary_sent' THEN 'itinerary_sent'
    WHEN 'follow_up' THEN 'follow_up'
    WHEN 'negotiation' THEN 'customizing_package'
    WHEN 'customizing_package' THEN 'customizing_package'
    WHEN 'closed_won' THEN 'booking_confirmed'
    WHEN 'booking_confirmed' THEN 'booking_confirmed'
    WHEN 'closed_lost' THEN 'booking_lost'
    WHEN 'booking_lost' THEN 'booking_lost'
    ELSE 'inquiry_received'
  END;

  -- 1. Mutate Legacy public.leads
  INSERT INTO public.leads (
    id, tenant_id, full_name, email, phone, status, destination, lead_source,
    priority, deal_value, assigned_to, last_contacted, next_follow_up, archived_at, created_at, updated_at
  ) VALUES (
    p_lead_id, p_tenant_id, v_norm_name, p_payload->>'email', p_payload->>'phone',
    v_status, NULLIF(trim(p_payload->>'destination'), ''), COALESCE(p_payload->>'lead_source', 'website'),
    COALESCE(p_payload->>'priority', 'medium'),
    CASE WHEN (p_payload->>'deal_value')::numeric >= 0 THEN (p_payload->>'deal_value')::numeric ELSE 0 END,
    p_payload->>'assigned_to',
    p_payload->>'last_contacted', p_payload->>'next_follow_up',
    CASE WHEN v_is_archived THEN now() ELSE NULL END,
    now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    status = EXCLUDED.status,
    destination = EXCLUDED.destination,
    lead_source = EXCLUDED.lead_source,
    priority = EXCLUDED.priority,
    deal_value = EXCLUDED.deal_value,
    assigned_to = EXCLUDED.assigned_to,
    last_contacted = EXCLUDED.last_contacted,
    next_follow_up = EXCLUDED.next_follow_up,
    archived_at = CASE WHEN v_is_archived THEN now() ELSE public.leads.archived_at END,
    updated_at = now();

  -- 2. Deterministic Traveler Matching Algorithm
  SELECT ARRAY(SELECT id FROM public.traveler_profiles WHERE tenant_id = p_tenant_id AND v_norm_email IS NOT NULL AND lower(trim(email)) = v_norm_email) INTO v_email_matches;
  SELECT ARRAY(SELECT id FROM public.traveler_profiles WHERE tenant_id = p_tenant_id AND v_norm_phone IS NOT NULL AND normalized_phone = v_norm_phone) INTO v_phone_matches;

  IF array_length(v_email_matches, 1) = 1 AND array_length(v_phone_matches, 1) = 1 AND v_email_matches[1] = v_phone_matches[1] THEN
    v_traveler_id := v_email_matches[1];
  ELSIF array_length(v_email_matches, 1) = 1 AND array_length(v_phone_matches, 1) IS NULL THEN
    v_traveler_id := v_email_matches[1];
  ELSIF array_length(v_phone_matches, 1) = 1 AND array_length(v_email_matches, 1) IS NULL THEN
    v_traveler_id := v_phone_matches[1];
  ELSE
    v_traveler_id := gen_random_uuid();
    INSERT INTO public.traveler_profiles (
      id, tenant_id, display_name, email, phone, normalized_phone, created_at, updated_at
    ) VALUES (
      v_traveler_id, p_tenant_id, v_norm_name, v_norm_email, p_payload->>'phone', v_norm_phone, now(), now()
    );
  END IF;

  -- 3. Check Multi-Inquiry Traveler Contact Updates
  SELECT COUNT(*) INTO v_traveler_inq_count FROM public.inquiries WHERE traveler_id = v_traveler_id;
  IF v_traveler_inq_count > 1 THEN
    SELECT email, normalized_phone, display_name INTO v_existing_traveler FROM public.traveler_profiles WHERE id = v_traveler_id;
    IF (v_norm_email IS DISTINCT FROM lower(trim(COALESCE(v_existing_traveler.email, '')))) OR (v_norm_phone IS DISTINCT FROM COALESCE(v_existing_traveler.normalized_phone, '')) THEN
      v_review_req := true;
      v_review_reason := 'Material contact change on multi-inquiry traveler profile';
      v_prop_name := v_norm_name;
      v_prop_email := v_norm_email;
      v_prop_phone := p_payload->>'phone';
    ELSE
      UPDATE public.traveler_profiles 
      SET display_name = v_norm_name, email = v_norm_email, phone = p_payload->>'phone', normalized_phone = v_norm_phone, updated_at = now()
      WHERE id = v_traveler_id;
    END IF;
  END IF;

  -- 4. Mutate New Entity Model: inquiries
  INSERT INTO public.inquiries (
    id, tenant_id, traveler_id, legacy_lead_id, destination, lead_source, priority,
    pipeline_stage, expected_value, currency, assigned_agent_id,
    last_contacted_at, next_follow_up_at, external_source, external_event_id,
    identity_review_required, identity_review_reason, proposed_display_name, proposed_email, proposed_phone,
    archived_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, v_traveler_id, p_lead_id, NULLIF(trim(p_payload->>'destination'), ''),
    COALESCE(p_payload->>'lead_source', 'website'), COALESCE(p_payload->>'priority', 'medium'),
    v_target_stage, CASE WHEN (p_payload->>'deal_value')::numeric >= 0 THEN (p_payload->>'deal_value')::numeric ELSE NULL END, 'INR',
    p_payload->>'assigned_to',
    CASE WHEN p_payload->>'last_contacted' IS NOT NULL AND pg_input_is_valid(p_payload->>'last_contacted', 'timestamptz') THEN (p_payload->>'last_contacted')::timestamptz ELSE NULL END,
    CASE WHEN p_payload->>'next_follow_up' IS NOT NULL AND pg_input_is_valid(p_payload->>'next_follow_up', 'timestamptz') THEN (p_payload->>'next_follow_up')::timestamptz ELSE NULL END,
    v_ext_source, v_ext_event, v_review_req, v_review_reason, v_prop_name, v_prop_email, v_prop_phone,
    CASE WHEN v_is_archived THEN now() ELSE NULL END, now(), now()
  )
  ON CONFLICT (tenant_id, legacy_lead_id) DO UPDATE SET
    traveler_id = EXCLUDED.traveler_id,
    destination = EXCLUDED.destination,
    lead_source = EXCLUDED.lead_source,
    priority = EXCLUDED.priority,
    pipeline_stage = EXCLUDED.pipeline_stage,
    expected_value = EXCLUDED.expected_value,
    assigned_agent_id = EXCLUDED.assigned_agent_id,
    last_contacted_at = EXCLUDED.last_contacted_at,
    next_follow_up_at = EXCLUDED.next_follow_up_at,
    identity_review_required = EXCLUDED.identity_review_required,
    identity_review_reason = EXCLUDED.identity_review_reason,
    proposed_display_name = EXCLUDED.proposed_display_name,
    proposed_email = EXCLUDED.proposed_email,
    proposed_phone = EXCLUDED.proposed_phone,
    archived_at = CASE WHEN v_is_archived THEN now() ELSE public.inquiries.archived_at END,
    updated_at = now();

  SELECT id INTO v_inquiry_id FROM public.inquiries WHERE tenant_id = p_tenant_id AND legacy_lead_id = p_lead_id;

  -- 5. Mutate New Entity Model: bookings
  IF v_target_stage = 'booking_confirmed' THEN
    INSERT INTO public.bookings (
      id, tenant_id, traveler_id, inquiry_id, legacy_lead_id, booking_reference,
      total_amount, paid_amount, balance_due, currency, booking_status, payment_status,
      fulfillment_status, financial_data_complete, assigned_agent_id, archived_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), p_tenant_id, v_traveler_id, v_inquiry_id, p_lead_id, 'BK-' || upper(replace(p_lead_id, '-', '')),
      NULL, NULL, NULL, 'INR', 'confirmed', 'unknown', 'unknown', false, p_payload->>'assigned_to',
      CASE WHEN v_is_archived THEN now() ELSE NULL END, now(), now()
    )
    ON CONFLICT (tenant_id, legacy_lead_id) DO UPDATE SET
      traveler_id = EXCLUDED.traveler_id,
      inquiry_id = EXCLUDED.inquiry_id,
      assigned_agent_id = EXCLUDED.assigned_agent_id,
      archived_at = CASE WHEN v_is_archived THEN now() ELSE public.bookings.archived_at END,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('status', 'success', 'lead_id', p_lead_id, 'inquiry_id', v_inquiry_id, 'traveler_id', v_traveler_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.execute_sync_lead_dual_write FROM PUBLIC, anon, authenticated;

-- 8. Authenticated RPC Wrapper (Strict Role Allowlist & Tenant Derivation)
CREATE OR REPLACE FUNCTION public.sync_lead_authenticated(
  p_lead_id text,
  p_payload jsonb
) RETURNS jsonb AS $$
DECLARE
  v_tenant_id text;
  v_user_role text;
BEGIN
  SELECT tenant_id, role INTO v_tenant_id, v_user_role FROM public.profiles WHERE id = auth.uid();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated request';
  END IF;

  IF v_user_role NOT IN ('super_admin', 'admin', 'manager', 'agent') THEN
    RAISE EXCEPTION 'Permission denied: Role % lacks write authority', v_user_role;
  END IF;

  IF EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id AND tenant_id != v_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: Lead % does not belong to user tenant %', p_lead_id, v_tenant_id;
  END IF;

  RETURN public.execute_sync_lead_dual_write(v_tenant_id, p_lead_id, p_payload);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.sync_lead_authenticated FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_lead_authenticated TO authenticated;

-- 9. Privileged Service-Role RPC (For trusted webhooks & background workers)
CREATE OR REPLACE FUNCTION public.sync_lead_service_role(
  p_tenant_id text,
  p_lead_id text,
  p_payload jsonb
) RETURNS jsonb AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Invalid tenant_id %', p_tenant_id;
  END IF;

  RETURN public.execute_sync_lead_dual_write(p_tenant_id, p_lead_id, p_payload);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.sync_lead_service_role FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_lead_service_role TO service_role, postgres;

-- 10. ATOMIC FREEZE INITIALIZATION (Commit Migration With Maintenance Freeze Active = TRUE)
INSERT INTO public.app_settings (key, value)
VALUES ('maintenance_write_freeze', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = now();
