import { NextResponse } from 'next/server';

function getKeys() {
  return (process.env.GNEWS_API_KEYS || process.env.GNEWS_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);
}

// Dedicated key per request type — 3 keys means national, international, and
// trending all get their own key, so parallel requests never share a key.
const KEY_INDEX = { national: 0, international: 1, trending: 2 };

function pickKey(type) {
  const keys = getKeys();
  if (!keys.length) return null;
  const idx = KEY_INDEX[type] ?? 0;
  return keys[idx % keys.length]; // falls back gracefully if fewer than 3 keys
}

function mapArticles(raw) {
  return (raw || []).map((item, index) => ({
    index: index + 1,
    title: item.title || 'Untitled',
    source: item.source?.name || 'Unknown',
    url: item.url || '',
    date: item.publishedAt || new Date().toISOString(),
    description: item.description || '',
    image: item.image || null,
  }));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'trending'; // 'national' | 'international' | 'trending'

  const apiKey = pickKey(type);
  if (!apiKey) {
    return NextResponse.json({ error: 'GNews API key not configured' }, { status: 500 });
  }

  try {
    let url;

    if (type === 'national') {
      // Key[0] — India top headlines
      url = `https://gnews.io/api/v4/top-headlines?lang=en&country=in&max=10&apikey=${apiKey}`;
    } else if (type === 'international') {
      // Key[1] — Global top headlines (no country filter)
      url = `https://gnews.io/api/v4/top-headlines?lang=en&max=10&apikey=${apiKey}`;
    } else {
      // Key[2] — Default trending (backward compat)
      url = `https://gnews.io/api/v4/top-headlines?lang=en&max=10&apikey=${apiKey}`;
    }

    const res = await fetch(url, { next: { revalidate: 1800 } }); // 30-min Next.js cache
    if (!res.ok) throw new Error(`GNews API error: ${res.status}`);

    const data = await res.json();
    const articles = mapArticles(data.articles);

    return NextResponse.json({ articles, total: articles.length, type });
  } catch (error) {
    console.error(`Trending [${type}] fetch error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch trending news', details: error.message },
      { status: 500 }
    );
  }
}
