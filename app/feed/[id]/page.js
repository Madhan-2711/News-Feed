'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import StatusBar from '../../components/StatusBar';

export default function ArticlePage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const articleId = params.id;
  const qaInputRef = useRef(null);

  const [user, setUser] = useState(null);
  const [article, setArticle] = useState(null);
  const [rationale, setRationale] = useState('');
  const [summary, setSummary] = useState('');
  const [keyPoints, setKeyPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qaHistory, setQaHistory] = useState([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [qaInput, setQaInput] = useState('');

  useEffect(() => {
    async function loadArticle() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      const { data: articleData } = await supabase
        .from('daily_cache')
        .select('*')
        .eq('id', articleId)
        .single();

      if (!articleData) { setLoading(false); return; }
      setArticle(articleData);

      if (user) {
        const { data: feedData } = await supabase
          .from('user_news_feed')
          .select('ai_rationale, ai_summary, ai_key_points, score')
          .eq('user_id', user.id)
          .eq('article_id', articleId)
          .single();

        if (feedData) {
          setRationale(feedData.ai_rationale);
          setSummary(feedData.ai_summary || '');
          setKeyPoints(feedData.ai_key_points || []);
        }
      }
      setLoading(false);
    }
    loadArticle();
  }, [articleId]);

  const handleAskAI = async () => {
    const question = qaInput.trim();
    if (!question || aiThinking) return;

    setQaHistory((prev) => [...prev, { type: 'question', text: question }]);
    setQaInput('');
    setAiThinking(true);

    try {
      const res = await fetch('/api/ask-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId, question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI query failed');
      setQaHistory((prev) => [...prev, { type: 'answer', text: data.answer }]);
    } catch (err) {
      setQaHistory((prev) => [...prev, { type: 'error', text: err.message }]);
    } finally {
      setAiThinking(false);
      qaInputRef.current?.focus();
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

  if (!article) {
    return (
      <div className="app-container">
        <StatusBar user={user} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Article not found</p>
          <button className="btn btn-outline" onClick={() => router.push('/feed')}>← Back to Feed</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <StatusBar user={user} />

      <div style={{ padding: '1.25rem 0 0.5rem' }}>
        <button className="btn btn-ghost" onClick={() => router.push('/feed')} style={{ paddingLeft: 0 }}>
          ← Back to Feed
        </button>
      </div>

      <div className="article-layout">
        {/* Left: Article Content */}
        <article className="article-layout__main">
          {/* Hero Image */}
          {article.image_url && (
            <div className="article-hero">
              <img src={article.image_url} alt={article.title} />
            </div>
          )}

          {/* Header */}
          <div className="article-reader__header">
            <h1 className="article-reader__title">{article.title}</h1>
            <div className="article-reader__meta">
              <span>{article.source || 'Unknown'}</span>
              <span>{article.published_at ? new Date(article.published_at).toISOString().split('T')[0] : ''}</span>
              <span>{article.category || 'General'}</span>
            </div>
          </div>

          {/* AI Rationale */}
          {rationale && !rationale.includes('pending') && (
            <div className="article-reader__rationale">
              <div className="article-reader__rationale-label">Why this matters to you</div>
              <div className="article-reader__rationale-text">{rationale}</div>
            </div>
          )}

          {/* Summary */}
          <div className="section-label" style={{ marginTop: '1.5rem' }}>
            <span className="section-label__line" />
            <span className="section-label__text">Summary</span>
            <span className="section-label__line" />
          </div>

          <div className="article-reader__content">
            {summary ? (
              <p>{summary}</p>
            ) : article.full_text ? (
              <p>{article.full_text}</p>
            ) : (
              <p className="text-muted">No summary available for this article.</p>
            )}
          </div>

          {/* Key Points */}
          {keyPoints.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <div className="section-label">
                <span className="section-label__line" />
                <span className="section-label__text">Key Takeaways</span>
                <span className="section-label__line" />
              </div>
              <ul style={{ marginTop: '1rem', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {keyPoints.map((point, i) => (
                  <li key={i} style={{
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                    padding: '0.75rem 1rem',
                    background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                    borderLeft: '3px solid var(--accent)',
                    borderRadius: '4px',
                    lineHeight: 1.5,
                    fontSize: '0.95rem'
                  }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>→</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Read Original */}
          {article.source_url && (
            <div style={{ marginTop: '2rem', marginBottom: '2rem' }}>
              <a
                href={article.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline"
                style={{ textDecoration: 'none' }}
              >
                Read Original Article →
              </a>
            </div>
          )}
        </article>

        {/* Right: Sticky Q&A Sidebar */}
        <aside className="article-layout__sidebar">
          <div className="qa-sidebar">
            <div className="qa-sidebar__header">
              <span className="section-label__text">Ask AI</span>
            </div>

            <div className="qa-sidebar__body">
              {qaHistory.length === 0 && !aiThinking && (
                <p className="text-muted" style={{ fontSize: '0.82rem', textAlign: 'center', padding: '1rem 0' }}>
                  Ask anything about this article. AI will answer based on the content.
                </p>
              )}

              {qaHistory.map((entry, i) => (
                <div key={i} style={{ marginBottom: '0.75rem' }}>
                  {entry.type === 'question' && (
                    <p className="qa-sidebar__question">
                      <strong>Q:</strong> {entry.text}
                    </p>
                  )}
                  {entry.type === 'answer' && (
                    <div className="qa-sidebar__answer">{entry.text}</div>
                  )}
                  {entry.type === 'error' && (
                    <div className="qa-sidebar__answer" style={{ borderColor: '#DC2626', color: '#DC2626' }}>
                      {entry.text}
                    </div>
                  )}
                </div>
              ))}

              {aiThinking && (
                <p className="text-muted" style={{ fontSize: '0.82rem' }}>
                  Thinking<span className="loading-dots" />
                </p>
              )}
            </div>

            <div className="qa-sidebar__input">
              <input
                ref={qaInputRef}
                type="text"
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
                placeholder="Ask a question…"
                disabled={aiThinking}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAskAI}
                disabled={aiThinking || !qaInput.trim()}
              >
                Ask
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
