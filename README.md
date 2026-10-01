# News Feed

A personalized news reader built with Next.js and Supabase. Users sign in with Google, pick up to 5 topics plus a language and country, and get a feed of about 20 articles ranked for them. Each article has an **Ask AI** panel that answers questions about it.

## How it works

News is collected into a **shared cache** in the background. Fetch News reads from that cache instead of calling news APIs, so it's fast and doesn't hit rate limits.

- **Collection (`/api/ingest`, every 15 minutes):** refreshes the topics users have asked for in the last 3 days, stalest first, so each topic is refreshed about hourly. Only new articles are inserted.
  - **Every run:** Google News RSS search (topics grouped 3 per request, then split back by keywords) and publisher RSS feeds (BBC, The Hindu, Indian Express, Mint, The Verge, GameSpot, etc.). Spaceflight News covers Science and Hacker News covers Tech. None of these need an API key.
  - **Every ~3 hours per topic:** the Guardian (full article text) and NewsData.
- **Fetch News (`/api/process-news`):** registers the user's topics, reads their cached articles from the last 36 hours, and ranks them.
- **Niche topics:** if a topic isn't in the cache yet (e.g. a custom keyword nobody has used before), Fetch News searches it on demand. It tries Google News first, then APITube, Guardian and NewsData. The results are cached and the topic joins the hourly collection.
- **Ranking (`lib/rank.js`, `lib/scoring.js`):** each article is scored on how it matches your topics, its recency, source quality and your click history.
  - Matches are graded: headline > description > a topic search returned it.
  - Near-duplicate stories are merged.
  - The feed takes turns between your topics, with at most 6 stories per cluster.
  - Articles you've opened in the last week are hidden.
- **Shared API budgets:** keyed APIs are capped per day across all users (`lib/budget.js`): APITube 90, Guardian 450, NewsData 180, each under its free limit.
- **Home page:** headlines come from Google News top stories and section feeds.
- **Ask AI:** short articles are scraped in full with Firecrawl (not possible for Google News links), then answered by a rotating pool of OpenRouter, Groq and OpenAI (`lib/ai.js`).
- **Limits:** free users get 10 feed refreshes and 10 Ask AI questions per day (`lib/limits.js`). Premium users are unlimited.

## Environment variables

Set these in `.env.local` for local development and in your host's project settings for deploys.

| Variable | Required | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase browser key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side writes (cache, feed, quotas) |
| `CRON_SECRET` | Yes, when deployed | Protects `/api/ingest`, `/api/cleanup` and `/api/check-keys` |
| `GUARDIAN_API_KEY` | Recommended | Guardian (full text); free key is non-commercial, 500/day |
| `APITUBE_API_KEY` | Recommended | On-demand searches for niche topics; free plan 100/day |
| `NEWSDATA_API_KEY` | Optional | NewsData; free plan 200/day, 12h delay |
| `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` | At least one | Ask AI answers |
| `FIRECRAWL_API_KEY` | Optional | Full-text scraping for Ask AI |

Google News RSS and the publisher feeds need no keys. Google intends its RSS feeds for personal, non-commercial use.

## Database setup

Run these in the Supabase SQL Editor, in order. All are safe to rerun.

1. `lib/supabase/migrations.sql`: tables, row-level security and the signup trigger. It can be skipped for an existing database.
2. `lib/supabase/profile_permissions.sql`: limits which profile columns users can write, so premium status and counters stay server-only.
3. `lib/supabase/quota_hardening.sql`: atomic daily limits, Ask AI counters, and the `user_news_feed` unique constraint.
4. `lib/supabase/news_cache.sql`: the shared cache tables (`topic_refresh`, `article_topics`) and API budgets. **Fetch News needs this.**
5. `lib/supabase/news_cache_cron.sql`, **after deploying**: schedules collection every 15 minutes and cleanup daily with `pg_cron`. First enable the `pg_cron` and `pg_net` extensions (Database → Extensions), then fill in your site URL and `CRON_SECRET`. They're stored in Supabase Vault.

## Hosting

The app deploys on **Vercel** (current) or **Netlify** (`netlify.toml`).

- **Scheduling:** Vercel's free plan only allows daily crons, so Supabase `pg_cron` calls `/api/ingest` every 15 minutes and `/api/cleanup` daily. This works on either host. `vercel.json` also runs cleanup daily on Vercel; a second run is harmless.
- **Cleanup:** deletes cached articles older than 48 hours and topics nobody has requested for a week.

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests (node --test)
npm run build   # production build
```

To fill the cache locally, call the ingest job with your `CRON_SECRET`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/ingest
```

This project uses Next.js 16, which changes some APIs; for example, `proxy.js` replaces `middleware.js`. See `AGENTS.md`.
