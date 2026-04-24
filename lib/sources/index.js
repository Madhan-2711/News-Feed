// ── Multi-Source Orchestrator ─────────────────────────────────────
// For each interest topic, fires parallel searches across Guardian,
// NewsAPI, and GNews. Results are capped per-topic per-source (2 each),
// interleaved for diversity, then deduped and capped at 20.

import { fetchFromGNews } from './gnews.js';
import { fetchFromNewsData } from './newsdata.js';
import { fetchFromGuardian } from './guardian.js';
import { fetchFromRSS } from './rss.js';
import { fetchFromNewsAPI } from './newsapi.js';

// Title similarity dedup — strips punctuation, compares first 60 chars
function normTitle(title = '') {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function dedup(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = normTitle(a.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasContent(a) {
  return a.title && a.title.length > 10 && a.link;
}

function sortByRecency(articles) {
  return [...articles].sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}

function filterFresh(articles) {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return articles.filter(a => {
    if (!a.publishedAt) return true;
    return new Date(a.publishedAt).getTime() > cutoff;
  });
}

// Apply freshness filter with graceful fallback to 7-day if 48h yields nothing
function freshOrFallback(articles) {
  const fresh = filterFresh(articles);
  return sortByRecency(fresh.length > 0 ? fresh : articles);
}

export async function fetchFromAllSources(interests = [], lang = 'en', country = '') {
  const topicList = (Array.isArray(interests) ? interests : Object.values(interests))
    .filter(Boolean)
    .slice(0, 5); // max 5 topics

  console.log('[sources] Topics to search:', topicList);

  // ── Per-topic parallel search ─────────────────────────────────────
  // For each interest, fire Guardian + NewsAPI + GNews independently.
  // This gives focused, topic-matched results instead of blended queries.
  //
  // Cap strategy: Guardian has no native country filter, so for non-UK/US/AU
  // countries we heavily limit its slots and give GNews + NewsAPI more weight
  // (they both support proper country params).
  const GUARDIAN_NATIVE = new Set(['gb', 'au', 'us', '']);
  const isGuardianNative = GUARDIAN_NATIVE.has((country || '').toLowerCase());

  const GUARDIAN_CAP = isGuardianNative ? 4 : 1; // 1 slot for non-UK countries
  const NEWSAPI_CAP  = 4;
  const GNEWS_CAP    = isGuardianNative ? 4 : 6; // compensate with more GNews for India etc.

  let topicArticles = [];

  if (topicList.length > 0) {
    const topicResults = await Promise.allSettled(
      topicList.map(async (topic) => {
        const [guardian, newsapi, gnews] = await Promise.allSettled([
          fetchFromGuardian([topic], lang, country),
          fetchFromNewsAPI([topic], lang, country),
          fetchFromGNews([topic], lang, country),
        ]);

        const guardianItems = guardian.status === 'fulfilled' ? guardian.value : [];
        const newsapiItems  = newsapi.status  === 'fulfilled' ? newsapi.value  : [];
        const gnewsItems    = gnews.status    === 'fulfilled' ? gnews.value    : [];

        // Take top N from each (country-aware caps), newest-first, tagging with the topic
        const perTopicPool = [
          ...freshOrFallback(guardianItems).slice(0, GUARDIAN_CAP),
          ...freshOrFallback(newsapiItems).slice(0, NEWSAPI_CAP),
          ...freshOrFallback(gnewsItems).slice(0, GNEWS_CAP),
        ].map(a => ({ ...a, _topic: topic }));

        console.log(`[sources] Topic "${topic}" → guardian:${guardianItems.length} newsapi:${newsapiItems.length} gnews:${gnewsItems.length} (caps g=${GUARDIAN_CAP}/n=${NEWSAPI_CAP}/gn=${GNEWS_CAP})`);
        return perTopicPool;
      })
    );

    topicArticles = topicResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  // ── Background sources (not topic-specific) ───────────────────────
  // NewsData + RSS run once for broad coverage and freshness
  const [newsdata, rss] = await Promise.allSettled([
    fetchFromNewsData(topicList, lang, country),
    fetchFromRSS(topicList, lang, country),
  ]);

  const newsdataItems = newsdata.status === 'fulfilled' ? newsdata.value : [];
  const rssItems      = rss.status      === 'fulfilled' ? rss.value      : [];

  console.log(`[sources] Background — NewsData: ${newsdataItems.length}, RSS: ${rssItems.length}`);

  // ── Merge: interleave topic articles with background ──────────────
  // Round-robin across topics so every topic gets representation
  const topicBuckets = topicList.length > 0
    ? topicList.map(topic => topicArticles.filter(a => a._topic === topic))
    : [topicArticles];

  const backgroundPool = [
    ...freshOrFallback(newsdataItems).slice(0, 6),
    ...freshOrFallback(rssItems).slice(0, 6),
  ];

  // Interleave: 1 article per topic bucket per round
  const interleaved = [];
  const maxLen = Math.max(...topicBuckets.map(b => b.length), backgroundPool.length);
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of topicBuckets) {
      if (i < bucket.length && hasContent(bucket[i])) interleaved.push(bucket[i]);
    }
    if (i < backgroundPool.length && hasContent(backgroundPool[i])) {
      interleaved.push(backgroundPool[i]);
    }
  }

  const deduped = dedup(interleaved).slice(0, 40); // large pool — AI will select top 20

  const sourceCounts = deduped.reduce((acc, a) => {
    acc[a._sourceTag] = (acc[a._sourceTag] || 0) + 1;
    return acc;
  }, {});
  const topicCounts = deduped.reduce((acc, a) => {
    if (a._topic) acc[a._topic] = (acc[a._topic] || 0) + 1;
    return acc;
  }, {});

  console.log('[sources] Final pool:', deduped.length, 'articles');
  console.log('[sources] By source:', JSON.stringify(sourceCounts));
  console.log('[sources] By topic:', JSON.stringify(topicCounts));

  return deduped;
}
