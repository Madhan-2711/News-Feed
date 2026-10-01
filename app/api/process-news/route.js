import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { buildBrief } from '@/lib/scoring';
import { rankFeed } from '@/lib/rank';
import { registerTopics, loadFeedCandidates, fillThinTopics } from '@/lib/feedCandidates';
import { consumeQuota, refundQuota } from '@/lib/quota';
import { FREE_DAILY_FETCHES } from '@/lib/limits';
import { sanitizeLang, sanitizeCountry } from '@/lib/locale';

// Reads from the shared news cache, so most fetches take a few seconds.
// Topics the cache doesn't cover yet are searched on demand (bounded),
// which keeps the worst case well under the 60s function limit.
export const maxDuration = 60;

const FEED_SIZE = 20;
const READ_HIDDEN_FOR_DAYS = 7;

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Behavioral profile from click history ──────────────────────────
function buildBehaviorProfile(clicks) {
  if (!clicks || clicks.length === 0) {
    return { profileText: null, topTopics: [], topClusters: [], recentTitles: [], hasHistory: false };
  }

  const clusterCount = {};
  const recentTitles = [];

  for (const click of clicks) {
    const cluster = click.user_news_feed?.cluster || click.daily_cache?.category || null;
    const title   = click.daily_cache?.title || null;
    if (cluster) clusterCount[cluster] = (clusterCount[cluster] || 0) + 1;
    if (title) recentTitles.push(title);
  }

  const sorted = Object.entries(clusterCount).sort(([, a], [, b]) => b - a);
  const total  = sorted.reduce((s, [, c]) => s + c, 0);

  const topicsText = sorted
    .slice(0, 6)
    .map(([name, count]) => `${name} (${Math.round((count / total) * 100)}%)`)
    .join(', ');

  const profileText = sorted.length > 0
    ? `Based on reading history (${clicks.length} articles read): ${topicsText}`
    : null;

  console.log(`[behavior] Profile from ${clicks.length} clicks: ${topicsText || 'none'}`);

  return {
    profileText,
    topTopics: sorted.slice(0, 5).map(([name]) => name),
    topClusters: sorted.slice(0, 5).map(([name]) => name),
    recentTitles: recentTitles.slice(0, 20),
    hasHistory: clicks.length >= 3,
  };
}

// Recent clicks: cluster history for the behaviour boost, and the ids of
// articles the user has already opened (hidden from the new feed).
async function loadClickHistory(db, userId) {
  try {
    const { data: clicks } = await db
      .from('article_clicks')
      .select('clicked_at, daily_cache ( title, category ), article_id')
      .eq('user_id', userId)
      .order('clicked_at', { ascending: false })
      .limit(30);
    if (!clicks?.length) return { clickRows: [], readIds: new Set() };

    const articleIds = clicks.map(c => c.article_id).filter(Boolean);
    const { data: feedRows } = await db
      .from('user_news_feed')
      .select('article_id, cluster')
      .eq('user_id', userId)
      .in('article_id', articleIds);

    const clusterById = {};
    (feedRows || []).forEach(r => { clusterById[r.article_id] = r.cluster; });

    const hideSince = Date.now() - READ_HIDDEN_FOR_DAYS * 86400000;
    return {
      clickRows: clicks.map(c => ({ ...c, user_news_feed: { cluster: clusterById[c.article_id] || null } })),
      readIds: new Set(clicks.filter(c => new Date(c.clicked_at).getTime() > hideSince).map(c => c.article_id)),
    };
  } catch {
    return { clickRows: [], readIds: new Set() };
  }
}

// Save the feed. Updates rows for articles already in it and inserts the
// rest rather than upserting, so it works with or without the
// (user_id, article_id) unique constraint.
async function saveFeed(db, userId, entries) {
  const { data: existingRows, error: existingErr } = await db
    .from('user_news_feed')
    .select('id, article_id')
    .eq('user_id', userId);
  if (existingErr) throw existingErr;

  const keepArticleIds = new Set(entries.map(entry => entry.article_id));
  const existingIdByArticle = {};
  const staleRowIds = [];
  for (const row of existingRows || []) {
    // Old articles and duplicate rows for the same article are removed
    if (!keepArticleIds.has(row.article_id) || existingIdByArticle[row.article_id]) {
      staleRowIds.push(row.id);
    } else {
      existingIdByArticle[row.article_id] = row.id;
    }
  }

  const newEntries = entries.filter(entry => !existingIdByArticle[entry.article_id]);
  if (newEntries.length > 0) {
    const { error: insertErr } = await db.from('user_news_feed').insert(newEntries);
    if (insertErr) throw insertErr;
  }

  const updates = await Promise.all(
    entries
      .filter(entry => existingIdByArticle[entry.article_id])
      .map(entry => db.from('user_news_feed').update(entry).eq('id', existingIdByArticle[entry.article_id]))
  );
  const updateErr = updates.find(result => result.error)?.error;
  if (updateErr) throw updateErr;

  // Remove old entries only after the replacement entries are safely stored.
  if (staleRowIds.length > 0) {
    const { error: staleErr } = await db.from('user_news_feed').delete().in('id', staleRowIds);
    if (staleErr) throw staleErr;
  }
}

// ── Main pipeline ──────────────────────────────────────────────────
export async function POST() {
  // Set once a fetch is spent; the finally block refunds it unless the run succeeds.
  let refund = null;
  let succeeded = false;

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const serviceClient = getServiceClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('interests, lang, country, is_premium')
      .eq('id', user.id)
      .single();
    const isPremium = profile?.is_premium === true;

    // ── Rate limit ─────────────────────────────────────────────────
    // Spend the fetch before doing any work, atomically, so parallel
    // requests can't all pass the check.
    const quota = await consumeQuota(serviceClient, user.id, 'fetch');
    if (!quota.allowed) {
      const todayUTC = new Date().toISOString().split('T')[0];
      return NextResponse.json({
        error: 'Daily limit reached',
        message: `You've used all ${FREE_DAILY_FETCHES} of your daily fetches. Come back tomorrow for fresh news!`,
        limit: quota.limit,
        used: quota.used,
        resetsAt: `${todayUTC}T23:59:59Z`,
      }, { status: 429 });
    }
    refund = () => refundQuota(serviceClient, user.id, 'fetch');

    const interests = Object.entries(profile?.interests || {})
      .filter(([k, v]) => k.startsWith('topic_') && v)
      .map(([, v]) => v);
    if (!interests.length) {
      return NextResponse.json({ error: 'Pick at least one topic first' }, { status: 400 });
    }
    // Profile values are user-editable; only use known codes.
    const lang    = sanitizeLang(profile?.lang);
    const country = sanitizeCountry(profile?.country);

    // ── Step 1: Topics → cache candidates ──────────────────────────
    // Registering marks the topics as wanted, so the hourly job keeps them fresh.
    const topicRows = await registerTopics(serviceClient, interests, country, lang);
    let { candidates, countByKey } = await loadFeedCandidates(serviceClient, topicRows);

    // Topics the cache doesn't cover yet (new or niche keywords) are
    // searched now, including keyed APIs, then read back from the cache.
    const searched = await fillThinTopics(serviceClient, topicRows, countByKey);
    if (searched.length) ({ candidates, countByKey } = await loadFeedCandidates(serviceClient, topicRows));
    console.log(`[process-news] ${candidates.length} candidates`, countByKey);

    // ── Step 2: Rank ───────────────────────────────────────────────
    const { clickRows, readIds } = await loadClickHistory(serviceClient, user.id);
    const behavior = buildBehaviorProfile(clickRows);
    const ranked = rankFeed(candidates, interests, {
      readIds,
      behaviorClusters: behavior.topClusters,
      limit: FEED_SIZE,
    });

    if (ranked.length === 0) {
      return NextResponse.json({ error: 'No relevant articles found' }, { status: 404 });
    }
    console.log(
      `[process-news] Top ${ranked.length} selected ` +
      `(scores: ${ranked[0].score.toFixed(2)} → ${ranked[ranked.length - 1].score.toFixed(2)})`
    );

    // ── Step 3: Save the feed ──────────────────────────────────────
    const entries = ranked.map(e => ({
      user_id:      user.id,
      article_id:   e.article.id,
      ai_rationale: e.rationale,
      ai_summary:   e.summary,
      cluster:      e.cluster,
      score:        e.score,
    }));
    await saveFeed(serviceClient, user.id, entries);

    // ── Step 4: Daily brief (template-based) ───────────────────────
    try {
      const top = ranked.slice(0, 10);
      const brief = buildBrief(top.map(e => ({ title: e.article.title })), top.map(e => e.cluster));
      if (brief) {
        await serviceClient.from('profiles').update({ daily_brief: brief }).eq('id', user.id);
      }
    } catch (briefErr) {
      console.error('Daily brief error:', briefErr.message);
    }

    // ── Step 5: Record the fetch time ──────────────────────────────
    // The quota was already spent before fetching. The feed is saved now, so a
    // failure here is logged rather than failing (and refunding) the run.
    const { error: lastFetchErr } = await serviceClient
      .from('profiles')
      .update({ last_fetch: new Date().toISOString() })
      .eq('id', user.id);
    if (lastFetchErr) console.error('last_fetch update error:', lastFetchErr.message);

    const sourceTally = ranked.reduce((acc, e) => {
      const tag = e.article.source_tag || 'unknown';
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {});

    succeeded = true;
    return NextResponse.json({
      success: true,
      articlesProcessed: ranked.length,
      sources: sourceTally,
      searchedOnDemand: searched.length,
      behaviorProfile: behavior.hasHistory ? behavior.profileText : null,
      mode: 'cache',
      quota: isPremium
        ? { isPremium: true, unlimited: true }
        : { isPremium: false, used: quota.used, remaining: Math.max(0, quota.limit - quota.used), limit: quota.limit },
    });

  } catch (error) {
    console.error('Process news error:', error);
    return NextResponse.json(
      { error: 'Pipeline failed', details: error.message },
      { status: 500 }
    );
  } finally {
    // Failed or empty runs don't count toward the daily limit.
    if (refund && !succeeded) await refund();
  }
}
