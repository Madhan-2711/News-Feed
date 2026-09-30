// ── "Fetch News" request, shared by the home and feed pages ──────

export const FEED_TIMEOUT_MESSAGE =
  'Server timed out, but your feed may have updated. Try refreshing.';

/**
 * Ask the server to rebuild the user's feed.
 * @returns {Promise<{ status: 'ok' | 'rate-limited', data: object } | { status: 'timeout' }>}
 *   'timeout' when the host returned a non-JSON error page (e.g. a function
 *   timeout); the pipeline may still have saved the feed, so reload it.
 * @throws Error with the server's message when the pipeline fails.
 */
export async function requestFeedRefresh() {
  const res = await fetch('/api/process-news', { method: 'POST' });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return { status: 'timeout' };

  const data = await res.json();
  if (res.status === 429) return { status: 'rate-limited', data };
  if (!res.ok) throw new Error(data.error || 'Pipeline failed');
  return { status: 'ok', data };
}
