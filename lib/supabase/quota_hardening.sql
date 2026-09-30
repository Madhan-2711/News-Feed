-- Run in the Supabase SQL Editor for an existing database. Safe to rerun.
-- Makes the daily limits atomic, adds the Ask AI daily limit counters, and
-- adds the user_news_feed unique constraint that older databases lack.
-- The app keeps working before this runs (it falls back to a non-atomic
-- check), so deploy order does not matter.
BEGIN;

-- ── Ask AI counters ─────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_query_count INT DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_query_reset_date DATE;

-- ── Atomic quota functions ──────────────────────────────────────
-- Each consume function increments the counter in one UPDATE, and only
-- when the user is premium, on a new UTC day, or under the limit. The row
-- lock serializes parallel requests, so the limit cannot be exceeded.
CREATE OR REPLACE FUNCTION public.consume_fetch_quota(p_user uuid, p_limit int)
RETURNS TABLE (allowed boolean, used int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_used  int;
BEGIN
  UPDATE public.profiles p
  SET daily_fetch_count = CASE WHEN p.fetch_reset_date = v_today
                               THEN COALESCE(p.daily_fetch_count, 0) + 1 ELSE 1 END,
      fetch_reset_date  = v_today
  WHERE p.id = p_user
    AND (p.is_premium IS TRUE
         OR p.fetch_reset_date IS DISTINCT FROM v_today
         OR COALESCE(p.daily_fetch_count, 0) < p_limit)
  RETURNING p.daily_fetch_count INTO v_used;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_used;
  ELSE
    RETURN QUERY SELECT false, COALESCE((
      SELECT CASE WHEN fetch_reset_date = v_today THEN daily_fetch_count ELSE 0 END
      FROM public.profiles WHERE id = p_user), 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_user uuid, p_limit int)
RETURNS TABLE (allowed boolean, used int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_used  int;
BEGIN
  UPDATE public.profiles p
  SET ai_query_count      = CASE WHEN p.ai_query_reset_date = v_today
                                 THEN COALESCE(p.ai_query_count, 0) + 1 ELSE 1 END,
      ai_query_reset_date = v_today
  WHERE p.id = p_user
    AND (p.is_premium IS TRUE
         OR p.ai_query_reset_date IS DISTINCT FROM v_today
         OR COALESCE(p.ai_query_count, 0) < p_limit)
  RETURNING p.ai_query_count INTO v_used;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_used;
  ELSE
    RETURN QUERY SELECT false, COALESCE((
      SELECT CASE WHEN ai_query_reset_date = v_today THEN ai_query_count ELSE 0 END
      FROM public.profiles WHERE id = p_user), 0);
  END IF;
END;
$$;

-- Refunds undo one consume after a failed run, never going below zero.
CREATE OR REPLACE FUNCTION public.refund_fetch_quota(p_user uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.profiles
  SET daily_fetch_count = GREATEST(COALESCE(daily_fetch_count, 0) - 1, 0)
  WHERE id = p_user AND fetch_reset_date = (now() AT TIME ZONE 'utc')::date;
$$;

CREATE OR REPLACE FUNCTION public.refund_ai_quota(p_user uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.profiles
  SET ai_query_count = GREATEST(COALESCE(ai_query_count, 0) - 1, 0)
  WHERE id = p_user AND ai_query_reset_date = (now() AT TIME ZONE 'utc')::date;
$$;

-- Only the server (service role) may call these; users must not reset
-- or spend each other's quota.
REVOKE ALL ON FUNCTION public.consume_fetch_quota(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, int)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_fetch_quota(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_ai_quota(uuid)          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_fetch_quota(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(uuid, int)    TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_fetch_quota(uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_ai_quota(uuid)          TO service_role;

-- ── user_news_feed unique constraint ────────────────────────────
-- Remove duplicate rows (keeping one per user/article), then add the
-- constraint that migrations.sql declares but older databases lack.
DELETE FROM public.user_news_feed a
USING public.user_news_feed b
WHERE a.user_id = b.user_id
  AND a.article_id = b.article_id
  AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_news_feed'::regclass
      AND conname = 'user_news_feed_user_id_article_id_key'
  ) THEN
    ALTER TABLE public.user_news_feed
      ADD CONSTRAINT user_news_feed_user_id_article_id_key UNIQUE (user_id, article_id);
  END IF;
END $$;

COMMIT;
