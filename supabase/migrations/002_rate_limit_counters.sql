-- ====================================================================
-- Migration 002: Rate Limit Counters
-- ====================================================================
-- Creates the rate_limit_counters table and atomic rate_limit_hit() function.
-- Run on: Fresh install or existing DB without this table.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  hit_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key TEXT, p_window_ms BIGINT)
RETURNS TABLE(hit_count BIGINT, reset_at BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count BIGINT;
BEGIN
  v_window_start := NOW() - (p_window_ms || ' milliseconds')::INTERVAL;

  INSERT INTO public.rate_limit_counters (key, hit_count, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE SET
    hit_count = CASE
      WHEN rate_limit_counters.window_start < v_window_start THEN 1
      ELSE rate_limit_counters.hit_count + 1
    END,
    window_start = CASE
      WHEN rate_limit_counters.window_start < v_window_start THEN NOW()
      ELSE rate_limit_counters.window_start
    END;

  SELECT r.hit_count, EXTRACT(EPOCH FROM r.window_start) * 1000 + p_window_ms
  INTO v_count, reset_at
  FROM public.rate_limit_counters r
  WHERE r.key = p_key;

  hit_count := v_count;
  RETURN NEXT;
END;
$$;
