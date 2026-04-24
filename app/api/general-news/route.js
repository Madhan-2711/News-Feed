import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function getGNewsKey() {
  const keys = (process.env.GNEWS_API_KEYS || process.env.GNEWS_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  return keys[Math.floor(Math.random() * keys.length)];
}

async function fetchTopHeadlines(lang = 'en', country = '') {
  const apiKey = getGNewsKey();
  let url = `https://gnews.io/api/v4/top-headlines?lang=${lang}&max=10&apikey=${apiKey}`;
  if (country) url += `&country=${country}`;
  const res = await fetch(url, { next: { revalidate: 1800 } }); // cache 30 min
  if (!res.ok) return [];
  const data = await res.json();
  return (data.articles || []).map(a => ({
    title: a.title,
    description: a.description || '',
    source: a.source?.name || 'Unknown',
    url: a.url,
    image: a.image || null,
    publishedAt: a.publishedAt,
  }));
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let country = '';
    let lang = 'en';

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('country, lang')
        .eq('id', user.id)
        .single();
      country = profile?.country || '';
      lang = profile?.lang || 'en';
    }

    // Fetch national + international in parallel
    const [national, international] = await Promise.all([
      country ? fetchTopHeadlines(lang, country) : Promise.resolve([]),
      fetchTopHeadlines('en', ''), // world news — always English
    ]);

    return NextResponse.json({ national, international, country, lang });
  } catch (err) {
    console.error('General news error:', err);
    return NextResponse.json({ national: [], international: [], error: err.message }, { status: 500 });
  }
}
