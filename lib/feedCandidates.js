// ── Feed candidates from the shared cache (server only) ──────────
// Fetch News registers the user's topics, fills any the cache doesn't
// cover yet (searching on demand, including keyed APIs for niche
// keywords), then reads the tagged articles for ranking.

import { topicKey, normalizeTopic } from './topics.js';
import { searchTopicOnDemand, createRunCache, MIN_TOPIC_ARTICLES, NICHE_MAX_AGE_HOURS } from './collect.js';

const CANDIDATE_WINDOW_HOURS = 36;
const RETRY_AFTER_MINUTES = 60;     // don't re-search a thin topic more often
const MAX_KEYED_TOPICS_PER_FETCH = 3;
const ON_DEMAND_TIME_BUDGET_MS = 25000;

const ARTICLE_FIELDS = 'id, title, full_text, source, source_url, image_url, published_at, category, source_tag';

/**
 * Upsert the user's topics into topic_refresh (marking them requested so
 * the ingest job keeps collecting them) and return the rows.
 */
export async function registerTopics(db, topics, country, lang) {
  const now = new Date().toISOString();
  const rows = topics.map(t => ({
    topic_key: topicKey(t, country, lang),
    topic: normalizeTopic(t),
    country,
    lang,
    last_requested_at: now,
  }));
  const { error } = await db.from('topic_refresh').upsert(rows, { onConflict: 'topic_key' });
  if (error) throw error;

  const { data, error: readErr } = await db
    .from('topic_refresh')
    .select('topic_key, topic, country, lang, article_count, last_refreshed_at, last_deep_refresh_at')
    .in('topic_key', rows.map(r => r.topic_key));
  if (readErr) throw readErr;
  return data || [];
}

/** Cached articles per topic key, from the candidate window. */
export async function loadCandidates(db, topicRows, { windowHours = CANDIDATE_WINDOW_HOURS } = {}) {
  if (!topicRows.length) return { candidates: [], countByKey: {} };
  const since = new Date(Date.now() - windowHours * 3600000).toISOString();
  const topicByKey = Object.fromEntries(topicRows.map(r => [r.topic_key, r.topic]));

  const { data, error } = await db
    .from('article_topics')
    .select(`topic_key, relevance, daily_cache!inner ( ${ARTICLE_FIELDS} )`)
    .in('topic_key', topicRows.map(r => r.topic_key))
    .gte('daily_cache.published_at', since)
    .limit(2000);
  if (error) throw error;

  // One candidate per article, with its relevance for each matching topic
  const byArticle = new Map();
  const countByKey = {};
  for (const row of data || []) {
    const article = row.daily_cache;
    if (!article) continue;
    countByKey[row.topic_key] = (countByKey[row.topic_key] || 0) + 1;
    if (!byArticle.has(article.id)) byArticle.set(article.id, { article, topicRelevance: {} });
    byArticle.get(article.id).topicRelevance[topicByKey[row.topic_key]] = row.relevance;
  }
  return { candidates: [...byArticle.values()], countByKey };
}

/**
 * Search on demand for topics the cache barely covers: brand-new or niche
 * keywords that no hourly run has collected yet. Topics already searched
 * within the last hour are left alone (the source has nothing more), and
 * at most a few per fetch may use the keyed APIs.
 * @returns topic keys that were searched
 */
export async function fillThinTopics(db, topicRows, countByKey) {
  const retryBefore = Date.now() - RETRY_AFTER_MINUTES * 60000;
  const thin = topicRows.filter(r =>
    (countByKey[r.topic_key] || 0) < MIN_TOPIC_ARTICLES &&
    (!r.last_refreshed_at || new Date(r.last_refreshed_at).getTime() < retryBefore)
  );
  if (!thin.length) return [];

  console.log(`[feed] On-demand search for: ${thin.map(r => r.topic).join(', ')}`);
  const cache = createRunCache();  // fetch the RSS feeds once for all topics
  const searches = Promise.all(thin.map((row, i) =>
    searchTopicOnDemand(db, row, { useKeyedApis: i < MAX_KEYED_TOPICS_PER_FETCH, cache })
      .catch(err => console.warn(`[feed] On-demand ${row.topic} failed: ${err.message}`))
  ));
  // Use whatever finished in time. A slower search may still complete in
  // the background, but serverless hosts can stop it after the response.
  await Promise.race([searches, new Promise(r => setTimeout(r, ON_DEMAND_TIME_BUDGET_MS))]);
  return thin.map(r => r.topic_key);
}

/**
 * Candidates for the feed: the last 36 hours for every topic, plus up to
 * a week back for topics that are still thin (rare or niche keywords), so
 * those still get articles. Busy topics stay recent.
 */
export async function loadFeedCandidates(db, topicRows) {
  const recent = await loadCandidates(db, topicRows);
  const thin = topicRows.filter(r => (recent.countByKey[r.topic_key] || 0) < MIN_TOPIC_ARTICLES);
  if (!thin.length) return recent;

  const older = await loadCandidates(db, thin, { windowHours: NICHE_MAX_AGE_HOURS });
  const byId = new Map(recent.candidates.map(c => [c.article.id, c]));
  for (const c of older.candidates) {
    const existing = byId.get(c.article.id);
    if (existing) Object.assign(existing.topicRelevance, c.topicRelevance);
    else byId.set(c.article.id, c);
  }
  return {
    candidates: [...byId.values()],
    countByKey: { ...recent.countByKey, ...older.countByKey },
  };
}
