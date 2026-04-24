// ── The Guardian Source Adapter ───────────────────────────────────
// The Guardian Open Platform — unlimited requests on free tier.
// Returns article body text (show-fields=bodyText), section, and thumbnail.

const GUARDIAN_SECTION_MAP = {
  cricket: 'sport/cricket',
  ipl: 'sport/cricket',
  football: 'football',
  technology: 'technology',
  'ai': 'technology',
  'artificial intelligence': 'technology',
  finance: 'money',
  economics: 'business',
  'stock market': 'business',
  science: 'science',
  health: 'society',
  politics: 'politics',
  environment: 'environment',
  bollywood: 'film',
  film: 'film',
};

export async function fetchFromGuardian(interests = [], _lang = 'en', _country = '') {
  const apiKey = process.env.GUARDIAN_API_KEY;
  if (!apiKey) return [];

  const queries = (Array.isArray(interests) ? interests : Object.values(interests).filter(Boolean))
    .filter(Boolean);

  // Try to map interests to Guardian sections; fall back to keyword search
  const sectionHits = queries
    .map(q => GUARDIAN_SECTION_MAP[q.toLowerCase()])
    .filter(Boolean);

  const params = new URLSearchParams({
    'api-key': apiKey,
    'show-fields': 'bodyText,thumbnail,trailText,headline',
    'page-size': '15',
    'order-by': 'newest',
  });

  if (sectionHits.length > 0) {
    params.set('section', sectionHits[0]); // use primary interest section
  } else if (queries.length > 0) {
    params.set('q', queries.slice(0, 3).join(' OR '));
  }

  try {
    const res = await fetch(
      `https://content.guardianapis.com/search?${params.toString()}`
    );
    if (!res.ok) return [];
    const data = await res.json();

    if (data.response?.status !== 'ok') return [];

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return (data.response?.results || [])
      .filter(a => !a.webPublicationDate || new Date(a.webPublicationDate) > cutoff)
      .map(a => ({
        title: a.fields?.headline || a.webTitle || '',
        description: a.fields?.trailText || '',
        content: (a.fields?.bodyText || '').slice(0, 3000),
        link: a.webUrl || '',
        image_url: a.fields?.thumbnail || null,
        source_name: 'The Guardian',
        publishedAt: a.webPublicationDate || new Date().toISOString(),
        category: a.sectionName || 'general',
        _sourceTag: 'guardian',
      }));
  } catch {
    return [];
  }
}
