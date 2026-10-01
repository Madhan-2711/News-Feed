// ── APITube Source Adapter ────────────────────────────────────────
// Keyed (APITUBE_API_KEY). Free plan: 100 requests/day, 10 results per
// request, 12h delay, short body preview. Used only for on-demand
// searches of topics the cache doesn't have yet; callers spend the
// shared daily budget first (lib/budget.js).

import { fetchWithTimeout, plainText, isoDate } from './http.js';

const ENDPOINT = 'https://api.apitube.io/v1/news/everything';

export function hasAPITubeKey() {
  return Boolean(process.env.APITUBE_API_KEY);
}

/** Normalize one APITube article to the shared article shape. */
export function normalizeArticle(a) {
  return {
    title:       (a.title || '').trim(),
    description: plainText(a.description || ''),
    content:     plainText(a.body || a.description || ''),
    link:        a.href || a.url || '',
    image_url:   a.image || a.image_url || null,
    source_name: a.source?.name || a.source?.domain || 'APITube',
    publishedAt: isoDate(a.published_at),
    category:    'general',
    _sourceTag:  'apitube',
  };
}

/**
 * Search article titles for a topic.
 * @returns normalized articles; [] when no key is configured
 * @throws on HTTP errors so callers can log them
 */
export async function searchAPITube(topic, { lang = 'en', limit = 10 } = {}) {
  const apiKey = process.env.APITUBE_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    title: topic,
    'language.code': lang,
    per_page: String(limit),
    'sort.by': 'published_at',
    'sort.order': 'desc',
  });

  const res = await fetchWithTimeout(`${ENDPOINT}?${params}`, {
    timeoutMs: 12000,
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw new Error(`APITube HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || data.articles || data.data || [])
    .map(normalizeArticle)
    .filter(a => a.title && a.link);
}
