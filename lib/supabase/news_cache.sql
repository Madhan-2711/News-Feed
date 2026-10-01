-- Run in the Supabase SQL Editor. Safe to rerun, and additive only:
-- the shared news cache that the hourly ingest job fills and Fetch News
-- reads from. Server-only tables (service role); users have no access.
BEGIN;

-- Which adapter collected each cached article (guardian, googlenews, rss…);
-- ranking uses it for source quality.
ALTER TABLE public.daily_cache ADD COLUMN IF NOT EXISTS source_tag TEXT;

-- ── Topics being collected ──────────────────────────────────────
-- One row per topic + country + language. Fetch News registers the
-- user's topics here; the ingest job refreshes rows that are due and
-- skips ones nobody has requested recently.
CREATE TABLE IF NOT EXISTS public.topic_refresh (
  topic_key            TEXT PRIMARY KEY,          -- lower(topic)|country|lang
  topic                TEXT NOT NULL,
  country              TEXT NOT NULL DEFAULT '',
  lang                 TEXT NOT NULL DEFAULT 'en',
  last_refreshed_at    TIMESTAMPTZ,               -- free hourly sources
  last_deep_refresh_at TIMESTAMPTZ,               -- keyed APIs (Guardian, NewsData)
  last_requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  article_count        INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topic_refresh_due
  ON public.topic_refresh (last_refreshed_at NULLS FIRST);

-- ── Which topics each cached article belongs to ─────────────────
-- relevance: 1.0 title match, 0.6 description match, 0.3 returned by a
-- topic search only. Rows go away with their article (48h cleanup) or
-- their topic.
CREATE TABLE IF NOT EXISTS public.article_topics (
  article_id UUID NOT NULL REFERENCES public.daily_cache(id) ON DELETE CASCADE,
  topic_key  TEXT NOT NULL REFERENCES public.topic_refresh(topic_key) ON DELETE CASCADE,
  relevance  REAL NOT NULL DEFAULT 0.3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_article_topics_topic
  ON public.article_topics (topic_key);

-- ── Shared API key budgets ──────────────────────────────────────
-- Keyed APIs are shared by every user and the ingest job; this counter
-- keeps their combined use under each provider's free daily limit.
CREATE TABLE IF NOT EXISTS public.api_usage (
  provider TEXT NOT NULL,
  day      DATE NOT NULL,
  count    INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);

-- Spends one call if the provider is under p_limit today (UTC).
-- Returns true when the call may go ahead.
CREATE OR REPLACE FUNCTION public.consume_api_budget(p_provider text, p_limit int)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_count int;
BEGIN
  INSERT INTO public.api_usage AS u (provider, day, count)
  VALUES (p_provider, v_today, 1)
  ON CONFLICT (provider, day)
  DO UPDATE SET count = u.count + 1
  WHERE u.count < p_limit
  RETURNING u.count INTO v_count;

  RETURN FOUND;
END;
$$;

-- ── Access: server only ─────────────────────────────────────────
ALTER TABLE public.topic_refresh  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.topic_refresh, public.article_topics, public.api_usage
  FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_api_budget(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_budget(text, int) TO service_role;

COMMIT;
