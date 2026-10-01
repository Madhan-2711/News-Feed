import test from 'node:test';
import assert from 'node:assert/strict';
import { titleSimilarity, mergeNearDuplicates, balanceAcrossTopics, rankFeed } from '../lib/rank.js';
import { MATCH } from '../lib/scoring.js';

const now = new Date().toISOString();
let nextId = 1;
const art = (title, extra = {}) => ({
  id: String(nextId++), title, full_text: '', published_at: now,
  source_url: `https://example.com/${nextId}`, source_tag: 'rss', category: 'general', ...extra,
});

test('titleSimilarity spots the same story worded differently', () => {
  const a = "Guardiola backs Man City after guilty verdict";
  const b = "Man City guilty verdict: Guardiola backs his players";
  assert.ok(titleSimilarity(a, b) >= 0.5);
  assert.ok(titleSimilarity(a, 'Darjeeling toy train named top destination') < 0.2);
});

test('near-duplicates collapse to one, preferring a publisher link', () => {
  const google = { article: art('Guardiola backs Man City after guilty verdict', { source_url: 'https://news.google.com/rss/articles/x' }), score: 0.9 };
  const publisher = { article: art('Guardiola backs Man City after the guilty verdict'), score: 0.7 };
  const other = { article: art('India win second ODI'), score: 0.8 };
  const merged = mergeNearDuplicates([google, other, publisher]);
  assert.equal(merged.length, 2);
  const city = merged.find(e => e.article.title.includes('Guardiola'));
  assert.equal(city.article.source_url.startsWith('https://example.com'), true);
  assert.equal(city.score, 0.9);
});

test('balance takes turns between topics so one cannot fill the feed', () => {
  const entries = [
    ...Array.from({ length: 10 }, (_, i) => ({ article: art(`Sports ${i}`), score: 0.9 - i * 0.01, interest: 'Sports', cluster: `S${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ article: art(`Travel ${i}`), score: 0.5, interest: 'Travel', cluster: `T${i}` })),
  ];
  const picked = balanceAcrossTopics(entries, ['Sports', 'Travel'], { limit: 6 });
  assert.equal(picked.length, 6);
  assert.equal(picked.filter(e => e.interest === 'Travel').length, 3);
});

test('balance caps stories per cluster', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ article: art(`Cricket ${i}`), score: 0.9, interest: 'Sports', cluster: 'Cricket' }));
  assert.equal(balanceAcrossTopics(entries, ['Sports'], { limit: 10, perCluster: 6 }).length, 6);
});

test('rankFeed drops unrelated and already-read articles and labels honestly', () => {
  const read = art('Cricket: India lose the series');
  const candidates = [
    { article: art('Cricket: India win the series'), topicRelevance: {} },
    { article: read, topicRelevance: {} },
    { article: art('Left Alliance wins student union posts'), topicRelevance: {} },
    { article: art('Asian Games: twin golds'), topicRelevance: { Sports: MATCH.searchOnly } },
  ];
  const feed = rankFeed(candidates, ['Cricket', 'Sports'], { readIds: new Set([read.id]) });
  const titles = feed.map(e => e.article.title);
  assert.ok(titles.includes('Cricket: India win the series'));
  assert.ok(!titles.includes(read.title));
  assert.ok(!titles.includes('Left Alliance wins student union posts'));
  assert.equal(feed.find(e => e.article.title.startsWith('Asian')).rationale, 'Related to Sports.');
  assert.equal(feed[0].rationale, 'Highly relevant to your interest in Cricket.');
});
