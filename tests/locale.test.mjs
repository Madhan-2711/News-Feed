import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLang, sanitizeCountry } from '../lib/locale.js';

test('listed codes pass through, normalized', () => {
  assert.equal(sanitizeLang('hi'), 'hi');
  assert.equal(sanitizeLang(' TA '), 'ta');
  assert.equal(sanitizeCountry('in'), 'in');
  assert.equal(sanitizeCountry('GB'), 'gb');
});

test('unknown or injected values fall back to defaults', () => {
  assert.equal(sanitizeLang('en&apikey=attacker'), 'en');
  assert.equal(sanitizeLang('xx'), 'en');
  assert.equal(sanitizeCountry('in&max=100'), '');
  assert.equal(sanitizeCountry('zz'), '');
});

test('missing values fall back to defaults', () => {
  assert.equal(sanitizeLang(null), 'en');
  assert.equal(sanitizeLang(undefined), 'en');
  assert.equal(sanitizeCountry(null), '');
  assert.equal(sanitizeCountry(''), '');
});
