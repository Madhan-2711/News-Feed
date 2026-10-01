// ── Google News RSS Source Adapter ────────────────────────────────
// Free, no API key. Search (including grouped "a OR b OR c" queries,
// up to 100 results), top stories, and section headlines, per country
// and language edition.
// Links are news.google.com redirect URLs (they open in a browser but
// don't HTTP-redirect to the publisher) and items carry no image.

import { fetchFeed, plainText, isoDate } from './http.js';

const BASE = 'https://news.google.com';

export const SECTIONS = ['WORLD', 'NATION', 'BUSINESS', 'TECHNOLOGY', 'ENTERTAINMENT', 'SPORTS', 'SCIENCE', 'HEALTH'];

/** hl/gl/ceid parameters for a country + language edition. */
export function editionParams(country = '', lang = 'en') {
  const gl = (country || 'us').toUpperCase();
  const hl = lang === 'en' ? `en-${gl}` : lang;
  return new URLSearchParams({ hl, gl, ceid: `${gl}:${lang}` });
}

function sourceOf(item) {
  const src = item.source;
  if (!src) return { name: null, url: null };
  if (typeof src === 'string') return { name: src, url: null };
  return { name: src._ || null, url: src.$?.url || null };
}

/** Normalize one Google News RSS item to the shared article shape. */
export function normalizeItem(item) {
  const source = sourceOf(item);
  let title = (item.title || '').trim();
  // Titles end with " - Publisher"; the publisher is stored separately
  if (source.name && title.endsWith(` - ${source.name}`)) {
    title = title.slice(0, -(source.name.length + 3)).trim();
  }
  // The description is an HTML link list that mostly repeats the title
  const description = plainText(item.content || item.contentSnippet || '')
    .replace(title, '')
    .replace(source.name || '', '')
    .trim();

  return {
    title,
    description: description.length > 40 ? description : '',
    content: '',
    link: item.link || '',
    image_url: null,
    source_name: source.name || 'Google News',
    publishedAt: isoDate(item.isoDate || item.pubDate),
    category: 'general',
    _sourceTag: 'googlenews',
  };
}

// revalidate: seconds to reuse the response via Next's fetch cache (routes
// serving public headlines); omitted for the ingest job, which wants fresh data.
async function readFeed(url, { revalidate } = {}) {
  const feed = await fetchFeed(url, {
    timeoutMs: 10000,
    ...(revalidate ? { next: { revalidate } } : {}),
  });
  return (feed.items || []).map(normalizeItem).filter(a => a.title && a.link);
}

/**
 * Search Google News. `query` uses Google syntax (OR, "phrases").
 * @param window recency window such as '1h', '1d', '7d'
 */
export async function searchGoogleNews(query, { country = '', lang = 'en', window = '1d' } = {}) {
  const params = editionParams(country, lang);
  params.set('q', `${query} when:${window}`);
  return readFeed(`${BASE}/rss/search?${params}`);
}

/** Top stories for an edition. */
export async function topStories({ country = '', lang = 'en', revalidate } = {}) {
  return readFeed(`${BASE}/rss?${editionParams(country, lang)}`, { revalidate });
}

/** Headlines for one section (see SECTIONS). */
export async function sectionHeadlines(section, { country = '', lang = 'en', revalidate } = {}) {
  return readFeed(`${BASE}/news/rss/headlines/section/topic/${section}?${editionParams(country, lang)}`, { revalidate });
}
