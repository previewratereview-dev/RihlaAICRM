-- ============================================================================
-- Migration 019: Commercial Acceptance, Provenance & Atomic Booking Conversion
-- Phase: AI-5B.4
--
-- Tables Enhanced:
--   - public.quote_acceptances (staff_acceptance_method, staff_reference_notes, provenance constraint)
--   - public.tenant_booking_sequences (atomic year-scoped sequential booking numbering)
--
-- Triggers:
--   - trg_protect_quote_acceptance_immutability (core facts immutability & append-once voiding)
--
-- Stored Procedures:
--   - rpc_record_portal_quote_acceptance (Public capability-bound traveler acceptance)
--   - rpc_record_staff_quote_acceptance (Governed staff manual acceptance)
--   - rpc_void_quote_acceptance (Governed acceptance void with converted-booking protection)
--   - rpc_convert_accepted_quote_to_booking (Governed atomic booking conversion & inquiry transition)
--
-- Security:
--   - ALL RPCs revoked from PUBLIC, anon, authenticated
--   - Granted exclusively to service_role, postgres
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ADDITIVE COLUMNS & PROVENANCE CONSTRAINTS ON QUOTE ACCEPTANCES
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'quote_acceptances' 
      AND column_name = 'staff_acceptance_method'
  ) THEN
    ALTER TABLE public.quote_acceptances ADD COLUMN staff_acceptance_method text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'quote_acceptances' 
      AND column_name = 'staff_reference_notes'
  ) THEN
    ALTER TABLE public.quote_acceptances ADD COLUMN staff_reference_notes text;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.quote_acceptances DROP CONSTRAINT IF EXISTS chk_quote_acceptance_staff_method;
  ALTER TABLE public.quote_acceptances ADD CONSTRAINT chk_quote_acceptance_staff_method
    CHECK (staff_acceptance_method IS NULL OR staff_acceptance_method IN ('email', 'whatsapp', 'phone', 'in_person', 'other'));

  ALTER TABLE public.quote_acceptances DROP CONSTRAINT IF EXISTS chk_quote_acceptance_provenance;
  ALTER TABLE public.quote_acceptances ADD CONSTRAINT chk_quote_acceptance_provenance
    CHECK (
      (acceptance_type = 'traveler_portal' AND accepted_by_user_id IS NULL AND staff_acceptance_method IS NULL)
      OR
      (acceptance_type = 'staff_recorded' AND accepted_by_user_id IS NOT NULL AND quote_share_id IS NULL)
    );
END $$;

-- ============================================================================
-- 2. TENANT BOOKING SEQUENCES (RACE-SAFE NUMBERING)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_booking_sequences (
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year),
  CONSTRAINT chk_booking_seq_year CHECK (year >= 2020 AND year <= 2100),
  CONSTRAINT chk_booking_seq_last_number CHECK (last_number >= 0)
);

ALTER TABLE public.tenant_booking_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_booking_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation on tenant_booking_sequences" ON public.tenant_booking_sequences;
DROP POLICY IF EXISTS "Deny direct client read on booking sequences" ON public.tenant_booking_sequences;

CREATE POLICY "Deny direct client read on booking sequences" ON public.tenant_booking_sequences
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_tenant_booking_reference'
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT uq_tenant_booking_reference UNIQUE (tenant_id, booking_reference);
  END IF;
END $$;

-- ============================================================================
-- 3. CORE FACTS IMMUTABILITY & VOID APPEND-ONCE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_quote_acceptance_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Core acceptance facts can NEVER be changed after insertion
  IF (
    OLD.id IS DISTINCT FROM NEW.id OR
    OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
    OLD.inquiry_id IS DISTINCT FROM NEW.inquiry_id OR
    OLD.quote_id IS DISTINCT FROM NEW.quote_id OR
    OLD.quote_version_id IS DISTINCT FROM NEW.quote_version_id OR
    OLD.itinerary_version_id IS DISTINCT FROM NEW.itinerary_version_id OR
    OLD.traveler_id IS DISTINCT FROM NEW.traveler_id OR
    OLD.acceptance_type IS DISTINCT FROM NEW.acceptance_type OR
    OLD.accepted_by_user_id IS DISTINCT FROM NEW.accepted_by_user_id OR
    OLD.quote_share_id IS DISTINCT FROM NEW.quote_share_id OR
    OLD.traveler_name_input IS DISTINCT FROM NEW.traveler_name_input OR
    OLD.traveler_email_input IS DISTINCT FROM NEW.traveler_email_input OR
    OLD.accepted_grand_total IS DISTINCT FROM NEW.accepted_grand_total OR
    OLD.currency IS DISTINCT FROM NEW.currency OR
    OLD.customer_safe_snapshot IS DISTINCT FROM NEW.customer_safe_snapshot OR
    OLD.snapshot_schema_version IS DISTINCT FROM NEW.snapshot_schema_version OR
    OLD.accepted_snapshot_hash IS DISTINCT FROM NEW.accepted_snapshot_hash OR
    OLD.accepted_at IS DISTINCT FROM NEW.accepted_at OR
    OLD.client_ip IS DISTINCT FROM NEW.client_ip OR
    OLD.user_agent IS DISTINCT FROM NEW.user_agent OR
    OLD.staff_acceptance_method IS DISTINCT FROM NEW.staff_acceptance_method OR
    OLD.staff_reference_notes IS DISTINCT FROM NEW.staff_reference_notes OR
    OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN
    RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Core QuoteAcceptance facts are immutable once inserted'
      USING ERRCODE = 'P0003';
  END IF;

  -- 2. Void metadata can only be set ONCE (append-once)
  IF OLD.voided_at IS NOT NULL THEN
    IF (
      OLD.voided_at IS DISTINCT FROM NEW.voided_at OR
      OLD.voided_by IS DISTINCT FROM NEW.voided_by OR
      OLD.void_reason IS DISTINCT FROM NEW.void_reason
    ) THEN
      RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: QuoteAcceptance void metadata is immutable once set and cannot be altered or cleared'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_quote_acceptance_immutability ON public.quote_acceptances;
CREATE TRIGGER trg_protect_quote_acceptance_immutability
  BEFORE UPDATE ON public.quote_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.protect_quote_acceptance_immutability();

-- ============================================================================
-- 4. DETERMINISTIC JSON CANONICALIZATION & SNAPSHOT BUILDERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public._canonicalize_jsonb(p_val jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text;
  v_key text;
  v_elem jsonb;
  v_result text := '';
  v_first boolean := true;
BEGIN
  IF p_val IS NULL OR p_val = 'null'::jsonb THEN
    RETURN 'null';
  END IF;

  v_type := jsonb_typeof(p_val);

  IF v_type = 'object' THEN
    v_result := '{';
    FOR v_key IN SELECT key FROM jsonb_each(p_val) ORDER BY key ASC
    LOOP
      IF NOT v_first THEN
        v_result := v_result || ',';
      END IF;
      v_first := false;
      v_result := v_result || to_json(v_key)::text || ':' || public._canonicalize_jsonb(p_val->v_key);
    END LOOP;
    v_result := v_result || '}';
    RETURN v_result;
  ELSIF v_type = 'array' THEN
    v_result := '[';
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_val)
    LOOP
      IF NOT v_first THEN
        v_result := v_result || ',';
      END IF;
      v_first := false;
      v_result := v_result || public._canonicalize_jsonb(v_elem);
    END LOOP;
    v_result := v_result || ']';
    RETURN v_result;
  ELSE
    RETURN p_val::text;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._build_customer_acceptance_snapshot(
  p_qv record,
  p_quote record,
  p_iv record
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean_line_items jsonb := '[]'::jsonb;
  v_clean_days jsonb := '[]'::jsonb;
  v_item jsonb;
  v_day jsonb;
  v_day_item jsonb;
  v_clean_day_items jsonb;
BEGIN
  -- 1. Clean quote line items (strip supplierCost, supplierName, markup, margin)
  IF p_qv.line_items IS NOT NULL AND jsonb_typeof(p_qv.line_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_qv.line_items)
    LOOP
      v_clean_line_items := v_clean_line_items || jsonb_build_object(
        'title', COALESCE(v_item->>'title', ''),
        'description', v_item->>'description',
        'category', COALESCE(v_item->>'category', 'other'),
        'quantity', COALESCE((v_item->>'quantity')::numeric, 1),
        'unitPrice', COALESCE(v_item->>'unitPrice', v_item->>'unit_price', '0.00'),
        'totalPrice', COALESCE(v_item->>'totalPrice', v_item->>'total_price', '0.00')
      );
    END LOOP;
  END IF;

  -- 2. Clean itinerary days & items (strip supplierName, internalNotes)
  IF p_iv.days IS NOT NULL AND jsonb_typeof(p_iv.days) = 'array' THEN
    FOR v_day IN SELECT * FROM jsonb_array_elements(p_iv.days)
    LOOP
      v_clean_day_items := '[]'::jsonb;
      IF v_day->'items' IS NOT NULL AND jsonb_typeof(v_day->'items') = 'array' THEN
        FOR v_day_item IN SELECT * FROM jsonb_array_elements(v_day->'items')
        LOOP
          v_clean_day_items := v_clean_day_items || jsonb_build_object(
            'itemType', COALESCE(v_day_item->>'itemType', v_day_item->>'item_type', 'other'),
            'title', COALESCE(v_day_item->>'title', ''),
            'description', v_day_item->>'description',
            'location', v_day_item->>'location',
            'startTime', v_day_item->>'startTime',
            'endTime', v_day_item->>'endTime'
          );
        END LOOP;
      END IF;

      v_clean_days := v_clean_days || jsonb_build_object(
        'dayNumber', COALESCE((v_day->>'dayNumber')::int, (v_day->>'day_number')::int, 1),
        'date', v_day->>'date',
        'title', COALESCE(v_day->>'title', ''),
        'summary', v_day->>'summary',
        'items', v_clean_day_items
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'snapshotSchemaVersion', 1,
    'quote', jsonb_build_object(
      'quoteNumber', p_quote.quote_number,
      'versionNumber', p_qv.version_number,
      'currency', p_qv.currency,
      'lineItems', v_clean_line_items,
      'subtotal', p_qv.subtotal::text,
      'discountAmount', p_qv.discount_amount::text,
      'taxAmount', p_qv.tax_amount::text,
      'grandTotal', p_qv.grand_total::text,
      'validUntil', p_qv.valid_until::text,
      'termsAndConditions', p_qv.terms_and_conditions,
      'customerNotes', p_qv.customer_notes
    ),
    'itinerary', jsonb_build_object(
      'title', p_iv.title,
      'destinationSummary', p_iv.destination_summary,
      'startDate', p_iv.start_date::text,
      'endDate', p_iv.end_date::text,
      'durationDays', p_iv.duration_days,
      'passengerCount', p_iv.passenger_count,
      'days', v_clean_days,
      'inclusions', COALESCE(to_jsonb(p_iv.inclusions), '[]'::jsonb),
      'exclusions', COALESCE(to_jsonb(p_iv.exclusions), '[]'::jsonb)
    )
  );
END;
$$;

-- ============================================================================
-- 5. RPC: PORTAL QUOTE ACCEPTANCE (CAPABILITY-BOUND)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_record_portal_quote_acceptance(
  p_token_hash text,
  p_traveler_name text,
  p_traveler_email text,
  p_client_ip text,
  p_user_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_share record;
  v_qv record;
  v_quote record;
  v_iv record;
  v_existing_acceptance record;
  v_acceptance_id uuid;
  v_snapshot jsonb;
  v_snapshot_hash text;
BEGIN
  -- 1. Validate hash format
  IF length(p_token_hash) != 64 OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_TOKEN: Malformed token' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Find active share
  SELECT s.id, s.tenant_id, s.quote_version_id, s.expires_at, s.revoked_at
  INTO v_share
  FROM public.quote_shares s
  WHERE s.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TOKEN: Share not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_share.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TOKEN_REVOKED: This share link has been revoked' USING ERRCODE = 'P0002';
  END IF;

  IF v_share.expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED: This share link has expired' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Fetch QuoteVersion and parent Quote
  SELECT qv.* INTO v_qv
  FROM public.quote_versions qv
  WHERE qv.id = v_share.quote_version_id AND qv.tenant_id = v_share.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: Referenced QuoteVersion not found' USING ERRCODE = 'XX000';
  END IF;

  SELECT q.* INTO v_quote
  FROM public.quotes q
  WHERE q.id = v_qv.quote_id AND q.tenant_id = v_share.tenant_id;

  -- 4. Lock Inquiry row to serialize concurrent acceptance attempts deterministically
  PERFORM 1 FROM public.inquiries
  WHERE id = v_quote.inquiry_id AND tenant_id = v_share.tenant_id
  FOR UPDATE;

  -- 5. Check if an active acceptance already exists for this inquiry
  SELECT qa.* INTO v_existing_acceptance
  FROM public.quote_acceptances qa
  WHERE qa.tenant_id = v_share.tenant_id
    AND qa.inquiry_id = v_quote.inquiry_id
    AND qa.voided_at IS NULL;

  IF FOUND THEN
    -- Same quote version -> idempotent return
    IF v_existing_acceptance.quote_version_id = v_qv.id THEN
      RETURN jsonb_build_object(
        'acceptance_id', v_existing_acceptance.id,
        'quote_version_id', v_existing_acceptance.quote_version_id,
        'accepted_grand_total', v_existing_acceptance.accepted_grand_total::text,
        'currency', v_existing_acceptance.currency,
        'accepted_at', v_existing_acceptance.accepted_at,
        'idempotent', true
      );
    ELSE
      -- Different quote version -> reject conflict
      RAISE EXCEPTION 'CONFLICT_ACTIVE_ACCEPTANCE_EXISTS: An active acceptance already exists for this inquiry with a different quote version'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  -- 6. Validate QuoteVersion status and commercial validity
  IF v_qv.status != 'issued' OR v_qv.frozen_at IS NULL THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot accept QuoteVersion in status %; must be issued and frozen', v_qv.status;
  END IF;

  IF v_qv.valid_until IS NOT NULL AND v_qv.valid_until::date < CURRENT_DATE THEN
    RAISE EXCEPTION 'EXPIRED_QUOTE_OFFER: This quote offer has expired on %', v_qv.valid_until;
  END IF;

  -- 7. Fetch referenced ItineraryVersion (customer-safe)
  SELECT iv.* INTO v_iv
  FROM public.itinerary_versions iv
  WHERE iv.id = v_qv.itinerary_version_id AND iv.tenant_id = v_share.tenant_id;

  -- 8. Construct customer-safe AcceptanceSnapshot (strictly excluding derived portal state and internal costs)
  v_snapshot := public._build_customer_acceptance_snapshot(v_qv, v_quote, v_iv);
  v_snapshot_hash := encode(digest(public._canonicalize_jsonb(v_snapshot), 'sha256'), 'hex');

  -- 9. Insert into quote_acceptances
  INSERT INTO public.quote_acceptances (
    tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
    acceptance_type, accepted_by_user_id, quote_share_id,
    traveler_name_input, traveler_email_input,
    accepted_grand_total, currency,
    customer_safe_snapshot, snapshot_schema_version, accepted_snapshot_hash,
    accepted_at, client_ip, user_agent
  ) VALUES (
    v_share.tenant_id, v_quote.inquiry_id, v_quote.id, v_qv.id, v_qv.itinerary_version_id,
    (SELECT traveler_id FROM public.inquiries WHERE id = v_quote.inquiry_id AND tenant_id = v_share.tenant_id),
    'traveler_portal', NULL, v_share.id,
    p_traveler_name, p_traveler_email,
    v_qv.grand_total, v_qv.currency,
    v_snapshot, 1, v_snapshot_hash,
    now(), p_client_ip, p_user_agent
  )
  RETURNING id INTO v_acceptance_id;

  RETURN jsonb_build_object(
    'acceptance_id', v_acceptance_id,
    'quote_version_id', v_qv.id,
    'accepted_grand_total', v_qv.grand_total::text,
    'currency', v_qv.currency,
    'accepted_at', now(),
    'idempotent', false
  );
END;
$$;

-- ============================================================================
-- 6. RPC: STAFF MANUAL QUOTE ACCEPTANCE (GOVERNED)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_record_staff_quote_acceptance(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_quote_version_id uuid,
  p_method text,
  p_notes text,
  p_traveler_name text,
  p_traveler_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_qv record;
  v_quote record;
  v_iv record;
  v_existing_acceptance record;
  v_acceptance_id uuid;
  v_snapshot jsonb;
  v_snapshot_hash text;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Role permission check (admin, manager, consultant, specialist)
  IF v_role NOT IN ('admin', 'manager', 'consultant', 'specialist') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % cannot record quote acceptance', v_role;
  END IF;

  -- 3. Validate method
  IF p_method NOT IN ('email', 'whatsapp', 'phone', 'in_person', 'other') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Invalid staff acceptance method: %', p_method;
  END IF;

  -- 4. Find QuoteVersion
  SELECT qv.* INTO v_qv
  FROM public.quote_versions qv
  WHERE qv.id = p_quote_version_id AND qv.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: QuoteVersion % not found in tenant %', p_quote_version_id, p_tenant_id;
  END IF;

  SELECT q.* INTO v_quote
  FROM public.quotes q
  WHERE q.id = v_qv.quote_id AND q.tenant_id = p_tenant_id;

  -- 5. Lock Inquiry row
  PERFORM 1 FROM public.inquiries
  WHERE id = v_quote.inquiry_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  -- 6. Check existing active acceptance
  SELECT qa.* INTO v_existing_acceptance
  FROM public.quote_acceptances qa
  WHERE qa.tenant_id = p_tenant_id
    AND qa.inquiry_id = v_quote.inquiry_id
    AND qa.voided_at IS NULL;

  IF FOUND THEN
    IF v_existing_acceptance.quote_version_id = v_qv.id THEN
      RETURN jsonb_build_object(
        'acceptance_id', v_existing_acceptance.id,
        'quote_version_id', v_existing_acceptance.quote_version_id,
        'accepted_grand_total', v_existing_acceptance.accepted_grand_total::text,
        'currency', v_existing_acceptance.currency,
        'accepted_at', v_existing_acceptance.accepted_at,
        'idempotent', true
      );
    ELSE
      RAISE EXCEPTION 'CONFLICT_ACTIVE_ACCEPTANCE_EXISTS: An active acceptance already exists for this inquiry with a different quote version'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  -- 7. Validate QuoteVersion status and validity
  IF v_qv.status != 'issued' OR v_qv.frozen_at IS NULL THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot accept QuoteVersion in status %; must be issued and frozen', v_qv.status;
  END IF;

  IF v_qv.valid_until IS NOT NULL AND v_qv.valid_until::date < CURRENT_DATE THEN
    RAISE EXCEPTION 'EXPIRED_QUOTE_OFFER: This quote offer has expired on %', v_qv.valid_until;
  END IF;

  -- 8. Fetch ItineraryVersion
  SELECT iv.* INTO v_iv
  FROM public.itinerary_versions iv
  WHERE iv.id = v_qv.itinerary_version_id AND iv.tenant_id = p_tenant_id;

  -- 9. Construct Snapshot & Hash
  v_snapshot := public._build_customer_acceptance_snapshot(v_qv, v_quote, v_iv);
  v_snapshot_hash := encode(digest(public._canonicalize_jsonb(v_snapshot), 'sha256'), 'hex');

  -- 10. Insert
  INSERT INTO public.quote_acceptances (
    tenant_id, inquiry_id, quote_id, quote_version_id, itinerary_version_id, traveler_id,
    acceptance_type, accepted_by_user_id, quote_share_id,
    traveler_name_input, traveler_email_input,
    accepted_grand_total, currency,
    customer_safe_snapshot, snapshot_schema_version, accepted_snapshot_hash,
    accepted_at, client_ip, user_agent,
    staff_acceptance_method, staff_reference_notes
  ) VALUES (
    p_tenant_id, v_quote.inquiry_id, v_quote.id, v_qv.id, v_qv.itinerary_version_id,
    (SELECT traveler_id FROM public.inquiries WHERE id = v_quote.inquiry_id AND tenant_id = p_tenant_id),
    'staff_recorded', p_actor_user_id, NULL,
    p_traveler_name, p_traveler_email,
    v_qv.grand_total, v_qv.currency,
    v_snapshot, 1, v_snapshot_hash,
    now(), NULL, NULL,
    p_method, p_notes
  )
  RETURNING id INTO v_acceptance_id;

  RETURN jsonb_build_object(
    'acceptance_id', v_acceptance_id,
    'quote_version_id', v_qv.id,
    'accepted_grand_total', v_qv.grand_total::text,
    'currency', v_qv.currency,
    'accepted_at', now(),
    'idempotent', false
  );
END;
$$;

-- ============================================================================
-- 7. RPC: VOID QUOTE ACCEPTANCE (GOVERNED WITH BOOKING PROTECTION)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_void_quote_acceptance(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_acceptance_id uuid,
  p_void_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_acceptance record;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Permission check: Admin/Manager only
  IF v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % cannot void quote acceptances', v_role;
  END IF;

  -- 3. Validate reason
  IF p_void_reason IS NULL OR trim(p_void_reason) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: void_reason cannot be empty';
  END IF;

  -- 4. Find acceptance row
  SELECT * INTO v_acceptance
  FROM public.quote_acceptances
  WHERE id = p_acceptance_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: QuoteAcceptance % not found in tenant %', p_acceptance_id, p_tenant_id;
  END IF;

  -- 5. Idempotent return if already voided
  IF v_acceptance.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'acceptance_id', v_acceptance.id,
      'voided_at', v_acceptance.voided_at,
      'voided_by', v_acceptance.voided_by,
      'void_reason', v_acceptance.void_reason,
      'already_voided', true
    );
  END IF;

  -- 6. CRITICAL PROTECTION: If a Booking already references this acceptance, VOID IS REJECTED
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE tenant_id = p_tenant_id
      AND quote_acceptance_id = p_acceptance_id
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_ALREADY_CONVERTED: Cannot void an acceptance that has already been converted to a Booking'
      USING ERRCODE = 'P0004';
  END IF;

  -- 7. Void
  UPDATE public.quote_acceptances
  SET voided_at = now(),
      voided_by = p_actor_user_id,
      void_reason = trim(p_void_reason)
  WHERE id = p_acceptance_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'acceptance_id', p_acceptance_id,
    'voided_at', now(),
    'voided_by', p_actor_user_id,
    'void_reason', trim(p_void_reason),
    'already_voided', false
  );
END;
$$;

-- ============================================================================
-- 8. RPC: CONVERT ACCEPTED QUOTE TO BOOKING (GOVERNED & ATOMIC)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_convert_accepted_quote_to_booking(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_acceptance_id uuid,
  p_assigned_agent_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_acceptance record;
  v_inquiry record;
  v_itin record;
  v_existing_booking record;
  v_booking_id uuid;
  v_booking_ref text;
  v_year int;
  v_seq int;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Permission check: Admin/Manager only
  IF v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % cannot convert quotes to bookings', v_role;
  END IF;

  -- 3. Find acceptance
  SELECT * INTO v_acceptance
  FROM public.quote_acceptances
  WHERE id = p_acceptance_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: QuoteAcceptance % not found in tenant %', p_acceptance_id, p_tenant_id;
  END IF;

  IF v_acceptance.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Cannot convert a voided acceptance'
      USING ERRCODE = 'P0004';
  END IF;

  -- 4. Lock Inquiry row
  SELECT * INTO v_inquiry
  FROM public.inquiries
  WHERE id = v_acceptance.inquiry_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Inquiry % not found in tenant %', v_acceptance.inquiry_id, p_tenant_id;
  END IF;

  -- 5. Check if a Booking already exists for this Inquiry
  SELECT * INTO v_existing_booking
  FROM public.bookings
  WHERE inquiry_id = v_acceptance.inquiry_id AND tenant_id = p_tenant_id;

  IF FOUND THEN
    -- If same acceptance -> idempotent return
    IF v_existing_booking.quote_acceptance_id = p_acceptance_id THEN
      RETURN jsonb_build_object(
        'booking_id', v_existing_booking.id,
        'booking_reference', v_existing_booking.booking_reference,
        'quote_acceptance_id', v_existing_booking.quote_acceptance_id,
        'total_amount', v_existing_booking.total_amount::text,
        'currency', v_existing_booking.currency,
        'booking_status', v_existing_booking.booking_status,
        'idempotent', true
      );
    ELSE
      -- Different acceptance or cancelled booking -> reject
      RAISE EXCEPTION 'INQUIRY_ALREADY_CONVERTED: A booking already exists for this inquiry'
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  -- 6. Fetch accepted ItineraryVersion for trip facts
  SELECT * INTO v_itin
  FROM public.itinerary_versions
  WHERE id = v_acceptance.itinerary_version_id AND tenant_id = p_tenant_id;

  -- 7. Atomically allocate Booking Reference
  v_year := EXTRACT(YEAR FROM now())::int;
  INSERT INTO public.tenant_booking_sequences (tenant_id, year, last_number)
  VALUES (p_tenant_id, v_year, 1)
  ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_number = tenant_booking_sequences.last_number + 1
  RETURNING last_number INTO v_seq;

  v_booking_ref := format('BK-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
  v_booking_id := gen_random_uuid();

  -- 8. Insert Booking with exact financial handoff:
  -- total_amount = accepted_grand_total, paid_amount = NULL, balance_due = NULL, payment_status = 'unknown', financial_data_complete = false
  INSERT INTO public.bookings (
    id, tenant_id, traveler_id, inquiry_id, legacy_lead_id, quote_acceptance_id, booking_reference,
    departure_date, return_date, passenger_count,
    total_amount, paid_amount, currency,
    booking_status, payment_status, fulfillment_status, financial_data_complete,
    assigned_agent_id, created_at, updated_at
  ) VALUES (
    v_booking_id, p_tenant_id, v_acceptance.traveler_id, v_acceptance.inquiry_id, v_inquiry.legacy_lead_id, p_acceptance_id, v_booking_ref,
    v_itin.start_date, v_itin.end_date, v_itin.passenger_count,
    v_acceptance.accepted_grand_total, NULL, v_acceptance.currency,
    'confirmed', 'unknown', 'unknown', false,
    COALESCE(p_assigned_agent_id, v_inquiry.assigned_agent_id, p_actor_user_id), now(), now()
  );

  -- 9. Atomic stage update on Inquiry in SAME transaction
  UPDATE public.inquiries
  SET pipeline_stage = 'booking_confirmed', updated_at = now()
  WHERE id = v_acceptance.inquiry_id AND tenant_id = p_tenant_id;

  -- 10. Legacy lead compatibility if legacy_lead_id is present
  IF v_inquiry.legacy_lead_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'leads'
    ) THEN
      UPDATE public.leads
      SET status = 'booking_confirmed', updated_at = now()
      WHERE id = v_inquiry.legacy_lead_id AND tenant_id = p_tenant_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'booking_reference', v_booking_ref,
    'quote_acceptance_id', p_acceptance_id,
    'total_amount', v_acceptance.accepted_grand_total::text,
    'currency', v_acceptance.currency,
    'booking_status', 'confirmed',
    'idempotent', false
  );
END;
$$;

-- ============================================================================
-- 9. STRICT EXECUTE PRIVILEGES & TABLE GRANTS
-- ============================================================================
REVOKE ALL ON TABLE public.tenant_booking_sequences FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tenant_booking_sequences TO service_role, postgres;

REVOKE ALL ON FUNCTION public.protect_quote_acceptance_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._canonicalize_jsonb(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._build_customer_acceptance_snapshot(record, record, record) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_record_portal_quote_acceptance(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_record_staff_quote_acceptance(text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_void_quote_acceptance(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_convert_accepted_quote_to_booking(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_record_portal_quote_acceptance(text, text, text, text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.rpc_record_staff_quote_acceptance(text, uuid, uuid, text, text, text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.rpc_void_quote_acceptance(text, uuid, uuid, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.rpc_convert_accepted_quote_to_booking(text, uuid, uuid, uuid) TO service_role, postgres;

-- ============================================================================
-- END MIGRATION 019
-- ============================================================================
