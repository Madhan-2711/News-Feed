import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// Called daily at 4 AM UTC (Vercel cron and Supabase pg_cron).
// Deletes cached articles older than 48h, and topics nobody has requested
// for a week (so the ingest job stops tracking them).

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // 1. Delete old daily_cache entries
    const { count: cacheDeleted, error: cleanupError } = await serviceClient
      .from('daily_cache')
      .delete({ count: 'exact' })
      .lt('fetched_at', cutoff);
    if (cleanupError) throw cleanupError;

    // user_news_feed, article_clicks and article_topics reference daily_cache
    // with ON DELETE CASCADE.
    console.log(`[cleanup] Cache: ${cacheDeleted || 0} deleted`);

    // 2. Stop tracking topics nobody has asked for in a week
    const topicCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: topicsDeleted, error: topicError } = await serviceClient
      .from('topic_refresh')
      .delete({ count: 'exact' })
      .lt('last_requested_at', topicCutoff);
    if (topicError) console.error('[cleanup] Topic cleanup failed:', topicError.message);

    return NextResponse.json({
      success: true,
      cacheDeleted: cacheDeleted || 0,
      topicsDeleted: topicsDeleted || 0,
      cutoff,
    });
  } catch (error) {
    console.error('Cleanup error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
