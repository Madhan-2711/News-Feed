import { NextResponse } from 'next/server';
import { checkAllKeys } from '@/lib/gemini';

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await checkAllKeys();
    const working = results.filter(r => r.status === 'ok').length;
    return NextResponse.json({
      working,
      total: results.length,
      providers: results.map(({ provider, status, code }) => ({ provider, status, code })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
