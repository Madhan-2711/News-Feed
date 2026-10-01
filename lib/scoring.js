// ── Algorithmic Scoring Engine ────────────────────────────────────
// Ranks cached articles for a user by how strongly they match the user's
// topics (title vs. description), how recent they are, source quality and
// click history.

// ── Safe keyword matcher ─────────────────────────────────────────
// Keywords match whole words only, so they can't hit inside other words:
//   e.g. 'ai' must NOT match "s-ai-d"; 'visa' must NOT match "Visa-khapatnam";
//   'travel' must NOT match "Travel-odge".
// Longer keywords also match simple plurals ('visa' → "visas").
const keywordPatterns = new Map();

function kwMatch(combined, kw) {
  let pattern = keywordPatterns.get(kw);
  if (!pattern) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const plural = kw.length > 3 ? '(?:s|es)?' : '';
    pattern = new RegExp(`\\b${escaped}${plural}\\b`, 'i');
    keywordPatterns.set(kw, pattern);
  }
  return pattern.test(combined);
}

// ── Cluster label map ────────────────────────────────────────────
// Rules checked in priority order (first match wins).
// Sports before Tech so that sport articles aren't misclassified.
const CLUSTER_RULES = [
  // ── Sports (high-specificity first) ──
  { keywords: ['cricket', 'ipl', 'bcci', 't20', 'test match', 'odi', 'virat kohli', 'rohit sharma', 'ms dhoni', 'cricket match', 'cricket team'], label: 'Cricket' },
  { keywords: ['football', 'soccer', 'premier league', 'la liga', 'champions league', 'fifa', 'messi', 'ronaldo', 'uefa'], label: 'Football' },
  { keywords: ['tennis', 'wimbledon', 'nadal', 'djokovic', 'federer', 'grand slam', 'atp', 'wta'], label: 'Tennis' },
  { keywords: ['formula 1', 'formula one', 'grand prix', 'verstappen', 'f1 race', 'f1 championship'], label: 'Formula 1' },
  { keywords: ['olympics', 'olympic games', 'gold medal', 'silver medal', 'bronze medal'], label: 'Olympics' },

  // ── Finance & Markets (before AI/Tech to catch "nifty", "stocks") ──
  { keywords: ['nifty 50', 'nifty50', 'sensex', 'bse', 'nse india', 'gift nifty', 'nifty bank'], label: 'Nifty & Sensex' },
  { keywords: ['stock market', 'stock exchange', 'share market', 'equity market', 'bull market', 'bear market', 'market rally', 'market crash'], label: 'Markets' },
  { keywords: ['mutual fund', 'sip', 'portfolio', 'investment', 'investor', 'hedge fund', 'asset management', 'etf'], label: 'Finance' },
  { keywords: ['rbi', 'repo rate', 'monetary policy', 'interest rate', 'inflation', 'gdp', 'fiscal deficit', 'recession', 'cpi', 'wholesale price'], label: 'Economy' },
  { keywords: ['budget', 'income tax', 'gst', 'tax policy', 'finance minister', 'union budget', 'capital gains'], label: 'Finance' },
  { keywords: ['ipo', 'initial public offering', 'listing gains', 'grey market', 'oversubscribed'], label: 'IPO' },
  { keywords: ['bitcoin', 'ethereum', 'crypto', 'blockchain', 'nft', 'web3', 'defi', 'altcoin'], label: 'Crypto' },

  // ── Technology ──
  { keywords: ['artificial intelligence', 'machine learning', 'deep learning', 'llm', 'chatgpt', 'openai', 'deepmind', 'neural network', 'generative ai'], label: 'AI & Tech' },
  { keywords: ['cybersecurity', 'cyber security', 'data breach', 'ransomware', 'malware', 'phishing', 'hacker'], label: 'Cybersecurity' },
  { keywords: ['startup', 'venture capital', 'funding round', 'unicorn', 'y combinator', 'seed round', 'series a'], label: 'Startups' },
  { keywords: ['apple', 'iphone', 'google', 'microsoft', 'amazon', 'meta', 'samsung', 'android', 'ios', 'tesla'], label: 'Big Tech' },
  { keywords: ['space mission', 'nasa', 'isro', 'spacex', 'mars mission', 'satellite launch', 'rocket launch'], label: 'Space' },

  // ── Environment, wildlife, travel, transport ──
  { keywords: ['climate change', 'global warming', 'carbon emission', 'net zero', 'renewable energy', 'solar energy', 'wind energy', 'green energy'], label: 'Climate' },
  { keywords: ['wildlife', 'elephant', 'tiger reserve', 'national park', 'forest department', 'poaching', 'biodiversity', 'endangered species'], label: 'Wildlife' },
  { keywords: ['tourism', 'tourist', 'travel destination', 'travellers', 'travelers', 'visa', 'airline', 'holiday destination'], label: 'Travel' },
  { keywords: ['vande bharat', 'railway', 'train service', 'metro line', 'airport', 'highway', 'expressway', 'flyover', 'traffic jam'], label: 'Transport' },

  // ── Politics (specific first) ──
  { keywords: ['modi', 'bjp', 'lok sabha', 'rajya sabha', 'nda', 'aap', 'trinamool', 'samajwadi', 'aam aadmi party'], label: 'Indian Politics' },
  { keywords: ['trump', 'biden', 'kamala harris', 'white house', 'republican party', 'democratic party', 'us congress'], label: 'US Politics' },
  { keywords: ['ukraine war', 'russia ukraine', 'putin', 'nato alliance', 'middle east conflict', 'israel hamas', 'gaza'], label: 'Geopolitics' },
  { keywords: ['election', 'parliament', 'senate', 'minister', 'legislation', 'ballot', 'polling', 'constituency'], label: 'Politics' },

  // ── Lifestyle / Culture ──
  { keywords: ['bollywood', 'tollywood', 'box office', 'oscar', 'film festival', 'netflix series', 'ott release'], label: 'Entertainment' },
  { keywords: ['health', 'medical', 'disease outbreak', 'vaccine', 'pandemic', 'hospital', 'treatment', 'cancer', 'diabetes'], label: 'Health' },
  { keywords: ['science', 'research study', 'scientific discovery', 'physics', 'biology', 'chemistry', 'astronomy'], label: 'Science' },
  { keywords: ['university', 'board exam', 'entrance exam', 'jee', 'neet', 'upsc', 'school', 'college admission'], label: 'Education' },
];

/**
 * Assign a topic cluster label to an article based on keyword matching.
 * Uses word-boundary matching for short keywords to prevent false positives.
 */
export function clusterArticle(title, text, fallbackCategory = 'general') {
  const combined = `${title} ${(text || '').slice(0, 500)}`.toLowerCase();

  for (const rule of CLUSTER_RULES) {
    for (const kw of rule.keywords) {
      if (kwMatch(combined, kw)) return rule.label;
    }
  }

  // Fallback: capitalize the source category if it's meaningful
  const skip = new Set(['general', 'news', 'top', 'latest', 'world', 'sport']);
  if (fallbackCategory && !skip.has(fallbackCategory.toLowerCase())) {
    return fallbackCategory.charAt(0).toUpperCase() + fallbackCategory.slice(1);
  }
  return 'General';
}

/**
 * Extract first 3 sentences from full text as a summary.
 */
export function extractSummary(fullText) {
  if (!fullText || fullText.trim().length < 50) return null;

  const sentences = fullText
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.length > 15)
    .slice(0, 3);

  if (sentences.length === 0) return fullText.slice(0, 300).trim() + '…';
  const summary = sentences.join(' ').trim();
  return summary.length > 500 ? summary.slice(0, 500).trim() + '…' : summary;
}

/**
 * Explain why an article was picked, based on how it matched (not on its
 * overall score, which also reflects recency and source).
 * strength: 1.0 title match, 0.6 description match, 0.3 search result only.
 */
export function generateRationale(matchedInterest, strength) {
  // No specific topic matched — don't name one the article may not cover
  if (!matchedInterest) return 'Similar to stories you follow.';

  // Clean up the interest label for display (capitalize words)
  const label = matchedInterest
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  if (strength >= MATCH.title) return `Highly relevant to your interest in ${label}.`;
  if (strength >= MATCH.description) return `Matches your interest in ${label}.`;
  return `Related to ${label}.`;
}

/**
 * Build a template-based daily brief from the top articles.
 */
export function buildBrief(topArticles, clusters) {
  if (!topArticles.length) return null;

  const uniqueClusters = [...new Set(clusters)].slice(0, 4);
  const topTitles = topArticles.slice(0, 2).map(a => a.title).filter(Boolean);
  const total = topArticles.length;

  let brief = '';

  if (uniqueClusters.length >= 2) {
    brief += `Today's feed spans ${uniqueClusters.slice(0, -1).join(', ')} and ${uniqueClusters[uniqueClusters.length - 1]}. `;
  } else if (uniqueClusters.length === 1) {
    brief += `Today's feed is focused on ${uniqueClusters[0]}. `;
  }

  if (topTitles.length >= 2) {
    brief += `Top stories: "${topTitles[0]}" and "${topTitles[1]}." `;
  } else if (topTitles.length === 1) {
    brief += `Top story: "${topTitles[0]}." `;
  }

  brief += `${total} articles curated for you.`;
  return brief.trim();
}

// ── Scoring weights ──────────────────────────────────────────────
const WEIGHTS = {
  relevance:     0.60,
  recency:       0.25,
  sourceQuality: 0.10,
  behaviorBoost: 0.05,
};

// How an article matched a topic. Also stored as article_topics.relevance.
export const MATCH = {
  title:       1.0,  // topic keyword in the headline
  description: 0.6,  // only in the summary / opening text
  searchOnly:  0.3,  // a topic search returned it, but no keyword is visible
};

// Source quality by adapter tag
const SOURCE_SCORES = {
  guardian:    0.85,  // full article text
  spaceflight: 0.80,
  googlenews:  0.75,
  rss:         0.70,
  newsdata:    0.70,
  apitube:     0.70,
  hackernews:  0.60,
};

// Smooth decay: 1.0 now, 0.5 at 12h, 0.25 at 24h
function recencyScore(publishedAt) {
  if (!publishedAt) return 0.3;
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3600000);
  return Math.pow(0.5, ageHours / 12);
}

// ── Interest keywords ────────────────────────────────────────────
// Predefined setup interests expand to terms an article about them would use.
// Custom interests fall back to the phrase plus its significant words.
const INTEREST_KEYWORDS = {
  'cricket':          ['cricket', 'ipl', 'bcci', 't20', 'odi', 'test match', 'wicket'],
  'fashion':          ['fashion', 'runway', 'couture', 'apparel', 'fashion week'],
  'health':           ['health', 'medical', 'hospital', 'disease', 'vaccine', 'doctor', 'patient', 'cancer', 'diabetes'],
  'fitness':          ['fitness', 'workout', 'exercise', 'gym', 'yoga', 'marathon'],
  'entertainment':    ['entertainment', 'film', 'movie', 'box office', 'celebrity', 'netflix', 'ott', 'actor', 'actress'],
  'politics':         ['politics', 'political', 'election', 'parliament', 'minister', 'government', 'senate', 'lok sabha'],
  'tech':             ['technology', 'tech', 'software', 'smartphone', 'gadget', 'semiconductor', 'chip'],
  'lifestyle':        ['lifestyle', 'wellness', 'home decor', 'relationship'],
  'science':          ['science', 'scientist', 'research', 'physics', 'biology', 'chemistry', 'astronomy', 'nasa', 'isro'],
  'travel':           ['travel', 'tourism', 'tourist', 'airline', 'visa', 'hotel', 'destination'],
  'comedy':           ['comedy', 'comedian', 'stand-up', 'standup', 'sitcom', 'satire'],
  'art':              ['art', 'artist', 'painting', 'gallery', 'museum', 'exhibition', 'sculpture'],
  'music':            ['music', 'song', 'album', 'concert', 'singer', 'musician', 'grammy'],
  'finance':          ['finance', 'financial', 'stock', 'investor', 'investment', 'mutual fund', 'sensex', 'nifty', 'rbi', 'ipo'],
  'sports':           ['sport', 'sports', 'cricket', 'football', 'tennis', 'olympic', 'tournament', 'league', 'athlete'],
  'ai & ml':          ['artificial intelligence', 'machine learning', 'ai', 'llm', 'chatgpt', 'openai', 'deep learning', 'generative'],
  'gaming':           ['gaming', 'video game', 'videogame', 'gamer', 'esports', 'playstation', 'xbox', 'nintendo', 'steam'],
  'food':             ['food', 'recipe', 'restaurant', 'cuisine', 'chef', 'cooking'],
  'business':         ['business', 'company', 'ceo', 'earnings', 'revenue', 'profit', 'merger', 'acquisition'],
  'nifty 50':         ['nifty', 'sensex', 'bse', 'nse', 'stock market', 'share market', 'dalal street'],
  'indian economics': ['economy', 'gdp', 'rbi', 'inflation', 'repo rate', 'fiscal', 'union budget'],
  'bollywood':        ['bollywood', 'hindi film', 'box office'],
  'environment':      ['environment', 'climate', 'pollution', 'emission', 'wildlife', 'renewable', 'carbon'],
};

// Interests that any news article satisfies.
const GENERAL_INTERESTS = new Set(['news']);

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'news', 'india', 'indian', 'world', 'latest']);

function interestKeywords(interest) {
  const key = (interest || '').toLowerCase().trim();
  if (INTEREST_KEYWORDS[key]) return INTEREST_KEYWORDS[key];
  const words = key.split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set([key, ...words])].filter(Boolean);
}

function articleText(title, text) {
  return `${title} ${(text || '').slice(0, 500)}`.toLowerCase();
}

/**
 * How strongly an article matches one interest: MATCH.title when a
 * keyword is in the headline, MATCH.description when only in the text,
 * otherwise 0. General interests ("News") match any article, at
 * description level so a specific topic match ranks above them.
 */
export function matchStrength(title, text, interest) {
  if (GENERAL_INTERESTS.has((interest || '').toLowerCase().trim())) return MATCH.description;
  const keywords = interestKeywords(interest);
  if (keywords.some(kw => kwMatch((title || '').toLowerCase(), kw))) return MATCH.title;
  const body = (text || '').slice(0, 500).toLowerCase();
  if (keywords.some(kw => kwMatch(body, kw))) return MATCH.description;
  return 0;
}

function matchesInterest(combined, interest) {
  if (GENERAL_INTERESTS.has((interest || '').toLowerCase().trim())) return true;
  return interestKeywords(interest).some(kw => kwMatch(combined, kw));
}

/**
 * Interests whose keywords appear in the article's title or opening text.
 */
export function matchedInterests(title, text, interests) {
  const combined = articleText(title, text);
  return interests.filter(interest => matchesInterest(combined, interest));
}

/**
 * Score an article for a user.
 * @param article { title, full_text, published_at, source_tag }
 * @param interests the user's topics
 * @param opts.topicRelevance { [interest]: cached article_topics.relevance }
 *   — how a topic search matched it at collection time
 * @returns {{ score: number, interest: string|null, strength: number }}
 *   score 0 when the article matches none of the interests.
 */
export function scoreArticle(article, interests, {
  topicRelevance = {},
  behaviorClusters = [],
  cluster = '',
} = {}) {
  // Best match across the user's interests: keyword strength now, or the
  // relevance recorded when a topic search collected it.
  let best = { interest: null, strength: 0 };
  for (const interest of interests) {
    const strength = Math.max(
      matchStrength(article.title, article.full_text, interest),
      topicRelevance[interest] || 0,
    );
    if (strength > best.strength) best = { interest, strength };
  }

  // Recency and source weight alone must not lift an unrelated article
  if (interests.length && best.strength === 0) return { score: 0, interest: null, strength: 0 };

  const relevance = interests.length ? best.strength : 0.5;
  const recency   = recencyScore(article.published_at || article.publishedAt);
  const srcScore  = SOURCE_SCORES[article.source_tag || article._sourceTag] || 0.6;
  const behBoost  = behaviorClusters.some(bc => bc.toLowerCase() === cluster.toLowerCase()) ? 1 : 0;

  const score =
    relevance * WEIGHTS.relevance +
    recency   * WEIGHTS.recency +
    srcScore  * WEIGHTS.sourceQuality +
    behBoost  * WEIGHTS.behaviorBoost;

  return { score: Math.min(1, Math.max(0, score)), ...best };
}
