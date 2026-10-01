// ── RSS Feed Catalog ──────────────────────────────────────────────
// Publisher feeds: free, no key, no rate limit. Each feed lists the
// topics its section covers; the ingest job still checks every item's
// keywords, so a feed's topics only add a weak "came from this section"
// signal. All feeds verified working on 2026-10-01.

import { fetchFeed, plainText, isoDate } from './http.js';

// country 'in' feeds are used for India editions; 'world' feeds for all.
export const FEEDS = [
  // India — general
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', source: 'Times of India', country: 'in', topics: [] },
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories', source: 'NDTV', country: 'in', topics: [] },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', source: 'The Hindu', country: 'in', topics: ['politics'] },
  // India — topic sections
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', source: 'TOI Sports', country: 'in', topics: ['sports'] },
  { url: 'https://www.thehindu.com/sport/feeder/default.rss', source: 'The Hindu', country: 'in', topics: ['sports'] },
  { url: 'https://indianexpress.com/section/sports/feed/', source: 'Indian Express', country: 'in', topics: ['sports'] },
  { url: 'https://feeds.feedburner.com/ndtvsports-latest', source: 'NDTV Sports', country: 'in', topics: ['sports'] },
  { url: 'https://www.thehindu.com/sci-tech/science/feeder/default.rss', source: 'The Hindu', country: 'in', topics: ['science'] },
  { url: 'https://www.thehindu.com/entertainment/feeder/default.rss', source: 'The Hindu', country: 'in', topics: ['entertainment'] },
  { url: 'https://indianexpress.com/section/entertainment/bollywood/feed/', source: 'Indian Express', country: 'in', topics: ['bollywood', 'entertainment'] },
  { url: 'https://indianexpress.com/section/lifestyle/food-wine/feed/', source: 'Indian Express', country: 'in', topics: ['food'] },
  { url: 'https://indianexpress.com/section/technology/feed/', source: 'Indian Express', country: 'in', topics: ['tech'] },
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', source: 'Economic Times', country: 'in', topics: ['business'] },
  { url: 'https://www.thehindu.com/business/feeder/default.rss', source: 'The Hindu', country: 'in', topics: ['business'] },
  { url: 'https://www.livemint.com/rss/markets', source: 'Mint', country: 'in', topics: ['nifty 50', 'finance'] },
  { url: 'https://www.livemint.com/rss/economy', source: 'Mint', country: 'in', topics: ['indian economics'] },
  // International
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC News', country: 'world', topics: [] },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business', country: 'world', topics: ['business'] },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: 'BBC Technology', country: 'world', topics: ['tech'] },
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', source: 'BBC Science', country: 'world', topics: ['science', 'environment'] },
  { url: 'https://feeds.bbci.co.uk/news/health/rss.xml', source: 'BBC Health', country: 'world', topics: ['health'] },
  { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', source: 'BBC Culture', country: 'world', topics: ['entertainment', 'art'] },
  { url: 'https://feeds.bbci.co.uk/sport/rss.xml', source: 'BBC Sport', country: 'world', topics: ['sports'] },
  { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge', country: 'world', topics: ['tech'] },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica', country: 'world', topics: ['tech', 'science'] },
  { url: 'https://www.gamespot.com/feeds/mashup/', source: 'GameSpot', country: 'world', topics: ['gaming'] },
  { url: 'https://www.polygon.com/rss/index.xml', source: 'Polygon', country: 'world', topics: ['gaming'] },
  { url: 'https://www.rollingstone.com/music/feed/', source: 'Rolling Stone', country: 'world', topics: ['music'] },
  { url: 'https://www.vogue.com/feed/rss', source: 'Vogue', country: 'world', topics: ['fashion', 'lifestyle'] },
];

const MAX_ITEMS_PER_FEED = 40;

function extractImage(item) {
  if (item['media:content']?.$?.url) return item['media:content'].$.url;
  if (item['media:thumbnail']?.$?.url) return item['media:thumbnail'].$.url;
  if (item.enclosure?.url) return item.enclosure.url;
  return null;
}

// Strip SEO template tokens (%%title%% etc.) some feeds use as descriptions
function sanitizeText(text = '') {
  return plainText(text).replace(/%%[^%]*%%/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Feeds that apply to a country edition: its own feeds plus international ones. */
export function feedsForCountry(country = '') {
  return FEEDS.filter(f => f.country === 'world' || (country && f.country === country));
}

// revalidate: seconds to reuse the response via Next's fetch cache (public
// home-page headlines); omitted by the ingest job, which wants fresh data.
async function readFeed(feed, { revalidate } = {}) {
  try {
    const parsed = await fetchFeed(feed.url, {
      timeoutMs: 8000,
      ...(revalidate ? { next: { revalidate } } : {}),
    });
    return (parsed.items || []).slice(0, MAX_ITEMS_PER_FEED).map(item => ({
      title:        sanitizeText(item.title || ''),
      description:  sanitizeText(item.contentSnippet || item.summary || ''),
      content:      sanitizeText(item.content || item.contentSnippet || ''),
      link:         item.link || item.guid || '',
      image_url:    extractImage(item),
      source_name:  feed.source,
      publishedAt:  isoDate(item.isoDate || item.pubDate),
      category:     feed.topics[0] || 'general',
      _sourceTag:   'rss',
      _feedTopics:  feed.topics,
    })).filter(a => a.title.length > 10 && a.link);
  } catch (err) {
    console.warn(`[rss] ${feed.source} failed: ${err.message}`);
    return [];
  }
}

/**
 * Latest items from the catalog feeds whose URL is listed, newest first.
 * Used for the home-page headline sections.
 */
export async function latestFromFeeds(urls, { limit = 10, revalidate } = {}) {
  const feeds = FEEDS.filter(f => urls.includes(f.url));
  const items = (await Promise.all(feeds.map(f => readFeed(f, { revalidate })))).flat();
  return items
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, limit);
}

/** Fetch every feed for a country edition, in parallel. */
export async function fetchFeedCatalog(country = '') {
  const results = await Promise.all(feedsForCountry(country).map(readFeed));
  return results.flat();
}
