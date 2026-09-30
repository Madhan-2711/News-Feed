import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreArticle, findBestInterest, generateRationale } from '../lib/scoring.js';

const freshArticle = {
  title: 'A new local headline',
  full_text: 'A short report with no sports references.',
  published_at: new Date().toISOString(),
  _sourceTag: 'gnews',
};

test('serverless scoring excludes an unrelated article', () => {
  assert.equal(scoreArticle(freshArticle, null, null, ['Cricket']), 0);
});

test('serverless scoring keeps articles matching a stated interest', () => {
  const article = { ...freshArticle, title: 'Cricket match begins today' };
  assert.ok(scoreArticle(article, null, null, ['Cricket']) >= 0.3);
});

test('verified search topic is sufficient when a headline uses different wording', () => {
  const article = { ...freshArticle, _topic: 'Cricket', _topicVerified: true };
  assert.ok(scoreArticle(article, null, null, ['Cricket']) >= 0.3);
});

test('unverified topic tag from a headline fallback does not count as a match', () => {
  const article = {
    ...freshArticle,
    title: 'High Court stays Vaze bail; NIA appeal to come up in October',
    _topic: 'Gaming',
    _topicVerified: false,
  };
  assert.equal(scoreArticle(article, null, null, ['Gaming', 'Cricket']), 0);
});

test('weak embedding similarity alone does not pass an unrelated article', () => {
  const article = {
    ...freshArticle,
    title: "'I grabbed the terrorist': Flydubai passenger tells Netanyahu how he subdued pilot",
  };
  const user = [1, 0];
  const weak = [0.2, Math.sqrt(1 - 0.04)];
  assert.equal(scoreArticle(article, user, weak, ['Gaming']), 0);
});

test('expanded keywords match predefined interests', () => {
  const article = { ...freshArticle, title: 'Nintendo announces new Switch release date' };
  assert.ok(scoreArticle(article, null, null, ['Gaming']) >= 0.3);
  assert.equal(findBestInterest(article.title, '', ['Cricket', 'Gaming']), 'Gaming');
});

test('short-word interests like AI & ML can match', () => {
  assert.equal(findBestInterest('OpenAI ships a new LLM', '', ['AI & ML']), 'AI & ML');
});

test('rationale never names an interest the article does not match', () => {
  const title = 'Screen Portable Monitor for Productivity Anywhere';
  assert.equal(findBestInterest(title, '', ['Gaming', 'Cricket']), null);
  assert.equal(generateRationale(null, 0.4), 'Similar to stories you follow.');
});

test('a specific interest is preferred over the general News interest', () => {
  assert.equal(findBestInterest('Cricket news: India win', '', ['News', 'Cricket']), 'Cricket');
});
