// ── Topic search terms and cache keys ────────────────────────────
// Shared by the ingest job and Fetch News. Search phrases use Google
// News / APITube query syntax (OR, "quoted phrases").

const SEARCH_TERMS = {
  'cricket':          'cricket',
  'fashion':          'fashion',
  'health':           'health',
  'fitness':          'fitness OR workout',
  'entertainment':    'entertainment OR "box office"',
  'politics':         'politics',
  'tech':             'technology',
  'lifestyle':        'lifestyle',
  'science':          'science',
  'travel':           'travel OR tourism',
  'comedy':           'comedy OR comedian',
  'art':              '"art exhibition" OR artist OR painting',
  'music':            'music',
  'finance':          'finance OR "stock market"',
  'sports':           'sports',
  'ai & ml':          '"artificial intelligence" OR "machine learning"',
  'gaming':           'gaming OR "video game"',
  'food':             'food OR recipe OR restaurant',
  'business':         'business',
  'nifty 50':         'Nifty OR Sensex',
  'indian economics': '"Indian economy" OR RBI',
  'bollywood':        'Bollywood',
  'environment':      'environment OR climate',
};

// "News" means general headlines: served from top-stories feeds, not search.
export const GENERAL_TOPICS = new Set(['news']);

export function normalizeTopic(topic) {
  return String(topic || '').trim().replace(/\s+/g, ' ');
}

export function isGeneralTopic(topic) {
  return GENERAL_TOPICS.has(normalizeTopic(topic).toLowerCase());
}

/** Search phrase for a topic; custom multi-word topics become a quoted phrase. */
export function searchTerms(topic) {
  const t = normalizeTopic(topic);
  const preset = SEARCH_TERMS[t.toLowerCase()];
  if (preset) return preset;
  const safe = t.replace(/"/g, '');
  return /\s/.test(safe) ? `"${safe}"` : safe;
}

/** Cache key for a topic in one country + language edition. */
export function topicKey(topic, country = '', lang = 'en') {
  return `${normalizeTopic(topic).toLowerCase()}|${country}|${lang}`;
}

/**
 * Split due topics into groups of `size` that share country + language,
 * so each group can be fetched with one OR query.
 * Each item: { topic_key, topic, country, lang, article_count }.
 * Busy topics (most cached articles) are spread across groups so one
 * busy topic doesn't crowd out the others in every query.
 */
export function groupTopics(items, size = 3) {
  const byEdition = new Map();
  for (const item of items) {
    const edition = `${item.country}|${item.lang}`;
    if (!byEdition.has(edition)) byEdition.set(edition, []);
    byEdition.get(edition).push(item);
  }

  const groups = [];
  for (const list of byEdition.values()) {
    const sorted = [...list].sort((a, b) => (b.article_count || 0) - (a.article_count || 0));
    const count = Math.ceil(sorted.length / size);
    const edition = Array.from({ length: count }, () => []);
    // Deal busiest-first round-robin: each group gets one busy topic
    sorted.forEach((item, i) => edition[i % count].push(item));
    groups.push(...edition);
  }
  return groups;
}
