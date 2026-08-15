-- ============================================================================
-- Migration 015: Atomic CRM Copilot Inquiry Action Execution & Single-Use Receipts
-- Description: Creates the copilot_action_executions single-use receipt table and
--              the server-authoritative, atomic SECURITY DEFINER RPC
--              execute_copilot_inquiry_action_atomic.
--              Callable ONLY by trusted backend service_role transport after
--              server-side HMAC, TTL, and session verification.
-- ============================================================================

BEGIN;

-- 1. Create Single-Use Proposal Execution Receipt Table
CREATE TABLE IF NOT EXISTS public.copilot_action_executions (
  proposal_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL,
  action_type text NOT NULL,
  entity_id uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  executed_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS and restrict table access to server-only service_role
ALTER TABLE public.copilot_action_executions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.copilot_action_executions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.copilot_action_executions TO service_role, postgres;

-- 2. Atomic Transactional RPC for Copilot Inquiry Actions
CREATE OR REPLACE FUNCTION public.execute_copilot_inquiry_action_atomic(
  p_actor_user_id text,
  p_proposal_id text,
  p_inquiry_id uuid,
  p_action_type text,
  p_expected_current_state jsonb,
  p_proposed_state jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_profile record;
  v_inquiry record;
  v_assignee_profile record;
  v_target_stage text;
  v_target_assignee text;
  v_target_follow_up timestamptz;
  v_now timestamptz := now();
  v_now_iso text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_activity_id text;
BEGIN
  -- 1. Actor Profile Resolution from trusted server-passed p_actor_user_id
  IF p_actor_user_id IS NULL OR trim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Actor user ID is required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name, role, tenant_id INTO v_caller_profile
  FROM public.profiles
  WHERE id = p_actor_user_id;

  IF v_caller_profile.id IS NULL OR v_caller_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Authenticated profile record not found.' USING ERRCODE = '42501';
  END IF;

  -- Block Super Admin from direct agency CRM execution
  IF v_caller_profile.role = 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN: Platform Super Admin cannot execute Agency CRM actions directly.' USING ERRCODE = '42501';
  END IF;

  -- Block Viewer role
  IF v_caller_profile.role = 'viewer' THEN
    RAISE EXCEPTION 'FORBIDDEN: Viewer role has read-only access and cannot perform CRM mutations.' USING ERRCODE = '42501';
  END IF;

  -- Validate Writable CRM Role
  IF v_caller_profile.role NOT IN ('admin', 'manager', 'specialist', 'setter', 'closer', 'consultant') THEN
    RAISE EXCEPTION 'FORBIDDEN: Insufficient role permissions for CRM actions.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify Canonical Inquiry Existence & Tenant Boundary (FOR UPDATE lock)
  SELECT id, tenant_id, destination, pipeline_stage, assigned_agent_id, next_follow_up_at, legacy_lead_id, updated_at
  INTO v_inquiry
  FROM public.inquiries
  WHERE id = p_inquiry_id
    AND tenant_id = v_caller_profile.tenant_id
    AND archived_at IS NULL
  FOR UPDATE;

  IF v_inquiry.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Inquiry not found in current agency workspace.' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Ownership / Assignment Parity Check (ordinary CRM parity)
  -- Admins & Managers have tenant-wide authority.
  -- Specialists, consultants, setters, closers can only modify inquiries assigned to them or unassigned inquiries.
  IF v_caller_profile.role NOT IN ('admin', 'manager') THEN
    IF v_inquiry.assigned_agent_id IS NOT NULL AND v_inquiry.assigned_agent_id != v_caller_profile.id THEN
      RAISE EXCEPTION 'FORBIDDEN: You can only modify inquiries assigned to you or unassigned inquiries.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Single-Use Proposal Execution Receipt (Replay Protection)
  -- Primary key constraint guarantees execution at most once.
  BEGIN
    INSERT INTO public.copilot_action_executions (
      proposal_id,
      tenant_id,
      actor_user_id,
      action_type,
      entity_id,
      executed_at
    ) VALUES (
      p_proposal_id,
      v_caller_profile.tenant_id,
      v_caller_profile.id,
      p_action_type,
      v_inquiry.id,
      v_now
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_EXECUTED: This action proposal has already been executed.' USING ERRCODE = '23505';
  END;

  -- 5. Dispatch Action Execution
  IF p_action_type = 'update_inquiry_stage' THEN
    v_target_stage := trim(p_proposed_state->>'stage');
    
    -- Validate target stage against exact canonical enum
    IF v_target_stage NOT IN (
      'inquiry_received', 'initial_contact', 'options_shared', 'consultation_booked',
      'itinerary_sent', 'follow_up', 'customizing_package', 'booking_confirmed', 'booking_lost'
    ) THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Target stage "%" is not a valid pipeline stage.', v_target_stage USING ERRCODE = '22023';
    END IF;

    -- Stale State & Replay Protection: Check if already in target stage
    IF v_inquiry.pipeline_stage = v_target_stage THEN
      RAISE EXCEPTION 'STALE_STATE: Inquiry is already in target stage "%". No changes made.', v_target_stage USING ERRCODE = 'P0001';
    END IF;

    -- Stale State: Check if current state changed since proposal
    IF (p_expected_current_state->>'stage') IS NOT NULL AND v_inquiry.pipeline_stage != (p_expected_current_state->>'stage') THEN
      RAISE EXCEPTION 'STALE_STATE: Inquiry stage changed from expected "%" to "%". Please review latest record.',
        (p_expected_current_state->>'stage'), v_inquiry.pipeline_stage USING ERRCODE = 'P0001';
    END IF;

    -- 5a. Mutate Canonical Inquiry
    UPDATE public.inquiries
    SET pipeline_stage = v_target_stage,
        updated_at = v_now
    WHERE id = v_inquiry.id;

    -- 5b. Dual-Write Legacy Lead if linked
    IF v_inquiry.legacy_lead_id IS NOT NULL THEN
      UPDATE public.leads
      SET status = v_target_stage,
          updated_at = v_now
      WHERE id = v_inquiry.legacy_lead_id
        AND tenant_id = v_caller_profile.tenant_id;
    END IF;

    -- 5c. Insert Business Activity Record (Rolls back whole tx if fails)
    v_activity_id := 'act-stage-' || floor(extract(epoch from v_now) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
    INSERT INTO public.activities (
      id,
      lead_id,
      user_id,
      user_name,
      type,
      title,
      description,
      tenant_id,
      created_at
    ) VALUES (
      v_activity_id,
      v_inquiry.legacy_lead_id,
      v_caller_profile.id,
      v_caller_profile.full_name,
      'status_change',
      'Inquiry Stage Updated via Copilot',
      'Stage moved to ' || v_target_stage || ' (confirmed by ' || coalesce(v_caller_profile.full_name, 'Agent') || ').',
      v_caller_profile.tenant_id,
      v_now
    );

    RETURN jsonb_build_object(
      'success', true,
      'actionType', 'update_inquiry_stage',
      'entityId', v_inquiry.id,
      'message', 'Stage successfully updated to ' || v_target_stage || '.',
      'newState', jsonb_build_object(
        'stage', v_target_stage,
        'updatedAt', v_now_iso
      )
    );

  ELSIF p_action_type = 'assign_inquiry' THEN
    v_target_assignee := trim(p_proposed_state->>'assignedAgentId');

    IF v_target_assignee IS NULL OR v_target_assignee = '' THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Target assignee ID is required.' USING ERRCODE = '22023';
    END IF;

    -- Replay / Stale State check
    IF coalesce(v_inquiry.assigned_agent_id, '') = v_target_assignee THEN
      RAISE EXCEPTION 'STALE_STATE: Inquiry is already assigned to this team member. No changes made.' USING ERRCODE = 'P0001';
    END IF;

    -- Validate target assignee profile in same tenant
    SELECT id, full_name, role, tenant_id INTO v_assignee_profile
    FROM public.profiles
    WHERE id = v_target_assignee
      AND tenant_id = v_caller_profile.tenant_id;

    IF v_assignee_profile.id IS NULL THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Target assignee is not a valid team member in this agency workspace.' USING ERRCODE = '22023';
    END IF;

    IF v_assignee_profile.role = 'super_admin' THEN
      RAISE EXCEPTION 'INVALID_ARGUMENT: Cannot assign inquiry to platform super_admin.' USING ERRCODE = '22023';
    END IF;

    -- Stale State Check on assignee
    IF (p_expected_current_state ? 'assignedAgentId') AND coalesce(v_inquiry.assigned_agent_id, '') != coalesce(p_expected_current_state->>'assignedAgentId', '') THEN
      RAISE EXCEPTION 'STALE_STATE: Inquiry assignee changed unexpectedly. Please review latest record.' USING ERRCODE = 'P0001';
    END IF;

    -- 5a. Mutate Canonical Inquiry
    UPDATE public.inquiries
    SET assigned_agent_id = v_target_assignee,
        updated_at = v_now
    WHERE id = v_inquiry.id;

    -- 5b. Dual-Write Legacy Lead if linked
    IF v_inquiry.legacy_lead_id IS NOT NULL THEN
      UPDATE public.leads
      SET assigned_to = v_target_assignee,
          updated_at = v_now
      WHERE id = v_inquiry.legacy_lead_id
        AND tenant_id = v_caller_profile.tenant_id;
    END IF;

    -- 5c. Insert Business Activity Record (Rolls back whole tx if fails)
    v_activity_id := 'act-assign-' || floor(extract(epoch from v_now) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
    INSERT INTO public.activities (
      id,
      lead_id,
      user_id,
      user_name,
      type,
      title,
      description,
      tenant_id,
      created_at
    ) VALUES (
      v_activity_id,
      v_inquiry.legacy_lead_id,
      v_caller_profile.id,
      v_caller_profile.full_name,
      'assigned',
      'Inquiry Reassigned via Copilot',
      'Assigned to ' || coalesce(v_assignee_profile.full_name, 'Team Member') || ' (confirmed by ' || coalesce(v_caller_profile.full_name, 'Agent') || ').',
      v_caller_profile.tenant_id,
      v_now
    );

    RETURN jsonb_build_object(
      'success', true,
      'actionType', 'assign_inquiry',
      'entityId', v_inquiry.id,
      'message', 'Inquiry successfully assigned to ' || coalesce(v_assignee_profile.full_name, 'Team Member') || '.',
      'newState', jsonb_build_object(
        'assignedAgentId', v_target_assignee,
        'assignedAgentName', v_assignee_profile.full_name,
        'updatedAt', v_now_iso
      )
    );

  ELSIF p_action_type = 'set_inquiry_follow_up' THEN
    IF (p_proposed_state->>'nextFollowUpAt') IS NOT NULL AND trim(p_proposed_state->>'nextFollowUpAt') != '' THEN
      v_target_follow_up := (p_proposed_state->>'nextFollowUpAt')::timestamptz;
    ELSE
      v_target_follow_up := NULL;
    END IF;

    -- Replay / Stale State check
    IF (v_inquiry.next_follow_up_at IS NOT DISTINCT FROM v_target_follow_up) THEN
      RAISE EXCEPTION 'STALE_STATE: Follow-up is already set to this datetime. No changes made.' USING ERRCODE = 'P0001';
    END IF;

    -- Stale State Check
    IF (p_expected_current_state ? 'nextFollowUpAt') AND (v_inquiry.next_follow_up_at IS DISTINCT FROM (p_expected_current_state->>'nextFollowUpAt')::timestamptz) THEN
      RAISE EXCEPTION 'STALE_STATE: Follow-up date changed unexpectedly. Please review latest record.' USING ERRCODE = 'P0001';
    END IF;

    -- 5a. Mutate Canonical Inquiry
    UPDATE public.inquiries
    SET next_follow_up_at = v_target_follow_up,
        updated_at = v_now
    WHERE id = v_inquiry.id;

    -- 5b. Dual-Write Legacy Lead if linked
    IF v_inquiry.legacy_lead_id IS NOT NULL THEN
      UPDATE public.leads
      SET next_follow_up_at = v_target_follow_up,
          updated_at = v_now
      WHERE id = v_inquiry.legacy_lead_id
        AND tenant_id = v_caller_profile.tenant_id;
    END IF;

    -- 5c. Insert Business Activity Record (Rolls back whole tx if fails)
    v_activity_id := 'act-followup-' || floor(extract(epoch from v_now) * 1000)::text || '-' || substr(md5(random()::text), 1, 6);
    INSERT INTO public.activities (
      id,
      lead_id,
      user_id,
      user_name,
      type,
      title,
      description,
      tenant_id,
      created_at
    ) VALUES (
      v_activity_id,
      v_inquiry.legacy_lead_id,
      v_caller_profile.id,
      v_caller_profile.full_name,
      'follow_up_set',
      'Follow-Up Scheduled via Copilot',
      'Follow-up scheduled for ' || coalesce(v_target_follow_up::text, 'Cleared') || ' (confirmed by ' || coalesce(v_caller_profile.full_name, 'Agent') || ').',
      v_caller_profile.tenant_id,
      v_now
    );

    RETURN jsonb_build_object(
      'success', true,
      'actionType', 'set_inquiry_follow_up',
      'entityId', v_inquiry.id,
      'message', 'Follow-up successfully scheduled.',
      'newState', jsonb_build_object(
        'nextFollowUpAt', v_target_follow_up,
        'updatedAt', v_now_iso
      )
    );

  ELSE
    RAISE EXCEPTION 'INVALID_ARGUMENT: Unknown action type "%".', p_action_type USING ERRCODE = '22023';
  END IF;

END;
$$;

-- Security & Permissions Hardening:
-- Callable EXCLUSIVELY by server-only backend role (service_role)
-- Revoked from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.execute_copilot_inquiry_action_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_copilot_inquiry_action_atomic TO service_role, postgres;

COMMIT;
