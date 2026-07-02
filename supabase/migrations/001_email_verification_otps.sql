-- ====================================================================
-- Migration 001: Email Verification OTPs
-- ====================================================================
-- Creates the email_verification_otps table for storing verification codes.
-- Run on: Fresh install or existing DB without this table.

CREATE TABLE IF NOT EXISTS public.email_verification_otps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_otps_email_otp
  ON public.email_verification_otps(email, otp, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_otps_token
  ON public.email_verification_otps(token, used, expires_at);
