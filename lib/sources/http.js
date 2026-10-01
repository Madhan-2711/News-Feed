// ── Shared fetch helpers for source adapters ─────────────────────
// Every outside request gets a hard timeout: the ingest job and Fetch
// News both run inside a 60s serverless limit, and one slow feed must
// not stall the rest.

import Parser from 'rss-parser';

const USER_AGENT = 'Mozilla/5.0 (compatible; NewsFeedBot/1.0)';

export const rssParser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure', 'source'],
  },
});

export async function fetchWithTimeout(url, { timeoutMs = 10000, headers = {}, ...init } = {}) {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Fetch and parse an RSS/Atom feed; throws on HTTP errors and timeouts. */
export async function fetchFeed(url, options) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return rssParser.parseString(await res.text());
}

/** Strip HTML tags and collapse whitespace. */
export function plainText(html = '') {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function isoDate(value) {
  const d = new Date(value);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
