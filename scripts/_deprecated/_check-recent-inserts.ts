import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY as string
);

async function main() {
  // Check recent inserts (last 24 hours)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: e1 } = await sb
    .from('lures')
    .select('manufacturer_slug, name, created_at')
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })
    .limit(50);

  if (e1) { console.error('Recent query error:', e1); }
  else {
    console.log(`=== Recent inserts (last 24h): ${recent.length} rows ===`);
    const byMaker: Record<string, number> = {};
    recent.forEach((r: any) => { byMaker[r.manufacturer_slug] = (byMaker[r.manufacturer_slug] || 0) + 1; });
    Object.entries(byMaker).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    if (recent.length > 0) {
      console.log('\nSample recent rows:');
      recent.slice(0, 5).forEach((r: any) => console.log(`  ${r.manufacturer_slug} | ${r.name} | ${r.created_at}`));
    }
  }

  // Check Phase 3 makers specifically
  const phase3 = ['attic','damiki','dreemup','god-hands','grassroots','itocraft','ivy-line','jazz','jungle-gym','mibro','obasslive','pickup','pozidrive-garage','sea-falcon','shout','signal','skagit','souls','viva','yarie'];

  console.log('\n=== Phase 3 makers in Supabase ===');
  for (const slug of phase3) {
    const { count, error } = await sb
      .from('lures')
      .select('*', { count: 'exact', head: true })
      .eq('manufacturer_slug', slug);
    if (error) console.log(`  ${slug}: ERROR - ${error.message}`);
    else console.log(`  ${slug}: ${count} rows`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
