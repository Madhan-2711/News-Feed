import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreArticle, matchStrength, generateRationale, clusterArticle, MATCH } from '../lib/scoring.js';

const now = new Date().toISOString();
const article = (title, full_text = '', extra = {}) => ({ title, full_text, published_at: now, source_tag: 'googlenews', ...extra });

test('an article matching none of the interests scores 0', () => {
  const result = scoreArticle(article('High Court stays Vaze bail', 'NIA appeal in October'), ['Gaming', 'Cricket']);
  assert.equal(result.score, 0);
  assert.equal(result.interest, null);
});

test('a headline match outranks a description-only match', () => {
  const inTitle = scoreArticle(article('Cricket: India win the second ODI'), ['Cricket']);
  const inBody = scoreArticle(article('Weekend round-up', 'The cricket season starts next week'), ['Cricket']);
  assert.equal(inTitle.strength, MATCH.title);
  assert.equal(inBody.strength, MATCH.description);
  assert.ok(inTitle.score > inBody.score);
});

test('a cached search tag counts as a weak match', () => {
  const result = scoreArticle(article('Asian Games: twin golds for Sahil'), ['Sports'], {
    topicRelevance: { Sports: MATCH.searchOnly },
  });
  assert.equal(result.strength, MATCH.searchOnly);
  assert.ok(result.score > 0);
});

test('fresher articles score higher, all else equal', () => {
  const old = new Date(Date.now() - 30 * 3600000).toISOString();
  const fresh = scoreArticle(article('Cricket final tonight'), ['Cricket']);
  const stale = scoreArticle(article('Cricket final tonight', '', { published_at: old }), ['Cricket']);
  assert.ok(fresh.score > stale.score);
});

test('scores are spread out, not flat', () => {
  const scores = [
    scoreArticle(article('Cricket final tonight'), ['Cricket']).score,
    scoreArticle(article('Weekend round-up', 'cricket news inside'), ['Cricket']).score,
    scoreArticle(article('Asian Games golds'), ['Cricket'], { topicRelevance: { Cricket: MATCH.searchOnly } }).score,
  ];
  assert.equal(new Set(scores.map(s => s.toFixed(2))).size, 3);
});

test('expanded keywords match preset interests', () => {
  assert.equal(matchStrength('Nintendo announces new Switch release date', '', 'Gaming'), MATCH.title);
  assert.equal(matchStrength('OpenAI ships a new LLM', '', 'AI & ML'), MATCH.title);
});

test('a specific interest is preferred over the general News interest', () => {
  const result = scoreArticle(article('Cricket news: India win'), ['News', 'Cricket']);
  assert.equal(result.interest, 'Cricket');
});

test('rationale wording follows how the article matched', () => {
  assert.equal(generateRationale('Cricket', MATCH.title), 'Highly relevant to your interest in Cricket.');
  assert.equal(generateRationale('Cricket', MATCH.description), 'Matches your interest in Cricket.');
  assert.equal(generateRationale('Cricket', MATCH.searchOnly), 'Related to Cricket.');
  assert.equal(generateRationale(null, 0), 'Similar to stories you follow.');
});

test('clusterArticle checks sports before tech', () => {
  assert.equal(clusterArticle('IPL final: Mumbai beat Chennai', ''), 'Cricket');
  assert.equal(clusterArticle('OpenAI releases a new LLM', ''), 'AI & Tech');
});

test('clusterArticle short keywords need word boundaries', () => {
  // "said" contains "ai" but must not be read as an AI story
  assert.equal(clusterArticle('Minister said the plan is on track', '', 'general'), 'Politics');
  assert.equal(clusterArticle('Local bakery wins award', '', 'general'), 'General');
  assert.equal(clusterArticle('Local bakery wins award', '', 'food'), 'Food');
});

test('clusterArticle has travel, wildlife and transport groups', () => {
  assert.equal(clusterArticle('Wild elephant menace: night travel restricted', ''), 'Wildlife');
  assert.equal(clusterArticle('Darjeeling toy train among top tourist destinations', ''), 'Travel');
  assert.equal(clusterArticle('Mangaluru-Goa Vande Bharat to be extended', ''), 'Transport');
});
