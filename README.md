# News Feed

A personalized news reader built with Next.js and Supabase. Users sign in with Google, pick up to 5 topics plus a language and country, and get a feed of about 20 articles ranked for them. Each article has an **Ask AI** panel that answers questions about it.

## How it works

- **Sources:** each topic is searched on the Guardian, NewsAPI and GNews, with NewsData and RSS feeds added for background coverage (`lib/sources/`).
- **Ranking:** articles are scored on keyword relevance to your topics, recency, source quality and your click history (`lib/scoring.js`). When running locally, a MiniLM embedding model adds semantic similarity; serverless hosts skip it.
- **Ask AI:** short articles are scraped in full with Firecrawl, then answered by a rotating pool of OpenRouter, Groq and OpenAI (`lib/ai.js`).
- **Limits:** free users get 2 feed refreshes and 10 Ask AI questions per day (`lib/limits.js`). Premium users are unlimited.

## Environment variables

Set these in `.env.local` for local development and in your host's project settings for deploys.

| Variable | Required | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase browser key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side writes (feed, quotas, cache) |
| `GNEWS_API_KEYS` | Yes | Comma-separated GNews keys (`GNEWS_API_KEY` also works for a single key) |
| `GUARDIAN_API_KEY` | Recommended | Guardian source |
| `NEWSAPI_KEY` | Recommended | NewsAPI source |
| `NEWSDATA_API_KEY` | Optional | NewsData source |
| `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` | At least one | Ask AI answers |
| `FIRECRAWL_API_KEY` | Optional | Full-text scraping for Ask AI |
| `CRON_SECRET` | Yes, when deployed | Protects `/api/cleanup` and `/api/check-keys` |

## Database setup

Run these in the Supabase SQL Editor, in order. All three are safe to rerun.

1. `lib/supabase/migrations.sql`: tables, row-level security and the signup trigger. It can be skipped for an existing database.
2. `lib/supabase/profile_permissions.sql`: limits which profile columns users can write, so premium status and counters stay server-only.
3. `lib/supabase/quota_hardening.sql`: makes the daily limits atomic, adds the Ask AI counters, and adds the `user_news_feed` unique constraint that older databases lack.

Deploying the app doesn't change the database. Until step 3 has run, the app still works, but it falls back to a non-atomic limit check and doesn't limit Ask AI.

## Hosting

The app deploys on **Vercel** (current) or **Netlify** (`netlify.toml`).

- **Scheduled cleanup:** `vercel.json` runs `/api/cleanup` daily at 04:00 UTC, which deletes cached articles older than 48 hours. Vercel sends `CRON_SECRET` as a bearer token. Netlify doesn't read `vercel.json`, so on Netlify you'd need to schedule that call separately.
- **Feed refresh:** there's no cron for it. The personalized feed refreshes when a signed-in user opens the app or presses Fetch News.
- **Embeddings:** these only run locally. On Vercel and Netlify, ranking uses keywords, recency and source quality.

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests (node --test)
npm run build   # production build
```

This project uses Next.js 16, which changes some APIs; for example, `proxy.js` replaces `middleware.js`. See `AGENTS.md`.
