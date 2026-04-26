// ── Algorithmic Scoring Engine ────────────────────────────────────
// Replaces external AI (Cerebras/Groq) for article ranking.
// Uses: vector similarity + keyword overlap + recency + source weight.

import { cosineSimilarity } from './embeddings.js';

// ── Cluster label map ────────────────────────────────────────────
// Maps keywords found in title/text → a clean cluster label.
// Checked in priority order (first match wins).
const CLUSTER_RULES = [
  { keywords: ['cricket', 'ipl', 'bcci', 't20', 'test match', 'odi', 'virat', 'rohit', 'dhoni'], label: 'Cricket' },
  { keywords: ['football', 'soccer', 'premier league', 'la liga', 'champions league', 'fifa', 'messi', 'ronaldo'], label: 'Football' },
  { keywords: ['tennis', 'wimbledon', 'nadal', 'djokovic', 'federer', 'grand slam'], label: 'Tennis' },
  { keywords: ['f1', 'formula 1', 'formula one', 'grand prix', 'verstappen', 'hamilton'], label: 'Formula 1' },
  { keywords: ['olympics', 'olympic', 'medal', 'athlete'], label: 'Olympics' },
  { keywords: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'chatgpt', 'openai', 'deepmind', 'neural'], label: 'AI & Tech' },
  { keywords: ['cybersecurity', 'cyber security', 'hacker', 'data breach', 'ransomware', 'malware', 'phishing'], label: 'Cybersecurity' },
  { keywords: ['startup', 'venture capital', 'funding round', 'unicorn', 'ipo', 'y combinator'], label: 'Startups' },
  { keywords: ['apple', 'iphone', 'google', 'microsoft', 'amazon', 'meta', 'samsung', 'android', 'ios'], label: 'Big Tech' },
  { keywords: ['blockchain', 'bitcoin', 'crypto', 'ethereum', 'nft', 'web3'], label: 'Crypto' },
  { keywords: ['space', 'nasa', 'isro', 'spacex', 'mars', 'satellite', 'rocket', 'orbit'], label: 'Space' },
  { keywords: ['climate', 'global warming', 'carbon', 'renewable', 'solar', 'wind energy', 'emission'], label: 'Climate' },
  { keywords: ['election', 'parliament', 'congress', 'senate', 'minister', 'governor', 'legislation', 'ballot', 'vote'], label: 'Politics' },
  { keywords: ['modi', 'bjp', 'congress', 'lok sabha', 'rajya sabha', 'indian politics'], label: 'Indian Politics' },
  { keywords: ['trump', 'biden', 'white house', 'republican', 'democrat', 'us politics'], label: 'US Politics' },
  { keywords: ['ukraine', 'russia', 'putin', 'nato', 'war', 'conflict', 'military'], label: 'Geopolitics' },
  { keywords: ['stock', 'market', 'sensex', 'nifty', 'dow', 'nasdaq', 'shares', 'trading', 'bull', 'bear'], label: 'Markets' },
  { keywords: ['rbi', 'fed', 'interest rate', 'inflation', 'gdp', 'recession', 'fiscal', 'monetary'], label: 'Economy' },
  { keywords: ['bollywood', 'tollywood', 'netflix', 'movie', 'film', 'box office', 'oscar', 'cinema'], label: 'Entertainment' },
  { keywords: ['health', 'medical', 'disease', 'vaccine', 'who', 'pandemic', 'hospital', 'drug', 'treatment'], label: 'Health' },
  { keywords: ['science', 'research', 'study', 'discovery', 'experiment', 'physics', 'biology', 'chemistry'], label: 'Science' },
  { keywords: ['education', 'university', 'school', 'exam', 'student', 'college', 'admission'], label: 'Education' },
];

/**
 * Assign a topic cluster label to an article based on keyword matching.
 * Falls back to the article's source category if no keyword matches.
 */
export function clusterArticle(title, text, fallbackCategory = 'general') {
  const combined = `${title} ${(text || '').slice(0, 500)}`.toLowerCase();

  for (const rule of CLUSTER_RULES) {
    for (const kw of rule.keywords) {
      if (combined.includes(kw)) return rule.label;
    }
  }

  // Fallback: capitalize the source category
  if (fallbackCategory && fallbackCategory !== 'general') {
    return fallbackCategory.charAt(0).toUpperCase() + fallbackCategory.slice(1);
  }
  return 'General';
}

/**
 * Extract first 3 sentences from full text as a summary.
 * Returns a clean string or null if text is too short.
 */
export function extractSummary(fullText) {
  if (!fullText || fullText.trim().length < 50) return null;

  // Split on sentence boundaries (period + space, exclamation, question mark)
  const sentences = fullText
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.length > 15) // skip tiny fragments
    .slice(0, 3);

  if (sentences.length === 0) return fullText.slice(0, 300).trim() + '…';
  const summary = sentences.join(' ').trim();
  return summary.length > 500 ? summary.slice(0, 500).trim() + '…' : summary;
}

/**
 * Generate a rationale string explaining why this article matched.
 */
export function generateRationale(matchedInterest, similarity) {
  if (similarity > 0.7) return `Highly relevant to your interest in ${matchedInterest}.`;
  if (similarity > 0.5) return `Matches your interest in ${matchedInterest}.`;
  if (similarity > 0.3) return `Related to ${matchedInterest}.`;
  return 'Based on article content.';
}

/**
 * Build a template-based daily brief from the top articles.
 */
export function buildBrief(topArticles, clusters) {
  if (!topArticles.length) return null;

  // Get unique cluster names from the feed
  const uniqueClusters = [...new Set(clusters)].slice(0, 4);
  const topTitles = topArticles.slice(0, 3).map(a => a.title).filter(Boolean);

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

  // Add article count
  brief += `${topArticles.length} articles curated for you.`;

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

// Source quality scores — country-filtered sources rank higher
const SOURCE_SCORES = {
  gnews:    0.85, // country-filtered, decent content
  newsapi:  0.80, // country-filtered, major outlets
  newsdata: 0.75, // country-filtered, full text
  guardian: 0.60, // UK-biased for non-UK countries
  rss:      0.50, // unfiltered, generic
};

/**
 * Calculate recency score (0–1) based on article age.
 */
function recencyScore(publishedAt) {
  if (!publishedAt) return 0.5;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 6)  return 1.0;
  if (ageHours < 12) return 0.9;
  if (ageHours < 24) return 0.75;
  if (ageHours < 36) return 0.5;
  return 0.3;
}

/**
 * Calculate keyword overlap score between article and user interests.
 */
function keywordOverlapScore(title, text, interests) {
  if (!interests.length) return 0.5;
  const combined = `${title} ${(text || '').slice(0, 500)}`.toLowerCase();
  let matches = 0;
  for (const interest of interests) {
    const words = (interest || '').toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && combined.includes(word)) {
        matches++;
        break; // count each interest once
      }
    }
  }
  return matches / interests.length;
}

/**
 * Score an article using the composite formula.
 * @param {object} article - The DB article row (title, full_text, source, etc.)
 * @param {number[]} userEmbedding - User's interest embedding (384 dims)
 * @param {number[]} articleEmbedding - Article's embedding (384 dims)
 * @param {string[]} interests - User's interest strings
 * @param {string[]} behaviorClusters - Cluster names from user's click history
 * @param {string} cluster - Assigned cluster label for this article
 * @returns {number} Final score 0–1
 */
export function scoreArticle(
  article,
  userEmbedding,
  articleEmbedding,
  interests,
  behaviorClusters = [],
  cluster = ''
) {
  // 1. Vector similarity (primary signal)
  const vecSim = userEmbedding && articleEmbedding
    ? Math.max(0, cosineSimilarity(userEmbedding, articleEmbedding))
    : 0.5; // fallback if embeddings unavailable

  // 2. Keyword overlap
  const kwScore = keywordOverlapScore(article.title, article.full_text, interests);

  // 3. Recency
  const recency = recencyScore(article.published_at || article.publishedAt);

  // 4. Source quality
  const srcScore = SOURCE_SCORES[article._sourceTag] || 0.6;

  // 5. Behavior boost — small bump if article cluster matches user's reading history
  const behBoost = behaviorClusters.some(bc =>
    bc.toLowerCase() === cluster.toLowerCase()
  ) ? 1.0 : 0.0;

  // Composite
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
 */
export function findBestInterest(title, interests) {
  const titleLower = (title || '').toLowerCase();
  for (const interest of interests) {
    const words = (interest || '').toLowerCase().split(/\s+/);
    if (words.some(w => w.length > 2 && titleLower.includes(w))) {
      return interest;
    }
  }
  return interests[0] || 'your topics';
}
