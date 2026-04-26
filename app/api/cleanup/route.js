import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// Called by Vercel cron daily at 4 AM UTC.
// Cleans stale articles from daily_cache (older than 48h)
// and orphaned user_news_feed entries.

export async function GET() {
  try {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // 1. Delete old daily_cache entries
    const { count: cacheDeleted } = await serviceClient
      .from('daily_cache')
      .delete({ count: 'exact' })
      .lt('fetched_at', cutoff);

    // 2. Delete orphaned user_news_feed entries (article no longer in cache)
    // These are feed rows whose article was just cleaned up
    const { data: validArticles } = await serviceClient
      .from('daily_cache')
      .select('id');

    if (validArticles) {
      const validIds = new Set(validArticles.map(a => a.id));

      const { data: feedRows } = await serviceClient
        .from('user_news_feed')
        .select('id, article_id');

      if (feedRows) {
        const orphanIds = feedRows
          .filter(f => !validIds.has(f.article_id))
          .map(f => f.id);

        if (orphanIds.length > 0) {
          await serviceClient
            .from('user_news_feed')
            .delete()
            .in('id', orphanIds);
        }

        console.log(`[cleanup] Cache: ${cacheDeleted || 0} deleted | Feed orphans: ${orphanIds.length} deleted`);
      }
    }

    return NextResponse.json({
      success: true,
      cacheDeleted: cacheDeleted || 0,
      cutoff,
    });
  } catch (error) {
    console.error('Cleanup error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
