-- ============================================================================
-- Migration 012: Stage C1 Selected Traveler Linkage & Security Guard
-- Description: Amends execute_sync_lead_dual_write and sync_lead_authenticated
--              to support fail-closed selected_traveler_id linkage without
--              modifying historical Migration 011.
-- ============================================================================

BEGIN;

-- 1. Amend execute_sync_lead_dual_write function with selected_traveler_id validation
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
  v_existing_inq_traveler_id uuid;
  v_traveler_inq_count int;
  v_existing_traveler record;
  v_review_req boolean := false;
  v_review_reason text := null;
  v_prop_name text := null;
  v_prop_email text := null;
  v_prop_phone text := null;
  v_is_archived boolean := false;
  v_selected_traveler_raw text;
  v_selected_uuid uuid;
  v_server_traveler record;
BEGIN
  -- Server-Side Write Freeze Enforcement Guard
  IF public.is_write_freeze_active() THEN
    RAISE EXCEPTION 'Maintenance Write Freeze Active: Database mutations are temporarily suspended.';
  END IF;

  -- Lock Lead and Inquiry FOR UPDATE to serialize concurrent writes to existing lead
  PERFORM id FROM public.leads WHERE id = p_lead_id AND tenant_id = p_tenant_id FOR UPDATE;
  PERFORM id FROM public.inquiries WHERE legacy_lead_id = p_lead_id AND tenant_id = p_tenant_id FOR UPDATE;

  -- Check existing inquiry traveler ID for historical relinking protection
  SELECT id, traveler_id INTO v_existing_inq_id, v_existing_inq_traveler_id
  FROM public.inquiries
  WHERE tenant_id = p_tenant_id AND legacy_lead_id = p_lead_id;

  -- Extract explicit selected_traveler_id
  v_selected_traveler_raw := NULLIF(trim(p_payload->>'selected_traveler_id'), '');

  -- Historical Relinking Protection: prohibit moving existing inquiry to a different traveler
  IF v_existing_inq_traveler_id IS NOT NULL AND v_selected_traveler_raw IS NOT NULL THEN
    IF NOT pg_input_is_valid(v_selected_traveler_raw, 'uuid') THEN
      RAISE EXCEPTION 'Invalid UUID format for selected_traveler_id: %', v_selected_traveler_raw;
    END IF;
    v_selected_uuid := v_selected_traveler_raw::uuid;
    IF v_selected_uuid != v_existing_inq_traveler_id THEN
      RAISE EXCEPTION 'Reassignment of existing inquiry % to a different traveler is not permitted.', p_lead_id;
    END IF;
  END IF;

  -- Transaction-First External Idempotency Check
  v_ext_source := NULLIF(trim(p_payload->>'external_source'), '');
  v_ext_event := NULLIF(trim(p_payload->>'external_event_id'), '');
  
  IF v_ext_source IS NOT NULL AND v_ext_event IS NOT NULL THEN
    IF v_existing_inq_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'idempotent_duplicate', 'inquiry_id', v_existing_inq_id);
    END IF;
  END IF;

  -- Contact normalization
  v_norm_email := NULLIF(lower(trim(p_payload->>'email')), '');
  v_norm_phone := NULLIF(regexp_replace(p_payload->>'phone', '\D', '', 'g'), '');
  v_norm_name := COALESCE(NULLIF(trim(p_payload->>'full_name'), ''), 'Unnamed Traveler');

  -- Process Explicit Selected Traveler Validation (Fail-Closed)
  IF v_selected_traveler_raw IS NOT NULL THEN
    IF NOT pg_input_is_valid(v_selected_traveler_raw, 'uuid') THEN
      RAISE EXCEPTION 'Invalid UUID format for selected_traveler_id: %', v_selected_traveler_raw;
    END IF;

    v_selected_uuid := v_selected_traveler_raw::uuid;

    SELECT id, display_name, email, phone, normalized_phone
    INTO v_server_traveler
    FROM public.traveler_profiles
    WHERE id = v_selected_uuid AND tenant_id = p_tenant_id;

    IF v_server_traveler.id IS NULL THEN
      RAISE EXCEPTION 'Invalid or cross-tenant selected traveler: % does not exist in tenant %', v_selected_traveler_raw, p_tenant_id;
    END IF;

    v_traveler_id := v_server_traveler.id;

    -- Enforce server contact authority for compatibility lead insertion if client details mismatched
    v_norm_name := COALESCE(v_server_traveler.display_name, v_norm_name);
    if v_server_traveler.email IS NOT NULL THEN
      v_norm_email := lower(trim(v_server_traveler.email));
    END IF;
    IF v_server_traveler.normalized_phone IS NOT NULL THEN
      v_norm_phone := v_server_traveler.normalized_phone;
    END IF;
  ELSE
    -- Advisory Lock for Contact Matching
    IF v_norm_email IS NOT NULL OR v_norm_phone IS NOT NULL THEN
      v_advisory_key := hashtext(p_tenant_id || ':' || COALESCE(v_norm_email, v_norm_phone));
      PERFORM pg_advisory_xact_lock(v_advisory_key);
    END IF;
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
    NULLIF(trim(p_payload->>'assigned_to'), '')::uuid,
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

  -- 2. Traveler Matching (only run if selected_traveler_id was not specified)
  IF v_traveler_id IS NULL THEN
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
  END IF;

  -- 3. Check Multi-Inquiry Traveler Contact Updates
  SELECT COUNT(*) INTO v_traveler_inq_count FROM public.inquiries WHERE traveler_id = v_traveler_id;
  IF v_traveler_inq_count > 1 AND v_selected_traveler_raw IS NULL THEN
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
    NULLIF(trim(p_payload->>'assigned_to'), '')::uuid,
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
      gen_random_uuid(), p_tenant_id, v_traveler_id, v_inquiry_id, p_lead_id,
      'BK-' || upper(substring(p_lead_id from 1 for 8)),
      CASE WHEN (p_payload->>'deal_value')::numeric >= 0 THEN (p_payload->>'deal_value')::numeric ELSE 0 END,
      0,
      CASE WHEN (p_payload->>'deal_value')::numeric >= 0 THEN (p_payload->>'deal_value')::numeric ELSE 0 END,
      'INR', 'confirmed', 'pending', 'unknown', true,
      NULLIF(trim(p_payload->>'assigned_to'), '')::uuid,
      CASE WHEN v_is_archived THEN now() ELSE NULL END, now(), now()
    )
    ON CONFLICT (tenant_id, legacy_lead_id) DO UPDATE SET
      traveler_id = EXCLUDED.traveler_id,
      inquiry_id = EXCLUDED.inquiry_id,
      total_amount = EXCLUDED.total_amount,
      balance_due = EXCLUDED.total_amount - public.bookings.paid_amount,
      assigned_agent_id = EXCLUDED.assigned_agent_id,
      archived_at = CASE WHEN v_is_archived THEN now() ELSE public.bookings.archived_at END,
      updated_at = now();
  END IF;

  SELECT id INTO v_booking_id FROM public.bookings WHERE tenant_id = p_tenant_id AND legacy_lead_id = p_lead_id;

  RETURN jsonb_build_object(
    'status', 'synced',
    'lead_id', p_lead_id,
    'traveler_id', v_traveler_id,
    'inquiry_id', v_inquiry_id,
    'booking_id', v_booking_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Amend sync_lead_authenticated to whitelist selected_traveler_id
CREATE OR REPLACE FUNCTION public.sync_lead_authenticated(
  p_lead_id text,
  p_payload jsonb
) RETURNS jsonb AS $$
DECLARE
  v_tenant_id text;
  v_cleaned_payload jsonb := '{}'::jsonb;
  key text;
  val jsonb;
BEGIN
  -- Authenticated user tenant resolution
  v_tenant_id := (auth.jwt() ->> 'app_metadata')::jsonb ->> 'tenant_id';
  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    v_tenant_id := (auth.jwt() ->> 'user_metadata')::jsonb ->> 'tenant_id';
  END IF;
  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Authentication Error: Active tenant_id claim missing from JWT session context.';
  END IF;

  -- Whitelist validation of payload fields (including selected_traveler_id)
  FOR key, val IN SELECT * FROM jsonb_each(p_payload) LOOP
    IF key = ANY (ARRAY[
      'full_name', 'email', 'phone', 'status', 'destination', 'lead_source',
      'priority', 'deal_value', 'assigned_to', 'last_contacted', 'next_follow_up',
      'is_archived', 'archived_at', 'external_source', 'external_event_id',
      'selected_traveler_id'
    ]) THEN
      v_cleaned_payload := jsonb_insert(v_cleaned_payload, ARRAY[key], val);
    END IF;
  END LOOP;

  RETURN public.execute_sync_lead_dual_write(v_tenant_id, p_lead_id, v_cleaned_payload);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Revoke permissions and grant strictly to authenticated and service_role
REVOKE ALL ON FUNCTION public.execute_sync_lead_dual_write FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sync_lead_dual_write TO service_role;

REVOKE ALL ON FUNCTION public.sync_lead_authenticated FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_lead_authenticated TO authenticated, service_role;

COMMIT;
