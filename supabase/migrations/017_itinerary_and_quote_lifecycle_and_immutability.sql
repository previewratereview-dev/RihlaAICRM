-- Migration 017: Itinerary & Quote Lifecycle, Concurrency & Immutability (Phase AI-5B.2)
--
-- Implements:
-- 1. Database-enforced content immutability triggers on frozen ItineraryVersion and QuoteVersion
-- 2. Atomic SECURITY DEFINER RPCs for family creation, revision branching, and optimistic concurrency
-- 3. Atomic year-scoped sequential quote number generation
-- 4. Idempotent finalization and issuance transitions with automatic prior-version supersession
-- 5. Strict search_path and role permission controls

-- ============================================================================
-- 1. ITINERARY VERSION IMMUTABILITY TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.protect_itinerary_version_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status != 'draft' OR OLD.frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot delete frozen/non-draft ItineraryVersion % (status: %)', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- If the record was already frozen/non-draft:
    IF OLD.status != 'draft' OR OLD.frozen_at IS NOT NULL THEN
      -- Prohibit reviving back to draft or changing identity
      IF NEW.status = 'draft' THEN
        RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot revert frozen ItineraryVersion % from % to draft', OLD.id, OLD.status;
      END IF;

      -- Check if any commercial/program content column has changed
      IF NEW.itinerary_id IS DISTINCT FROM OLD.itinerary_id OR
         NEW.version_number IS DISTINCT FROM OLD.version_number OR
         NEW.title IS DISTINCT FROM OLD.title OR
         NEW.destination_summary IS DISTINCT FROM OLD.destination_summary OR
         NEW.start_date IS DISTINCT FROM OLD.start_date OR
         NEW.end_date IS DISTINCT FROM OLD.end_date OR
         NEW.duration_days IS DISTINCT FROM OLD.duration_days OR
         NEW.passenger_count IS DISTINCT FROM OLD.passenger_count OR
         NEW.days IS DISTINCT FROM OLD.days OR
         NEW.inclusions IS DISTINCT FROM OLD.inclusions OR
         NEW.exclusions IS DISTINCT FROM OLD.exclusions OR
         NEW.itinerary_schema_version IS DISTINCT FROM OLD.itinerary_schema_version OR
         NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
         NEW.id IS DISTINCT FROM OLD.id OR
         NEW.created_by IS DISTINCT FROM OLD.created_by OR
         NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot modify content of frozen ItineraryVersion % (status: %)', OLD.id, OLD.status;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_itinerary_version_immutability ON public.itinerary_versions;
CREATE TRIGGER trg_protect_itinerary_version_immutability
  BEFORE UPDATE OR DELETE ON public.itinerary_versions
  FOR EACH ROW EXECUTE FUNCTION public.protect_itinerary_version_immutability();

-- ============================================================================
-- 2. QUOTE VERSION IMMUTABILITY TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.protect_quote_version_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status != 'draft' OR OLD.frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot delete frozen/non-draft QuoteVersion % (status: %)', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- If the record was already frozen/non-draft:
    IF OLD.status != 'draft' OR OLD.frozen_at IS NOT NULL THEN
      -- Prohibit reviving back to draft
      IF NEW.status = 'draft' THEN
        RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot revert frozen QuoteVersion % from % to draft', OLD.id, OLD.status;
      END IF;

      -- Check if any commercial content column has changed
      IF NEW.quote_id IS DISTINCT FROM OLD.quote_id OR
         NEW.version_number IS DISTINCT FROM OLD.version_number OR
         NEW.itinerary_version_id IS DISTINCT FROM OLD.itinerary_version_id OR
         NEW.currency IS DISTINCT FROM OLD.currency OR
         NEW.line_items IS DISTINCT FROM OLD.line_items OR
         NEW.quote_schema_version IS DISTINCT FROM OLD.quote_schema_version OR
         NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
         NEW.discount_amount IS DISTINCT FROM OLD.discount_amount OR
         NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR
         NEW.grand_total IS DISTINCT FROM OLD.grand_total OR
         NEW.internal_cost_total IS DISTINCT FROM OLD.internal_cost_total OR
         NEW.gross_margin_amount IS DISTINCT FROM OLD.gross_margin_amount OR
         NEW.valid_until IS DISTINCT FROM OLD.valid_until OR
         NEW.terms_and_conditions IS DISTINCT FROM OLD.terms_and_conditions OR
         NEW.customer_notes IS DISTINCT FROM OLD.customer_notes OR
         NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
         NEW.id IS DISTINCT FROM OLD.id OR
         NEW.created_by IS DISTINCT FROM OLD.created_by OR
         NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot modify commercial content of frozen QuoteVersion % (status: %)', OLD.id, OLD.status;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_quote_version_immutability ON public.quote_versions;
CREATE TRIGGER trg_protect_quote_version_immutability
  BEFORE UPDATE OR DELETE ON public.quote_versions
  FOR EACH ROW EXECUTE FUNCTION public.protect_quote_version_immutability();

-- ============================================================================
-- 3. ATOMIC ITINERARY CREATION & LIFECYCLE RPCS
-- ============================================================================

-- 3.1 Create Itinerary Family and Version 1 Draft
CREATE OR REPLACE FUNCTION public.rpc_create_itinerary_family_and_version(
  p_tenant_id text,
  p_inquiry_id uuid,
  p_title text,
  p_created_by uuid,
  p_version_payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_itinerary_id uuid;
  v_version_id uuid;
  v_version_row public.itinerary_versions%ROWTYPE;
BEGIN
  -- 1. Validate Inquiry exists in tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.inquiries WHERE id = p_inquiry_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Inquiry % does not exist in tenant %', p_inquiry_id, p_tenant_id;
  END IF;

  -- 2. Create Itinerary Header
  INSERT INTO public.itineraries (
    tenant_id, inquiry_id, title, created_by
  ) VALUES (
    p_tenant_id, p_inquiry_id, p_title, p_created_by
  ) RETURNING id INTO v_itinerary_id;

  -- 3. Create Version 1 Draft
  INSERT INTO public.itinerary_versions (
    tenant_id, itinerary_id, version_number, status, frozen_at,
    title, destination_summary, start_date, end_date, duration_days,
    passenger_count, days, inclusions, exclusions, itinerary_schema_version,
    created_by
  ) VALUES (
    p_tenant_id,
    v_itinerary_id,
    1,
    'draft',
    NULL,
    COALESCE(p_version_payload->>'title', p_title),
    p_version_payload->>'destinationSummary',
    (p_version_payload->>'startDate')::date,
    (p_version_payload->>'endDate')::date,
    (p_version_payload->>'durationDays')::int,
    (p_version_payload->>'passengerCount')::int,
    COALESCE(p_version_payload->'days', '[]'::jsonb),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_version_payload->'inclusions', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_version_payload->'exclusions', '[]'::jsonb))),
    COALESCE((p_version_payload->>'itinerarySchemaVersion')::int, 1),
    p_created_by
  ) RETURNING * INTO v_version_row;

  RETURN jsonb_build_object(
    'itineraryId', v_itinerary_id,
    'versionId', v_version_row.id,
    'versionNumber', v_version_row.version_number,
    'status', v_version_row.status,
    'title', v_version_row.title,
    'updatedAt', v_version_row.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3.2 Update Itinerary Draft with Optimistic Concurrency
CREATE OR REPLACE FUNCTION public.rpc_update_itinerary_draft(
  p_tenant_id text,
  p_version_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_version public.itinerary_versions%ROWTYPE;
BEGIN
  -- Lock the draft version row
  SELECT * INTO v_version
  FROM public.itinerary_versions
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: ItineraryVersion % not found in tenant %', p_version_id, p_tenant_id;
  END IF;

  IF v_version.status != 'draft' OR v_version.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot edit ItineraryVersion % because it is %', p_version_id, v_version.status;
  END IF;

  -- Optimistic concurrency check (within 1 ms precision to avoid microsecond rounding diffs)
  IF p_expected_updated_at IS NOT NULL AND 
     abs(extract(epoch from (v_version.updated_at - p_expected_updated_at))) > 0.001 THEN
    RAISE EXCEPTION 'STALE_VERSION: The itinerary draft has been updated by another user (expected %, current %)',
      p_expected_updated_at, v_version.updated_at;
  END IF;

  UPDATE public.itinerary_versions SET
    title = COALESCE(p_payload->>'title', v_version.title),
    destination_summary = p_payload->>'destinationSummary',
    start_date = (p_payload->>'startDate')::date,
    end_date = (p_payload->>'endDate')::date,
    duration_days = (p_payload->>'durationDays')::int,
    passenger_count = (p_payload->>'passengerCount')::int,
    days = COALESCE(p_payload->'days', v_version.days),
    inclusions = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'inclusions', '[]'::jsonb))),
    exclusions = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'exclusions', '[]'::jsonb))),
    updated_at = now()
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_version;

  RETURN jsonb_build_object(
    'itineraryId', v_version.itinerary_id,
    'versionId', v_version.id,
    'versionNumber', v_version.version_number,
    'status', v_version.status,
    'title', v_version.title,
    'updatedAt', v_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3.3 Create Itinerary Revision (Clones source version into new Draft)
CREATE OR REPLACE FUNCTION public.rpc_create_itinerary_revision(
  p_tenant_id text,
  p_itinerary_id uuid,
  p_source_version_id uuid,
  p_created_by uuid
)
RETURNS jsonb AS $$
DECLARE
  v_source public.itinerary_versions%ROWTYPE;
  v_next_version int;
  v_new_version public.itinerary_versions%ROWTYPE;
BEGIN
  -- Lock family header
  PERFORM 1 FROM public.itineraries 
  WHERE id = p_itinerary_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Itinerary % not found in tenant %', p_itinerary_id, p_tenant_id;
  END IF;

  -- Verify source version belongs to family
  SELECT * INTO v_source
  FROM public.itinerary_versions
  WHERE id = p_source_version_id AND itinerary_id = p_itinerary_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Source ItineraryVersion % does not belong to Itinerary % in tenant %',
      p_source_version_id, p_itinerary_id, p_tenant_id;
  END IF;

  -- Allocate next version number atomically
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.itinerary_versions
  WHERE itinerary_id = p_itinerary_id AND tenant_id = p_tenant_id;

  -- Clone structured content into new Draft
  INSERT INTO public.itinerary_versions (
    tenant_id, itinerary_id, version_number, status, frozen_at,
    title, destination_summary, start_date, end_date, duration_days,
    passenger_count, days, inclusions, exclusions, itinerary_schema_version,
    created_by
  ) VALUES (
    p_tenant_id,
    p_itinerary_id,
    v_next_version,
    'draft',
    NULL,
    v_source.title,
    v_source.destination_summary,
    v_source.start_date,
    v_source.end_date,
    v_source.duration_days,
    v_source.passenger_count,
    v_source.days,
    v_source.inclusions,
    v_source.exclusions,
    v_source.itinerary_schema_version,
    p_created_by
  ) RETURNING * INTO v_new_version;

  RETURN jsonb_build_object(
    'itineraryId', v_new_version.itinerary_id,
    'versionId', v_new_version.id,
    'versionNumber', v_new_version.version_number,
    'status', v_new_version.status,
    'title', v_new_version.title,
    'updatedAt', v_new_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3.4 Finalize Itinerary Version
CREATE OR REPLACE FUNCTION public.rpc_finalize_itinerary_version(
  p_tenant_id text,
  p_version_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_version public.itinerary_versions%ROWTYPE;
BEGIN
  -- Select version for update
  SELECT * INTO v_version
  FROM public.itinerary_versions
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: ItineraryVersion % not found in tenant %', p_version_id, p_tenant_id;
  END IF;

  -- Idempotent return if already finalized
  IF v_version.status = 'finalized' THEN
    RETURN jsonb_build_object(
      'itineraryId', v_version.itinerary_id,
      'versionId', v_version.id,
      'versionNumber', v_version.version_number,
      'status', v_version.status,
      'frozenAt', v_version.frozen_at,
      'updatedAt', v_version.updated_at
    );
  END IF;

  IF v_version.status != 'draft' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot finalize ItineraryVersion % with status %', p_version_id, v_version.status;
  END IF;

  -- Lock family header to serialize transitions
  PERFORM 1 FROM public.itineraries 
  WHERE id = v_version.itinerary_id AND tenant_id = p_tenant_id 
  FOR UPDATE;

  -- Atomically supersede any prior finalized version in the same family
  UPDATE public.itinerary_versions
  SET status = 'superseded', updated_at = now()
  WHERE itinerary_id = v_version.itinerary_id 
    AND tenant_id = p_tenant_id 
    AND status = 'finalized' 
    AND id != p_version_id;

  -- Finalize target version
  UPDATE public.itinerary_versions
  SET status = 'finalized', frozen_at = now(), updated_at = now()
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_version;

  RETURN jsonb_build_object(
    'itineraryId', v_version.itinerary_id,
    'versionId', v_version.id,
    'versionNumber', v_version.version_number,
    'status', v_version.status,
    'frozenAt', v_version.frozen_at,
    'updatedAt', v_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================================
-- 4. ATOMIC QUOTE CREATION & LIFECYCLE RPCS
-- ============================================================================

-- 4.1 Create Quote Family and Version 1 Draft
CREATE OR REPLACE FUNCTION public.rpc_create_quote_family_and_version(
  p_tenant_id text,
  p_inquiry_id uuid,
  p_itinerary_version_id uuid,
  p_created_by uuid,
  p_pricing_payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_quote_id uuid;
  v_quote_number text;
  v_year int;
  v_seq int;
  v_itin_version public.itinerary_versions%ROWTYPE;
  v_quote_version public.quote_versions%ROWTYPE;
BEGIN
  -- 1. Validate Inquiry exists in tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.inquiries WHERE id = p_inquiry_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Inquiry % does not exist in tenant %', p_inquiry_id, p_tenant_id;
  END IF;

  -- 2. Validate attached ItineraryVersion is finalized and belongs to the same inquiry
  SELECT iv.* INTO v_itin_version
  FROM public.itinerary_versions iv
  JOIN public.itineraries i ON i.id = iv.itinerary_id AND i.tenant_id = iv.tenant_id
  WHERE iv.id = p_itinerary_version_id AND iv.tenant_id = p_tenant_id AND i.inquiry_id = p_inquiry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CROSS_INQUIRY_INTEGRITY_VIOLATION: ItineraryVersion % does not belong to Inquiry % in tenant %',
      p_itinerary_version_id, p_inquiry_id, p_tenant_id;
  END IF;

  IF v_itin_version.status != 'finalized' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Referenced ItineraryVersion % must be finalized before creating a quote (current: %)',
      p_itinerary_version_id, v_itin_version.status;
  END IF;

  -- 3. Atomically allocate tenant/year quote number
  v_year := EXTRACT(YEAR FROM now())::int;
  INSERT INTO public.tenant_quote_sequences (tenant_id, year, last_number)
  VALUES (p_tenant_id, v_year, 1)
  ON CONFLICT (tenant_id, year)
  DO UPDATE SET last_number = tenant_quote_sequences.last_number + 1
  RETURNING last_number INTO v_seq;

  v_quote_number := format('QT-%s-%s', v_year, lpad(v_seq::text, 4, '0'));

  -- 4. Create Quote Header
  INSERT INTO public.quotes (
    tenant_id, inquiry_id, quote_number, created_by
  ) VALUES (
    p_tenant_id, p_inquiry_id, v_quote_number, p_created_by
  ) RETURNING id INTO v_quote_id;

  -- 5. Create Quote Version 1 Draft
  INSERT INTO public.quote_versions (
    tenant_id, quote_id, version_number, itinerary_version_id, status, frozen_at,
    currency, line_items, quote_schema_version,
    subtotal, discount_amount, tax_amount, grand_total,
    internal_cost_total, gross_margin_amount,
    valid_until, terms_and_conditions, customer_notes,
    created_by
  ) VALUES (
    p_tenant_id,
    v_quote_id,
    1,
    p_itinerary_version_id,
    'draft',
    NULL,
    COALESCE(p_pricing_payload->>'currency', 'INR'),
    COALESCE(p_pricing_payload->'lineItems', '[]'::jsonb),
    COALESCE((p_pricing_payload->>'quoteSchemaVersion')::int, 1),
    (p_pricing_payload->>'subtotal')::numeric(12, 2),
    (p_pricing_payload->>'discountAmount')::numeric(12, 2),
    (p_pricing_payload->>'taxAmount')::numeric(12, 2),
    (p_pricing_payload->>'grandTotal')::numeric(12, 2),
    (p_pricing_payload->>'internalCostTotal')::numeric(12, 2),
    (p_pricing_payload->>'grossMarginAmount')::numeric(12, 2),
    (p_pricing_payload->>'validUntil')::date,
    p_pricing_payload->>'termsAndConditions',
    p_pricing_payload->>'customerNotes',
    p_created_by
  ) RETURNING * INTO v_quote_version;

  RETURN jsonb_build_object(
    'quoteId', v_quote_id,
    'quoteNumber', v_quote_number,
    'versionId', v_quote_version.id,
    'versionNumber', v_quote_version.version_number,
    'itineraryVersionId', v_quote_version.itinerary_version_id,
    'status', v_quote_version.status,
    'grandTotal', v_quote_version.grand_total::text,
    'updatedAt', v_quote_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.2 Update Quote Draft with Optimistic Concurrency
CREATE OR REPLACE FUNCTION public.rpc_update_quote_draft(
  p_tenant_id text,
  p_version_id uuid,
  p_expected_updated_at timestamptz,
  p_pricing_payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_version public.quote_versions%ROWTYPE;
  v_quote_inquiry_id uuid;
  v_itin_inquiry_id uuid;
  v_itin_status text;
  v_target_itinerary_version_id uuid;
BEGIN
  -- Lock target draft version
  SELECT * INTO v_version
  FROM public.quote_versions
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: QuoteVersion % not found in tenant %', p_version_id, p_tenant_id;
  END IF;

  IF v_version.status != 'draft' OR v_version.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot edit QuoteVersion % because it is %', p_version_id, v_version.status;
  END IF;

  -- Optimistic concurrency check
  IF p_expected_updated_at IS NOT NULL AND 
     abs(extract(epoch from (v_version.updated_at - p_expected_updated_at))) > 0.001 THEN
    RAISE EXCEPTION 'STALE_VERSION: The quote draft has been updated by another user (expected %, current %)',
      p_expected_updated_at, v_version.updated_at;
  END IF;

  v_target_itinerary_version_id := COALESCE(
    (p_pricing_payload->>'itineraryVersionId')::uuid,
    v_version.itinerary_version_id
  );

  -- If itinerary_version_id changed, verify it is finalized and belongs to same inquiry
  IF v_target_itinerary_version_id IS DISTINCT FROM v_version.itinerary_version_id THEN
    SELECT q.inquiry_id, i.inquiry_id, iv.status 
    INTO v_quote_inquiry_id, v_itin_inquiry_id, v_itin_status
    FROM public.quotes q
    CROSS JOIN public.itinerary_versions iv
    JOIN public.itineraries i ON i.id = iv.itinerary_id AND i.tenant_id = iv.tenant_id
    WHERE q.id = v_version.quote_id AND q.tenant_id = p_tenant_id
      AND iv.id = v_target_itinerary_version_id AND iv.tenant_id = p_tenant_id;

    IF v_quote_inquiry_id IS DISTINCT FROM v_itin_inquiry_id THEN
      RAISE EXCEPTION 'CROSS_INQUIRY_INTEGRITY_VIOLATION: ItineraryVersion % does not belong to Quote Inquiry %',
        v_target_itinerary_version_id, v_quote_inquiry_id;
    END IF;

    IF v_itin_status != 'finalized' THEN
      RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Attached ItineraryVersion % must be finalized (current: %)',
        v_target_itinerary_version_id, v_itin_status;
    END IF;
  END IF;

  UPDATE public.quote_versions SET
    itinerary_version_id = v_target_itinerary_version_id,
    currency = COALESCE(p_pricing_payload->>'currency', v_version.currency),
    line_items = COALESCE(p_pricing_payload->'lineItems', v_version.line_items),
    subtotal = (p_pricing_payload->>'subtotal')::numeric(12, 2),
    discount_amount = (p_pricing_payload->>'discountAmount')::numeric(12, 2),
    tax_amount = (p_pricing_payload->>'taxAmount')::numeric(12, 2),
    grand_total = (p_pricing_payload->>'grandTotal')::numeric(12, 2),
    internal_cost_total = (p_pricing_payload->>'internalCostTotal')::numeric(12, 2),
    gross_margin_amount = (p_pricing_payload->>'grossMarginAmount')::numeric(12, 2),
    valid_until = (p_pricing_payload->>'validUntil')::date,
    terms_and_conditions = p_pricing_payload->>'termsAndConditions',
    customer_notes = p_pricing_payload->>'customerNotes',
    updated_at = now()
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_version;

  RETURN jsonb_build_object(
    'quoteId', v_version.quote_id,
    'versionId', v_version.id,
    'versionNumber', v_version.version_number,
    'itineraryVersionId', v_version.itinerary_version_id,
    'status', v_version.status,
    'grandTotal', v_version.grand_total::text,
    'updatedAt', v_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.3 Create Quote Revision
CREATE OR REPLACE FUNCTION public.rpc_create_quote_revision(
  p_tenant_id text,
  p_quote_id uuid,
  p_source_version_id uuid,
  p_itinerary_version_id uuid,
  p_created_by uuid,
  p_pricing_payload jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_source public.quote_versions%ROWTYPE;
  v_next_version int;
  v_new_version public.quote_versions%ROWTYPE;
  v_target_itin_id uuid;
  v_quote_inquiry_id uuid;
  v_itin_inquiry_id uuid;
  v_itin_status text;
BEGIN
  -- Lock family header
  PERFORM 1 FROM public.quotes 
  WHERE id = p_quote_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Quote % not found in tenant %', p_quote_id, p_tenant_id;
  END IF;

  -- Verify source version belongs to family
  SELECT * INTO v_source
  FROM public.quote_versions
  WHERE id = p_source_version_id AND quote_id = p_quote_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: Source QuoteVersion % does not belong to Quote % in tenant %',
      p_source_version_id, p_quote_id, p_tenant_id;
  END IF;

  -- Resolve attached itinerary version
  v_target_itin_id := COALESCE(p_itinerary_version_id, v_source.itinerary_version_id);

  SELECT q.inquiry_id, i.inquiry_id, iv.status 
  INTO v_quote_inquiry_id, v_itin_inquiry_id, v_itin_status
  FROM public.quotes q
  CROSS JOIN public.itinerary_versions iv
  JOIN public.itineraries i ON i.id = iv.itinerary_id AND i.tenant_id = iv.tenant_id
  WHERE q.id = p_quote_id AND q.tenant_id = p_tenant_id
    AND iv.id = v_target_itin_id AND iv.tenant_id = p_tenant_id;

  IF v_quote_inquiry_id IS DISTINCT FROM v_itin_inquiry_id THEN
    RAISE EXCEPTION 'CROSS_INQUIRY_INTEGRITY_VIOLATION: ItineraryVersion % does not belong to Quote Inquiry %',
      v_target_itin_id, v_quote_inquiry_id;
  END IF;

  IF v_itin_status != 'finalized' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Attached ItineraryVersion % must be finalized (current: %)',
      v_target_itin_id, v_itin_status;
  END IF;

  -- Allocate next version number atomically
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.quote_versions
  WHERE quote_id = p_quote_id AND tenant_id = p_tenant_id;

  -- Create new Draft revision
  INSERT INTO public.quote_versions (
    tenant_id, quote_id, version_number, itinerary_version_id, status, frozen_at,
    currency, line_items, quote_schema_version,
    subtotal, discount_amount, tax_amount, grand_total,
    internal_cost_total, gross_margin_amount,
    valid_until, terms_and_conditions, customer_notes,
    created_by
  ) VALUES (
    p_tenant_id,
    p_quote_id,
    v_next_version,
    v_target_itin_id,
    'draft',
    NULL,
    COALESCE(p_pricing_payload->>'currency', v_source.currency),
    COALESCE(p_pricing_payload->'lineItems', v_source.line_items),
    v_source.quote_schema_version,
    (p_pricing_payload->>'subtotal')::numeric(12, 2),
    (p_pricing_payload->>'discountAmount')::numeric(12, 2),
    (p_pricing_payload->>'taxAmount')::numeric(12, 2),
    (p_pricing_payload->>'grandTotal')::numeric(12, 2),
    (p_pricing_payload->>'internalCostTotal')::numeric(12, 2),
    (p_pricing_payload->>'grossMarginAmount')::numeric(12, 2),
    COALESCE((p_pricing_payload->>'validUntil')::date, v_source.valid_until),
    COALESCE(p_pricing_payload->>'termsAndConditions', v_source.terms_and_conditions),
    COALESCE(p_pricing_payload->>'customerNotes', v_source.customer_notes),
    p_created_by
  ) RETURNING * INTO v_new_version;

  RETURN jsonb_build_object(
    'quoteId', v_new_version.quote_id,
    'versionId', v_new_version.id,
    'versionNumber', v_new_version.version_number,
    'itineraryVersionId', v_new_version.itinerary_version_id,
    'status', v_new_version.status,
    'grandTotal', v_new_version.grand_total::text,
    'updatedAt', v_new_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.4 Issue Quote Version
CREATE OR REPLACE FUNCTION public.rpc_issue_quote_version(
  p_tenant_id text,
  p_version_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_version public.quote_versions%ROWTYPE;
  v_itin_status text;
BEGIN
  -- Select version for update
  SELECT * INTO v_version
  FROM public.quote_versions
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_NOT_FOUND: QuoteVersion % not found in tenant %', p_version_id, p_tenant_id;
  END IF;

  -- Idempotent return if already issued
  IF v_version.status = 'issued' THEN
    RETURN jsonb_build_object(
      'quoteId', v_version.quote_id,
      'versionId', v_version.id,
      'versionNumber', v_version.version_number,
      'status', v_version.status,
      'frozenAt', v_version.frozen_at,
      'updatedAt', v_version.updated_at
    );
  END IF;

  IF v_version.status != 'draft' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot issue QuoteVersion % with status %', p_version_id, v_version.status;
  END IF;

  -- Verify attached itinerary is finalized
  SELECT status INTO v_itin_status
  FROM public.itinerary_versions
  WHERE id = v_version.itinerary_version_id AND tenant_id = p_tenant_id;

  IF v_itin_status != 'finalized' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Attached ItineraryVersion % must be finalized before issuing quote (current: %)',
      v_version.itinerary_version_id, v_itin_status;
  END IF;

  -- Lock family header
  PERFORM 1 FROM public.quotes 
  WHERE id = v_version.quote_id AND tenant_id = p_tenant_id 
  FOR UPDATE;

  -- Fail safe if an active acceptance exists on a prior version of this quote
  IF EXISTS (
    SELECT 1 FROM public.quote_acceptances
    WHERE quote_id = v_version.quote_id AND tenant_id = p_tenant_id AND voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ACCEPTANCE_EXISTS: Cannot issue new version while an active quote acceptance exists on this inquiry.';
  END IF;

  -- Atomically supersede previous issued version in the same quote family
  UPDATE public.quote_versions
  SET status = 'superseded', superseded_at = now(), updated_at = now()
  WHERE quote_id = v_version.quote_id 
    AND tenant_id = p_tenant_id 
    AND status = 'issued' 
    AND id != p_version_id;

  -- Issue target version
  UPDATE public.quote_versions
  SET status = 'issued', frozen_at = now(), updated_at = now()
  WHERE id = p_version_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_version;

  RETURN jsonb_build_object(
    'quoteId', v_version.quote_id,
    'versionId', v_version.id,
    'versionNumber', v_version.version_number,
    'status', v_version.status,
    'frozenAt', v_version.frozen_at,
    'updatedAt', v_version.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
