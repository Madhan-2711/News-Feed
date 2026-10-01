import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { refreshTopics } from '@/lib/collect';

// Called every 15 minutes by Supabase pg_cron (lib/supabase/news_cache_cron.sql).
// Refreshes the topics users have asked for recently, stalest first, so
// each one is refreshed about hourly. Only new articles are inserted.

export const maxDuration = 60;

const REFRESH_EVERY_MINUTES = 60;
const ACTIVE_FOR_DAYS = 3;      // stop collecting topics nobody has requested
const TOPICS_PER_RUN = 9;       // 3 grouped searches
const TIME_BUDGET_MS = 45000;   // stop starting new groups before the 60s limit

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const db = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const staleBefore = new Date(Date.now() - REFRESH_EVERY_MINUTES * 60000).toISOString();
    const activeSince = new Date(Date.now() - ACTIVE_FOR_DAYS * 86400000).toISOString();

    const { data: due, error } = await db
      .from('topic_refresh')
      .select('topic_key, topic, country, lang, article_count, last_refreshed_at, last_deep_refresh_at')
      .gte('last_requested_at', activeSince)
      .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${staleBefore}`)
      .order('last_refreshed_at', { ascending: true, nullsFirst: true })
      .limit(TOPICS_PER_RUN);
    if (error) throw error;

    if (!due?.length) {
      return NextResponse.json({ success: true, refreshed: 0, message: 'No topics due' });
    }

    const { refreshed, tagged } = await refreshTopics(db, due, {
      deadline: startedAt + TIME_BUDGET_MS,
    });

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[ingest] Refreshed ${refreshed.length}/${due.length} topics in ${seconds}s`, tagged);
    return NextResponse.json({ success: true, refreshed: refreshed.length, due: due.length, tagged, seconds });
  } catch (error) {
    console.error('[ingest] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
