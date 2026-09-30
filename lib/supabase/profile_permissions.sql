-- Apply once in the Supabase SQL Editor for an existing database.
-- Profile rows are created by the signup trigger. Signed-in users may edit
-- their preferences, while premium status and fetch counters remain server-only.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';
ALTER TABLE public.user_news_feed ADD COLUMN IF NOT EXISTS ai_key_points JSONB DEFAULT '[]'::jsonb;

REVOKE INSERT, UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (interests, lang, country) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

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
