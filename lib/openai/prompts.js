export function buildRationalePrompt(articlesData, userInterests) {
  let interestsList = '';
  if (Array.isArray(userInterests)) {
    interestsList = userInterests.join(', ');
  } else if (typeof userInterests === 'object') {
    interestsList = Object.values(userInterests).filter(Boolean).join(', ');
  }

  return `You are a senior news analyst. Analyze these articles for a reader interested in: ${interestsList || 'general news'}.

For EACH article, provide:
1. A relevance score (0.0 – 1.0)
2. A one-line rationale explaining why this matters to the reader
3. A 4–5 sentence analytical summary that covers: what happened, why it matters, and key implications
4. A short topic cluster label (2-4 words max, e.g. "Indian Markets", "Global Tech", "Geopolitics", "Sports", "Science & Health")

ARTICLES:
${articlesData.map((a, i) => `
[${i}] "${a.title}"
Full text: ${(a.full_text || a.description || '').slice(0, 1500)}
`).join('\n')}

Respond with valid JSON only. No markdown fences. Format:
[
  {
    "index": 0,
    "score": 0.85,
    "rationale": "Brief explanation of relevance.",
    "summary": "4-5 sentence analytical summary. Cover what happened, why it matters, and implications. Do NOT just truncate or paraphrase the article — synthesize the key points.",
    "cluster": "Indian Markets"
  }
]

Rules:
- Score 0.0 to 1.0 based on relevance to the reader's interests
- Rationale: 1 concise line
- Summary: 4-5 sentences of real analysis. Explain context and significance. Never just copy text from the article.
- cluster: 2-4 word label that groups this article by topic. Be consistent — articles about the same story should share a cluster name.
- If the article text is truncated or incomplete, infer what you can from the title and available text
- Return results for ALL articles`;
}

// ── AI Ranking prompt — used by the multi-source pipeline ─────────
// behaviorProfile: plain-English string built from click-frequency analysis (may be null)
// recentTitles:   last N article titles the user actually opened
// When behaviorProfile is present it is the PRIMARY signal; stated interests are context only.
export function buildRankingPrompt(articles, userInterests, behaviorProfile = null, recentTitles = []) {
  let interestsList = '';
  if (Array.isArray(userInterests)) {
    interestsList = userInterests.join(', ');
  } else if (typeof userInterests === 'object') {
    interestsList = Object.values(userInterests).filter(Boolean).join(', ');
  }

  // Decide primary vs secondary signal
  const primarySignal = behaviorProfile
    ? `PRIMARY SIGNAL — actual reading behavior:\n  ${behaviorProfile}`
    : `PRIMARY SIGNAL — stated interests: ${interestsList || 'general news'}`;

  const secondarySignal = behaviorProfile && interestsList
    ? `\nSecondary context — stated interests: ${interestsList} (use only if behavior signal is insufficient)`
    : '';

  const recentBlock = recentTitles.length > 0
    ? `\nRecently read articles (last ${recentTitles.length}):\n${recentTitles.slice(0, 15).map(t => `  - ${t}`).join('\n')}`
    : '';

  return `You are a senior news editor building a daily personalized feed.

READER PROFILE:
${primarySignal}${secondarySignal}${recentBlock}

TASK: Score and rank the ${articles.length} candidate articles below. Articles that match the reader's ACTUAL reading behavior must score highest. If no behavior data is available, use stated interests instead.

For EACH article assign:
1. score (0.0–1.0): how well it matches this reader. Behavior signal outweighs stated interests.
2. rationale: one sharp, specific sentence explaining why this matters to THIS reader personally.
3. summary: 3–4 sentence analytical summary — what happened, why it matters, key implications. Never copy text verbatim.
4. cluster: 2–4 word topic label. Be consistent — related articles must share the same cluster name.

CANDIDATE ARTICLES:
${articles.map((a, i) => `[${i}] "${a.title}"
Source: ${a.source_name || a.source || 'Unknown'}
Text: ${(a.full_text || a.content || a.description || '').slice(0, 600)}
`).join('\n')}

Return ONLY a valid JSON array — one object per article, no markdown, no extra text.
[
  {
    "index": 0,
    "score": 0.92,
    "rationale": "Specific reason this matters to this reader.",
    "summary": "3–4 sentence analytical summary.",
    "cluster": "IPL Cricket"
  }
]

Rules:
- Return ALL ${articles.length} articles, none skipped
- score: 0.0–1.0 only
- cluster: 2–4 words, consistent across related stories
- summary: synthesized analysis, NOT copied text`;
}

export function buildDailyBriefPrompt(articles, userInterests) {
  let interestsList = '';
  if (Array.isArray(userInterests)) {
    interestsList = userInterests.join(', ');
  } else if (typeof userInterests === 'object') {
    interestsList = Object.values(userInterests).filter(Boolean).join(', ');
  }

  const titles = articles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');

  return `You are an editorial writer for a personalized news digest.

A reader interested in: ${interestsList || 'general news'} has ${articles.length} articles in their feed today.

Here are the article titles:
${titles}

Write a 2-3 sentence "Daily Brief" — a sharp, conversational editorial intro that:
- Highlights the dominant theme or story of the day
- Mentions specific topics (not generic phrases like "several articles")
- Reads like a newspaper editor wrote it, not an AI
- Is personalized to this reader's interests

Return ONLY the brief text. No labels, no JSON, no markdown.`;
}

export function buildQAPrompt(articleContent) {
  return `You are a knowledgeable analyst. Answer the user's question based on the article below.
If the answer isn't fully covered in the article, use what's available and note any limitations.
Keep answers clear, factual, and conversational.

ARTICLE CONTEXT:
${articleContent}`;
}
