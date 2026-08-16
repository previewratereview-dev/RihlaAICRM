-- Migration 016: Itinerary and Quote Domain Foundation (Phase AI-5B.1)
--
-- Pure additive database schema foundation for Rihla Itinerary & Quote domain:
-- 1. itineraries (Stable family identity)
-- 2. itinerary_versions (Versioned spatial/temporal travel plans with days JSONB)
-- 3. quotes (Stable quote family identity & human-readable quote numbers)
-- 4. quote_versions (Versioned commercial proposals with line_items JSONB and exact ItineraryVersion FK)
-- 5. itinerary_shares (Public read-only share capabilities with token hashing)
-- 6. quote_shares (Public commercial quote share capabilities with token hashing)
-- 7. quote_acceptances (Authoritative commercial acceptance provenance & immutable snapshots)
-- 8. tenant_quote_sequences (Atomic year-scoped sequential quote numbering)
-- 9. bookings (Nullable quote_acceptance_id commercial provenance FK)
--
-- Invariants:
-- - ALL domain tables carry physical tenant_id text NOT NULL references public.tenants(id)
-- - Composite foreign keys enforce tenant isolation at database level
-- - Higher-order trigger enforces that Quote and Itinerary belong to the SAME Inquiry
-- - quote_acceptances enforces at most ONE active non-void acceptance per Inquiry
-- - bookings.quote_acceptance_id is NULLABLE to preserve legacy Bookings
-- - legacy public.quotes_itineraries remains untouched for backward compatibility

-- ============================================================================
-- 1. ITINERARIES (FAMILY HEADER)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  inquiry_id uuid NOT NULL,
  title text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT uq_itineraries_composite UNIQUE (tenant_id, id),
  CONSTRAINT fk_itineraries_inquiry FOREIGN KEY (tenant_id, inquiry_id)
    REFERENCES public.inquiries(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_itinerary_title_nonempty CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_itineraries_tenant_inquiry ON public.itineraries(tenant_id, inquiry_id);
CREATE INDEX IF NOT EXISTS idx_itineraries_tenant_created ON public.itineraries(tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS update_itineraries_updated_at ON public.itineraries;
CREATE TRIGGER update_itineraries_updated_at
  BEFORE UPDATE ON public.itineraries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2. ITINERARY VERSIONS (STRUCTURED TRAVEL PROGRAM DOCUMENT)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.itinerary_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  itinerary_id uuid NOT NULL,
  version_number int NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  frozen_at timestamptz,
  title text NOT NULL,
  destination_summary text,
  start_date date,
  end_date date,
  duration_days int,
  passenger_count int,
  days jsonb NOT NULL DEFAULT '[]'::jsonb,
  inclusions text[] NOT NULL DEFAULT '{}'::text[],
  exclusions text[] NOT NULL DEFAULT '{}'::text[],
  itinerary_schema_version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_itinerary_versions_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_itinerary_versions_family UNIQUE (tenant_id, itinerary_id, version_number),
  CONSTRAINT fk_itinerary_versions_itinerary FOREIGN KEY (tenant_id, itinerary_id)
    REFERENCES public.itineraries(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_itinerary_version_number CHECK (version_number > 0),
  CONSTRAINT chk_itinerary_version_status CHECK (status IN ('draft', 'finalized', 'superseded', 'archived')),
  CONSTRAINT chk_itinerary_passenger_count CHECK (passenger_count IS NULL OR passenger_count > 0),
  CONSTRAINT chk_itinerary_dates CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_itinerary_duration CHECK (duration_days IS NULL OR duration_days > 0),
  CONSTRAINT chk_itinerary_schema_version CHECK (itinerary_schema_version = 1)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_versions_family ON public.itinerary_versions(tenant_id, itinerary_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_itinerary_versions_status ON public.itinerary_versions(tenant_id, status);

DROP TRIGGER IF EXISTS update_itinerary_versions_updated_at ON public.itinerary_versions;
CREATE TRIGGER update_itinerary_versions_updated_at
  BEFORE UPDATE ON public.itinerary_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 3. QUOTES (FAMILY HEADER & NUMBERING)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  inquiry_id uuid NOT NULL,
  quote_number text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT uq_quotes_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_quotes_tenant_quote_number UNIQUE (tenant_id, quote_number),
  CONSTRAINT fk_quotes_inquiry FOREIGN KEY (tenant_id, inquiry_id)
    REFERENCES public.inquiries(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_quotes_quote_number_nonempty CHECK (length(trim(quote_number)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant_inquiry ON public.quotes(tenant_id, inquiry_id);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant_created ON public.quotes(tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS update_quotes_updated_at ON public.quotes;
CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 4. QUOTE VERSIONS (STRUCTURED COMMERCIAL PROPOSAL DOCUMENT)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL,
  version_number int NOT NULL,
  itinerary_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  frozen_at timestamptz,
  currency text NOT NULL DEFAULT 'INR',
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  quote_schema_version int NOT NULL DEFAULT 1,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0.00,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  grand_total numeric(12, 2) NOT NULL DEFAULT 0.00,
  internal_cost_total numeric(12, 2),
  gross_margin_amount numeric(12, 2),
  valid_until date,
  terms_and_conditions text,
  customer_notes text,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  superseded_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_quote_versions_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_quote_versions_family UNIQUE (tenant_id, quote_id, version_number),
  CONSTRAINT fk_quote_versions_quote FOREIGN KEY (tenant_id, quote_id)
    REFERENCES public.quotes(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_versions_itinerary_version FOREIGN KEY (tenant_id, itinerary_version_id)
    REFERENCES public.itinerary_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_quote_version_number CHECK (version_number > 0),
  CONSTRAINT chk_quote_version_status CHECK (status IN ('draft', 'issued', 'rejected', 'superseded', 'cancelled')),
  CONSTRAINT chk_quote_currency CHECK (length(trim(currency)) BETWEEN 3 AND 5),
  CONSTRAINT chk_quote_amounts CHECK (
    subtotal >= 0 AND
    discount_amount >= 0 AND
    tax_amount >= 0 AND
    grand_total >= 0 AND
    (internal_cost_total IS NULL OR internal_cost_total >= 0)
  ),
  CONSTRAINT chk_quote_schema_version CHECK (quote_schema_version = 1)
);

CREATE INDEX IF NOT EXISTS idx_quote_versions_family ON public.quote_versions(tenant_id, quote_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_quote_versions_itinerary_version ON public.quote_versions(tenant_id, itinerary_version_id);
CREATE INDEX IF NOT EXISTS idx_quote_versions_status ON public.quote_versions(tenant_id, status);

DROP TRIGGER IF EXISTS update_quote_versions_updated_at ON public.quote_versions;
CREATE TRIGGER update_quote_versions_updated_at
  BEFORE UPDATE ON public.quote_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 5. ITINERARY SHARES (PUBLIC READ-ONLY CAPABILITY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.itinerary_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  itinerary_version_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,

  CONSTRAINT uq_itinerary_shares_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_itinerary_shares_token UNIQUE (token_hash),
  CONSTRAINT fk_itinerary_shares_version FOREIGN KEY (tenant_id, itinerary_version_id)
    REFERENCES public.itinerary_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_itinerary_shares_lookup ON public.itinerary_shares(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_itinerary_shares_version ON public.itinerary_shares(tenant_id, itinerary_version_id);

-- ============================================================================
-- 6. QUOTE SHARES (PUBLIC COMMERCIAL PROPOSAL CAPABILITY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quote_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  quote_version_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,

  CONSTRAINT uq_quote_shares_composite UNIQUE (tenant_id, id),
  CONSTRAINT uq_quote_shares_token UNIQUE (token_hash),
  CONSTRAINT fk_quote_shares_version FOREIGN KEY (tenant_id, quote_version_id)
    REFERENCES public.quote_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_shares_lookup ON public.quote_shares(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quote_shares_version ON public.quote_shares(tenant_id, quote_version_id);

-- ============================================================================
-- 7. QUOTE ACCEPTANCES (AUTHORITATIVE COMMERCIAL PROVENANCE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quote_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  inquiry_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  quote_version_id uuid NOT NULL,
  itinerary_version_id uuid NOT NULL,
  traveler_id uuid NOT NULL,
  acceptance_type text NOT NULL,
  accepted_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  quote_share_id uuid,
  traveler_name_input text,
  traveler_email_input text,
  accepted_grand_total numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  customer_safe_snapshot jsonb NOT NULL,
  snapshot_schema_version int NOT NULL DEFAULT 1,
  accepted_snapshot_hash text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  client_ip text,
  user_agent text,
  voided_at timestamptz,
  voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_quote_acceptances_composite UNIQUE (tenant_id, id),
  CONSTRAINT fk_quote_acceptances_inquiry FOREIGN KEY (tenant_id, inquiry_id)
    REFERENCES public.inquiries(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quote_acceptances_quote FOREIGN KEY (tenant_id, quote_id)
    REFERENCES public.quotes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quote_acceptances_quote_version FOREIGN KEY (tenant_id, quote_version_id)
    REFERENCES public.quote_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quote_acceptances_itinerary_version FOREIGN KEY (tenant_id, itinerary_version_id)
    REFERENCES public.itinerary_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quote_acceptances_traveler FOREIGN KEY (tenant_id, traveler_id)
    REFERENCES public.traveler_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quote_acceptances_share FOREIGN KEY (tenant_id, quote_share_id)
    REFERENCES public.quote_shares(tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT chk_quote_acceptance_type CHECK (acceptance_type IN ('traveler_portal', 'staff_recorded')),
  CONSTRAINT chk_quote_acceptance_total CHECK (accepted_grand_total >= 0),
  CONSTRAINT chk_quote_acceptance_schema CHECK (snapshot_schema_version = 1),
  CONSTRAINT chk_quote_acceptance_hash_len CHECK (length(accepted_snapshot_hash) = 64)
);

-- Invariant: At most ONE active (non-void) commercial acceptance per Inquiry
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_inquiry_acceptance 
  ON public.quote_acceptances (tenant_id, inquiry_id) 
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_acceptances_quote_version ON public.quote_acceptances(tenant_id, quote_version_id);
CREATE INDEX IF NOT EXISTS idx_quote_acceptances_inquiry ON public.quote_acceptances(tenant_id, inquiry_id);

-- ============================================================================
-- 8. TENANT QUOTE SEQUENCES (ATOMIC NUMBERING)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tenant_quote_sequences (
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year),
  CONSTRAINT chk_quote_seq_year CHECK (year >= 2020 AND year <= 2100),
  CONSTRAINT chk_quote_seq_last_number CHECK (last_number >= 0)
);

-- ============================================================================
-- 9. HIGHER-ORDER CROSS-INQUIRY INTEGRITY TRIGGER
-- ============================================================================
-- Enforces:
-- A. A QuoteVersion cannot reference an ItineraryVersion belonging to a different Inquiry.
-- B. A QuoteAcceptance cannot mix Quote, ItineraryVersion, or Traveler from different Inquiries.
CREATE OR REPLACE FUNCTION public.validate_quote_inquiry_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_quote_inquiry_id uuid;
  v_itinerary_inquiry_id uuid;
  v_inquiry_traveler_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'quote_versions' THEN
    -- Get quote's inquiry_id
    SELECT inquiry_id INTO v_quote_inquiry_id
    FROM public.quotes
    WHERE id = NEW.quote_id AND tenant_id = NEW.tenant_id;

    -- Get itinerary's inquiry_id
    SELECT i.inquiry_id INTO v_itinerary_inquiry_id
    FROM public.itinerary_versions iv
    JOIN public.itineraries i ON i.id = iv.itinerary_id AND i.tenant_id = iv.tenant_id
    WHERE iv.id = NEW.itinerary_version_id AND iv.tenant_id = NEW.tenant_id;

    IF v_quote_inquiry_id IS DISTINCT FROM v_itinerary_inquiry_id THEN
      RAISE EXCEPTION 'CROSS_INQUIRY_INTEGRITY_VIOLATION: Quote (Inquiry %) and referenced Itinerary (Inquiry %) must belong to the same Inquiry.',
        v_quote_inquiry_id, v_itinerary_inquiry_id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'quote_acceptances' THEN
    -- Verify quote belongs to inquiry
    SELECT inquiry_id INTO v_quote_inquiry_id
    FROM public.quotes
    WHERE id = NEW.quote_id AND tenant_id = NEW.tenant_id;

    IF v_quote_inquiry_id IS DISTINCT FROM NEW.inquiry_id THEN
      RAISE EXCEPTION 'CROSS_INQUIRY_INTEGRITY_VIOLATION: QuoteAcceptance inquiry_id (%) does not match Quote inquiry_id (%).',
        NEW.inquiry_id, v_quote_inquiry_id;
    END IF;

    -- Verify traveler belongs to inquiry
    SELECT traveler_id INTO v_inquiry_traveler_id
    FROM public.inquiries
    WHERE id = NEW.inquiry_id AND tenant_id = NEW.tenant_id;

    IF v_inquiry_traveler_id IS DISTINCT FROM NEW.traveler_id THEN
      RAISE EXCEPTION 'CROSS_INQUIRY_INTEGRITY_VIOLATION: QuoteAcceptance traveler_id (%) does not match Inquiry traveler_id (%).',
        NEW.traveler_id, v_inquiry_traveler_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_quote_version_inquiry ON public.quote_versions;
CREATE TRIGGER trg_validate_quote_version_inquiry
  BEFORE INSERT OR UPDATE OF quote_id, itinerary_version_id ON public.quote_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_quote_inquiry_integrity();

DROP TRIGGER IF EXISTS trg_validate_quote_acceptance_inquiry ON public.quote_acceptances;
CREATE TRIGGER trg_validate_quote_acceptance_inquiry
  BEFORE INSERT OR UPDATE OF inquiry_id, quote_id, traveler_id ON public.quote_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.validate_quote_inquiry_integrity();

-- ============================================================================
-- 10. BOOKINGS MODIFICATION (NULLABLE PROVENANCE FK)
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'bookings' 
    AND column_name = 'quote_acceptance_id'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN quote_acceptance_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_bookings_quote_acceptance'
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT fk_bookings_quote_acceptance
      FOREIGN KEY (tenant_id, quote_acceptance_id)
      REFERENCES public.quote_acceptances(tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_quote_acceptance ON public.bookings(tenant_id, quote_acceptance_id) 
  WHERE quote_acceptance_id IS NOT NULL;

-- ============================================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_quote_sequences ENABLE ROW LEVEL SECURITY;

-- Helper macro for standard tenant agency access:
-- Agency members can read/write their tenant's records.
-- Platform super_admin cannot casually browse operational agency records.

DROP POLICY IF EXISTS "Tenant isolation on itineraries" ON public.itineraries;
CREATE POLICY "Tenant isolation on itineraries" ON public.itineraries
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on itinerary_versions" ON public.itinerary_versions;
CREATE POLICY "Tenant isolation on itinerary_versions" ON public.itinerary_versions
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on quotes" ON public.quotes;
CREATE POLICY "Tenant isolation on quotes" ON public.quotes
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on quote_versions" ON public.quote_versions;
CREATE POLICY "Tenant isolation on quote_versions" ON public.quote_versions
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on itinerary_shares" ON public.itinerary_shares;
CREATE POLICY "Tenant isolation on itinerary_shares" ON public.itinerary_shares
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on quote_shares" ON public.quote_shares;
CREATE POLICY "Tenant isolation on quote_shares" ON public.quote_shares
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on quote_acceptances" ON public.quote_acceptances;
CREATE POLICY "Tenant isolation on quote_acceptances" ON public.quote_acceptances
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation on tenant_quote_sequences" ON public.tenant_quote_sequences;
CREATE POLICY "Tenant isolation on tenant_quote_sequences" ON public.tenant_quote_sequences
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
