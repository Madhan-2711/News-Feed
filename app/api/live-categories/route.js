import { NextResponse } from 'next/server';
import { latestFromFeeds } from '@/lib/sources/rss';
import { sectionHeadlines } from '@/lib/sources/googlenews';

// Home-page "live" sidebar from publisher RSS feeds (with images). Google
// News sections are only a fallback if a feed group returns nothing.
// Upstream feeds are cached for 30 minutes.
const CACHE_SECONDS = 1800;

const SECTIONS = {
  sports: {
    feeds: ['https://feeds.bbci.co.uk/sport/rss.xml', 'https://indianexpress.com/section/sports/feed/'],
    fallback: 'SPORTS',
  },
  world: {
    feeds: ['https://feeds.bbci.co.uk/news/world/rss.xml'],
    fallback: 'WORLD',
  },
  bigMoves: {
    feeds: [
      'https://feeds.bbci.co.uk/news/business/rss.xml',
      'https://www.livemint.com/rss/markets',
      'https://www.theverge.com/rss/index.xml',
    ],
    fallback: 'BUSINESS',
  },
};

function mapItems(items = []) {
  return items.slice(0, 5).map(a => ({
    title:       a.title || 'Untitled',
    source:      a.source_name || 'Unknown',
    url:         a.link || '#',
    publishedAt: a.publishedAt || new Date().toISOString(),
    image:       a.image_url || null,
  }));
}

async function section({ feeds, fallback }) {
  try {
    const items = await latestFromFeeds(feeds, { limit: 5, revalidate: CACHE_SECONDS });
    if (items.length) return items;
    return await sectionHeadlines(fallback, { country: '', lang: 'en', revalidate: CACHE_SECONDS });
  } catch (err) {
    console.warn(`[live-categories] ${fallback} failed: ${err.message}`);
    return [];
  }
}

export async function GET() {
  const [sports, world, bigMoves] = await Promise.all([
    section(SECTIONS.sports),
    section(SECTIONS.world),
    section(SECTIONS.bigMoves),
  ]);
  return NextResponse.json({
    sports: mapItems(sports),
    world: mapItems(world),
    bigMoves: mapItems(bigMoves),
  });
}
