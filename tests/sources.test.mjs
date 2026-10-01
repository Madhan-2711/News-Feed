import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem, editionParams } from '../lib/sources/googlenews.js';
import { normalizeArticle } from '../lib/sources/apitube.js';
import { rssParser } from '../lib/sources/http.js';
import { spendApiBudget } from '../lib/budget.js';

const GOOGLE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title>
<item>
  <title>ICC announces World Cup fixtures - The Hindu</title>
  <link>https://news.google.com/rss/articles/CBMiabc?oc=5</link>
  <pubDate>Thu, 01 Oct 2026 15:53:13 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/CBMiabc"&gt;ICC announces World Cup fixtures&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;The Hindu&lt;/font&gt;</description>
  <source url="https://www.thehindu.com">The Hindu</source>
</item>
</channel></rss>`;

test('Google News items keep the publisher and drop the title suffix', async () => {
  const feed = await rssParser.parseString(GOOGLE_FIXTURE);
  const a = normalizeItem(feed.items[0]);
  assert.equal(a.title, 'ICC announces World Cup fixtures');
  assert.equal(a.source_name, 'The Hindu');
  assert.equal(a.description, '');
  assert.equal(a._sourceTag, 'googlenews');
  assert.equal(a.publishedAt, '2026-10-01T15:53:13.000Z');
});

test('Google News editions map country and language', () => {
  assert.equal(editionParams('in', 'en').toString(), 'hl=en-IN&gl=IN&ceid=IN%3Aen');
  assert.equal(editionParams('', 'en').get('gl'), 'US');
  assert.equal(editionParams('in', 'hi').get('hl'), 'hi');
});

test('APITube articles map to the shared shape', () => {
  const a = normalizeArticle({
    title: 'vivo invites pickleball players',
    href: 'https://astig.ph/x',
    description: '<p>Play, smash and win</p>',
    body: 'Full preview text',
    image: 'https://img/x.jpg',
    published_at: '2026-10-01T03:38:00Z',
    source: { domain: 'astig.ph' },
  });
  assert.equal(a.link, 'https://astig.ph/x');
  assert.equal(a.source_name, 'astig.ph');
  assert.equal(a.image_url, 'https://img/x.jpg');
  assert.equal(a.description, 'Play, smash and win');
  assert.equal(a._sourceTag, 'apitube');
});

test('API budget: allowed, refused, and missing-function fallback', async () => {
  const db = result => ({ rpc: async () => result });
  assert.equal(await spendApiBudget(db({ data: true, error: null }), 'apitube'), true);
  assert.equal(await spendApiBudget(db({ data: false, error: null }), 'apitube'), false);
  assert.equal(await spendApiBudget(db({ data: null, error: { code: 'PGRST202' } }), 'apitube'), true);
  assert.equal(await spendApiBudget(db({ data: null, error: { code: '57014', message: 'timeout' } }), 'apitube'), false);
});
