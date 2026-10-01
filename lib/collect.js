// ── News collection into the shared cache (server only) ──────────
// Used by the ingest job (/api/ingest) and by Fetch News for topics the
// cache doesn't cover yet. Articles go into daily_cache (one row per URL,
// shared by every user) and are tagged with topics in article_topics.

import { searchGoogleNews, topStories } from './sources/googlenews.js';
import { fetchFeedCatalog } from './sources/rss.js';
import { fetchSpaceflightNews } from './sources/spaceflight.js';
import { fetchHackerNews } from './sources/hackernews.js';
import { fetchFromGuardian } from './sources/guardian.js';
import { fetchFromNewsData } from './sources/newsdata.js';
import { searchAPITube, hasAPITubeKey } from './sources/apitube.js';
import { spendApiBudget } from './budget.js';
import { searchTerms, isGeneralTopic, groupTopics } from './topics.js';
import { matchStrength, MATCH } from './scoring.js';

// A topic with fewer cached articles than this gets an extra search
export const MIN_TOPIC_ARTICLES = 8;
// Only keep articles published within this window
const MAX_AGE_HOURS = 48;

// ── Dedup ───────────────────────────────────────────────────────────

export function normTitle(title = '') {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const isGoogleLink = url => /^https?:\/\/news\.google\.com\//.test(url || '');

// Prefer a publisher URL (scrapable for Ask AI) with an image over a
// Google News redirect link for the same story.
function preference(a) {
  return (isGoogleLink(a.link) ? 0 : 2) + (a.image_url ? 1 : 0);
}

/** Drop duplicate titles across sources, keeping the best copy of each. */
export function dedupArticles(articles) {
  const byTitle = new Map();
  for (const a of articles) {
    const key = normTitle(a.title);
    if (!key) continue;
    const kept = byTitle.get(key);
    if (!kept) {
      byTitle.set(key, { ...a, _searchedTopics: [...(a._searchedTopics || [])] });
      continue;
    }
    // Merge which searches found it, then keep the preferred copy
    const searched = [...new Set([...(kept._searchedTopics || []), ...(a._searchedTopics || [])])];
    const winner = preference(a) > preference(kept) ? a : kept;
    byTitle.set(key, { ...winner, _searchedTopics: searched });
  }
  return [...byTitle.values()];
}

function isFresh(a) {
  const t = new Date(a.publishedAt).getTime();
  return !isNaN(t) && Date.now() - t < MAX_AGE_HOURS * 3600000;
}

// ── Classification ──────────────────────────────────────────────────

/**
 * How strongly an article belongs to each topic: a keyword in the title
 * or text, or (weakly) a search for that topic / a feed section for it
 * returned the article. Topics with no signal are left out.
 * @returns {{ [topic]: number }}
 */
export function classifyArticle(article, topics) {
  const text = `${article.description || ''} ${article.content || ''}`;
  const searched = new Set((article._searchedTopics || []).map(t => t.toLowerCase()));
  const feedTopics = new Set((article._feedTopics || []).map(t => t.toLowerCase()));
  const result = {};
  for (const topic of topics) {
    const lower = topic.toLowerCase();
    const strength = Math.max(
      matchStrength(article.title, text, topic),
      searched.has(lower) || feedTopics.has(lower) ? MATCH.searchOnly : 0,
    );
    if (strength > 0) result[topic] = strength;
  }
  return result;
}

// ── Storage ─────────────────────────────────────────────────────────

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Insert new articles into daily_cache (existing URLs are left alone)
 * and return a map of URL → article id for all of them.
 */
async function storeArticles(db, articles) {
  if (!articles.length) return {};
  const now = new Date().toISOString();
  const rows = articles.map(a => ({
    title:        a.title,
    full_text:    a.content || a.description || '',
    source:       a.source_name || 'Unknown',
    source_url:   a.link,
    image_url:    a.image_url || null,
    is_global:    false,
    category:     a.category || 'general',
    published_at: a.publishedAt,
    fetched_at:   now,
    source_tag:   a._sourceTag || null,
  }));

  for (const batch of chunks(rows, 200)) {
    const { error } = await db.from('daily_cache')
      .upsert(batch, { onConflict: 'source_url', ignoreDuplicates: true });
    if (error) throw error;
  }

  const idByUrl = {};
  for (const urls of chunks(rows.map(r => r.source_url), 100)) {
    const { data, error } = await db.from('daily_cache').select('id, source_url').in('source_url', urls);
    if (error) throw error;
    for (const row of data || []) idByUrl[row.source_url] = row.id;
  }
  return idByUrl;
}

/**
 * Store articles and tag them with the topics they match.
 * @param topicRows topic_refresh rows ({ topic_key, topic }) to tag against
 * @returns {{ [topic_key]: number }} tagged article count per topic
 */
export async function storeAndTag(db, articles, topicRows) {
  const fresh = dedupArticles(articles.filter(a => a.title && a.link && isFresh(a)));
  const topicNames = topicRows.map(r => r.topic);
  const keyByTopic = Object.fromEntries(topicRows.map(r => [r.topic, r.topic_key]));

  const classified = fresh
    .map(a => ({ article: a, topics: classifyArticle(a, topicNames) }))
    .filter(c => Object.keys(c.topics).length > 0);

  const idByUrl = await storeArticles(db, classified.map(c => c.article));

  const tags = [];
  const counts = {};
  for (const { article, topics } of classified) {
    const articleId = idByUrl[article.link];
    if (!articleId) continue;
    for (const [topic, relevance] of Object.entries(topics)) {
      const key = keyByTopic[topic];
      tags.push({ article_id: articleId, topic_key: key, relevance });
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  for (const batch of chunks(tags, 500)) {
    const { error } = await db.from('article_topics').upsert(batch, { onConflict: 'article_id,topic_key' });
    if (error) throw error;
  }
  return counts;
}

async function markRefreshed(db, topicRows, { deep = false } = {}) {
  const now = new Date().toISOString();
  for (const row of topicRows) {
    const { count } = await db.from('article_topics')
      .select('article_id', { count: 'exact', head: true })
      .eq('topic_key', row.topic_key);
    const update = { last_refreshed_at: now, article_count: count || 0 };
    if (deep) update.last_deep_refresh_at = now;
    await db.from('topic_refresh').update(update).eq('topic_key', row.topic_key);
  }
}

// ── Fetching ────────────────────────────────────────────────────────

const tagSearched = (articles, topics) =>
  articles.map(a => ({ ...a, _searchedTopics: topics }));

async function safe(label, promise) {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[collect] ${label} failed: ${err.message}`);
    return [];
  }
}

/** Shared per-run lookups: one fetch per feed catalog / source per run. */
export function createRunCache() {
  return { catalog: new Map(), shared: null, topStories: new Map() };
}

async function catalogFor(cache, country) {
  if (!cache.catalog.has(country)) cache.catalog.set(country, fetchFeedCatalog(country));
  return cache.catalog.get(country);
}

async function sharedSources(cache) {
  if (!cache.shared) {
    cache.shared = Promise.all([fetchSpaceflightNews(), fetchHackerNews()]).then(r => r.flat());
  }
  return cache.shared;
}

async function topStoriesFor(cache, country, lang) {
  const key = `${country}|${lang}`;
  if (!cache.topStories.has(key)) {
    cache.topStories.set(key, safe('top stories', topStories({ country, lang }))
      .then(items => tagSearched(items, ['News'])));
  }
  return cache.topStories.get(key);
}

/**
 * Free sources for one group of topics in the same edition: one grouped
 * Google News search, plus a single-topic search for any topic that came
 * back thin, plus the feed catalog and shared tech/space sources.
 */
async function freeSourcesForGroup(group, cache) {
  const { country, lang } = group[0];
  const searchable = group.filter(r => !isGeneralTopic(r.topic));
  const general = group.filter(r => isGeneralTopic(r.topic));

  const grouped = searchable.length
    ? await safe('google grouped', searchGoogleNews(
        searchable.map(r => `(${searchTerms(r.topic)})`).join(' OR '),
        { country, lang },
      ))
    : [];
  const groupedTagged = grouped.map(a => ({
    ...a,
    // A grouped result was found by one of the group's terms; record the
    // topics it actually mentions so the split-back stays honest.
    _searchedTopics: searchable
      .filter(r => matchStrength(a.title, a.description, r.topic) > 0)
      .map(r => r.topic),
  }));

  // Top up topics the grouped search under-served
  const counts = Object.fromEntries(searchable.map(r => [r.topic, 0]));
  for (const a of groupedTagged) for (const t of a._searchedTopics) counts[t]++;
  const thin = searchable.filter(r => counts[r.topic] < MIN_TOPIC_ARTICLES);
  const topUps = await Promise.all(thin.map(r =>
    safe(`google ${r.topic}`, searchGoogleNews(searchTerms(r.topic), { country, lang }))
      .then(items => tagSearched(items, [r.topic]))
  ));

  const [catalog, shared, top] = await Promise.all([
    catalogFor(cache, country),
    sharedSources(cache),
    general.length ? topStoriesFor(cache, country, lang) : [],
  ]);

  return [...groupedTagged, ...topUps.flat(), ...catalog, ...shared, ...top];
}

/** Keyed APIs for a group (deep refresh), within the shared daily budgets. */
async function keyedSourcesForGroup(db, group) {
  const { country, lang } = group[0];
  const topics = group.filter(r => !isGeneralTopic(r.topic)).map(r => r.topic);
  if (!topics.length) return [];

  const guardian = await Promise.all(topics.map(async topic =>
    (await spendApiBudget(db, 'guardian'))
      ? tagSearched(await safe(`guardian ${topic}`, fetchFromGuardian([topic], lang, country)), [topic])
      : []
  ));
  const newsdata = (await spendApiBudget(db, 'newsdata'))
    ? await safe('newsdata', fetchFromNewsData(topics, lang, country))
    : [];

  return [...guardian.flat(), ...newsdata];
}

/**
 * Refresh topics from the free hourly sources, adding the keyed APIs for
 * topics whose deep refresh is due. Stops starting new groups at the
 * deadline (ms timestamp).
 * @returns {{ refreshed: string[], tagged: object }}
 */
export async function refreshTopics(db, topicRows, { deepAfterHours = 3, deadline = Infinity } = {}) {
  const cache = createRunCache();
  const refreshed = [];
  const tagged = {};

  for (const group of groupTopics(topicRows, 3)) {
    if (Date.now() > deadline) break;

    const deepDue = group.some(r =>
      !r.last_deep_refresh_at ||
      Date.now() - new Date(r.last_deep_refresh_at).getTime() > deepAfterHours * 3600000
    );
    const [free, keyed] = await Promise.all([
      freeSourcesForGroup(group, cache),
      deepDue ? keyedSourcesForGroup(db, group) : [],
    ]);

    Object.assign(tagged, await storeAndTag(db, [...free, ...keyed], group));
    await markRefreshed(db, group, { deep: deepDue });
    refreshed.push(...group.map(r => r.topic_key));
  }
  return { refreshed, tagged };
}

/**
 * Search for one topic the cache doesn't cover yet (a new or niche
 * keyword): Google News first, then the keyed APIs if that's still thin.
 * @param useKeyedApis whether APITube / Guardian / NewsData may be used
 * @returns number of articles now tagged with the topic
 */
export async function searchTopicOnDemand(db, topicRow, { useKeyedApis = true } = {}) {
  const { topic, country, lang } = topicRow;
  if (isGeneralTopic(topic)) {
    const { tagged } = await refreshTopics(db, [topicRow], { deepAfterHours: Infinity });
    return tagged[topicRow.topic_key] || 0;
  }

  const google = tagSearched(
    await safe(`google ${topic}`, searchGoogleNews(searchTerms(topic), { country, lang, window: '2d' })),
    [topic],
  );
  let counts = await storeAndTag(db, google, [topicRow]);
  let total = counts[topicRow.topic_key] || 0;
  let usedKeyed = false;

  if (total < MIN_TOPIC_ARTICLES && useKeyedApis) {
    usedKeyed = true;
    const keyed = [];
    if (hasAPITubeKey() && await spendApiBudget(db, 'apitube')) {
      keyed.push(...tagSearched(await safe(`apitube ${topic}`, searchAPITube(topic, { lang })), [topic]));
    }
    keyed.push(...await keyedSourcesForGroup(db, [topicRow]));
    counts = await storeAndTag(db, keyed, [topicRow]);
    total += counts[topicRow.topic_key] || 0;
  }

  await markRefreshed(db, [topicRow], { deep: usedKeyed });
  return total;
}
