// ── GNews Source Adapter ──────────────────────────────────────────
// Fetches up to 10 articles from GNews using keyword search or top-headlines fallback.

const TERM_MAP = {
  'nifty 50': 'India stock market',
  'nifty': 'India stock market',
  'sensex': 'India stock market BSE',
  'indian economics': 'India economy',
  'indian economy': 'India economy',
  'stock market': 'stock market finance',
  'ai & ml': 'artificial intelligence',
  'ai': 'artificial intelligence',
  'cricket': 'cricket IPL',
  'ipl': 'IPL cricket',
  'bollywood': 'Bollywood India',
};

function getGNewsKey() {
  const keys = (process.env.GNEWS_API_KEYS || process.env.GNEWS_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

export async function fetchFromGNews(interests = [], lang = 'en', country = '') {
  const apiKey = getGNewsKey();
  if (!apiKey) return [];

  const queries = (Array.isArray(interests) ? interests : Object.values(interests).filter(Boolean))
    .map(q => TERM_MAP[q.toLowerCase()] || q);

  const q = queries.slice(0, 3).join(' OR ');

  let url = q
    ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&max=10&sortby=publishedAt&apikey=${apiKey}`
    : `https://gnews.io/api/v4/top-headlines?lang=${lang}&max=10&apikey=${apiKey}`;
  if (country) url += `&country=${country}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Fallback to top-headlines if search fails
      let fallbackUrl = `https://gnews.io/api/v4/top-headlines?lang=${lang}&max=10&apikey=${apiKey}`;
      if (country) fallbackUrl += `&country=${country}`;
      const fb = await fetch(fallbackUrl);
      if (!fb.ok) return [];
      const fbData = await fb.json();
      return normalizeGNews(fbData.articles || [], 'gnews');
    }
    const data = await res.json();
    let articles = data.articles || [];

    // Fallback if keyword search returned 0
    if (!articles.length && q) {
      let fallbackUrl = `https://gnews.io/api/v4/top-headlines?lang=${lang}&max=10&apikey=${apiKey}`;
      if (country) fallbackUrl += `&country=${country}`;
      const fb = await fetch(fallbackUrl);
      if (fb.ok) {
        const fbData = await fb.json();
        articles = fbData.articles || [];
      }
    }

    return normalizeGNews(articles, 'gnews');
  } catch {
    return [];
  }
}

function normalizeGNews(articles, sourceTag) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return articles
    .filter(a => !a.publishedAt || new Date(a.publishedAt) > cutoff)
    .map(a => ({
      title: a.title || '',
      description: a.description || '',
      content: a.content || '',
      link: a.url || '',
      image_url: a.image || null,
      source_name: a.source?.name || 'GNews',
      publishedAt: a.publishedAt || new Date().toISOString(),
      category: 'general',
      _sourceTag: sourceTag,
    }));
}
