// ── Supported languages and countries ────────────────────────────
// Single source for the setup page options and for server-side
// validation. Profile values are user-editable, so anything not listed
// here is replaced before it reaches a news API URL.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
];

export const COUNTRIES = [
  { code: '', name: 'International (All)' },
  { code: 'in', name: 'India' },
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'au', name: 'Australia' },
  { code: 'ca', name: 'Canada' },
  { code: 'sg', name: 'Singapore' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'jp', name: 'Japan' },
  { code: 'cn', name: 'China' },
  { code: 'pk', name: 'Pakistan' },
  { code: 'bd', name: 'Bangladesh' },
];

const LANG_CODES = new Set(LANGUAGES.map(l => l.code));
const COUNTRY_CODES = new Set(COUNTRIES.map(c => c.code));

export function sanitizeLang(value) {
  const code = String(value ?? '').trim().toLowerCase();
  return LANG_CODES.has(code) ? code : 'en';
}

export function sanitizeCountry(value) {
  const code = String(value ?? '').trim().toLowerCase();
  return COUNTRY_CODES.has(code) ? code : '';
}
