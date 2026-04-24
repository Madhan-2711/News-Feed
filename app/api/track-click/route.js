import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// POST /api/track-click  { article_id: string }
export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { article_id } = body;
    if (!article_id) return NextResponse.json({ error: 'article_id required' }, { status: 400 });

    const svc = getServiceClient();
    await svc.from('article_clicks').insert({
      user_id: user.id,
      article_id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Non-blocking — don't surface errors to client
    console.error('track-click error:', err.message);
    return NextResponse.json({ ok: false });
  }
}
