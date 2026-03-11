import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function fetchAllLures() {
  const allRows: any[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, manufacturer_slug, name, type, target_fish, action_type, diving_depth, description')
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) { console.error('DB error:', error); return []; }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

async function main() {
  // Read opportunity finder top lures
  const opData = JSON.parse(readFileSync('logs/seo-data/opportunities-2026-03-07.json', 'utf-8'));
  const topLures = opData.topLures.slice(0, 100);
  console.log(`Top lures from opportunity finder: ${topLures.length}`);

  // Get ALL lures from Supabase (paginated)
  const allLures = await fetchAllLures();
  console.log(`Total DB rows: ${allLures.length}`);

  // Group by manufacturer_slug/slug (unique)
  const lureMap = new Map<string, any>();
  for (const r of allLures) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!lureMap.has(key)) {
      lureMap.set(key, {
        slug: r.slug,
        manufacturerSlug: r.manufacturer_slug,
        name: r.name,
        type: r.type || '',
        targetFish: r.target_fish || [],
        actionType: r.action_type || '',
        divingDepth: r.diving_depth || '',
        description: (r.description || '').substring(0, 200),
      });
    }
  }
  console.log(`Unique lure slugs in DB: ${lureMap.size}`);

  // Match top lures with DB data
  const results: any[] = [];
  const unmatched: string[] = [];
  for (const lure of topLures) {
    const key = `${lure.manufacturerSlug}/${lure.slug}`;
    const dbData = lureMap.get(key);
    if (dbData) {
      results.push({
        ...dbData,
        impressions: lure.impressions,
        clicks: lure.clicks,
        position: lure.position,
        topQueries: (lure.topQueries || []).slice(0, 3),
        overallScore: lure.overallScore,
      });
    } else {
      unmatched.push(key);
    }
  }

  console.log(`Matched lures with DB data: ${results.length}`);
  if (unmatched.length > 0) {
    console.log(`Unmatched (${unmatched.length}):`);
    unmatched.slice(0, 10).forEach(k => console.log('  ' + k));
  }

  // Filter out lures with type "その他" or no type
  const validResults = results.filter(r => r.type && r.type !== 'その他' && r.type !== 'ルアー');
  console.log(`Valid for guide generation (has type): ${validResults.length}`);

  // Save ALL matched results (including "その他")
  writeFileSync('/tmp/lure-guide-data.json', JSON.stringify(results, null, 2));
  console.log(`Saved ${results.length} lures to /tmp/lure-guide-data.json`);

  // Show first 10
  console.log('\nTop 10:');
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.manufacturerSlug}/${r.slug}: ${r.name} | type=${r.type} | ${r.impressions}imp ${r.clicks}click pos=${r.position?.toFixed(1)}`);
  }
}

main();
