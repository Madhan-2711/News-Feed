import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const cutoff = '2026-10-01T18:25:00Z';
for (let i = 0; i < 30; i++) {
  const { data } = await db.from('topic_refresh').select('topic_key, last_refreshed_at, article_count')
    .in('topic_key', ['tech||en', 'gaming||en', 'music||en', 'lifestyle|in|en', 'sports|in|en', 'travel|in|en', 'science|in|en'])
    .gt('last_refreshed_at', cutoff);
  if (data?.length) {
    console.log(`SCHEDULED RUN CONFIRMED (${new Date().toISOString().slice(11, 19)} UTC): ${data.length} topic(s) refreshed`);
    for (const r of data) console.log(`  ${r.topic_key} at ${r.last_refreshed_at.slice(11, 19)} (${r.article_count} articles)`);
    const { data: all } = await db.from('topic_refresh').select('topic_key, last_refreshed_at, article_count').order('topic_key');
    console.log('all topics:'); for (const r of all) console.log(`  ${r.topic_key.padEnd(22)} ${r.last_refreshed_at?.slice(11, 19) ?? 'never'} ${r.article_count}`);
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 60000));
}
console.log('NO scheduled refresh by', new Date().toISOString());
