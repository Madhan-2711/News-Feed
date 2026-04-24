'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import TerminalButton from './components/TerminalButton';
import ArticleRow from './components/ArticleRow';
import StatusBar from './components/StatusBar';
import AnimatedShaderHero from './components/AnimatedShaderHero';

const BOOT_LINES = [
  { text: 'Connecting services…', delay: 0 },
  { text: 'Discovery engine — ready', delay: 400, highlight: true },
  { text: 'Extraction layer — ready', delay: 800, highlight: true },
  { text: 'Intelligence module — online', delay: 1200, highlight: true },
  { text: '', delay: 1600 },
  { text: 'News Feed — Curated Intelligence', delay: 2000, accent: true },
];

// Module-level cache — survives client-side navigation within the session
const cache = { national: null, international: null, fetchedAt: null };
const CACHE_TTL_MS = 30 * 60 * 1000;

function isCacheValid() {
  return cache.fetchedAt && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

export default function LandingPage() {
  const [bootComplete, setBootComplete] = useState(false);
  const [bootChecked, setBootChecked] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [user, setUser] = useState(null);
  const [nationalNews, setNationalNews] = useState(cache.national || []);
  const [internationalNews, setInternationalNews] = useState(cache.international || []);
  const [nationalLoading, setNationalLoading] = useState(!isCacheValid());
  const [internationalLoading, setInternationalLoading] = useState(!isCacheValid());
  const [activeTab, setActiveTab] = useState('national');

  // For You tab state
  const [forYouFeed, setForYouFeed] = useState([]);
  const [forYouLoading, setForYouLoading] = useState(false);
  const [forYouProcessing, setForYouProcessing] = useState(false);
  const [forYouError, setForYouError] = useState(null);
  const [forYouRateLimited, setForYouRateLimited] = useState(false);
  const [forYouSources, setForYouSources] = useState(null);
  const [forYouMode, setForYouMode] = useState(null);
  const [forYouBehaviorProfile, setForYouBehaviorProfile] = useState(null);
  const [forYouQuota, setForYouQuota] = useState(null);
  const [forYouLastUpdated, setForYouLastUpdated] = useState(null); // Date object

  const supabase = createClient();

  // Read sessionStorage + auth session after hydration
  useEffect(() => {
    if (sessionStorage.getItem('nf_boot') === '1') {
      setBootComplete(true);
    }
    setBootChecked(true);

    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Boot animation
  useEffect(() => {
    if (!bootChecked) return;
    if (bootComplete) return;

    const timers = BOOT_LINES.map((line, i) =>
      setTimeout(() => {
        setVisibleLines(i + 1);
        if (i === BOOT_LINES.length - 1) {
          setTimeout(() => {
            sessionStorage.setItem('nf_boot', '1');
            setBootComplete(true);
          }, 400);
        }
      }, line.delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [bootChecked]);

  // Public news fetch (National + International tabs)
  useEffect(() => {
    if (!bootComplete) return;

    if (isCacheValid()) {
      setNationalNews(cache.national || []);
      setInternationalNews(cache.international || []);
      setNationalLoading(false);
      setInternationalLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchNational() {
      try {
        const res = await fetch('/api/trending?type=national');
        if (!cancelled && res.ok) {
          const data = await res.json();
          cache.national = data.articles || [];
          setNationalNews(cache.national);
        }
      } catch (err) {
        console.error('National news error:', err);
      } finally {
        if (!cancelled) setNationalLoading(false);
      }
    }

    async function fetchInternational() {
      try {
        const res = await fetch('/api/trending?type=international');
        if (!cancelled && res.ok) {
          const data = await res.json();
          cache.international = data.articles || [];
          cache.fetchedAt = Date.now();
          setInternationalNews(cache.international);
        }
      } catch (err) {
        console.error('International news error:', err);
      } finally {
        if (!cancelled) setInternationalLoading(false);
      }
    }

    fetchNational();
    fetchInternational();
    return () => { cancelled = true; };
  }, [bootComplete]);

  // Load For You feed from Supabase when user is available
  // Auto-fetch only if today's feed hasn't been generated yet (once-per-day)
  useEffect(() => {
    if (!user || !bootComplete) return;

    async function initForYou() {
      // 1. Always load whatever exists in the DB first (instant)
      await loadForYouFeed(user.id);

      // 2. Check last_fetch from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('last_fetch, daily_fetch_count, fetch_reset_date, is_premium')
        .eq('id', user.id)
        .single();

      const todayUTC = new Date().toISOString().split('T')[0];
      const lastFetchDate = profile?.last_fetch
        ? new Date(profile.last_fetch).toISOString().split('T')[0]
        : null;
      const alreadyFetchedToday = lastFetchDate === todayUTC;

      // Restore quota info from profile
      if (profile) {
        const isPremium = profile.is_premium === true;
        const fetchCount = profile.fetch_reset_date === todayUTC
          ? (profile.daily_fetch_count || 0) : 0;
        setForYouQuota(isPremium
          ? { isPremium: true, unlimited: true }
          : { isPremium: false, used: fetchCount, remaining: Math.max(0, 2 - fetchCount), limit: 2 });
      }

      // 3. Auto-fetch only if not yet fetched today AND feed is empty
      if (!alreadyFetchedToday) {
        console.log('[foryou] No fetch today — auto-fetching…');
        handleFetchForYou();
      } else {
        console.log('[foryou] Already fetched today, showing cached feed');
        if (profile?.last_fetch) setForYouLastUpdated(new Date(profile.last_fetch));
      }
    }

    initForYou();
  }, [user, bootComplete]);

  async function loadForYouFeed(userId) {
    setForYouLoading(true);
    try {
      const { data: feed } = await supabase
        .from('user_news_feed')
        .select(`
          id, ai_rationale, ai_summary, cluster, score, article_id,
          daily_cache ( id, title, source, source_url, published_at, image_url )
        `)
        .eq('user_id', userId)
        .order('score', { ascending: false })
        .limit(20);

      setForYouFeed(feed || []);
    } catch (err) {
      console.error('For You feed error:', err);
    } finally {
      setForYouLoading(false);
    }
  }

  // Trigger multi-source AI pipeline for "For You"
  async function handleFetchForYou() {
    setForYouProcessing(true);
    setForYouError(null);
    setForYouRateLimited(false);
    try {
      const res = await fetch('/api/process-news', { method: 'POST' });
      const data = await res.json();

      if (res.status === 429) {
        setForYouRateLimited(true);
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Pipeline failed');

      setForYouSources(data.sources || null);
      setForYouMode(data.mode || null);
      setForYouBehaviorProfile(data.behaviorProfile || null);
      if (data.quota) setForYouQuota(data.quota);
      setForYouLastUpdated(new Date());
      if (user) await loadForYouFeed(user.id);
    } catch (err) {
      setForYouError(err.message);
    } finally {
      setForYouProcessing(false);
    }
  }

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  // ── Boot screen ───────────────────────────────────────────────
  if (!bootComplete) {
    return (
      <div className="app-container">
        <div className="boot-sequence">
          <h1 className="boot-sequence__title">
            News <span>Feed</span>
          </h1>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '2rem', letterSpacing: '0.1em' }}>
            Curated Intelligence
          </p>
          {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className={`boot-sequence__line ${line.highlight ? 'boot-sequence__line--highlight' : ''} ${line.accent ? 'boot-sequence__line--accent' : ''}`}
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Tabs config — For You only visible when signed in
  const tabs = [
    ...(user ? [{ id: 'foryou', label: '⭐ For You', sub: 'AI · Personalized' }] : []),
    { id: 'national', label: '🇮🇳 National', sub: 'India · Top 10' },
    { id: 'international', label: '🌐 International', sub: 'World · Top 10' },
  ];

  const activeLoading = activeTab === 'national'
    ? nationalLoading
    : activeTab === 'international'
    ? internationalLoading
    : forYouLoading;

  const activeArticles = activeTab === 'national'
    ? nationalNews
    : activeTab === 'international'
    ? internationalNews
    : [];

  const initial = (user?.user_metadata?.full_name?.[0] || user?.email?.[0] || '?').toUpperCase();
  const displayName = user?.user_metadata?.full_name || user?.email || '';

  // ── Main page ─────────────────────────────────────────────────
  return (
    <div className="app-container">
      {user ? (
        <StatusBar user={user} />
      ) : (
        <nav className="top-nav">
          <div className="top-nav__brand" style={{ fontFamily: 'var(--font-serif)' }}>
            News <span>Feed</span>
          </div>
          <div className="top-nav__right">
            <span className="top-nav__meta">Curated Intelligence</span>
          </div>
        </nav>
      )}

      {/* Hero */}
      {user ? (
        <AnimatedShaderHero>
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div style={{ display: 'inline-block', marginBottom: '2rem' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.5rem 1.25rem', background: 'rgba(184, 134, 11, 0.1)',
                border: '1px solid rgba(184, 134, 11, 0.3)', borderRadius: '999px',
                fontSize: '0.85rem', color: 'var(--accent)'
              }}>
                <span>✨</span>
                <span style={{ fontWeight: 500 }}>Personalized by AI.</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
              <h1 style={{
                fontFamily: 'var(--font-serif)', fontSize: 'clamp(3rem, 6vw, 5rem)', fontWeight: 800,
                lineHeight: 1.1, letterSpacing: '-0.02em', margin: 0,
                background: 'linear-gradient(to right, #111827, #374151)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
              }}>
                Your Daily News
              </h1>
              <h1 style={{
                fontFamily: 'var(--font-serif)', fontSize: 'clamp(3rem, 6vw, 5rem)', fontWeight: 800,
                lineHeight: 1.1, letterSpacing: '-0.02em', margin: 0,
                background: 'linear-gradient(to right, #8B4513, #B8860B, #92400E)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
              }}>
                Curated Into Focus
              </h1>
            </div>
            <div style={{ maxWidth: '42rem', margin: '0 auto' }}>
              <p style={{
                fontSize: 'clamp(1rem, 2vw, 1.25rem)', color: 'var(--fg-muted)',
                fontWeight: 300, lineHeight: 1.6
              }}>
                Supercharge your reading with AI-powered summaries and deep insights
                built for the modern mind — fast, personalized, and limitless.
              </p>
            </div>
          </div>
        </AnimatedShaderHero>
      ) : (
        <div style={{ textAlign: 'center', padding: '2rem 0 1.5rem' }}>
          <>
            <h1 style={{
              fontFamily: 'var(--font-serif)', fontSize: '3rem', fontWeight: 700,
              letterSpacing: '-0.02em', marginBottom: '0.75rem', lineHeight: 1.1, color: 'var(--fg)',
            }}>
              Your News, <em style={{ color: 'var(--accent)' }}>Understood</em>
            </h1>
            <p className="text-muted" style={{ fontSize: '1rem', maxWidth: '26rem', margin: '0 auto 2rem', lineHeight: 1.7 }}>
              AI-powered curation that explains why each story matters to you.
            </p>
            <TerminalButton onClick={handleLogin} variant="amber" id="login-btn">
              Sign In with Google
            </TerminalButton>
          </>
        </div>
      )}

      <div className="separator" style={{ margin: '0.75rem 0' }} />

      {/* News tabs */}
      <div style={{ maxWidth: '48rem', margin: '0 auto', paddingBottom: '4rem', width: '100%' }}>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                padding: '0.6rem 1.25rem 0.75rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.1rem',
                marginBottom: '-1px',
                transition: 'border-color 0.15s',
              }}
            >
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--fg-muted)',
                letterSpacing: '0.04em',
                transition: 'color 0.15s',
              }}>
                {tab.label}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                color: 'var(--fg-muted)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                {tab.sub}
              </span>
            </button>
          ))}

          {/* Loading indicator */}
          {(nationalLoading || internationalLoading) && activeTab !== 'foryou' && (
            <span style={{
              marginLeft: 'auto', alignSelf: 'center',
              fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
              color: 'var(--fg-muted)', paddingRight: '0.25rem',
            }}>
              Fetching<span className="loading-dots" />
            </span>
          )}

          {/* For You — compact tab bar controls */}
          {activeTab === 'foryou' && user && (
            <div style={{ marginLeft: 'auto', alignSelf: 'center', paddingRight: '0.25rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>

              {/* Timestamp — only when feed is loaded */}
              {forYouLastUpdated && !forYouProcessing && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
                  color: 'var(--fg-muted)', letterSpacing: '0.03em', whiteSpace: 'nowrap',
                }}>
                  {(() => {
                    const diff = Math.floor((Date.now() - forYouLastUpdated.getTime()) / 60000);
                    if (diff < 2) return 'just now';
                    if (diff < 60) return `${diff}m ago`;
                    return `${Math.floor(diff / 60)}h ago`;
                  })()}
                </span>
              )}

              <TerminalButton
                onClick={handleFetchForYou}
                variant="amber"
                loading={forYouProcessing}
                id="fetch-foryou-btn"
                disabled={forYouQuota && !forYouQuota.isPremium && forYouQuota.remaining === 0}
              >
                {forYouProcessing ? 'Curating…' : '↻ Update'}
              </TerminalButton>
            </div>
          )}

        </div>

        {/* ── For You tab content ──────────────────────────────── */}
        {activeTab === 'foryou' && user && (
          <>
            {/* Rate limit card */}
            {forYouRateLimited && (
              <div style={{
                margin: '0.25rem 0 1.25rem',
                padding: '1.5rem 1.75rem',
                background: 'linear-gradient(135deg, rgba(184,134,11,0.06) 0%, rgba(139,69,19,0.04) 100%)',
                border: '1px solid rgba(184,134,11,0.2)',
                borderRadius: '10px',
                display: 'flex', alignItems: 'flex-start', gap: '1.25rem',
              }}>
                <div style={{ fontSize: '2rem', lineHeight: 1, flexShrink: 0, marginTop: '0.1rem' }}>🌙</div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: 'var(--font-serif)', fontSize: '1.1rem',
                    fontWeight: 700, color: 'var(--fg)', marginBottom: '0.35rem',
                  }}>
                    You've read everything for today
                  </div>
                  <p style={{
                    fontSize: '0.88rem', color: 'var(--fg-muted)',
                    lineHeight: 1.6, margin: '0 0 0.85rem',
                  }}>
                    Your 2 daily fetches have been used. Fresh articles will be ready tomorrow —
                    the feed resets at midnight UTC.
                  </p>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.3rem 0.85rem',
                    background: 'rgba(184,134,11,0.1)',
                    border: '1px solid rgba(184,134,11,0.25)',
                    borderRadius: '999px',
                    fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
                    color: 'var(--accent)', letterSpacing: '0.06em',
                  }}>
                    <span>↻</span><span>Resets at midnight UTC</span>
                  </div>
                </div>
              </div>
            )}

            {/* Generic error */}
            {forYouError && (
              <div style={{
                padding: '0.75rem 1rem', marginBottom: '1rem',
                background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)',
                borderLeft: '3px solid #DC2626', borderRadius: '4px',
                fontSize: '0.88rem', color: '#DC2626',
              }}>
                ⚠ {forYouError}
              </div>
            )}

            {/* Quota status — matches editorial tab label style */}
            {forYouQuota && !forYouRateLimited && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.62rem',
                color: 'var(--fg-muted)',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                marginBottom: '1rem',
              }}>
                {forYouQuota.isPremium
                  ? '✦ PREMIUM · UNLIMITED UPDATES'
                  : `${forYouQuota.used} OF ${forYouQuota.limit} UPDATES USED · RESETS TOMORROW`}
              </div>
            )}

            {/* Behavior mode indicator */}
            {forYouMode && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                padding: '0.65rem 0.9rem', marginBottom: '1rem',
                background: forYouMode === 'behavior-driven'
                  ? 'rgba(184,134,11,0.07)'
                  : 'rgba(100,120,180,0.06)',
                border: `1px solid ${forYouMode === 'behavior-driven' ? 'rgba(184,134,11,0.25)' : 'rgba(100,120,180,0.2)'}`,
                borderRadius: '6px',
              }}>
                <span style={{ fontSize: '1rem', lineHeight: 1, marginTop: '1px' }}>
                  {forYouMode === 'behavior-driven' ? '🧠' : '⚙️'}
                </span>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: forYouMode === 'behavior-driven' ? 'var(--accent)' : 'var(--fg-muted)',
                    fontWeight: 600, marginBottom: '0.2rem',
                  }}>
                    {forYouMode === 'behavior-driven' ? 'Activity-Based Ranking Active' : 'Interest-Based Ranking'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)', lineHeight: 1.4 }}>
                    {forYouMode === 'behavior-driven'
                      ? forYouBehaviorProfile || 'Ranked using your reading history.'
                      : 'Read more articles to unlock activity-based personalization.'}
                  </div>
                </div>
              </div>
            )}

            {forYouProcessing && (
              <div className="loading-bar" style={{ marginBottom: '1rem' }}>
                <div className="loading-bar__progress" />
              </div>
            )}

            {forYouLoading ? (
              <div style={{ padding: '3rem 0' }}>
                <div className="loading-bar" style={{ maxWidth: '180px', margin: '0 auto' }}>
                  <div className="loading-bar__progress" />
                </div>
              </div>
            ) : forYouFeed.length > 0 ? (
              <>
                {/* Source diversity badge */}
                {forYouSources && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: '0.4rem',
                    marginBottom: '1.25rem',
                  }}>
                    {Object.entries(forYouSources).map(([src, count]) => (
                      <span key={src} style={{
                        padding: '0.2rem 0.65rem',
                        background: 'rgba(184,134,11,0.08)',
                        border: '1px solid rgba(184,134,11,0.2)',
                        borderRadius: '999px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.62rem',
                        color: 'var(--accent)',
                        letterSpacing: '0.06em',
                        textTransform: 'capitalize',
                      }}>
                        {src} · {count}
                      </span>
                    ))}
                  </div>
                )}

                {forYouFeed.map((item, i) => (
                  <ArticleRow
                    key={item.id}
                    index={i + 1}
                    title={item.daily_cache?.title || 'Untitled'}
                    date={item.daily_cache?.published_at}
                    rationale={item.ai_rationale}
                    source={item.daily_cache?.source}
                    imageUrl={item.daily_cache?.image_url}
                    href={`/feed/${item.article_id}`}
                    score={item.score}
                    cluster={item.cluster}
                    articleId={item.article_id}
                  />
                ))}
              </>
            ) : (
              <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', color: 'var(--fg)', marginBottom: '0.75rem' }}>
                  No personalized feed yet
                </p>
                <p className="text-muted" style={{ fontSize: '0.9rem', maxWidth: '22rem', margin: '0 auto 1.5rem' }}>
                  Press <strong style={{ color: 'var(--accent)' }}>✦ Refresh Feed</strong> to pull from 5 news sources and rank them by your interests.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── National / International tab content ─────────────── */}
        {activeTab !== 'foryou' && (
          activeLoading ? (
            <div style={{ padding: '3rem 0' }}>
              <div className="loading-bar" style={{ maxWidth: '180px', margin: '0 auto' }}>
                <div className="loading-bar__progress" />
              </div>
            </div>
          ) : activeArticles.length > 0 ? (
            activeArticles.map((article, i) => (
              <ArticleRow
                key={i}
                index={i + 1}
                title={article.title}
                date={article.date}
                source={article.source}
                href={article.url || '#'}
                summary={article.description}
                imageUrl={article.image}
              />
            ))
          ) : (
            <p className="text-muted" style={{ textAlign: 'center', padding: '2rem', fontSize: '0.85rem' }}>
              No articles available right now. Try again in a moment.
            </p>
          )
        )}
      </div>
    </div>
  );
}
