-- ============================================================================
-- MIGRATION 018: SECURE SHARING & PUBLIC TOKEN RESOLUTION
-- Phase AI-5B.3 — Share Issuance, Revocation, Public Read Portal
-- ============================================================================
-- FROZEN BASELINES: 016, 017
-- INVARIANTS:
--   SHARE CREATION != DELIVERY
--   VIEW != ACCEPTANCE
--   QUOTE EXPIRY != TOKEN EXPIRY
-- ============================================================================

-- ============================================================================
-- 1. RPC: ISSUE ITINERARY SHARE
-- ============================================================================
-- Issues a share capability for a finalized ItineraryVersion.
-- The raw token is returned to the caller for one-time delivery.
-- Only the SHA-256 hash is stored in the database.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_create_itinerary_share(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_itinerary_version_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_version record;
  v_share_id uuid;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Permission check: itineraries:share
  IF v_role NOT IN ('admin', 'manager', 'consultant', 'specialist') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % does not have itineraries:share permission', v_role;
  END IF;

  -- 3. Validate token_hash format (SHA-256 = 64 hex chars)
  IF length(p_token_hash) != 64 OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: token_hash must be a 64-character lowercase hex SHA-256 digest';
  END IF;

  -- 4. Validate expiry is in the future
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: expires_at must be in the future';
  END IF;

  -- 5. Verify ItineraryVersion exists, belongs to tenant, and is finalized
  SELECT iv.id, iv.status, iv.tenant_id
  INTO v_version
  FROM public.itinerary_versions iv
  WHERE iv.id = p_itinerary_version_id AND iv.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: ItineraryVersion % not found in tenant %',
      p_itinerary_version_id, p_tenant_id;
  END IF;

  IF v_version.status != 'finalized' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot share ItineraryVersion in status %; must be finalized',
      v_version.status;
  END IF;

  -- 6. Insert share record
  INSERT INTO public.itinerary_shares (
    tenant_id, itinerary_version_id, token_hash, created_by, expires_at
  ) VALUES (
    p_tenant_id, p_itinerary_version_id, p_token_hash, p_actor_user_id, p_expires_at
  )
  RETURNING id INTO v_share_id;

  RETURN jsonb_build_object(
    'share_id', v_share_id,
    'itinerary_version_id', p_itinerary_version_id,
    'expires_at', p_expires_at
  );
END;
$$;

-- ============================================================================
-- 2. RPC: ISSUE QUOTE SHARE
-- ============================================================================
-- Issues a share capability for an issued QuoteVersion.
-- Only issued quotes can be shared (not draft, rejected, cancelled, superseded).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_create_quote_share(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_quote_version_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_version record;
  v_share_id uuid;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Permission check: quotes:share
  IF v_role NOT IN ('admin', 'manager', 'consultant', 'specialist') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % does not have quotes:share permission', v_role;
  END IF;

  -- 3. Validate token_hash format
  IF length(p_token_hash) != 64 OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: token_hash must be a 64-character lowercase hex SHA-256 digest';
  END IF;

  -- 4. Validate expiry is in the future
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: expires_at must be in the future';
  END IF;

  -- 5. Verify QuoteVersion exists, belongs to tenant, and is issued
  SELECT qv.id, qv.status, qv.tenant_id
  INTO v_version
  FROM public.quote_versions qv
  WHERE qv.id = p_quote_version_id AND qv.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: QuoteVersion % not found in tenant %',
      p_quote_version_id, p_tenant_id;
  END IF;

  IF v_version.status != 'issued' THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: Cannot share QuoteVersion in status %; must be issued',
      v_version.status;
  END IF;

  -- 6. Insert share record
  INSERT INTO public.quote_shares (
    tenant_id, quote_version_id, token_hash, created_by, expires_at
  ) VALUES (
    p_tenant_id, p_quote_version_id, p_token_hash, p_actor_user_id, p_expires_at
  )
  RETURNING id INTO v_share_id;

  RETURN jsonb_build_object(
    'share_id', v_share_id,
    'quote_version_id', p_quote_version_id,
    'expires_at', p_expires_at
  );
END;
$$;

-- ============================================================================
-- 3. RPC: REVOKE SHARE
-- ============================================================================
-- Revokes a share capability. Works for both itinerary and quote shares.
-- Only admin/manager can revoke any share in their tenant.
-- The original share creator can also revoke their own shares.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_revoke_itinerary_share(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_share_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_share record;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Permission check
  IF v_role NOT IN ('admin', 'manager', 'consultant', 'specialist') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % cannot revoke shares', v_role;
  END IF;

  -- 3. Find the share
  SELECT id, tenant_id, created_by, revoked_at
  INTO v_share
  FROM public.itinerary_shares
  WHERE id = p_share_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: ItineraryShare % not found in tenant %', p_share_id, p_tenant_id;
  END IF;

  IF v_share.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: ItineraryShare % is already revoked', p_share_id;
  END IF;

  -- 4. Authorization: Admin/Manager can revoke any; others only their own
  IF v_role NOT IN ('admin', 'manager') AND v_share.created_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % can only revoke shares they created', v_role;
  END IF;

  -- 5. Revoke
  UPDATE public.itinerary_shares
  SET revoked_at = now()
  WHERE id = p_share_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('share_id', p_share_id, 'revoked', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_revoke_quote_share(
  p_tenant_id text,
  p_actor_user_id uuid,
  p_share_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_share record;
BEGIN
  -- 1. Validate actor
  v_role := public._validate_domain_actor(p_tenant_id, p_actor_user_id);

  -- 2. Permission check
  IF v_role NOT IN ('admin', 'manager', 'consultant', 'specialist') THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % cannot revoke shares', v_role;
  END IF;

  -- 3. Find the share
  SELECT id, tenant_id, created_by, revoked_at
  INTO v_share
  FROM public.quote_shares
  WHERE id = p_share_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: QuoteShare % not found in tenant %', p_share_id, p_tenant_id;
  END IF;

  IF v_share.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'LIFECYCLE_VIOLATION: QuoteShare % is already revoked', p_share_id;
  END IF;

  -- 4. Authorization: Admin/Manager can revoke any; others only their own
  IF v_role NOT IN ('admin', 'manager') AND v_share.created_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Role % can only revoke shares they created', v_role;
  END IF;

  -- 5. Revoke
  UPDATE public.quote_shares
  SET revoked_at = now()
  WHERE id = p_share_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('share_id', p_share_id, 'revoked', true);
END;
$$;

-- ============================================================================
-- 4. PUBLIC TOKEN RESOLUTION FUNCTION
-- ============================================================================
-- Resolves a token hash to the underlying version data for public portal rendering.
-- This is the ONLY function callable by anonymous/unauthenticated users.
-- It validates: token exists, not revoked, not expired.
-- It updates view metadata (first_viewed_at, last_viewed_at).
-- Returns ONLY customer-safe data. Zero internal/staff fields.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_itinerary_share_token(
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_share record;
  v_version record;
  v_itinerary record;
  v_tenant record;
BEGIN
  -- 1. Validate hash format
  IF length(p_token_hash) != 64 OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_TOKEN: Malformed token'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Find active (non-revoked) share by hash
  SELECT s.id, s.tenant_id, s.itinerary_version_id, s.expires_at,
         s.revoked_at, s.first_viewed_at
  INTO v_share
  FROM public.itinerary_shares s
  WHERE s.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TOKEN: Share not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_share.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TOKEN_REVOKED: This share link has been revoked'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_share.expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED: This share link has expired'
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Update view metadata
  IF v_share.first_viewed_at IS NULL THEN
    UPDATE public.itinerary_shares
    SET first_viewed_at = now(), last_viewed_at = now()
    WHERE id = v_share.id;
  ELSE
    UPDATE public.itinerary_shares
    SET last_viewed_at = now()
    WHERE id = v_share.id;
  END IF;

  -- 4. Fetch version data (customer-safe fields only)
  SELECT iv.id, iv.version_number, iv.title, iv.destination_summary,
         iv.start_date, iv.end_date, iv.duration_days, iv.passenger_count,
         iv.days, iv.inclusions, iv.exclusions
  INTO v_version
  FROM public.itinerary_versions iv
  WHERE iv.id = v_share.itinerary_version_id AND iv.tenant_id = v_share.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: Referenced ItineraryVersion not found'
      USING ERRCODE = 'XX000';
  END IF;

  -- 5. Fetch tenant name for branding
  SELECT t.name INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_share.tenant_id;

  RETURN jsonb_build_object(
    'share_id', v_share.id,
    'version_id', v_version.id,
    'version_number', v_version.version_number,
    'title', v_version.title,
    'destination_summary', v_version.destination_summary,
    'start_date', v_version.start_date,
    'end_date', v_version.end_date,
    'duration_days', v_version.duration_days,
    'passenger_count', v_version.passenger_count,
    'days', v_version.days,
    'inclusions', v_version.inclusions,
    'exclusions', v_version.exclusions,
    'agency_name', v_tenant.name,
    'expires_at', v_share.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_quote_share_token(
  p_token_hash text
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
  v_tenant record;
  v_has_active_acceptance boolean;
  v_is_acceptable boolean;
BEGIN
  -- 1. Validate hash format
  IF length(p_token_hash) != 64 OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_TOKEN: Malformed token'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Find active share by hash
  SELECT s.id, s.tenant_id, s.quote_version_id, s.expires_at,
         s.revoked_at, s.first_viewed_at
  INTO v_share
  FROM public.quote_shares s
  WHERE s.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TOKEN: Share not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_share.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TOKEN_REVOKED: This share link has been revoked'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_share.expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED: This share link has expired'
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Update view metadata
  IF v_share.first_viewed_at IS NULL THEN
    UPDATE public.quote_shares
    SET first_viewed_at = now(), last_viewed_at = now()
    WHERE id = v_share.id;
  ELSE
    UPDATE public.quote_shares
    SET last_viewed_at = now()
    WHERE id = v_share.id;
  END IF;

  -- 4. Fetch QuoteVersion (CUSTOMER-SAFE FIELDS ONLY — no internal costs/margins)
  SELECT qv.id, qv.tenant_id, qv.quote_id, qv.version_number, qv.status,
         qv.itinerary_version_id, qv.currency, qv.line_items,
         qv.subtotal, qv.discount_amount, qv.tax_amount, qv.grand_total,
         qv.valid_until, qv.terms_and_conditions, qv.customer_notes
  INTO v_qv
  FROM public.quote_versions qv
  WHERE qv.id = v_share.quote_version_id AND qv.tenant_id = v_share.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: Referenced QuoteVersion not found'
      USING ERRCODE = 'XX000';
  END IF;

  -- 5. Fetch Quote header for quote_number
  SELECT q.quote_number, q.inquiry_id
  INTO v_quote
  FROM public.quotes q
  WHERE q.id = v_qv.quote_id AND q.tenant_id = v_share.tenant_id;

  -- 6. Fetch linked ItineraryVersion (customer-safe fields only)
  SELECT iv.title, iv.destination_summary, iv.start_date, iv.end_date,
         iv.duration_days, iv.passenger_count, iv.days, iv.inclusions, iv.exclusions
  INTO v_iv
  FROM public.itinerary_versions iv
  WHERE iv.id = v_qv.itinerary_version_id AND iv.tenant_id = v_share.tenant_id;

  -- 7. Check if there's an active (non-voided) acceptance for this inquiry
  SELECT EXISTS(
    SELECT 1 FROM public.quote_acceptances qa
    WHERE qa.tenant_id = v_share.tenant_id
    AND qa.inquiry_id = v_quote.inquiry_id
    AND qa.voided_at IS NULL
  ) INTO v_has_active_acceptance;

  -- isAcceptable = issued AND not expired AND no competing acceptance
  -- Note: quote expiry != token expiry. Quote commercial validity is valid_until.
  v_is_acceptable := (
    v_qv.status = 'issued'
    AND (v_qv.valid_until IS NULL OR v_qv.valid_until::date >= CURRENT_DATE)
    AND NOT v_has_active_acceptance
  );

  -- 8. Fetch tenant name
  SELECT t.name INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_share.tenant_id;

  RETURN jsonb_build_object(
    'share_id', v_share.id,
    'quote_version_id', v_qv.id,
    'quote_number', v_quote.quote_number,
    'version_number', v_qv.version_number,
    'currency', v_qv.currency,
    'line_items', v_qv.line_items,
    'subtotal', v_qv.subtotal,
    'discount_amount', v_qv.discount_amount,
    'tax_amount', v_qv.tax_amount,
    'grand_total', v_qv.grand_total,
    'valid_until', v_qv.valid_until,
    'terms_and_conditions', v_qv.terms_and_conditions,
    'customer_notes', v_qv.customer_notes,
    'is_acceptable', v_is_acceptable,
    'itinerary', CASE WHEN v_iv.title IS NOT NULL THEN jsonb_build_object(
      'title', v_iv.title,
      'destination_summary', v_iv.destination_summary,
      'start_date', v_iv.start_date,
      'end_date', v_iv.end_date,
      'duration_days', v_iv.duration_days,
      'passenger_count', v_iv.passenger_count,
      'days', v_iv.days,
      'inclusions', v_iv.inclusions,
      'exclusions', v_iv.exclusions
    ) ELSE NULL END,
    'agency_name', v_tenant.name,
    'expires_at', v_share.expires_at
  );
END;
$$;

-- ============================================================================
-- 5. EXECUTE PRIVILEGES
-- ============================================================================
-- Share issuance/revocation: service_role only (called via server-side service layer)
REVOKE ALL ON FUNCTION public.rpc_create_itinerary_share(text, uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_quote_share(text, uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_revoke_itinerary_share(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_revoke_quote_share(text, uuid, uuid) FROM PUBLIC;

-- Public token resolution: callable by anon/authenticated for portal rendering
REVOKE ALL ON FUNCTION public.resolve_itinerary_share_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_quote_share_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_itinerary_share_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_quote_share_token(text) TO anon, authenticated;

-- ============================================================================
-- END MIGRATION 018
-- ============================================================================
