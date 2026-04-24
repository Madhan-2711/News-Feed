// ── RSS Source Adapter ────────────────────────────────────────────
// Pulls from Indian + international RSS feeds.
// No API key needed, no rate limits.

import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 8000,
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure'],
  },
});

// Feed catalogue — tagged by geography and topic
const FEEDS = [
  // Indian — general
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', source: 'Times of India', country: 'in', topic: 'general' },
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories', source: 'NDTV', country: 'in', topic: 'general' },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', source: 'The Hindu', country: 'in', topic: 'general' },
  // Indian — business / finance
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', source: 'Economic Times', country: 'in', topic: 'finance' },
  // Indian — cricket / sports
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', source: 'TOI Sports', country: 'in', topic: 'sports' },
  // International
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC News', country: 'world', topic: 'general' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: 'BBC Technology', country: 'world', topic: 'technology' },
  // Science
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', source: 'BBC Science', country: 'world', topic: 'science' },
];

function extractImage(item) {
  if (item['media:content']?.$.url) return item['media:content'].$.url;
  if (item['media:thumbnail']?.$.url) return item['media:thumbnail'].$.url;
  if (item.enclosure?.url) return item.enclosure.url;
  return null;
}

// Strip SEO meta template tokens (%%variable%%) and other junk patterns
// that some RSS feeds use instead of real descriptions
function sanitizeText(text = '') {
  return text
    .replace(/%%[^%]*%%/g, '')   // %%title%% %%sep%% %%sitename%% etc.
    .replace(/\s{2,}/g, ' ')     // collapse leftover whitespace
    .trim();
}

// Returns true if the text looks like real human-readable content
function isUsableText(text = '') {
  const cleaned = sanitizeText(text);
  return cleaned.length > 40; // at least a sentence worth of content
}

async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return (parsed.items || [])
      .filter(item => {
        if (!item.pubDate) return true;
        return new Date(item.pubDate) > cutoff;
      })
      .slice(0, 8) // max 8 per feed
      .map(item => {
        const rawDescription = item.contentSnippet || item.summary || '';
        const rawContent     = item.content || item.contentSnippet || '';
        const description    = sanitizeText(rawDescription);
        const content        = sanitizeText(rawContent);
        return {
          title:        item.title || '',
          description,
          content,
          link:         item.link || item.guid || '',
          image_url:    extractImage(item),
          source_name:  feed.source,
          publishedAt:  item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          category:     feed.topic,
          _sourceTag:   'rss',
          _feedCountry: feed.country,
        };
      })
      // Drop articles where the description is still junk after sanitizing
      .filter(item => item.title.length > 10 && isUsableText(item.description || item.content));
  } catch {
    return [];
  }
}

export async function fetchFromRSS(interests = [], _lang = 'en', country = '') {
  const queries = (Array.isArray(interests) ? interests : Object.values(interests).filter(Boolean))
    .map(q => q.toLowerCase());

  // Select feeds: always include country-relevant feeds + interest-topic feeds
  let selectedFeeds = FEEDS.filter(f => {
    if (country === 'in' && f.country === 'in') return true; // India news for IN users
    if (!country && f.country === 'world') return true;       // World for international
    if (f.country === 'world') return true;                   // Always include world feeds
    return false;
  });

  // Boost feeds that match user interests (topic-specific feeds)
  const interestTopics = new Set();
  for (const q of queries) {
    if (q.includes('finance') || q.includes('stock') || q.includes('econom') || q.includes('nifty') || q.includes('sensex')) interestTopics.add('finance');
    if (q.includes('cricket') || q.includes('sport') || q.includes('ipl')) interestTopics.add('sports');
    if (q.includes('tech') || q.includes('ai') || q.includes('software')) interestTopics.add('technology');
    if (q.includes('science') || q.includes('health')) interestTopics.add('science');
  }

  // Add country-specific interest feeds
  if (country === 'in') {
    FEEDS.filter(f => f.country === 'in' && interestTopics.has(f.topic)).forEach(f => {
      if (!selectedFeeds.includes(f)) selectedFeeds.push(f);
    });
  }

  // Deduplicate selected feeds
  selectedFeeds = [...new Set(selectedFeeds)].slice(0, 5); // cap at 5 feeds for speed

  // Fetch all in parallel
  const results = await Promise.all(selectedFeeds.map(fetchFeed));
  return results.flat();
}
