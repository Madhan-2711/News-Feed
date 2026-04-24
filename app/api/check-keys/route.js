import { NextResponse } from 'next/server';
import { checkAllKeys } from '@/lib/gemini';

export async function GET() {
  try {
    const results = await checkAllKeys();
    const working = results.filter(r => r.status === 'ok').length;
    return NextResponse.json({ working, total: results.length, keys: results });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
