// ── Feed ranking ──────────────────────────────────────────────────
// Turns cached candidate articles into a user's top-N feed: score each
// one, drop already-read and near-duplicate stories, and balance the
// result across the user's topics and story clusters.

import { scoreArticle, clusterArticle, generateRationale, extractSummary } from './scoring.js';

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'at', 'as', 'by', 'with', 'from', 'after', 'over']);

function titleTokens(title = '') {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
  );
}

/** Word-overlap (Jaccard) similarity of two titles, 0–1. */
export function titleSimilarity(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const DUPLICATE_SIMILARITY = 0.6;

const isGoogleLink = url => /^https?:\/\/news\.google\.com\//.test(url || '');

/**
 * Keep one copy of each story. Entries must be sorted best-first; a later
 * near-duplicate is dropped, but if the kept copy is a Google News link
 * and the duplicate is a publisher link (scrapable, usually has an
 * image), the publisher copy takes its place at the kept copy's score.
 */
export function mergeNearDuplicates(entries) {
  const kept = [];
  for (const entry of entries) {
    const match = kept.findIndex(k =>
      titleSimilarity(k.article.title, entry.article.title) >= DUPLICATE_SIMILARITY
    );
    if (match === -1) {
      kept.push(entry);
    } else if (isGoogleLink(kept[match].article.source_url) && !isGoogleLink(entry.article.source_url)) {
      kept[match] = { ...entry, score: kept[match].score };
    }
  }
  return kept;
}

/**
 * Pick up to `limit` entries taking turns between the user's topics, so
 * one busy topic can't fill the feed, with at most `perCluster` stories
 * from any one cluster.
 */
export function balanceAcrossTopics(entries, interests, { limit = 20, perCluster = 6 } = {}) {
  const buckets = new Map(interests.map(i => [i, []]));
  for (const e of entries) {
    if (!buckets.has(e.interest)) buckets.set(e.interest, []);
    buckets.get(e.interest).push(e);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.score - a.score);

  const picked = [];
  const perClusterCount = {};
  let progress = true;
  while (picked.length < limit && progress) {
    progress = false;
    for (const list of buckets.values()) {
      while (list.length) {
        const next = list.shift();
        if ((perClusterCount[next.cluster] || 0) >= perCluster) continue;
        perClusterCount[next.cluster] = (perClusterCount[next.cluster] || 0) + 1;
        picked.push(next);
        progress = true;
        break;
      }
      if (picked.length >= limit) break;
    }
  }
  return picked.sort((a, b) => b.score - a.score);
}

/**
 * Rank cached candidates for one user.
 * @param candidates [{ article: daily_cache row, topicRelevance: { [interest]: relevance } }]
 * @param interests the user's topics
 * @param opts.readIds article ids the user has already opened (hidden)
 * @param opts.behaviorClusters clusters from click history (small boost)
 * @returns feed entries: { article, score, interest, strength, cluster, rationale, summary }
 */
export function rankFeed(candidates, interests, { readIds = new Set(), behaviorClusters = [], limit = 20 } = {}) {
  const scored = [];
  for (const { article, topicRelevance } of candidates) {
    if (readIds.has(article.id)) continue;
    const cluster = clusterArticle(article.title, article.full_text, article.category);
    const { score, interest, strength } = scoreArticle(article, interests, {
      topicRelevance, behaviorClusters, cluster,
    });
    if (score <= 0) continue;
    scored.push({ article, score, interest, strength, cluster });
  }

  scored.sort((a, b) => b.score - a.score);
  const unique = mergeNearDuplicates(scored);
  return balanceAcrossTopics(unique, interests, { limit }).map(e => ({
    ...e,
    rationale: generateRationale(e.interest, e.strength),
    summary: extractSummary(e.article.full_text),
  }));
}
