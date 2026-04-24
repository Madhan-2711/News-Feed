-- ============================================================
-- NEWS FEED — Supabase Database Migration
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Profiles table (auto-created on signup via trigger)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  interests JSONB DEFAULT '{"career": "", "sports": "", "finance": ""}'::jsonb,
  last_fetch TIMESTAMPTZ,
  daily_fetch_count INT DEFAULT 0,
  fetch_reset_date DATE,
  is_premium BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily article cache
CREATE TABLE IF NOT EXISTS daily_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  full_text TEXT,
  source TEXT,
  source_url TEXT UNIQUE,
  image_url TEXT,
  is_global BOOLEAN DEFAULT false,
  category TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  -- Universal AI cache columns (shared across all users)
  ai_summary TEXT,
  cluster VARCHAR(100)
);

-- User-specific news feed with AI rationale
CREATE TABLE IF NOT EXISTS user_news_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  article_id UUID REFERENCES daily_cache(id) ON DELETE CASCADE,
  ai_rationale TEXT,
  ai_summary TEXT,
  cluster VARCHAR(100),
  score FLOAT4 DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, article_id)
);

-- ── Row Level Security ─────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_news_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_cache ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Daily cache policies (readable by all authenticated users)
CREATE POLICY "Authenticated can read daily_cache"
  ON daily_cache FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "Service role can manage daily_cache"
  ON daily_cache FOR ALL USING (auth.role() = 'service_role');

-- User news feed policies
CREATE POLICY "Users can read own feed"
  ON user_news_feed FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage feed"
  ON user_news_feed FOR ALL USING (auth.role() = 'service_role');

-- ── Auto-create profile trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'email');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_daily_cache_fetched ON daily_cache(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_cache_global ON daily_cache(is_global) WHERE is_global = true;
CREATE INDEX IF NOT EXISTS idx_user_feed_user ON user_news_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feed_created ON user_news_feed(created_at DESC);

-- ── Article click tracking (for AI personalization) ─────────────
-- Stores which articles each user has opened — used to improve feed ranking.
CREATE TABLE IF NOT EXISTS article_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  article_id UUID REFERENCES daily_cache(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE article_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own clicks"
  ON article_clicks FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can read clicks"
  ON article_clicks FOR SELECT USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_clicks_user_time ON article_clicks(user_id, clicked_at DESC);

-- ── Migrations for existing databases ────────────────────────────
-- Run these in Supabase SQL Editor if tables already exist:
ALTER TABLE daily_cache ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE daily_cache ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE daily_cache ADD COLUMN IF NOT EXISTS cluster VARCHAR(100);

ALTER TABLE user_news_feed ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE user_news_feed ADD COLUMN IF NOT EXISTS cluster VARCHAR(100);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_fetch_count INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fetch_reset_date DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_brief TEXT;
