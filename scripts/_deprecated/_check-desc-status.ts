import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY!
);

async function fetchAll() {
  const allRows: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, name, manufacturer_slug, manufacturer, description')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id');

    if (error) { console.error(error); return null; }
    if (!data || data.length === 0) break;

    allRows.push(...data);
    offset += PAGE_SIZE;

    if (data.length < PAGE_SIZE) break;
  }

  return allRows;
}

async function main() {
  const data = await fetchAll();
  if (!data) return;

  console.log(`Total rows fetched: ${data.length}`);

  // slug単位で重複排除（最初の行を採用）
  const bySlug = new Map<string, { slug: string; name: string; manufacturer_slug: string; manufacturer: string; description: string | null }>();
  for (const row of data) {
    if (!bySlug.has(row.slug)) {
      bySlug.set(row.slug, row);
    }
  }

  const total = bySlug.size;
  let noDesc = 0;
  let shortDesc = 0;
  let longDesc = 0;
  const noDescByMaker = new Map<string, number>();
  const longDescByMaker = new Map<string, number>();

  for (const [, row] of bySlug) {
    if (!row.description || row.description.trim() === '') {
      noDesc++;
      noDescByMaker.set(row.manufacturer_slug, (noDescByMaker.get(row.manufacturer_slug) || 0) + 1);
    } else if (row.description.length <= 250) {
      shortDesc++;
    } else {
      longDesc++;
      longDescByMaker.set(row.manufacturer_slug, (longDescByMaker.get(row.manufacturer_slug) || 0) + 1);
    }
  }

  console.log(`\n=== Description Status ===`);
  console.log(`Total unique slugs: ${total}`);
  console.log(`✅ Rewritten (<=250 chars): ${shortDesc} (${(shortDesc/total*100).toFixed(1)}%)`);
  console.log(`⚠️  Unrewritten (>250 chars): ${longDesc} (${(longDesc/total*100).toFixed(1)}%)`);
  console.log(`❌ No description: ${noDesc} (${(noDesc/total*100).toFixed(1)}%)`);

  if (longDesc > 0) {
    console.log(`\n--- Unrewritten (>250 chars) by maker ---`);
    const sorted = [...longDescByMaker.entries()].sort((a, b) => b[1] - a[1]);
    for (const [maker, count] of sorted) {
      console.log(`  ${maker}: ${count}`);
    }
  }

  if (noDesc > 0) {
    console.log(`\n--- No description by maker ---`);
    const sorted = [...noDescByMaker.entries()].sort((a, b) => b[1] - a[1]);
    for (const [maker, count] of sorted) {
      console.log(`  ${maker}: ${count}`);
    }
  }
}

main();
