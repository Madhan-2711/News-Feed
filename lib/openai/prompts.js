// ── AI Prompts — only Q&A remains (ranking/brief are now algorithmic) ──

export function buildQAPrompt(articleContent) {
  return `You are a knowledgeable analyst. Answer the user's question based on the article below.
If the answer isn't fully covered in the article, use what's available and note any limitations.
Keep answers clear, factual, and conversational.

ARTICLE CONTEXT:
${articleContent}`;
}
