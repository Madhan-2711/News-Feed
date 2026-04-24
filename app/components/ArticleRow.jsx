'use client';

import Link from 'next/link';

// Fire-and-forget click tracking
async function trackClick(articleId) {
  if (!articleId) return;
  try {
    await fetch('/api/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: articleId }),
    });
  } catch {
    // non-blocking
  }
}

export default function ArticleRow({
  index, title, date, rationale, summary, source,
  href, imageUrl, score, cluster, articleId,
}) {
  const formattedDate = date ? new Date(date).toISOString().split('T')[0] : '';
  const indexStr = String(index).padStart(2, '0');
  const blurb = rationale || summary || '';

  // Score bar — only shown when score is provided
  const scorePercent = score != null ? Math.round(score * 100) : null;
  const scoreColor = score >= 0.75
    ? '#B8860B'          // amber — high relevance
    : score >= 0.5
    ? '#6B8E6B'          // muted green — medium
    : '#888';            // grey — low

  return (
    <Link
      href={href || '#'}
      className="article-row"
      id={`article-row-${index}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackClick(articleId)}
    >
      {/* Index + score column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', minWidth: '2rem' }}>
        <span className="article-row__index">{indexStr}</span>
        {scorePercent != null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
            <div style={{
              width: '2px',
              height: `${Math.max(scorePercent * 0.28, 6)}px`,
              background: scoreColor,
              borderRadius: '1px',
              opacity: 0.85,
              transition: 'height 0.3s ease',
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.55rem',
              color: scoreColor,
              letterSpacing: '0.03em',
              opacity: 0.9,
            }}>{scorePercent}%</span>
          </div>
        )}
      </div>

      <div className="article-row__content">
        {/* Cluster pill — shows topic tag when provided */}
        {cluster && cluster !== 'General' && (
          <div style={{
            display: 'inline-block',
            marginBottom: '0.3rem',
            padding: '0.15rem 0.55rem',
            background: 'rgba(184, 134, 11, 0.1)',
            border: '1px solid rgba(184, 134, 11, 0.25)',
            borderRadius: '999px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color: 'var(--accent)',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            {cluster}
          </div>
        )}

        <div className="article-row__title">{title}</div>
        {blurb && !blurb.includes('pending') && (
          <div className="article-row__rationale">{blurb}</div>
        )}
        <div className="article-row__meta">
          {formattedDate && <span className="article-row__date">{formattedDate}</span>}
          {source && <span className="article-row__source">{source}</span>}
        </div>
      </div>

      {imageUrl && (
        <div className="article-row__image">
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
          />
        </div>
      )}
    </Link>
  );
}
