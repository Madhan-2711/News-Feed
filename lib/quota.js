// ── Daily quota enforcement (server only) ────────────────────────
// Uses the atomic Postgres functions from lib/supabase/quota_hardening.sql.
// Until that script has been run, falls back to a read-check-write on the
// profile so the app keeps working (without the atomic guarantee).

import { FREE_DAILY_FETCHES, FREE_DAILY_AI_QUESTIONS } from './limits.js';

const KINDS = {
  fetch: {
    limit: FREE_DAILY_FETCHES,
    consumeFn: 'consume_fetch_quota',
    refundFn: 'refund_fetch_quota',
    countCol: 'daily_fetch_count',
    dateCol: 'fetch_reset_date',
  },
  ai: {
    limit: FREE_DAILY_AI_QUESTIONS,
    consumeFn: 'consume_ai_quota',
    refundFn: 'refund_ai_quota',
    countCol: 'ai_query_count',
    dateCol: 'ai_query_reset_date',
  },
};

// PostgREST reports an unknown RPC as PGRST202; Postgres as 42883.
function isMissingFunction(error) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

// Undefined column: the counter columns don't exist before the SQL runs.
function isMissingColumn(error) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

export function todayUTC() {
  return new Date().toISOString().split('T')[0];
}

async function legacyConsume(db, userId, cfg) {
  const { data: profile, error } = await db
    .from('profiles')
    .select(`is_premium, ${cfg.countCol}, ${cfg.dateCol}`)
    .eq('id', userId)
    .single();

  if (error) {
    // No counter columns yet means no limit can be tracked; allow the
    // request rather than break the feature.
    if (isMissingColumn(error)) {
      console.warn(`[quota] ${cfg.countCol} missing — run quota_hardening.sql; not limiting`);
      return { allowed: true, used: 0, limit: cfg.limit };
    }
    throw error;
  }

  const today = todayUTC();
  const current = profile?.[cfg.dateCol] === today ? (profile?.[cfg.countCol] || 0) : 0;
  if (profile?.is_premium !== true && current >= cfg.limit) {
    return { allowed: false, used: current, limit: cfg.limit };
  }

  const used = current + 1;
  const { error: updateErr } = await db
    .from('profiles')
    .update({ [cfg.countCol]: used, [cfg.dateCol]: today })
    .eq('id', userId);
  if (updateErr) throw updateErr;
  return { allowed: true, used, limit: cfg.limit };
}

/**
 * Spend one unit of the user's daily quota before doing the work.
 * @param db service-role Supabase client
 * @param kind 'fetch' | 'ai'
 * @returns {Promise<{ allowed: boolean, used: number, limit: number }>}
 */
export async function consumeQuota(db, userId, kind) {
  const cfg = KINDS[kind];
  const { data, error } = await db.rpc(cfg.consumeFn, { p_user: userId, p_limit: cfg.limit });

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return { allowed: row?.allowed === true, used: row?.used ?? 0, limit: cfg.limit };
  }
  if (!isMissingFunction(error)) throw error;

  console.warn(`[quota] ${cfg.consumeFn} missing — run quota_hardening.sql; using non-atomic check`);
  return legacyConsume(db, userId, cfg);
}

/**
 * Give back one unit after a failed run, so failures don't count.
 * Never throws: it runs on error paths.
 */
export async function refundQuota(db, userId, kind) {
  const cfg = KINDS[kind];
  try {
    const { error } = await db.rpc(cfg.refundFn, { p_user: userId });
    if (!error) return;
    if (!isMissingFunction(error)) throw error;

    const { data: profile, error: readErr } = await db
      .from('profiles')
      .select(`${cfg.countCol}, ${cfg.dateCol}`)
      .eq('id', userId)
      .single();
    if (readErr || profile?.[cfg.dateCol] !== todayUTC()) return;

    await db
      .from('profiles')
      .update({ [cfg.countCol]: Math.max(0, (profile[cfg.countCol] || 0) - 1) })
      .eq('id', userId);
  } catch (err) {
    console.error(`[quota] Refund failed for ${kind}:`, err.message);
  }
}
