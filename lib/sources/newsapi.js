// ── NewsAPI.org Source Adapter ────────────────────────────────────
// NewsAPI.org — 100 req/day free, up to 50 articles per request.
// Great for top headlines from major English-language sources worldwide.
// NOTE: On the free tier, `everything` endpoint is restricted to 1-month-old articles.
// We use `top-headlines` for freshness + `everything` for interest-keyword search.

const BASE = 'https://newsapi.org/v2';

const COUNTRY_MAP = {
  in: 'in',
  us: 'us',
  gb: 'gb',
  au: 'au',
};

// Map broad interest terms to NewsAPI categories
const CATEGORY_MAP = {
  technology: 'technology',
  'ai': 'technology',
  'artificial intelligence': 'technology',
  science: 'science',
  health: 'health',
  sports: 'sports',
  cricket: 'sports',
  ipl: 'sports',
  football: 'sports',
  business: 'business',
  finance: 'business',
  economics: 'business',
  'stock market': 'business',
  nifty: 'business',
  sensex: 'business',
  entertainment: 'entertainment',
  bollywood: 'entertainment',
};

export async function fetchFromNewsAPI(interests = [], lang = 'en', country = '') {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];

  const queries = (Array.isArray(interests) ? interests : Object.values(interests).filter(Boolean))
    .filter(Boolean);

  // Find a matching category from user interests
  const matchedCategory = queries
    .map(q => CATEGORY_MAP[q.toLowerCase()])
    .find(Boolean);

  const newsApiCountry = COUNTRY_MAP[country] || null;

  const results = [];

  try {
    // Strategy 1: Top headlines (freshest, most prominent articles)
    const headlineParams = new URLSearchParams({
      apiKey,
      pageSize: '20',
      language: lang || 'en',
    });
    if (newsApiCountry) headlineParams.set('country', newsApiCountry);
    if (matchedCategory) headlineParams.set('category', matchedCategory);

    const headlineRes = await fetch(`${BASE}/top-headlines?${headlineParams.toString()}`);
    if (headlineRes.ok) {
      const headlineData = await headlineRes.json();
      if (headlineData.status === 'ok') {
        results.push(...(headlineData.articles || []));
      }
    }

    // Strategy 2: If we have keyword interests and didn't get enough from headlines, search `everything`
    if (results.length < 10 && queries.length > 0) {
      const q = queries.slice(0, 3).join(' OR ');
      const everythingParams = new URLSearchParams({
        apiKey,
        q,
        language: lang || 'en',
        sortBy: 'publishedAt',
        pageSize: '15',
      });
      const evRes = await fetch(`${BASE}/everything?${everythingParams.toString()}`);
      if (evRes.ok) {
        const evData = await evRes.json();
        if (evData.status === 'ok') {
          results.push(...(evData.articles || []));
        }
      }
    }
  } catch {
    return [];
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return results
    .filter(a => a.title && a.title !== '[Removed]' && a.url)
    .filter(a => !a.publishedAt || new Date(a.publishedAt) > cutoff)
    .map(a => ({
      title: a.title || '',
      description: a.description || '',
      content: a.content || a.description || '',
      link: a.url || '',
      image_url: a.urlToImage || null,
      source_name: a.source?.name || 'NewsAPI',
      publishedAt: a.publishedAt || new Date().toISOString(),
      category: matchedCategory || 'general',
      _sourceTag: 'newsapi',
    }));
}
