-- ====================================================================
-- Migration 007: Add resend_from_email to settings
-- ====================================================================

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS resend_from_email TEXT;
