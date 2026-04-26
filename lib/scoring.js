// ── Algorithmic Scoring Engine ────────────────────────────────────
// Replaces external AI (Cerebras/Groq) for article ranking.
// Uses: vector similarity + keyword overlap + recency + source weight.

import { cosineSimilarity } from './embeddings.js';

// ── Safe keyword matcher ─────────────────────────────────────────
// Short keywords (≤3 chars) use word-boundary regex to avoid false positives:
//   e.g. 'ai' must NOT match "ch-ai-rman", "s-ai-d", "ava-i-lable"
//   e.g. 'f1' must NOT match "f1rst", "f1nance"
// Long keywords use plain includes() for speed.
function kwMatch(combined, kw) {
  if (kw.length <= 3) {
    // Escape special regex chars in the keyword, then wrap in word boundaries
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(combined);
  }
  return combined.includes(kw);
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

  // ── Environment ──
  { keywords: ['climate change', 'global warming', 'carbon emission', 'net zero', 'renewable energy', 'solar energy', 'wind energy', 'green energy'], label: 'Climate' },

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
 * Generate a rationale string explaining why this article matched.
 */
export function generateRationale(matchedInterest, score) {
  // Clean up the interest label for display (capitalize words)
  const label = (matchedInterest || 'your topics')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  if (score > 0.65) return `Highly relevant to your interest in ${label}.`;
  if (score > 0.45) return `Matches your interest in ${label}.`;
  if (score > 0.30) return `Related to ${label}.`;
  return 'Based on article content.';
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
  vectorSimilarity: 0.50,
  keywordOverlap:   0.20,
  recency:          0.15,
  sourceQuality:    0.10,
  behaviorBoost:    0.05,
};

// Source quality — country-filtered sources rank higher
const SOURCE_SCORES = {
  gnews:    0.85,
  newsapi:  0.80,
  newsdata: 0.75,
  guardian: 0.60,
  rss:      0.50,
};

function recencyScore(publishedAt) {
  if (!publishedAt) return 0.5;
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
  if (ageHours < 6)  return 1.0;
  if (ageHours < 12) return 0.9;
  if (ageHours < 24) return 0.75;
  if (ageHours < 36) return 0.5;
  return 0.3;
}

function keywordOverlapScore(title, text, interests) {
  if (!interests.length) return 0.5;
  const combined = `${title} ${(text || '').slice(0, 500)}`.toLowerCase();
  let matches = 0;
  for (const interest of interests) {
    const words = (interest || '').toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && kwMatch(combined, word)) {
        matches++;
        break;
      }
    }
  }
  return matches / interests.length;
}

/**
 * Score an article using the composite formula.
 */
export function scoreArticle(
  article,
  userEmbedding,
  articleEmbedding,
  interests,
  behaviorClusters = [],
  cluster = ''
) {
  const vecSim = userEmbedding && articleEmbedding
    ? Math.max(0, cosineSimilarity(userEmbedding, articleEmbedding))
    : 0.5;

  const kwScore  = keywordOverlapScore(article.title, article.full_text, interests);
  const recency  = recencyScore(article.published_at || article.publishedAt);
  const srcScore = SOURCE_SCORES[article._sourceTag] || 0.6;
  const behBoost = behaviorClusters.some(bc =>
    bc.toLowerCase() === cluster.toLowerCase()
  ) ? 1.0 : 0.0;

  const score =
    vecSim   * WEIGHTS.vectorSimilarity +
    kwScore  * WEIGHTS.keywordOverlap +
    recency  * WEIGHTS.recency +
    srcScore * WEIGHTS.sourceQuality +
    behBoost * WEIGHTS.behaviorBoost;

  return Math.min(1, Math.max(0, score));
}

/**
 * Find the best-matching interest string for rationale generation.
 * Checks full interest phrase first, then individual words.
 */
export function findBestInterest(title, fullText, interests) {
  const combined = `${title} ${(fullText || '').slice(0, 300)}`.toLowerCase();

  // Try full phrase match first (e.g. "stock market")
  for (const interest of interests) {
    if (combined.includes((interest || '').toLowerCase())) return interest;
  }

  // Fall back to individual word match
  for (const interest of interests) {
    const words = (interest || '').toLowerCase().split(/\s+/);
    if (words.some(w => w.length > 2 && kwMatch(combined, w))) return interest;
  }

  return interests[0] || 'your topics';
}
