-- Run in the Supabase SQL Editor for an existing database. Safe to rerun.
-- Keep the currently deployed setup page's upsert working during rollout.
-- Clients can write only profile identity and preference columns; premium
-- status and fetch counters remain server-only.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';
ALTER TABLE public.user_news_feed ADD COLUMN IF NOT EXISTS ai_key_points JSONB DEFAULT '[]'::jsonb;

REVOKE INSERT, UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, email, interests, lang, country) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (id, email, interests, lang, country) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.profiles', 'is_premium', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'daily_fetch_count', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'fetch_reset_date', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'last_fetch', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'is_premium', 'INSERT') THEN
    RAISE EXCEPTION 'Profile privilege restriction did not take effect';
  END IF;
END $$;

COMMIT;
