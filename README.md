This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Supabase profile permissions

For an existing Supabase database, run [`lib/supabase/profile_permissions.sql`](lib/supabase/profile_permissions.sql) in the Supabase SQL Editor before deploying the setup-page update. It restricts signed-in users to editing their interests, language, and country; premium status and fetch counters remain server-managed. It also adds the article key-points column if needed. Deploying the app alone does not change database grants.

## Scheduled cleanup

Set `CRON_SECRET` in the Vercel project environment before deploying. Vercel sends it to `/api/cleanup` as a bearer token; cleanup and `/api/check-keys` return 401 without it. The personalized feed refreshes when a signed-in user opens the app or presses Refresh Feed. The previous `/api/process-news` cron entry was removed because Vercel calls cron routes with GET while that endpoint requires a signed-in POST request.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
