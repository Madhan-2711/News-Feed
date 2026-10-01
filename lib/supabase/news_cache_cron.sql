-- Schedules the news collection job. Run in the Supabase SQL Editor AFTER
-- the app with /api/ingest is deployed. Safe to rerun.
--
-- Before running:
--   1. Database → Extensions: enable "pg_cron" and "pg_net".
--   2. Replace the two placeholders below:
--        YOUR_SITE_URL     your deployed site, e.g. https://your-app.vercel.app
--        YOUR_CRON_SECRET  the same value as CRON_SECRET in Vercel
--      They are stored in Supabase Vault, not in this file or the job.

DO $$
DECLARE
  v_site   text := 'YOUR_SITE_URL';
  v_secret text := 'YOUR_CRON_SECRET';
BEGIN
  IF v_site LIKE 'YOUR_%' OR v_secret LIKE 'YOUR_%' THEN
    RAISE EXCEPTION 'Replace YOUR_SITE_URL and YOUR_CRON_SECRET before running';
  END IF;
  v_site := rtrim(v_site, '/');

  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'news_site_url') THEN
    PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'news_site_url'), v_site);
  ELSE
    PERFORM vault.create_secret(v_site, 'news_site_url');
  END IF;

  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'news_cron_secret') THEN
    PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'news_cron_secret'), v_secret);
  ELSE
    PERFORM vault.create_secret(v_secret, 'news_cron_secret');
  END IF;
END $$;

-- Every 15 minutes: refresh the stalest topics (each topic ≈ hourly).
-- Scheduling with an existing job name replaces that job.
SELECT cron.schedule(
  'news-ingest',
  '*/15 * * * *',
  $job$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'news_site_url') || '/api/ingest',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'news_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $job$
);

-- Daily at 04:00 UTC: delete old cached articles and unrequested topics.
-- (Vercel's cron does the same; this one also covers Netlify.)
SELECT cron.schedule(
  'news-cleanup',
  '0 4 * * *',
  $job$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'news_site_url') || '/api/cleanup',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'news_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $job$
);

-- Check it's working (run separately, after ~15 minutes):
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT status_code, left(content::text, 200), created
--     FROM net._http_response ORDER BY created DESC LIMIT 5;
-- To stop collecting:
--   SELECT cron.unschedule('news-ingest');
