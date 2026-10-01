import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const keys = ['tech||en', 'gaming||en', 'music||en', 'lifestyle|in|en'];
for (let i = 0; i < 25; i++) {
  const { data } = await db.from('topic_refresh').select('topic_key, last_refreshed_at, article_count').in('topic_key', keys).gt('last_refreshed_at', '2026-10-01T18:26:00Z');
  if (data?.length) {
    console.log(`SCHEDULED JOB CONFIRMED at ${new Date().toISOString().slice(11, 19)} UTC:`);
    for (const r of data) console.log(`  ${r.topic_key} refreshed ${r.last_refreshed_at.slice(11, 19)} (${r.article_count} articles)`);
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 60000));
}
console.log('NOT CONFIRMED: no scheduled refresh of tech/gaming/music/lifestyle by', new Date().toISOString().slice(11, 19));
