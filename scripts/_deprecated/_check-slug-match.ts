import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // DB全体のslug数とサンプルを確認
  const { data, error } = await sb
    .from('lures')
    .select('slug, manufacturer_slug')
    .order('manufacturer_slug');
  
  if (error) { console.error('Error:', error); return; }
  
  // ユニーク manufacturer_slug/slug ペア
  const unique = new Map<string, any>();
  for (const r of data!) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  
  console.log(`Total rows: ${data!.length}`);
  console.log(`Unique manufacturer/slug pairs: ${unique.size}`);
  
  // littlejack全件表示
  const ljSlugs = [...unique.values()].filter(r => r.manufacturer_slug === 'littlejack');
  console.log(`\nlittlejack slugs (${ljSlugs.length}):`);
  ljSlugs.forEach(r => console.log('  ' + r.slug));
  
  // Opportunity側top10のマッチ確認
  const opData = JSON.parse(readFileSync('logs/seo-data/opportunities-2026-03-07.json', 'utf-8'));
  const topLures = opData.topLures.slice(0, 10);
  console.log('\nOpportunity top 10 match check:');
  for (const lure of topLures) {
    const key = `${lure.manufacturerSlug}/${lure.slug}`;
    const found = unique.has(key);
    console.log(`  ${found ? '✓' : '✗'} ${key}`);
  }
}

main();
