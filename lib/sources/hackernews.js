// ── Hacker News Adapter (Algolia search API) ──────────────────────
// Free, no key. Popular recent tech stories; items are classified into
// Tech / AI & ML by keywords like every other source.

import { fetchWithTimeout, plainText, isoDate } from './http.js';

export async function fetchHackerNews({ sinceHours = 36, minPoints = 50, limit = 50 } = {}) {
  const since = Math.floor((Date.now() - sinceHours * 3600000) / 1000);
  const params = new URLSearchParams({
    tags: 'story',
    numericFilters: `created_at_i>${since},points>${minPoints}`,
    hitsPerPage: String(limit),
  });
  try {
    const res = await fetchWithTimeout(`https://hn.algolia.com/api/v1/search_by_date?${params}`, { timeoutMs: 8000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.hits || []).map(h => ({
      title:       (h.title || '').trim(),
      description: plainText(h.story_text || ''),
      content:     plainText(h.story_text || ''),
      // "Ask HN" posts have no external URL; link to the discussion
      link:        h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      image_url:   null,
      source_name: 'Hacker News',
      publishedAt: isoDate(h.created_at),
      category:    'technology',
      _sourceTag:  'hackernews',
      _feedTopics: ['tech'],
    })).filter(a => a.title && a.link);
  } catch (err) {
    console.warn(`[hackernews] failed: ${err.message}`);
    return [];
  }
}
