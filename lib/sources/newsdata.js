// ── NewsData.io Source Adapter ────────────────────────────────────
// NewsData.io supports full article text via `full_content=1`.
// Free tier: 200 requests/day.

export async function fetchFromNewsData(interests = [], lang = 'en', country = '') {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) return [];

  const queries = (Array.isArray(interests) ? interests : Object.values(interests).filter(Boolean))
    .filter(Boolean)
    .slice(0, 3);

  const q = queries.length > 0 ? queries.join(' OR ') : null;

  // NewsData uses `country` as comma-separated 2-letter codes
  // and `language` (not `lang`)
  const params = new URLSearchParams({
    apikey: apiKey,
    language: lang || 'en',
    full_content: '1',
    size: '10',
  });

  if (q) params.set('q', q);
  if (country) params.set('country', country);

  try {
    const res = await fetch(`https://newsdata.io/api/1/news?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();

    if (data.status !== 'success') return [];

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return (data.results || [])
      .filter(a => !a.pubDate || new Date(a.pubDate) > cutoff)
      .map(a => ({
        title: a.title || '',
        description: a.description || '',
        content: a.full_content || a.content || a.description || '',
        link: a.link || '',
        image_url: a.image_url || null,
        source_name: a.source_id || a.source_name || 'NewsData',
        publishedAt: a.pubDate || new Date().toISOString(),
        category: (a.category?.[0]) || 'general',
        _sourceTag: 'newsdata',
      }));
  } catch {
    return [];
  }
}
