import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreArticle } from '../lib/scoring.js';

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

test('source topic is sufficient when a headline uses different wording', () => {
  const article = { ...freshArticle, _topic: 'Cricket' };
  assert.ok(scoreArticle(article, null, null, ['Cricket']) >= 0.3);
});
