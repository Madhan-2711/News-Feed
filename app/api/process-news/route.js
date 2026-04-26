import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { fetchFromAllSources } from '@/lib/sources/index';
import { embedText, embedBatch } from '@/lib/embeddings';
import {
  scoreArticle, clusterArticle, extractSummary,
  generateRationale, findBestInterest, buildBrief,
} from '@/lib/scoring';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Dedup by normalized title ──────────────────────────────────────
function deduplicateArticles(items) {
  const seen = new Set();
  return items.filter((item) => {
    const normalized = (item.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
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

// ── Main pipeline ──────────────────────────────────────────────────
export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const serviceClient = getServiceClient();

    // Get user profile (premium flag + rate limit + interests)
    const { data: profile } = await supabase
      .from('profiles')
      .select('interests, lang, country, daily_fetch_count, fetch_reset_date, is_premium')
      .eq('id', user.id)
      .single();

    const isPremium = profile?.is_premium === true;

    // ── Rate limit ─────────────────────────────────────────────────
    const DAILY_LIMIT = 2;
    const todayUTC = new Date().toISOString().split('T')[0];

    if (!isPremium) {
      const lastResetDate = profile?.fetch_reset_date || null;
      const fetchCount    = lastResetDate === todayUTC ? (profile?.daily_fetch_count || 0) : 0;
      if (fetchCount >= DAILY_LIMIT) {
        return NextResponse.json({
          error: 'Daily limit reached',
          message: `You've used both your daily fetches. Come back tomorrow for fresh news!`,
          limit: DAILY_LIMIT,
          used: fetchCount,
          resetsAt: `${todayUTC}T23:59:59Z`,
        }, { status: 429 });
      }
    }

    const newCount     = (profile?.fetch_reset_date === todayUTC ? (profile?.daily_fetch_count || 0) : 0) + 1;
    const newResetDate = todayUTC;

    const rawInterests = profile?.interests || {};
    const statedInterests = Object.fromEntries(
      Object.entries(rawInterests).filter(([k]) => k.startsWith('topic_'))
    );
    const lang    = profile?.lang    || 'en';
    const country = profile?.country || '';

    // ── Step 1: Click history for behavior profile ─────────────────
    let clickRows = [];
    try {
      const { data: clicks } = await serviceClient
        .from('article_clicks')
        .select('clicked_at, daily_cache ( title, category ), article_id')
        .eq('user_id', user.id)
        .order('clicked_at', { ascending: false })
        .limit(30);

      if (clicks?.length > 0) {
        const articleIds = clicks.map(c => c.article_id).filter(Boolean);
        const { data: feedRows } = await serviceClient
          .from('user_news_feed')
          .select('article_id, cluster')
          .eq('user_id', user.id)
          .in('article_id', articleIds);

        const clusterById = {};
        (feedRows || []).forEach(r => { clusterById[r.article_id] = r.cluster; });
        clickRows = clicks.map(c => ({
          ...c,
          user_news_feed: { cluster: clusterById[c.article_id] || null },
        }));
      }
    } catch { /* article_clicks may not exist yet */ }

    const behavior = buildBehaviorProfile(clickRows);

    // Always fetch by stated interests — behavior only adjusts scoring weight (5% boost)
    // This prevents old click history from leaking into the rationale and topic sources
    const fetchInterests = Object.values(statedInterests).filter(Boolean);

    console.log(`[process-news] Fetch interests (stated):`, JSON.stringify(fetchInterests));

    // ── Step 2: Fetch from all sources ────────────────────────────
    const newsItems = await fetchFromAllSources(fetchInterests, lang, country);
    if (!newsItems.length) {
      return NextResponse.json({ error: 'No news articles found' }, { status: 404 });
    }

    const deduped = deduplicateArticles(newsItems);
    console.log(`[process-news] ${deduped.length} unique articles after dedup`);

    // ── Step 3: Upsert to daily_cache ─────────────────────────────
    // Sliding window: 36h instead of 24h so yesterday evening's news survives
    const urls   = deduped.map(i => i.link).filter(Boolean);
    const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

    const { data: cachedRows } = await serviceClient
      .from('daily_cache')
      .select('id, title, full_text, source_url, image_url, source, category, published_at')
      .in('source_url', urls)
      .gte('fetched_at', cutoff);

    const cachedMap = {};
    (cachedRows || []).forEach(r => { cachedMap[r.source_url] = r; });

    const newItems = deduped.filter(i => i.link && !cachedMap[i.link]);
    const articles = deduped.filter(i => i.link && cachedMap[i.link]).map(i => cachedMap[i.link]);

    if (newItems.length > 0) {
      const insertData = newItems.map(item => ({
        title:        item.title || 'Untitled',
        full_text:    item.content || item.description || '',
        source:       item.source_name || 'Unknown',
        source_url:   item.link,
        image_url:    item.image_url || null,
        is_global:    false,
        category:     item.category || 'general',
        published_at: item.publishedAt || new Date().toISOString(),
        fetched_at:   new Date().toISOString(),
      }));

      const { data: inserted } = await serviceClient
        .from('daily_cache')
        .upsert(insertData, { onConflict: 'source_url' })
        .select('id, title, full_text, source_url, image_url, source, category, published_at');

      if (inserted) articles.push(...inserted);
    }

    if (!articles.length) {
      return NextResponse.json({ error: 'No articles could be processed' }, { status: 500 });
    }

    // Deduplicate by DB id
    const dbArticlesById = Object.fromEntries(
      articles.filter(a => a.id).map(a => [a.id, a])
    );
    const dbArticles = Object.values(dbArticlesById);

    console.log(`[process-news] ${dbArticles.length} articles ready for scoring`);

    // ── Step 4: Generate embeddings ───────────────────────────────
    // Build user interest embedding
    const interestText = fetchInterests.join(', ');
    let userEmbedding = null;
    const articleEmbeddings = {};

    try {
      console.log('[embeddings] Generating user interest embedding...');
      userEmbedding = await embedText(interestText);

      // Generate article embeddings for articles that don't have one yet
      const textsToEmbed = dbArticles.map(a =>
        `${a.title}. ${(a.full_text || '').slice(0, 500)}`
      );

      console.log(`[embeddings] Generating embeddings for ${textsToEmbed.length} articles...`);
      const startTime = Date.now();
      const embeddings = await embedBatch(textsToEmbed);
      console.log(`[embeddings] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      dbArticles.forEach((a, i) => {
        articleEmbeddings[a.id] = embeddings[i];
      });
    } catch (embErr) {
      console.error('[embeddings] Embedding generation failed:', embErr.message);
      // Continue without embeddings — scoring will use keyword fallback
    }

    // ── Step 5: Score & rank articles ─────────────────────────────
    // Attach source tag from deduped items for source quality scoring
    const sourceTagByUrl = {};
    deduped.forEach(d => { if (d.link) sourceTagByUrl[d.link] = d._sourceTag; });

    const feedEntries = dbArticles.map(article => {
      const enriched = { ...article, _sourceTag: sourceTagByUrl[article.source_url] || 'unknown' };
      const cluster = clusterArticle(article.title, article.full_text, article.category);
      const score = scoreArticle(
        enriched,
        userEmbedding,
        articleEmbeddings[article.id] || null,
        fetchInterests,
        behavior.topClusters || [],
        cluster,
      );
      const summary = extractSummary(article.full_text);
      const bestInterest = findBestInterest(article.title, fetchInterests);
      const rationale = generateRationale(bestInterest, score);

      return {
        user_id:      user.id,
        article_id:   article.id,
        ai_rationale: rationale,
        ai_summary:   summary,
        cluster,
        score,
      };
    });

    // ── Step 6: Select top 20 by score ────────────────────────────
    const TOP_N = 20;
    const ranked = [...feedEntries].sort((a, b) => b.score - a.score);
    const relevantEntries = ranked.slice(0, TOP_N);

    console.log(
      `[process-news] Top ${relevantEntries.length} selected ` +
      `(scores: ${relevantEntries[0]?.score?.toFixed(2)} → ${relevantEntries[relevantEntries.length - 1]?.score?.toFixed(2)})`
    );

    // ── Step 7: Write user_news_feed ───────────────────────────────
    if (relevantEntries.length > 0) {
      await serviceClient.from('user_news_feed').delete().eq('user_id', user.id);
      const { error: feedErr } = await serviceClient
        .from('user_news_feed')
        .insert(relevantEntries);
      if (feedErr) console.error('Feed insert error:', feedErr.message);
    }

    // ── Step 8: Daily Brief (template-based) ──────────────────────
    try {
      const briefArticles = relevantEntries
        .slice(0, 10)
        .map(e => ({ title: dbArticlesById[e.article_id]?.title || '' }))
        .filter(a => a.title);
      const briefClusters = relevantEntries
        .slice(0, 10)
        .map(e => e.cluster)
        .filter(Boolean);

      const brief = buildBrief(briefArticles, briefClusters);

      if (brief) {
        await serviceClient
          .from('profiles')
          .update({ daily_brief: brief })
          .eq('id', user.id);
        console.log('[brief] Daily brief saved');
      }
    } catch (briefErr) {
      console.error('Daily brief error:', briefErr.message);
    }

    // ── Step 9: Persist rate-limit counters ────────────────────────
    await serviceClient
      .from('profiles')
      .update({
        last_fetch:        new Date().toISOString(),
        daily_fetch_count: newCount,
        fetch_reset_date:  newResetDate,
      })
      .eq('id', user.id);

    const sourceTally = deduped.reduce((acc, a) => {
      acc[a._sourceTag || 'unknown'] = (acc[a._sourceTag || 'unknown'] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      articlesProcessed: relevantEntries.length,
      embeddingsGenerated: Object.keys(articleEmbeddings).length,
      sources: sourceTally,
      behaviorProfile: behavior.hasHistory ? behavior.profileText : null,
      mode: 'interest-driven',
      quota: isPremium
        ? { isPremium: true, unlimited: true }
        : { isPremium: false, used: newCount, remaining: Math.max(0, DAILY_LIMIT - newCount), limit: DAILY_LIMIT },
    });

  } catch (error) {
    console.error('Process news error:', error);
    return NextResponse.json(
      { error: 'Pipeline failed', details: error.message },
      { status: 500 }
    );
  }
}
