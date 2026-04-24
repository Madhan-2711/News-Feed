import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { generateWithRetry, generateWithKey, getKeyCount } from '@/lib/gemini';
import { buildRankingPrompt, buildDailyBriefPrompt } from '@/lib/openai/prompts';
import { fetchFromAllSources } from '@/lib/sources/index';

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
    return { profileText: null, topTopics: [], recentTitles: [], hasHistory: false };
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
    recentTitles: recentTitles.slice(0, 20),
    hasHistory: clicks.length >= 3,
  };
}

// ── Groq: rank + summarize a batch of articles ─────────────────────
async function rankAndSummarize(articles, userInterests, behaviorProfile, recentTitles, keyIndex = 0) {
  const prompt = `You are a JSON-only response API. Return valid JSON arrays only. No markdown fences.\n\n${buildRankingPrompt(articles, userInterests, behaviorProfile, recentTitles)}`;
  const content = await generateWithKey(prompt, keyIndex);
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { console.error('AI no JSON array:', content.slice(0, 300)); return []; }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('AI JSON parse failed:', err.message);
    return [];
  }
}

// ── Save AI summaries back to daily_cache (universal cache) ────────
async function saveSummariesToCache(serviceClient, rankings, dbArticlesById) {
  const updates = rankings
    // Only cache articles that got a real AI summary AND a non-generic cluster
    .filter(r => r.article_id && r.summary && r.cluster && r.cluster !== 'General')
    .map(r => ({
      id:         r.article_id,
      ai_summary: r.summary,
      cluster:    r.cluster,
    }));

  if (updates.length === 0) return;

  // Update each article's ai_summary and cluster in daily_cache
  await Promise.all(
    updates.map(u =>
      serviceClient
        .from('daily_cache')
        .update({ ai_summary: u.ai_summary, cluster: u.cluster })
        .eq('id', u.id)
    )
  );

  console.log(`[cache] Saved AI summaries for ${updates.length} articles to daily_cache`);
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

    const fetchInterests = behavior.hasHistory
      ? behavior.topTopics
      : Object.values(statedInterests).filter(Boolean);

    console.log(`[process-news] Fetch interests (${behavior.hasHistory ? 'behavior' : 'stated'}):`, JSON.stringify(fetchInterests));

    // ── Step 2: Fetch from all sources ────────────────────────────
    const newsItems = await fetchFromAllSources(fetchInterests, lang, country);
    if (!newsItems.length) {
      return NextResponse.json({ error: 'No news articles found' }, { status: 404 });
    }

    const deduped = deduplicateArticles(newsItems);
    console.log(`[process-news] ${deduped.length} unique articles after dedup`);

    // ── Step 3: Upsert to daily_cache, fetch ai_summary if cached ─
    // Select includes ai_summary + cluster so we can skip AI for already-summarized articles
    const urls   = deduped.map(i => i.link).filter(Boolean);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: cachedRows } = await serviceClient
      .from('daily_cache')
      .select('id, title, full_text, source_url, image_url, source, ai_summary, cluster')
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
        .select('id, title, full_text, source_url, image_url, source, ai_summary, cluster');

      if (inserted) articles.push(...inserted);
    }

    if (!articles.length) {
      return NextResponse.json({ error: 'No articles could be processed' }, { status: 500 });
    }

    const dbArticles = articles.filter(a => a.id);
    const dbArticlesById = Object.fromEntries(dbArticles.map(a => [a.id, a]));

    // ── Step 4: AI cache check ─────────────────────────────────────
    // Articles with a real non-generic cluster + summary → skip AI
    // Articles with no summary, no cluster, OR cluster=General → re-send to AI
    const alreadyCached = dbArticles.filter(a => a.ai_summary && a.cluster && a.cluster !== 'General');
    const needsAI       = dbArticles.filter(a => !a.ai_summary || !a.cluster || a.cluster === 'General');

    console.log(`[cache] ${alreadyCached.length} articles have cached summaries, ${needsAI.length} need AI`);

    // ── Step 5: AI ranking only for uncached articles ─────────────
    let rankings = [];
    if (needsAI.length > 0) {
      try {
        const BATCH_SIZE = 8;
        const numKeys    = getKeyCount();
        const batches    = [];
        for (let i = 0; i < needsAI.length; i += BATCH_SIZE) {
          batches.push(needsAI.slice(i, i + BATCH_SIZE));
        }

        console.log(`[ai] ${batches.length} batches across ${numKeys} keys — ${batches.length} parallel Groq calls`);

        const batchResults = await Promise.all(
          batches.map((batch, batchIdx) => {
            const keyIdx = batchIdx % numKeys; // round-robin key assignment
            return rankAndSummarize(
              batch,
              statedInterests,
              behavior.profileText,
              behavior.recentTitles || [],
              keyIdx,
            )
              .then(results => results.map(r => ({ ...r, article_id: batch[r.index]?.id })))
              .catch(() => []);
          })
        );
        rankings = batchResults.flat().filter(r => r.article_id);

        // Save new summaries back to daily_cache for future users
        await saveSummariesToCache(serviceClient, rankings, dbArticlesById);
      } catch (aiErr) {
        console.error('AI ranking error:', aiErr.message);
      }
    }

    // ── Step 6: Build feed entries ─────────────────────────────────
    // For cached articles: reuse summary + cluster, assign score based on topic match
    // For new AI results: use fresh score + summary + cluster
    const feedEntries = dbArticles.map(article => {
      const fresh = rankings.find(r => r.article_id === article.id);

      // Derive a readable cluster from the article category if AI didn't provide one
      const fallbackCluster =
        (article.cluster && article.cluster !== 'General' ? article.cluster : null)
        || (article.category ? article.category.charAt(0).toUpperCase() + article.category.slice(1) : null)
        || 'General';

      // Best-effort summary: title + first 250 chars of full_text
      const rawText = (article.full_text || '').trim();
      const fallbackSummary = rawText
        ? rawText.slice(0, 260).trim() + (rawText.length > 260 ? '…' : '')
        : null;

      if (fresh) {
        return {
          user_id:      user.id,
          article_id:   article.id,
          ai_rationale: fresh.rationale  || 'Relevant to your interests.',
          ai_summary:   fresh.summary    || fallbackSummary,
          cluster:      fresh.cluster    || fallbackCluster,
          score:        fresh.score      ?? 0.6,
        };
      }

      if (article.ai_summary) {
        const titleLower = (article.title || '').toLowerCase();
        const interestMatch = fetchInterests.some(i =>
          titleLower.includes((i || '').toLowerCase().split(' ')[0])
        );
        return {
          user_id:      user.id,
          article_id:   article.id,
          ai_rationale: 'Matches your reading profile.',
          ai_summary:   article.ai_summary,
          cluster:      fallbackCluster,
          score:        interestMatch ? 0.72 : 0.58,
        };
      }

      // AI failed or timed out — use raw article content as summary
      return {
        user_id:      user.id,
        article_id:   article.id,
        ai_rationale: 'Based on article content.',
        ai_summary:   fallbackSummary,
        cluster:      fallbackCluster,
        score:        0.42,
      };
    });


    // ── Step 7: Select top 20 by score ────────────────────────────
    // Sort all candidates by score DESC, take the 20 most relevant.
    // No threshold cut — always return exactly 20 best-matched articles.
    const TOP_N = 20;
    const ranked = [...feedEntries].sort((a, b) => b.score - a.score);
    const relevantEntries = ranked.slice(0, TOP_N);

    console.log(
      `[process-news] Top ${relevantEntries.length} selected ` +
      `(scores: ${relevantEntries[0]?.score?.toFixed(2)} → ${relevantEntries[relevantEntries.length - 1]?.score?.toFixed(2)}) ` +
      `| ${alreadyCached.length} from cache, ${rankings.length} fresh AI`
    );

    // ── Step 8: Write user_news_feed ───────────────────────────────
    if (relevantEntries.length > 0) {
      await serviceClient.from('user_news_feed').delete().eq('user_id', user.id);
      const { error: feedErr } = await serviceClient
        .from('user_news_feed')
        .insert(relevantEntries);
      if (feedErr) console.error('Feed insert error:', feedErr.message);
    }

    // ── Step 9: Daily Brief ────────────────────────────────────────
    try {
      // Use only the top-scored articles to keep the prompt small (~2k tokens)
      const briefArticles = relevantEntries
        .slice(0, 10)
        .map(e => ({ title: dbArticlesById[e.article_id]?.title || '' }))
        .filter(a => a.title);

      const briefPrompt = buildDailyBriefPrompt(
        briefArticles,
        behavior.hasHistory ? { behavior: behavior.profileText } : statedInterests
      );

      // Try each Groq key in reverse order (last keys least used by article batches)
      const numKeys = getKeyCount();
      let brief = null;
      for (let ki = numKeys - 1; ki >= 0; ki--) {
        try {
          const result = await generateWithKey(briefPrompt, ki);
          if (result?.trim().length > 20) { brief = result.trim(); break; }
        } catch (e) {
          console.warn(`[brief] Key ${ki} failed: ${e.message?.slice(0, 60)}`);
        }
      }

      if (brief) {
        await serviceClient
          .from('profiles')
          .update({ daily_brief: brief })
          .eq('id', user.id);
        console.log('[brief] Daily brief saved');
      } else {
        console.warn('[brief] All keys exhausted — brief skipped');
      }
    } catch (briefErr) {
      console.error('Daily brief error:', briefErr.message);
    }

    // ── Step 10: Persist rate-limit counters ───────────────────────
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
      fromCache: alreadyCached.length,
      freshAI: rankings.length,
      sources: sourceTally,
      behaviorProfile: behavior.hasHistory ? behavior.profileText : null,
      mode: behavior.hasHistory ? 'behavior-driven' : 'interest-driven',
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
