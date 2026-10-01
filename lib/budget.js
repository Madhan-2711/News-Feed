// ── Shared daily budgets for keyed news APIs (server only) ───────
// Every user's on-demand searches and the ingest job draw from the same
// API keys, so calls are counted in api_usage (lib/supabase/news_cache.sql)
// and kept under each provider's free daily limit.

export const API_DAILY_BUDGET = {
  apitube:  90,   // free plan: 100/day
  guardian: 450,  // free developer key: 500/day
  newsdata: 180,  // free plan: 200 credits/day
};

function isMissingFunction(error) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/**
 * Spend one call of a provider's daily budget.
 * @returns true when the call may go ahead
 */
export async function spendApiBudget(db, provider) {
  const limit = API_DAILY_BUDGET[provider];
  if (!limit) return true;

  const { data, error } = await db.rpc('consume_api_budget', { p_provider: provider, p_limit: limit });
  if (!error) return data === true;

  if (isMissingFunction(error)) {
    console.warn('[budget] consume_api_budget missing — run news_cache.sql; not limiting');
    return true;
  }
  console.error(`[budget] ${provider} check failed:`, error.message);
  return false;
}
