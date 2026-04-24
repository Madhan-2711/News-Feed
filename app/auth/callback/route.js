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

        // If interests are already configured, go to feed
        const hasInterests = profile?.interests && Object.keys(profile.interests).length > 0;
        if (hasInterests) {
          return NextResponse.redirect(`${origin}/feed`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth_failed`);
}
