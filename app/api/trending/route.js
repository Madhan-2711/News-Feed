import { NextResponse } from 'next/server';
import { latestFromFeeds } from '@/lib/sources/rss';
import { topStories } from '@/lib/sources/googlenews';

// Public home-page headlines from publisher RSS feeds (with images).
// Google News top stories are only a fallback if the feeds fail.
// Upstream feeds are cached for 30 minutes.
const CACHE_SECONDS = 1800;

const EDITIONS = {
  national: {
    feeds: [
      'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
      'https://feeds.feedburner.com/ndtvnews-top-stories',
      'https://www.thehindu.com/news/national/feeder/default.rss',
    ],
    fallback: { country: 'in', lang: 'en' },
  },
  international: {
    feeds: ['https://feeds.bbci.co.uk/news/world/rss.xml'],
    fallback: { country: '', lang: 'en' },
  },
};
EDITIONS.trending = EDITIONS.international;

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
  const edition = EDITIONS[type];

  try {
    let items = await latestFromFeeds(edition.feeds, { revalidate: CACHE_SECONDS });
    if (!items.length) items = await topStories({ ...edition.fallback, revalidate: CACHE_SECONDS });
    const articles = mapArticles(items);
    return NextResponse.json({ articles, total: articles.length, type });
  } catch (error) {
    console.error(`Trending [${type}] fetch error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch trending news', details: error.message },
      { status: 500 }
    );
  }
}
