import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeQuota, refundQuota, todayUTC } from '../lib/quota.js';
import { FREE_DAILY_FETCHES, FREE_DAILY_AI_QUESTIONS } from '../lib/limits.js';

const MISSING_RPC = { code: 'PGRST202', message: 'Could not find the function' };

// Minimal stand-in for the Supabase client calls quota.js makes.
function stubDb({ rpc, profile = null, profileError = null }) {
  const updates = [];
  return {
    updates,
    rpc: async (fn, args) => rpc(fn, args),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: profileError }) }) }),
      update: values => ({ eq: async () => { updates.push(values); return { error: null }; } }),
    }),
  };
}

test('uses the atomic RPC result when the function exists', async () => {
  let called;
  const db = stubDb({ rpc: async (fn, args) => { called = { fn, args }; return { data: [{ allowed: true, used: 1 }], error: null }; } });
  const quota = await consumeQuota(db, 'u1', 'fetch');
  assert.deepEqual(quota, { allowed: true, used: 1, limit: FREE_DAILY_FETCHES });
  assert.deepEqual(called, { fn: 'consume_fetch_quota', args: { p_user: 'u1', p_limit: FREE_DAILY_FETCHES } });
  assert.equal(db.updates.length, 0);
});

test('reports a refusal from the RPC', async () => {
  const db = stubDb({ rpc: async () => ({ data: [{ allowed: false, used: 10 }], error: null }) });
  const quota = await consumeQuota(db, 'u1', 'ai');
  assert.deepEqual(quota, { allowed: false, used: 10, limit: FREE_DAILY_AI_QUESTIONS });
});

test('surfaces unexpected RPC errors instead of silently allowing', async () => {
  const db = stubDb({ rpc: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) });
  await assert.rejects(consumeQuota(db, 'u1', 'fetch'));
});

test('falls back to a counter update when the RPC is missing', async () => {
  const db = stubDb({
    rpc: async () => ({ data: null, error: MISSING_RPC }),
    profile: { is_premium: false, daily_fetch_count: 1, fetch_reset_date: todayUTC() },
  });
  const quota = await consumeQuota(db, 'u1', 'fetch');
  assert.equal(quota.allowed, true);
  assert.equal(quota.used, 2);
  assert.deepEqual(db.updates, [{ daily_fetch_count: 2, fetch_reset_date: todayUTC() }]);
});

test('fallback enforces the limit for free users', async () => {
  const db = stubDb({
    rpc: async () => ({ data: null, error: MISSING_RPC }),
    profile: { is_premium: false, daily_fetch_count: FREE_DAILY_FETCHES, fetch_reset_date: todayUTC() },
  });
  const quota = await consumeQuota(db, 'u1', 'fetch');
  assert.equal(quota.allowed, false);
  assert.equal(db.updates.length, 0);
});

test('fallback exempts premium users from the limit', async () => {
  const db = stubDb({
    rpc: async () => ({ data: null, error: MISSING_RPC }),
    profile: { is_premium: true, daily_fetch_count: 50, fetch_reset_date: todayUTC() },
  });
  assert.equal((await consumeQuota(db, 'u1', 'fetch')).allowed, true);
});

test('fallback starts a new count on a new day', async () => {
  const db = stubDb({
    rpc: async () => ({ data: null, error: MISSING_RPC }),
    profile: { is_premium: false, daily_fetch_count: FREE_DAILY_FETCHES, fetch_reset_date: '2000-01-01' },
  });
  const quota = await consumeQuota(db, 'u1', 'fetch');
  assert.equal(quota.allowed, true);
  assert.equal(quota.used, 1);
});

test('allows Ask AI when its counter columns do not exist yet', async () => {
  const db = stubDb({
    rpc: async () => ({ data: null, error: MISSING_RPC }),
    profileError: { code: '42703', message: 'column profiles.ai_query_count does not exist' },
  });
  const quota = await consumeQuota(db, 'u1', 'ai');
  assert.equal(quota.allowed, true);
  assert.equal(db.updates.length, 0);
});

test('refund fallback decrements today\'s count', async () => {
  const db = stubDb({
    rpc: async () => ({ data: null, error: MISSING_RPC }),
    profile: { daily_fetch_count: 2, fetch_reset_date: todayUTC() },
  });
  await refundQuota(db, 'u1', 'fetch');
  assert.deepEqual(db.updates, [{ daily_fetch_count: 1 }]);
});

test('refund never throws', async () => {
  const db = stubDb({ rpc: async () => { throw new Error('network down'); } });
  await assert.doesNotReject(refundQuota(db, 'u1', 'ai'));
});
