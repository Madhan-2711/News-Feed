import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupArticles, classifyArticle } from '../lib/collect.js';
import { searchTerms, topicKey, groupTopics, isGeneralTopic } from '../lib/topics.js';
import { MATCH } from '../lib/scoring.js';

test('topic keys are case-insensitive per edition', () => {
  assert.equal(topicKey('AI & ML', 'in', 'en'), 'ai & ml|in|en');
  assert.equal(topicKey('  Gaming ', '', 'en'), topicKey('gaming', '', 'en'));
  assert.notEqual(topicKey('Gaming', 'in', 'en'), topicKey('Gaming', 'us', 'en'));
});

test('search terms expand presets and quote multi-word custom topics', () => {
  assert.equal(searchTerms('Nifty 50'), 'Nifty OR Sensex');
  assert.equal(searchTerms('electric vehicles'), '"electric vehicles"');
  assert.equal(searchTerms('pickleball'), 'pickleball');
  assert.ok(isGeneralTopic('News'));
});

test('groups never mix editions and spread busy topics', () => {
  const rows = [
    { topic: 'Politics', country: 'in', lang: 'en', article_count: 90 },
    { topic: 'Business', country: 'in', lang: 'en', article_count: 80 },
    { topic: 'Gaming',   country: 'in', lang: 'en', article_count: 5 },
    { topic: 'Art',      country: 'in', lang: 'en', article_count: 3 },
    { topic: 'Cricket',  country: 'us', lang: 'en', article_count: 10 },
  ];
  const groups = groupTopics(rows, 3);
  for (const g of groups) assert.equal(new Set(g.map(r => r.country)).size, 1);
  const india = groups.filter(g => g[0].country === 'in');
  assert.equal(india.length, 2);
  // The two busiest India topics land in different groups
  assert.ok(india.every(g => g.some(r => r.topic === 'Politics' || r.topic === 'Business')));
});

test('dedup keeps one copy per title, preferring a publisher link with an image', () => {
  const google = { title: 'Sensex falls 500 points', link: 'https://news.google.com/rss/articles/a', image_url: null, _searchedTopics: ['Nifty 50'] };
  const publisher = { title: 'Sensex falls 500 points!', link: 'https://livemint.com/a', image_url: 'https://img', _searchedTopics: [] };
  const [kept, ...rest] = dedupArticles([google, publisher]);
  assert.equal(rest.length, 0);
  assert.equal(kept.link, 'https://livemint.com/a');
  assert.deepEqual(kept._searchedTopics, ['Nifty 50']);
});

test('classification splits grouped results back into the right topics', () => {
  const topics = ['Gaming', 'Nifty 50', 'Art'];
  assert.deepEqual(classifyArticle({ title: 'Sensex sinks 1,280 points' }, topics), { 'Nifty 50': MATCH.title });
  assert.deepEqual(classifyArticle({ title: 'New Xbox handheld revealed' }, topics), { Gaming: MATCH.title });
  assert.deepEqual(classifyArticle({ title: 'Flydubai pilot hailed a hero' }, topics), {});
});

test('a search or feed section adds only a weak signal', () => {
  const result = classifyArticle({ title: 'Asian Games: twin golds', _feedTopics: ['sports'] }, ['Sports', 'Travel']);
  assert.deepEqual(result, { Sports: MATCH.searchOnly });
});
