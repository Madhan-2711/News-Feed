// ── Spaceflight News API Adapter ──────────────────────────────────
// Free, no key. Space and science news from NASA, ESA, SpaceNews, etc.

import { fetchWithTimeout, isoDate } from './http.js';

export async function fetchSpaceflightNews({ sinceHours = 36, limit = 30 } = {}) {
  const since = new Date(Date.now() - sinceHours * 3600000).toISOString();
  const params = new URLSearchParams({ limit: String(limit), published_at_gte: since, ordering: '-published_at' });
  try {
    const res = await fetchWithTimeout(`https://api.spaceflightnewsapi.net/v4/articles/?${params}`, { timeoutMs: 8000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(a => ({
      title:       (a.title || '').trim(),
      description: a.summary || '',
      content:     a.summary || '',
      link:        a.url || '',
      image_url:   a.image_url || null,
      source_name: a.news_site || 'Spaceflight News',
      publishedAt: isoDate(a.published_at),
      category:    'science',
      _sourceTag:  'spaceflight',
      _feedTopics: ['science'],
    })).filter(a => a.title && a.link);
  } catch (err) {
    console.warn(`[spaceflight] failed: ${err.message}`);
    return [];
  }
}
