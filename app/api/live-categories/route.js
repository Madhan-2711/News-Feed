import { NextResponse } from 'next/server';

const TOPIC_MAP = {
  sports:   'sports',
  politics: 'nation',
  business: 'business',
  tech:     'technology',
};

function getKey(index) {
  const keys = (process.env.GNEWS_API_KEYS || process.env.GNEWS_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) return null;
  return keys[index % keys.length];
}

function mapItems(raw = []) {
  return raw.slice(0, 5).map(a => ({
    title:       a.title || 'Untitled',
    source:      a.source?.name || 'Unknown',
    url:         a.url || '#',
    publishedAt: a.publishedAt || new Date().toISOString(),
    image:       a.image || null,
  }));
}

async function fetchTopic(topic, keyIndex) {
  const key = getKey(keyIndex);
  if (!key) return [];
  try {
    const res = await fetch(
      `https://gnews.io/api/v4/top-headlines?topic=${topic}&lang=en&max=5&apikey=${key}`,
      { next: { revalidate: 1800 } }          // 30-min Next.js cache
    );
    if (!res.ok) return [];
    const data = await res.json();
    return mapItems(data.articles);
  } catch {
    return [];
  }
}

export async function GET() {
  // Fetch 3 categories in parallel — each uses a different key slot
  const [sports, politics, bizRaw, techRaw] = await Promise.all([
    fetchTopic(TOPIC_MAP.sports,   0),
    fetchTopic(TOPIC_MAP.politics, 1),
    fetchTopic(TOPIC_MAP.business, 2),
    fetchTopic(TOPIC_MAP.tech,     2),   // shares key[2] — business + tech merged below
  ]);

  // Merge business + tech, de-dup by url, take top 5
  const seen = new Set();
  const bigMoves = [...bizRaw, ...techRaw].filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  }).slice(0, 5);

  return NextResponse.json({ sports, politics, bigMoves });
}
