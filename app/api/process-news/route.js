import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { fetchFromAllSources } from '@/lib/sources/index';
import {
  scoreArticle, clusterArticle, extractSummary,
  generateRationale, findBestInterest, buildBrief,
} from '@/lib/scoring';
import { consumeQuota, refundQuota } from '@/lib/quota';
import { FREE_DAILY_FETCHES } from '@/lib/limits';
import { sanitizeLang, sanitizeCountry } from '@/lib/locale';

// Vercel Hobby max is 60s — enough since embeddings are skipped on serverless hosts
export const maxDuration = 60;

// Local ONNX embeddings can't run in serverless functions. Netlify sets
// AWS_LAMBDA_FUNCTION_NAME at runtime (NETLIFY is only guaranteed at build).
const isServerless = Boolean(
  process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
);


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

// ── Main pipeline ──────────────────────────────────────────────────
export async function POST(request) {
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

    // Get user profile (premium flag + interests)
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

    const rawInterests = profile?.interests || {};
    const statedInterests = Object.fromEntries(
      Object.entries(rawInterests).filter(([k]) => k.startsWith('topic_'))
    );
    // Profile values are user-editable; only pass known codes to news APIs.
    const lang    = sanitizeLang(profile?.lang);
    const country = sanitizeCountry(profile?.country);

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

    // fetchFromAllSources already drops duplicate titles
    const deduped = newsItems;

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

    // Embeddings: only attempt locally (serverless hosts can't run ONNX)
    // Keyword + recency + source quality scoring works well without embeddings
    if (!isServerless) {
      try {
        const { embedText, embedBatch } = await import('@/lib/embeddings');

        console.log('[embeddings] Generating user interest embedding...');
        userEmbedding = await embedText(interestText);

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
        console.warn('[embeddings] Unavailable — using keyword-only scoring:', embErr.message?.slice(0, 100));
      }
    } else {
      console.log('[embeddings] Skipped on serverless host — using keyword + recency scoring');
    }

    // ── Step 5: Score & rank articles ─────────────────────────────
    // Preserve source and searched topic for scoring cached articles.
    const sourceMetaByUrl = {};
    deduped.forEach(d => {
      if (d.link) {
        sourceMetaByUrl[d.link] = {
          sourceTag: d._sourceTag,
          topic: d._topic,
          topicVerified: d._viaSearch === true,
        };
      }
    });

    const feedEntries = dbArticles.map(article => {
      const sourceMeta = sourceMetaByUrl[article.source_url] || {};
      const enriched = {
        ...article,
        _sourceTag: sourceMeta.sourceTag || 'unknown',
        _topic: sourceMeta.topic || null,
        _topicVerified: sourceMeta.topicVerified || false,
      };
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
      const bestInterest = findBestInterest(article.title, article.full_text, fetchInterests) ||
        (enriched._topicVerified ? enriched._topic : null);
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

    // Score floor: drop articles with score < 0.30 (clearly off-topic)
    // Then take top 20 from what remains
    const SCORE_FLOOR = 0.30;
    const TOP_N = 20;
    const ranked = [...feedEntries]
      .filter(e => e.score >= SCORE_FLOOR)
      .sort((a, b) => b.score - a.score);
    const relevantEntries = ranked.slice(0, TOP_N);

    console.log(
      `[process-news] Top ${relevantEntries.length} selected ` +
      `(scores: ${relevantEntries[0]?.score?.toFixed(2)} → ${relevantEntries[relevantEntries.length - 1]?.score?.toFixed(2)})`
    );

    if (relevantEntries.length === 0) {
      return NextResponse.json({ error: 'No relevant articles found' }, { status: 404 });
    }

    // ── Step 7: Write user_news_feed ───────────────────────────────
    // Update rows for articles already in the feed and insert the rest,
    // rather than upsert: deployed databases may lack the
    // (user_id, article_id) unique constraint that ON CONFLICT requires.
    const { data: existingRows, error: existingErr } = await serviceClient
      .from('user_news_feed')
      .select('id, article_id')
      .eq('user_id', user.id);
    if (existingErr) throw existingErr;

    const keepArticleIds = new Set(relevantEntries.map(entry => entry.article_id));
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

    const newEntries = relevantEntries.filter(entry => !existingIdByArticle[entry.article_id]);
    if (newEntries.length > 0) {
      const { error: insertErr } = await serviceClient.from('user_news_feed').insert(newEntries);
      if (insertErr) throw insertErr;
    }

    const updates = await Promise.all(
      relevantEntries
        .filter(entry => existingIdByArticle[entry.article_id])
        .map(entry => serviceClient
          .from('user_news_feed')
          .update(entry)
          .eq('id', existingIdByArticle[entry.article_id]))
    );
    const updateErr = updates.find(result => result.error)?.error;
    if (updateErr) throw updateErr;

    // Remove old entries only after the replacement entries are safely stored.
    if (staleRowIds.length > 0) {
      const { error: staleErr } = await serviceClient
        .from('user_news_feed')
        .delete()
        .in('id', staleRowIds);
      if (staleErr) throw staleErr;
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

    // ── Step 9: Record the fetch time ──────────────────────────────
    // The quota was already spent before fetching. The feed is saved now, so a
    // failure here is logged rather than failing (and refunding) the run.
    const { error: lastFetchErr } = await serviceClient
      .from('profiles')
      .update({ last_fetch: new Date().toISOString() })
      .eq('id', user.id);
    if (lastFetchErr) console.error('last_fetch update error:', lastFetchErr.message);

    const sourceTally = deduped.reduce((acc, a) => {
      acc[a._sourceTag || 'unknown'] = (acc[a._sourceTag || 'unknown'] || 0) + 1;
      return acc;
    }, {});

    succeeded = true;
    return NextResponse.json({
      success: true,
      articlesProcessed: relevantEntries.length,
      embeddingsGenerated: Object.keys(articleEmbeddings).length,
      sources: sourceTally,
      behaviorProfile: behavior.hasHistory ? behavior.profileText : null,
      mode: 'interest-driven',
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
