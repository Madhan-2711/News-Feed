import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/setup';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if user has profile with interests set
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('interests')
          .eq('id', user.id)
          .single();

        // Only skip setup if at least one topic_* interest is actually saved
        const hasInterests = profile?.interests &&
          Object.keys(profile.interests).some(k => k.startsWith('topic_'));
        if (hasInterests) {
          return NextResponse.redirect(`${origin}/feed`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth_failed`);
}
