import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { generateWithRetry } from '@/lib/gemini';
import { buildQAPrompt } from '@/lib/openai/prompts';

// ── Firecrawl: scrape full article text ────────────────────────
async function scrapeArticle(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.data?.markdown || null;
    return raw ? cleanArticleText(raw) : null;
  } catch {
    return null;
  }
}

function cleanArticleText(markdown) {
  const lines = markdown.split('\n');
  const clean = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-*]\s*\[.*?\]\(.*?\)\s*$/.test(trimmed)) continue;
    if (/^!\[.*?\]\(.*?\)$/.test(trimmed)) continue;
    const lower = trimmed.toLowerCase();
    if (lower.includes('copyright ©') || lower.includes('all rights reserved')) continue;
    if (lower.includes('privacy policy') && lower.includes('terms')) continue;
    clean.push(trimmed);
  }
  return clean.join('\n').slice(0, 3000);
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { article_id, question } = await request.json();

    if (!article_id || !question) {
      return NextResponse.json(
        { error: 'article_id and question are required' },
        { status: 400 }
      );
    }

    const { data: article, error: articleErr } = await supabase
      .from('daily_cache')
      .select('title, full_text, source, source_url')
      .eq('id', article_id)
      .single();

    if (articleErr || !article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    let finalContext = article.full_text || '';

    // Lazy load full text: if the text is short (just the GNews snippet), scrape it now
    if (finalContext.length < 500 && article.source_url) {
      const scrapedText = await scrapeArticle(article.source_url);
      if (scrapedText && scrapedText.length > 200) {
        finalContext = scrapedText;
        
        // Save back to DB using service role to bypass RLS
        const serviceClient = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        await serviceClient.from('daily_cache').update({ full_text: scrapedText }).eq('id', article_id);
      }
    }

    const context = finalContext || `Title: ${article.title}\nSource: ${article.source}`;
    const prompt = `${buildQAPrompt(context)}\n\nUser question: ${question}`;

    const answer = await generateWithRetry(prompt);

    return NextResponse.json({ answer: answer || 'No response generated.' });
  } catch (error) {
    console.error('Ask AI error:', error);
    const isRateLimit = error.status === 429;
    return NextResponse.json(
      { error: isRateLimit ? 'Rate limited — please wait a moment and try again.' : 'AI query failed' },
      { status: 500 }
    );
  }
}
