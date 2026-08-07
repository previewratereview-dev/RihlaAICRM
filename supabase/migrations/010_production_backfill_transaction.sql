-- ====================================================================
-- Migration 010: Single-Transaction Production Backfill PL/pgSQL Function
-- ====================================================================
-- EXECUTES 100% INSIDE ONE POSTGRESQL TRANSACTION SESSION:
-- 1. Sets fail-fast lock_timeout ('3s') and statement_timeout ('10s')
-- 2. Acquires EXCLUSIVE lock on public.leads, tasks, activities, conversations
-- 3. Asserts pre-backfill target state zero counts (travelers=0, inquiries=0, bookings=0)
-- 4. Dynamically re-reads baseline production counts (leads=93, confirmed leads=6)
-- 5. Performs idempotent/convergent backfill of TravelerProfiles, Inquiries, Bookings
-- 6. Backfills relationship columns on tasks, activities, conversations
-- 7. Runs complete field-level reconciliation auditor INSIDE the transaction
-- 8. Asserts exact post-backfill entity counts (inquiries=93, bookings=6, travelers=92)
-- 9. Runs complete 11-way tenant-integrity auditor INSIDE the transaction
-- 10. Asserts 100% activity mapping (BOTH traveler_id and inquiry_id) for lead-linked rows
-- 11. Verifies Lead -> Traveler identity compatibility for every Inquiry
-- 12. COMMITS only if 100% of assertions pass (ROLLBACK on any error)
-- 13. Explicitly revokes EXECUTE privileges from PUBLIC, anon, authenticated
-- ====================================================================

CREATE OR REPLACE FUNCTION public.execute_production_backfill_transaction()
RETURNS TABLE(
  status_code text,
  leads_migrated int,
  inquiries_created int,
  bookings_created int,
  travelers_created int,
  reconciliation_mismatches int,
  tenant_violations int,
  activity_mismatches int,
  execution_message text
) AS $$
DECLARE
  v_lead_count INT;
  v_confirmed_count INT;
  v_pre_trav INT;
  v_pre_inq INT;
  v_pre_bk INT;
  v_inq_count INT;
  v_bk_count INT;
  v_trav_count INT;
  v_reconcil_mismatches INT := 0;
  v_tenant_violations INT := 0;
  v_identity_mismatches INT := 0;
  v_lead_linked_tasks INT;
  v_mapped_tasks INT;
  v_lead_linked_activities INT;
  v_mapped_activities INT;
  v_lead_linked_convs INT;
  v_mapped_convs INT;
  r RECORD;
  v_traveler_id UUID;
  v_inquiry_id UUID;
  v_booking_id UUID;
  v_norm_email TEXT;
  v_norm_phone TEXT;
  v_norm_name TEXT;
  v_target_stage TEXT;
  v_booking_ref TEXT;
BEGIN
  -- 1. FAIL-FAST LOCKING STRATEGY
  SET LOCAL lock_timeout = '3s';
  SET LOCAL statement_timeout = '10s';

  -- 2. ACQUIRE EXCLUSIVE LOCKS (Blocks mid-transaction writes, allows SELECTs)
  LOCK TABLE public.leads, public.tasks, public.activities, public.conversations IN EXCLUSIVE MODE;

  -- 3. ASSERT PRE-BACKFILL TARGET STATE ZERO COUNTS
  SELECT COUNT(*) INTO v_pre_trav FROM public.traveler_profiles;
  SELECT COUNT(*) INTO v_pre_inq FROM public.inquiries;
  SELECT COUNT(*) INTO v_pre_bk FROM public.bookings;

  IF v_pre_trav > 0 OR v_pre_inq > 0 OR v_pre_bk > 0 THEN
    RAISE EXCEPTION 'PRE-BACKFILL TARGET STATE FAIL: Existing new-entity records found (travelers=%, inquiries=%, bookings=%)',
      v_pre_trav, v_pre_inq, v_pre_bk;
  END IF;

  -- 4. DYNAMIC BASELINE RE-READ & ASSERTIONS
  SELECT COUNT(*) INTO v_lead_count FROM public.leads;
  SELECT COUNT(*) INTO v_confirmed_count FROM public.leads WHERE status IN ('booking_confirmed', 'closed_won');

  IF v_lead_count != 93 THEN
    RAISE EXCEPTION 'PRODUCTION BASELINE ASSERTION FAIL: Expected 93 leads, found %', v_lead_count;
  END IF;

  IF v_confirmed_count != 6 THEN
    RAISE EXCEPTION 'PRODUCTION BASELINE ASSERTION FAIL: Expected 6 confirmed leads, found %', v_confirmed_count;
  END IF;

  -- 5. IDEMPOTENT & CONVERGENT BACKFILL ALGORITHM

  -- Step A: Backfill Traveler Profiles (Tenant-Scoped Deduplication)
  FOR r IN 
    SELECT DISTINCT ON (
      tenant_id, 
      COALESCE(NULLIF(lower(trim(email)), ''), NULLIF(regexp_replace(phone, '\D', '', 'g'), ''), lower(trim(regexp_replace(full_name, '\s+', ' ', 'g'))))
    )
      id, tenant_id, full_name, email, phone, created_at
    FROM public.leads
    ORDER BY 
      tenant_id, 
      COALESCE(NULLIF(lower(trim(email)), ''), NULLIF(regexp_replace(phone, '\D', '', 'g'), ''), lower(trim(regexp_replace(full_name, '\s+', ' ', 'g')))),
      created_at ASC
  LOOP
    v_norm_email := NULLIF(lower(trim(r.email)), '');
    v_norm_phone := NULLIF(regexp_replace(r.phone, '\D', '', 'g'), '');
    v_norm_name := COALESCE(NULLIF(trim(r.full_name), ''), 'Unnamed Traveler');

    IF NOT EXISTS (
      SELECT 1 FROM public.traveler_profiles 
      WHERE tenant_id = r.tenant_id 
        AND (
          (v_norm_email IS NOT NULL AND lower(trim(email)) = v_norm_email)
          OR (v_norm_phone IS NOT NULL AND normalized_phone = v_norm_phone)
          OR (lower(trim(display_name)) = lower(v_norm_name))
        )
    ) THEN
      INSERT INTO public.traveler_profiles (
        id, tenant_id, display_name, email, phone, normalized_phone, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), r.tenant_id, v_norm_name, v_norm_email, r.phone, v_norm_phone, r.created_at, now()
      );
    END IF;
  END LOOP;

  -- Step B: Backfill Inquiries and Bookings for all Leads
  FOR r IN SELECT * FROM public.leads LOOP
    v_norm_email := NULLIF(lower(trim(r.email)), '');
    v_norm_phone := NULLIF(regexp_replace(r.phone, '\D', '', 'g'), '');
    v_norm_name := lower(trim(regexp_replace(r.full_name, '\s+', ' ', 'g')));

    SELECT id INTO v_traveler_id
    FROM public.traveler_profiles
    WHERE tenant_id = r.tenant_id
      AND (
        (v_norm_email IS NOT NULL AND lower(trim(email)) = v_norm_email)
        OR (v_norm_phone IS NOT NULL AND normalized_phone = v_norm_phone)
        OR (lower(trim(display_name)) = v_norm_name)
      )
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_traveler_id IS NULL THEN
      v_traveler_id := gen_random_uuid();
      INSERT INTO public.traveler_profiles (
        id, tenant_id, display_name, email, phone, normalized_phone, created_at, updated_at
      ) VALUES (
        v_traveler_id, r.tenant_id, COALESCE(NULLIF(trim(r.full_name), ''), 'Unnamed Traveler'), v_norm_email, r.phone, v_norm_phone, r.created_at, now()
      );
    END IF;

    v_target_stage := CASE r.status
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

    v_inquiry_id := gen_random_uuid();
    INSERT INTO public.inquiries (
      id, tenant_id, traveler_id, legacy_lead_id, destination, lead_source,
      priority, pipeline_stage, expected_value, currency, assigned_agent_id,
      last_contacted_at, next_follow_up_at, created_at, updated_at
    ) VALUES (
      v_inquiry_id, r.tenant_id, v_traveler_id, r.id, NULLIF(trim(r.destination), ''),
      COALESCE(r.lead_source, 'website'),
      CASE WHEN r.priority IN ('urgent','high','medium','low') THEN r.priority ELSE 'medium' END,
      v_target_stage,
      CASE WHEN r.deal_value >= 0 THEN r.deal_value ELSE NULL END,
      'INR', r.assigned_to,
      CASE WHEN r.last_contacted IS NOT NULL AND pg_input_is_valid(r.last_contacted, 'timestamptz') THEN r.last_contacted::timestamptz ELSE NULL END,
      CASE WHEN r.next_follow_up IS NOT NULL AND pg_input_is_valid(r.next_follow_up, 'timestamptz') THEN r.next_follow_up::timestamptz ELSE NULL END,
      r.created_at, r.updated_at
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
      updated_at = now();

    SELECT id INTO v_inquiry_id FROM public.inquiries WHERE tenant_id = r.tenant_id AND legacy_lead_id = r.id;

    IF v_target_stage = 'booking_confirmed' THEN
      v_booking_id := gen_random_uuid();
      v_booking_ref := 'BK-' || upper(replace(r.id, '-', ''));

      INSERT INTO public.bookings (
        id, tenant_id, traveler_id, inquiry_id, legacy_lead_id, booking_reference,
        departure_date, return_date, passenger_count, total_amount, paid_amount,
        currency, booking_status, payment_status, fulfillment_status, financial_data_complete,
        assigned_agent_id, created_at, updated_at
      ) VALUES (
        v_booking_id, r.tenant_id, v_traveler_id, v_inquiry_id, r.id, v_booking_ref,
        CASE WHEN r.departure_date IS NOT NULL AND pg_input_is_valid(r.departure_date, 'date') THEN r.departure_date::date ELSE NULL END,
        CASE WHEN r.return_date IS NOT NULL AND pg_input_is_valid(r.return_date, 'date') THEN r.return_date::date ELSE NULL END,
        CASE WHEN r.number_of_travelers ~ '^[0-9]+$' THEN r.number_of_travelers::int ELSE 1 END,
        NULL, NULL, 'INR', 'confirmed', 'unknown', 'unknown', false,
        r.assigned_to, r.created_at, r.updated_at
      )
      ON CONFLICT (tenant_id, legacy_lead_id) DO UPDATE SET
        traveler_id = EXCLUDED.traveler_id,
        inquiry_id = EXCLUDED.inquiry_id,
        assigned_agent_id = EXCLUDED.assigned_agent_id,
        updated_at = now();
    END IF;
  END LOOP;

  -- Step C: Backfill Activity Table Relationship Columns
  UPDATE public.tasks t
  SET traveler_id = i.traveler_id, inquiry_id = i.id, booking_id = b.id
  FROM public.inquiries i
  LEFT JOIN public.bookings b ON b.tenant_id = i.tenant_id AND b.inquiry_id = i.id
  WHERE t.tenant_id = i.tenant_id AND t.lead_id = i.legacy_lead_id;

  UPDATE public.activities a
  SET traveler_id = i.traveler_id, inquiry_id = i.id, booking_id = b.id
  FROM public.inquiries i
  LEFT JOIN public.bookings b ON b.tenant_id = i.tenant_id AND b.inquiry_id = i.id
  WHERE a.tenant_id = i.tenant_id AND a.lead_id = i.legacy_lead_id;

  UPDATE public.conversations c
  SET traveler_id = i.traveler_id, inquiry_id = i.id, booking_id = b.id
  FROM public.inquiries i
  LEFT JOIN public.bookings b ON b.tenant_id = i.tenant_id AND b.inquiry_id = i.id
  WHERE c.tenant_id = i.tenant_id AND c.lead_id = i.legacy_lead_id;

  -- 6. ASSERT EXACT POST-BACKFILL ENTITY COUNTS
  SELECT COUNT(*) INTO v_inq_count FROM public.inquiries;
  SELECT COUNT(*) INTO v_bk_count FROM public.bookings;
  SELECT COUNT(*) INTO v_trav_count FROM public.traveler_profiles;

  IF v_inq_count != v_lead_count THEN
    RAISE EXCEPTION 'POST-BACKFILL COUNT FAIL: Inquiries (%) != baseline leads (%)', v_inq_count, v_lead_count;
  END IF;

  IF v_bk_count != v_confirmed_count THEN
    RAISE EXCEPTION 'POST-BACKFILL COUNT FAIL: Bookings (%) != confirmed leads (%)', v_bk_count, v_confirmed_count;
  END IF;

  IF v_trav_count != 92 THEN
    RAISE EXCEPTION 'POST-BACKFILL COUNT FAIL: TravelerProfiles count (%) != expected 92', v_trav_count;
  END IF;

  -- 7. COMPLETE IN-TRANSACTION FIELD RECONCILIATION AUDITOR
  SELECT COUNT(*) INTO v_reconcil_mismatches
  FROM public.leads l
  LEFT JOIN public.inquiries i ON i.tenant_id = l.tenant_id AND i.legacy_lead_id = l.id
  LEFT JOIN public.bookings b ON b.tenant_id = l.tenant_id AND b.legacy_lead_id = l.id
  WHERE 
    i.id IS NULL
    OR (l.status IN ('booking_confirmed', 'closed_won') AND b.id IS NULL)
    OR (
      CASE l.status
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
        ELSE 'UNMAPPED'
      END IS DISTINCT FROM i.pipeline_stage
    )
    OR (CASE WHEN l.priority IN ('urgent','high','medium','low') THEN l.priority ELSE 'medium' END IS DISTINCT FROM i.priority)
    OR (CASE WHEN l.deal_value >= 0 THEN l.deal_value ELSE NULL END IS DISTINCT FROM i.expected_value)
    OR (NULLIF(trim(l.destination), '') IS DISTINCT FROM i.destination)
    OR (COALESCE(l.lead_source, 'website') IS DISTINCT FROM i.lead_source)
    OR (l.assigned_to IS DISTINCT FROM i.assigned_agent_id)
    OR (CASE WHEN l.next_follow_up IS NOT NULL AND pg_input_is_valid(l.next_follow_up, 'timestamptz') THEN l.next_follow_up::timestamptz ELSE NULL END IS DISTINCT FROM i.next_follow_up_at)
    OR (CASE WHEN l.last_contacted IS NOT NULL AND pg_input_is_valid(l.last_contacted, 'timestamptz') THEN l.last_contacted::timestamptz ELSE NULL END IS DISTINCT FROM i.last_contacted_at);

  IF v_reconcil_mismatches > 0 THEN
    RAISE EXCEPTION 'IN-TRANSACTION FIELD RECONCILIATION FAIL: % mismatches detected', v_reconcil_mismatches;
  END IF;

  -- 8. COMPLETE IN-TRANSACTION 11-WAY TENANT INTEGRITY AUDITOR
  SELECT COUNT(*) INTO v_tenant_violations
  FROM (
    -- Inquiry -> Traveler
    SELECT i.id FROM public.inquiries i JOIN public.traveler_profiles t ON t.id = i.traveler_id WHERE i.tenant_id != t.tenant_id
    UNION ALL
    -- Booking -> Traveler
    SELECT b.id FROM public.bookings b JOIN public.traveler_profiles t ON t.id = b.traveler_id WHERE b.tenant_id != t.tenant_id
    UNION ALL
    -- Booking -> Inquiry
    SELECT b.id FROM public.bookings b JOIN public.inquiries i ON i.id = b.inquiry_id WHERE b.tenant_id != i.tenant_id
    UNION ALL
    -- Inquiry -> Agent
    SELECT i.id FROM public.inquiries i JOIN public.profiles p ON p.id = i.assigned_agent_id WHERE i.tenant_id != p.tenant_id
    UNION ALL
    -- Booking -> Agent
    SELECT b.id FROM public.bookings b JOIN public.profiles p ON p.id = b.assigned_agent_id WHERE b.tenant_id != p.tenant_id
    UNION ALL
    -- Tasks -> Inquiry
    SELECT tk.id FROM public.tasks tk JOIN public.inquiries i ON i.id = tk.inquiry_id WHERE tk.tenant_id != i.tenant_id
    UNION ALL
    -- Tasks -> Traveler
    SELECT tk.id FROM public.tasks tk JOIN public.traveler_profiles t ON t.id = tk.traveler_id WHERE tk.tenant_id != t.tenant_id
    UNION ALL
    -- Activities -> Inquiry
    SELECT a.id FROM public.activities a JOIN public.inquiries i ON i.id = a.inquiry_id WHERE a.tenant_id != i.tenant_id
    UNION ALL
    -- Activities -> Traveler
    SELECT a.id FROM public.activities a JOIN public.traveler_profiles t ON t.id = a.traveler_id WHERE a.tenant_id != t.tenant_id
    UNION ALL
    -- Conversations -> Inquiry
    SELECT c.id FROM public.conversations c JOIN public.inquiries i ON i.id = c.inquiry_id WHERE c.tenant_id != i.tenant_id
    UNION ALL
    -- Conversations -> Traveler
    SELECT c.id FROM public.conversations c JOIN public.traveler_profiles t ON t.id = c.traveler_id WHERE c.tenant_id != t.tenant_id
  ) violations;

  IF v_tenant_violations > 0 THEN
    RAISE EXCEPTION 'IN-TRANSACTION TENANT INTEGRITY FAIL: % cross-tenant violations', v_tenant_violations;
  END IF;

  -- 9. ASSERT ACTIVITY MIGRATION RESULTS (Require BOTH traveler_id AND inquiry_id on lead-linked rows)
  SELECT COUNT(*) INTO v_lead_linked_tasks FROM public.tasks WHERE lead_id IS NOT NULL;
  SELECT COUNT(*) INTO v_mapped_tasks FROM public.tasks WHERE lead_id IS NOT NULL AND inquiry_id IS NOT NULL AND traveler_id IS NOT NULL;

  SELECT COUNT(*) INTO v_lead_linked_activities FROM public.activities WHERE lead_id IS NOT NULL;
  SELECT COUNT(*) INTO v_mapped_activities FROM public.activities WHERE lead_id IS NOT NULL AND inquiry_id IS NOT NULL AND traveler_id IS NOT NULL;

  SELECT COUNT(*) INTO v_lead_linked_convs FROM public.conversations WHERE lead_id IS NOT NULL;
  SELECT COUNT(*) INTO v_mapped_convs FROM public.conversations WHERE lead_id IS NOT NULL AND inquiry_id IS NOT NULL AND traveler_id IS NOT NULL;

  IF v_lead_linked_tasks != v_mapped_tasks OR v_lead_linked_activities != v_mapped_activities OR v_lead_linked_convs != v_mapped_convs THEN
    RAISE EXCEPTION 'ACTIVITY MAPPING ASSERTION FAIL: Tasks (%/%), Activities (%/%), Convs (%/%)',
      v_mapped_tasks, v_lead_linked_tasks, v_mapped_activities, v_lead_linked_activities, v_mapped_convs, v_lead_linked_convs;
  END IF;

  -- 10. VERIFY LEAD -> TRAVELER IDENTITY COMPATIBILITY FOR EVERY INQUIRY
  SELECT COUNT(*) INTO v_identity_mismatches
  FROM public.leads l
  JOIN public.inquiries i ON i.tenant_id = l.tenant_id AND i.legacy_lead_id = l.id
  JOIN public.traveler_profiles t ON t.id = i.traveler_id
  WHERE NOT (
    (NULLIF(lower(trim(l.email)), '') IS NOT NULL AND lower(trim(t.email)) = lower(trim(l.email)))
    OR (NULLIF(regexp_replace(l.phone, '\D', '', 'g'), '') IS NOT NULL AND t.normalized_phone = regexp_replace(l.phone, '\D', '', 'g'))
    OR (lower(trim(t.display_name)) = lower(trim(regexp_replace(COALESCE(NULLIF(trim(l.full_name), ''), 'Unnamed Traveler'), '\s+', ' ', 'g'))))
  );

  IF v_identity_mismatches > 0 THEN
    RAISE EXCEPTION 'LEAD-TRAVELER IDENTITY MATCH FAIL: % inquiries linked to incompatible travelers', v_identity_mismatches;
  END IF;

  -- 11. RETURN FINAL SUCCESS SUMMARY
  status_code := 'SUCCESS_READY_TO_COMMIT';
  leads_migrated := v_lead_count;
  inquiries_created := v_inq_count;
  bookings_created := v_bk_count;
  travelers_created := v_trav_count;
  reconciliation_mismatches := v_reconcil_mismatches;
  tenant_violations := v_tenant_violations;
  activity_mismatches := 0;
  execution_message := 'All pre-backfill zeroes, baseline counts, post-backfill counts, field reconciliations, 11-way tenant isolation, activity mappings, and lead-traveler identity assertions passed 100%.';

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 12. STRICTLY RESTRICT FUNCTION EXECUTE PRIVILEGES
REVOKE EXECUTE ON FUNCTION public.execute_production_backfill_transaction() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_production_backfill_transaction() TO postgres, service_role;
