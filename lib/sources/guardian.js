// ── The Guardian Source Adapter ───────────────────────────────────
// The Guardian Open Platform — unlimited requests on free tier.
// Returns article body text (show-fields=bodyText), section, and thumbnail.
//
// NOTE: Guardian has no native country filter. For non-UK countries we
// inject the country name into the keyword query so results are geographically
// relevant (e.g. "India politics" instead of bare "politics").

const GUARDIAN_SECTION_MAP = {
  cricket: 'sport/cricket',
  ipl: 'sport/cricket',
  football: 'football',
  technology: 'technology',
  'ai': 'technology',
  'artificial intelligence': 'technology',
  finance: 'money',
  economics: 'business',
  'stock market': 'business',
  science: 'science',
  health: 'society',
  politics: 'politics',
  environment: 'environment',
  bollywood: 'film',
  film: 'film',
};

// Countries whose domestic press Guardian naturally covers well.
// For all others we inject a country keyword to keep results relevant.
const GUARDIAN_NATIVE_COUNTRIES = new Set(['gb', 'au', 'us', '']);

// Human-readable country label to inject into queries
const COUNTRY_LABEL = {
  in: 'India',
  ng: 'Nigeria',
  za: 'South Africa',
  ke: 'Kenya',
  ca: 'Canada',
  nz: 'New Zealand',
  de: 'Germany',
  fr: 'France',
  br: 'Brazil',
  jp: 'Japan',
  cn: 'China',
  pk: 'Pakistan',
  bd: 'Bangladesh',
};

export async function fetchFromGuardian(interests = [], _lang = 'en', country = '') {
  const apiKey = process.env.GUARDIAN_API_KEY;
  if (!apiKey) return [];

  const queries = (Array.isArray(interests) ? interests : Object.values(interests).filter(Boolean))
    .filter(Boolean);

  const isNativeCountry = GUARDIAN_NATIVE_COUNTRIES.has((country || '').toLowerCase());
  const countryLabel = COUNTRY_LABEL[(country || '').toLowerCase()] || null;

  // Try to map interests to Guardian sections only for native countries.
  // For non-native countries, skip section filter and rely on keyword search
  // with the country name prepended so we get geographically relevant articles.
  const sectionHits = isNativeCountry
    ? queries.map(q => GUARDIAN_SECTION_MAP[q.toLowerCase()]).filter(Boolean)
    : [];

  // For non-native countries: build keyword query that includes the country name.
  // e.g. country=in, interest="politics" → q="India AND politics"
  function buildKeywordQuery(qs) {
    const terms = qs.slice(0, 3).join(' OR ');
    if (!isNativeCountry && countryLabel) {
      return `${countryLabel} AND (${terms})`;
    }
    return terms;
  }

  const params = new URLSearchParams({
    'api-key': apiKey,
    'show-fields': 'bodyText,thumbnail,trailText,headline',
    // Non-native countries get fewer results — other sources cover them better.
    'page-size': isNativeCountry ? '15' : '8',
    'order-by': 'newest',
  });

  if (sectionHits.length > 0) {
    params.set('section', sectionHits[0]); // use primary interest section (UK/AU/US only)
  } else if (queries.length > 0) {
    params.set('q', buildKeywordQuery(queries));
  } else if (!isNativeCountry && countryLabel) {
    // No interest query but we still want country-specific articles
    params.set('q', countryLabel);
  }

  try {
    const res = await fetch(
      `https://content.guardianapis.com/search?${params.toString()}`
    );
    if (!res.ok) return [];
    const data = await res.json();

    if (data.response?.status !== 'ok') return [];

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return (data.response?.results || [])
      .filter(a => !a.webPublicationDate || new Date(a.webPublicationDate) > cutoff)
      .map(a => ({
        title: a.fields?.headline || a.webTitle || '',
        description: a.fields?.trailText || '',
        content: (a.fields?.bodyText || '').slice(0, 3000),
        link: a.webUrl || '',
        image_url: a.fields?.thumbnail || null,
        source_name: 'The Guardian',
        publishedAt: a.webPublicationDate || new Date().toISOString(),
        category: a.sectionName || 'general',
        _sourceTag: 'guardian',
      }));
  } catch {
    return [];
  }
}
