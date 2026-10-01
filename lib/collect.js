// ── News collection into the shared cache (server only) ──────────
// Used by the ingest job (/api/ingest) and by Fetch News for topics the
// cache doesn't cover yet. Articles go into daily_cache (one row per URL,
// shared by every user) and are tagged with topics in article_topics.
//
// Source order per topic: publisher RSS feeds + Guardian + NewsData
// (images; full text from the Guardian), then APITube for thin topics,
// then Google News RSS only as a last resort (an unofficial feed with no
// images that could change at any time).

import { searchGoogleNews } from './sources/googlenews.js';
import { fetchFeedCatalog } from './sources/rss.js';
import { fetchSpaceflightNews } from './sources/spaceflight.js';
import { fetchHackerNews } from './sources/hackernews.js';
import { fetchFromGuardian } from './sources/guardian.js';
import { fetchFromNewsData } from './sources/newsdata.js';
import { searchAPITube, hasAPITubeKey } from './sources/apitube.js';
import { spendApiBudget } from './budget.js';
import { searchTerms, primaryTerm, isGeneralTopic, groupTopics } from './topics.js';
import { matchStrength, MATCH } from './scoring.js';

// A topic with fewer cached articles than this gets an extra search
export const MIN_TOPIC_ARTICLES = 8;
// Only keep articles published within this window. Niche topics searched
// on demand may keep older ones: a few-days-old story beats an empty feed.
const MAX_AGE_HOURS = 48;
export const NICHE_MAX_AGE_HOURS = 7 * 24;

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

function mergeInto(map, key, a) {
  const kept = map.get(key);
  if (!kept) {
    map.set(key, { ...a, _searchedTopics: [...(a._searchedTopics || [])] });
    return;
  }
  // Merge which searches found it, then keep the preferred copy
  const searched = [...new Set([...(kept._searchedTopics || []), ...(a._searchedTopics || [])])];
  const winner = preference(a) > preference(kept) ? a : kept;
  map.set(key, { ...winner, _searchedTopics: searched });
}

/**
 * Drop duplicates across sources, keeping the best copy of each story:
 * the same title, or the same URL (feeds sometimes reuse one link for
 * differently titled items, and the cache stores one row per URL).
 */
export function dedupArticles(articles) {
  const byTitle = new Map();
  for (const a of articles) {
    const key = normTitle(a.title);
    if (key) mergeInto(byTitle, key, a);
  }
  const byUrl = new Map();
  for (const a of byTitle.values()) mergeInto(byUrl, a.link, a);
  return [...byUrl.values()];
}

// Wire-service slugs like "FOOTBALL-NFL/" aren't real headlines
export function isJunkTitle(title = '') {
  return title.split(/\s+/).filter(w => /[a-z]{2,}/i.test(w)).length < 3;
}

function isFresh(a, maxAgeHours = MAX_AGE_HOURS) {
  const t = new Date(a.publishedAt).getTime();
  return !isNaN(t) && Date.now() - t < maxAgeHours * 3600000;
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

// URL lookups go in the request's query string, which the database API
// rejects past a few KB; Google News links are ~300 characters each.
const MAX_LOOKUP_CHARS = 6000;

function chunksByLength(strings, maxChars) {
  const out = [];
  let current = [];
  let length = 0;
  for (const str of strings) {
    if (current.length && length + str.length > maxChars) {
      out.push(current);
      current = [];
      length = 0;
    }
    current.push(str);
    length += str.length;
  }
  if (current.length) out.push(current);
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
  for (const urls of chunksByLength(rows.map(r => r.source_url), MAX_LOOKUP_CHARS)) {
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
export async function storeAndTag(db, articles, topicRows, { maxAgeHours = MAX_AGE_HOURS } = {}) {
  const fresh = dedupArticles(articles.filter(a =>
    a.title && a.link && !isJunkTitle(a.title) && isFresh(a, maxAgeHours)
  ));
  const topicNames = topicRows.map(r => r.topic);
  const keyByTopic = Object.fromEntries(topicRows.map(r => [r.topic, r.topic_key]));

  const classified = fresh
    .map(a => ({ article: a, topics: classifyArticle(a, topicNames) }))
    .filter(c => Object.keys(c.topics).length > 0);

  const idByUrl = await storeArticles(db, classified.map(c => c.article));

  // One tag per article + topic (an upsert batch can't touch a row twice),
  // keeping the strongest match
  const tagByKey = new Map();
  for (const { article, topics } of classified) {
    const articleId = idByUrl[article.link];
    if (!articleId) continue;
    for (const [topic, relevance] of Object.entries(topics)) {
      const key = keyByTopic[topic];
      const id = `${articleId}|${key}`;
      if ((tagByKey.get(id)?.relevance ?? -1) < relevance) {
        tagByKey.set(id, { article_id: articleId, topic_key: key, relevance });
      }
    }
  }
  const tags = [...tagByKey.values()];
  const counts = {};
  for (const tag of tags) counts[tag.topic_key] = (counts[tag.topic_key] || 0) + 1;

  for (const batch of chunks(tags, 500)) {
    const { error } = await db.from('article_topics').upsert(batch, { onConflict: 'article_id,topic_key' });
    if (error) throw error;
  }
  return counts;
}

// last_deep_refresh_at records the last APITube search for a topic, so
// its small daily budget is spread across topics.
async function markRefreshed(db, topicRows, { deepKeys = new Set() } = {}) {
  const now = new Date().toISOString();
  for (const row of topicRows) {
    const { count } = await db.from('article_topics')
      .select('article_id', { count: 'exact', head: true })
      .eq('topic_key', row.topic_key);
    const update = { last_refreshed_at: now, article_count: count || 0 };
    if (deepKeys.has(row.topic_key)) update.last_deep_refresh_at = now;
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
  return { catalog: new Map(), shared: null };
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

/** Call a keyed API if its shared daily budget allows; [] otherwise. */
async function keyedSearch(db, provider, label, run, searchedTopics = null) {
  if (!(await spendApiBudget(db, provider))) return [];
  const items = await safe(label, run());
  return searchedTopics ? tagSearched(items, searchedTopics) : items;
}

/** How many articles match each topic in the group. */
function coverage(articles, group) {
  const topics = group.map(r => r.topic);
  const counts = Object.fromEntries(topics.map(t => [t, 0]));
  for (const a of articles) {
    for (const t of Object.keys(classifyArticle(a, topics))) counts[t]++;
  }
  return counts;
}

/**
 * Main sources for a group of topics in the same edition, all of which
 * usually include images: publisher RSS feeds and the free space/tech
 * APIs, plus the Guardian per topic and NewsData for the group (keyed,
 * within the shared daily budgets).
 */
async function primarySources(db, group, cache, { useKeyedApis = true } = {}) {
  const { country, lang } = group[0];
  const topics = group.filter(r => !isGeneralTopic(r.topic)).map(r => r.topic);

  const [catalog, shared, guardian, newsdata] = await Promise.all([
    catalogFor(cache, country),
    sharedSources(cache),
    useKeyedApis
      ? Promise.all(topics.map(t =>
          keyedSearch(db, 'guardian', `guardian ${t}`, () => fetchFromGuardian([primaryTerm(t)], lang, country), [t])))
      : [],
    useKeyedApis && topics.length
      ? keyedSearch(db, 'newsdata', 'newsdata', () => fetchFromNewsData(topics.map(primaryTerm), lang, country))
      : [],
  ]);
  return [...catalog, ...shared, ...guardian.flat(), ...newsdata];
}

/**
 * Fallbacks for topics the main sources left thin: APITube first (when
 * allowed), then Google News RSS only as a last resort.
 */
async function topUpThinTopics(db, group, have, { useApiTube = true, window = '1d' } = {}) {
  const thin = group.filter(r => !isGeneralTopic(r.topic) && (have[r.topic] || 0) < MIN_TOPIC_ARTICLES);
  const results = await Promise.all(thin.map(async r => {
    const items = [];
    if (useApiTube && hasAPITubeKey()) {
      items.push(...await keyedSearch(db, 'apitube', `apitube ${r.topic}`,
        () => searchAPITube(primaryTerm(r.topic), { lang: r.lang }), [r.topic]));
    }
    if ((have[r.topic] || 0) + coverage(items, [r])[r.topic] < MIN_TOPIC_ARTICLES) {
      items.push(...tagSearched(
        await safe(`google ${r.topic}`, searchGoogleNews(searchTerms(r.topic), { country: r.country, lang: r.lang, window })),
        [r.topic],
      ));
    }
    return items;
  }));
  return {
    items: results.flat(),
    usedApiTube: useApiTube && hasAPITubeKey() ? thin.map(r => r.topic_key) : [],
  };
}

const hoursSince = iso => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : Infinity);

/**
 * Refresh topics: main sources every time, APITube for thin topics at
 * most every `apiTubeEveryHours` per topic, Google News as a last resort.
 * Stops starting new groups at the deadline (ms timestamp).
 * @returns {{ refreshed: string[], tagged: object }}
 */
export async function refreshTopics(db, topicRows, { apiTubeEveryHours = 3, deadline = Infinity } = {}) {
  const cache = createRunCache();
  const refreshed = [];
  const tagged = {};
  const unique = [...new Map(topicRows.map(r => [r.topic_key, r])).values()];

  for (const group of groupTopics(unique, 3)) {
    if (Date.now() > deadline) break;

    const primary = await primarySources(db, group, cache);
    const have = coverage(primary, group);
    // APITube has the tightest budget: only topics that haven't used it lately
    const apiTubeDue = group.filter(r => hoursSince(r.last_deep_refresh_at) >= apiTubeEveryHours);
    const dueKeys = new Set(apiTubeDue.map(r => r.topic_key));
    const [dueTopUp, otherTopUp] = await Promise.all([
      topUpThinTopics(db, apiTubeDue, have, { useApiTube: true }),
      topUpThinTopics(db, group.filter(r => !dueKeys.has(r.topic_key)), have, { useApiTube: false }),
    ]);

    Object.assign(tagged, await storeAndTag(db, [...primary, ...dueTopUp.items, ...otherTopUp.items], group));
    await markRefreshed(db, group, { deepKeys: new Set(dueTopUp.usedApiTube) });
    refreshed.push(...group.map(r => r.topic_key));
  }
  return { refreshed, tagged };
}

/**
 * Search for one topic the cache doesn't cover yet (a new or niche
 * keyword): the main sources first, then APITube, then Google News, with
 * up to a week of look-back so rare topics still get articles.
 * @param useKeyedApis whether Guardian / NewsData / APITube may be used
 * @param cache a run cache shared by the searches of one Fetch News
 * @returns number of articles now tagged with the topic
 */
export async function searchTopicOnDemand(db, topicRow, { useKeyedApis = true, cache = createRunCache() } = {}) {
  const primary = await primarySources(db, [topicRow], cache, { useKeyedApis });
  const have = coverage(primary, [topicRow]);
  const topUp = await topUpThinTopics(db, [topicRow], have, { useApiTube: useKeyedApis, window: '7d' });

  const counts = await storeAndTag(db, [...primary, ...topUp.items], [topicRow], { maxAgeHours: NICHE_MAX_AGE_HOURS });
  await markRefreshed(db, [topicRow], { deepKeys: new Set(topUp.usedApiTube) });
  return counts[topicRow.topic_key] || 0;
}
