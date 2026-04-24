'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import StatusBar from '../components/StatusBar';
import TerminalButton from '../components/TerminalButton';
import ArticleRow from '../components/ArticleRow';
import ShineBorder from '../components/ShineBorder';

// Group feed items by their cluster label
function groupByCluster(items) {
  const groups = {};
  for (const item of items) {
    const key = item.cluster || 'General';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

export default function FeedPage() {
  const supabase = createClient();
  const [user, setUser] = useState(null);
  const [feedItems, setFeedItems] = useState([]);
  const [dailyBrief, setDailyBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [rateLimited, setRateLimited] = useState(false); // true when 429 received

  async function loadFeed(userId) {
    const { data: feed } = await supabase
      .from('user_news_feed')
      .select(`
        id, ai_rationale, ai_summary, cluster, score, created_at, article_id,
        daily_cache ( id, title, source, source_url, published_at, category, image_url )
      `)
      .eq('user_id', userId)
      .order('score', { ascending: false });

    if (feed && feed.length > 0) {
      // Guard against stale duplicate rows (same article_id appearing more than once)
      const seen = new Set();
      const deduped = feed.filter(item => {
        if (seen.has(item.article_id)) return false;
        seen.add(item.article_id);
        return true;
      });
      setFeedItems(deduped);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('daily_brief')
      .eq('id', userId)
      .single();

    if (profile?.daily_brief) setDailyBrief(profile.daily_brief);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (!user) { setLoading(false); return; }
      await loadFeed(user.id);
      setLoading(false);
    }
    init();
  }, []);

  const handleFetch = async () => {
    setProcessing(true);
    setFetchError(null);
    setRateLimited(false);
    try {
      const res = await fetch('/api/process-news', { method: 'POST' });
      const data = await res.json();
      if (res.status === 429) {
        setRateLimited(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Pipeline failed');
      await loadFeed(user.id);
    } catch (err) {
      console.error('Fetch failed:', err.message);
      setFetchError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container">
        <StatusBar user={user} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="text-muted">Loading<span className="loading-dots" /></span>
        </div>
      </div>
    );
  }

  const clusters = groupByCluster(feedItems);
  const clusterNames = Object.keys(clusters);
  let globalIndex = 1;

  return (
    <div className="app-container">
      <StatusBar user={user} />

      {/* Controls */}
      <div className="flex-between" style={{ padding: '1.5rem 0 1rem' }}>
        <span />
        <div className="flex-row gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => { window.location.href = '/'; }} id="home-btn" type="button">
            ← Home
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => { window.location.href = '/setup'; }} id="edit-profile-btn" type="button">
            Edit Profile
          </button>
          <TerminalButton onClick={handleFetch} variant="amber" loading={processing} id="fetch-btn">
            {processing ? 'Fetching…' : 'Fetch News'}
          </TerminalButton>
        </div>
      </div>

      {/* Rate limit card */}
      {rateLimited && (
        <div style={{
          margin: '0.5rem 0 1.25rem',
          padding: '1.5rem 1.75rem',
          background: 'linear-gradient(135deg, rgba(184,134,11,0.06) 0%, rgba(139,69,19,0.04) 100%)',
          border: '1px solid rgba(184,134,11,0.2)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '1.25rem',
        }}>
          {/* Moon icon */}
          <div style={{
            fontSize: '2rem',
            lineHeight: 1,
            flexShrink: 0,
            marginTop: '0.1rem',
          }}>🌙</div>

          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--fg)',
              marginBottom: '0.35rem',
            }}>
              You've read everything for today
            </div>
            <p style={{
              fontSize: '0.88rem',
              color: 'var(--fg-muted)',
              lineHeight: 1.6,
              margin: '0 0 0.85rem',
            }}>
              Your 2 daily fetches have been used. Fresh articles will be ready tomorrow —
              the feed resets at midnight UTC.
            </p>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.3rem 0.85rem',
              background: 'rgba(184,134,11,0.1)',
              border: '1px solid rgba(184,134,11,0.25)',
              borderRadius: '999px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
              color: 'var(--accent)',
              letterSpacing: '0.06em',
            }}>
              <span>↻</span>
              <span>Resets at midnight UTC</span>
            </div>
          </div>
        </div>
      )}

      {/* Generic error display */}
      {fetchError && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)',
          borderLeft: '3px solid #DC2626', borderRadius: '4px',
          fontSize: '0.88rem', color: '#DC2626'
        }}>
          ⚠ {fetchError}
        </div>
      )}

      {/* Processing indicator */}
      {processing && (
        <div className="loading-bar" style={{ marginBottom: '1rem' }}>
          <div className="loading-bar__progress" />
        </div>
      )}

      <div className="separator" />

      {/* Two-column layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: feedItems.length > 0 ? '1fr 300px' : '1fr',
        gap: '2.5rem',
        alignItems: 'start',
        paddingBottom: '3rem',
        marginTop: '1rem',
      }}>

        {/* ── Left: Clustered Feed ─────────────────────────────── */}
        <div>
          {feedItems.length > 0 ? (
            clusterNames.map((clusterName) => {
              const items = clusters[clusterName];
              return (
                <div key={clusterName} style={{ marginBottom: '2rem' }}>
                  {/* Cluster heading */}
                  <div className="section-label" style={{ marginBottom: '0.5rem' }}>
                    <span className="section-label__line" />
                    <span className="section-label__text">{clusterName}</span>
                    <span className="section-label__line" />
                  </div>

                  {items.map((item) => {
                    const idx = globalIndex++;
                    return (
                      <ShineBorder
                        key={item.id}
                        borderRadius={6}
                        borderWidth={1}
                        duration={16}
                        color={['#B8860B', '#DAA520', '#D4AF37']}
                        style={{ display: 'block', marginBottom: '0' }}
                      >
                        <ArticleRow
                          index={idx}
                          title={item.daily_cache?.title || 'Untitled'}
                          date={item.daily_cache?.published_at || item.created_at}
                          rationale={item.ai_rationale}
                          source={item.daily_cache?.source}
                          imageUrl={item.daily_cache?.image_url}
                          href={`/feed/${item.article_id}`}
                        />
                      </ShineBorder>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', color: 'var(--fg)', marginBottom: '0.75rem' }}>
                No articles yet
              </p>
              <p className="text-muted" style={{ fontSize: '0.9rem', maxWidth: '22rem', margin: '0 auto' }}>
                Press <strong style={{ color: 'var(--accent)' }}>Fetch News</strong> to discover articles tailored to your interests.
              </p>
            </div>
          )}
        </div>

        {/* ── Right: Sidebar ───────────────────────────────────── */}
        {feedItems.length > 0 && (
          <aside style={{
          position: 'sticky',
          top: '5rem',
          height: 'calc(100vh - 7rem)',
          overflowY: 'auto',
          paddingRight: '0.25rem',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--border) transparent',
        }}>

            {/* Daily Brief Card */}
            <ShineBorder
              borderRadius={8}
              borderWidth={1}
              duration={20}
              color={['#B8860B', '#DAA520', '#D4AF37', '#CD853F']}
              style={{ display: 'block', marginBottom: '1.5rem' }}
            >
              <div style={{
                padding: '1.25rem',
                background: 'var(--card)',
                borderRadius: '8px',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  marginBottom: '0.75rem'
                }}>
                  <span style={{ fontSize: '1rem' }}>📰</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    color: 'var(--accent)', fontWeight: 600
                  }}>
                    Today's Brief
                  </span>
                </div>
                {dailyBrief ? (
                  <p style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.95rem',
                    lineHeight: 1.7,
                    color: 'var(--fg)',
                    margin: 0,
                    fontStyle: 'italic'
                  }}>
                    {dailyBrief}
                  </p>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)', margin: 0 }}>
                    Fetch today's news to generate your brief.
                  </p>
                )}
              </div>
            </ShineBorder>

            {/* Topic Summary */}
            <div style={{
              padding: '1.25rem',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                color: 'var(--accent)', fontWeight: 600, marginBottom: '0.75rem'
              }}>
                Topics Today
              </div>
              {clusterNames.map((name) => (
                <div key={name} style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '0.4rem 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.88rem'
                }}>
                  <span style={{ color: 'var(--fg)' }}>{name}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                    color: 'var(--accent)', fontWeight: 600
                  }}>
                    {clusters[name].length}
                  </span>
                </div>
              ))}
            </div>

          </aside>
        )}
      </div>
    </div>
  );
}
