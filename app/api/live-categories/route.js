import { NextResponse } from 'next/server';
import { sectionHeadlines } from '@/lib/sources/googlenews';

// Home-page "live" sidebar from Google News section feeds (free, no key).
// Upstream feeds are cached for 30 minutes.
const CACHE_SECONDS = 1800;

function mapItems(items = []) {
  return items.slice(0, 5).map(a => ({
    title:       a.title || 'Untitled',
    source:      a.source_name || 'Unknown',
    url:         a.link || '#',
    publishedAt: a.publishedAt || new Date().toISOString(),
    image:       a.image_url || null,
  }));
}

async function section(name) {
  try {
    return await sectionHeadlines(name, { country: '', lang: 'en', revalidate: CACHE_SECONDS });
  } catch (err) {
    console.warn(`[live-categories] ${name} failed: ${err.message}`);
    return [];
  }
}

export async function GET() {
  const [sports, world, business, tech] = await Promise.all([
    section('SPORTS'),
    section('WORLD'),
    section('BUSINESS'),
    section('TECHNOLOGY'),
  ]);

  // "Big moves": business and tech headlines, interleaved, without repeats
  const seen = new Set();
  const bigMoves = business.flatMap((b, i) => [b, tech[i]]).filter(a => {
    if (!a || seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  return NextResponse.json({
    sports: mapItems(sports),
    world: mapItems(world),
    bigMoves: mapItems(bigMoves),
  });
}
