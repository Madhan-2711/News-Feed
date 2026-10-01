import { NextResponse } from 'next/server';
import { topStories } from '@/lib/sources/googlenews';

// Public home-page headlines from Google News top stories (free, no key).
// The upstream feed is cached for 30 minutes per edition.
const CACHE_SECONDS = 1800;

const EDITIONS = {
  national:      { country: 'in', lang: 'en' },
  international: { country: '',   lang: 'en' },
  trending:      { country: '',   lang: 'en' },
};

function mapArticles(items) {
  return items.slice(0, 10).map((item, index) => ({
    index: index + 1,
    title: item.title || 'Untitled',
    source: item.source_name || 'Unknown',
    url: item.link || '',
    date: item.publishedAt || new Date().toISOString(),
    description: item.description || '',
    image: item.image_url || null,
  }));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = EDITIONS[searchParams.get('type')] ? searchParams.get('type') : 'trending';

  try {
    const articles = mapArticles(await topStories({ ...EDITIONS[type], revalidate: CACHE_SECONDS }));
    return NextResponse.json({ articles, total: articles.length, type });
  } catch (error) {
    console.error(`Trending [${type}] fetch error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch trending news', details: error.message },
      { status: 500 }
    );
  }
}
