import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 1000;

async function fetchAll(columns: string) {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select(columns)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  console.log('Fetching all rows (paginated)...');
  const rows = await fetchAll('type, target_fish, slug, manufacturer_slug');
  console.log(`Total rows: ${rows.length}`);

  // Types
  const typeSlugSets = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.type) continue;
    if (!typeSlugSets.has(r.type)) typeSlugSets.set(r.type, new Set());
    typeSlugSets.get(r.type)!.add(r.slug);
  }
  console.log('\n=== TYPES (unique series count) ===');
  [...typeSlugSets.entries()]
    .map(([t, s]) => [t, s.size] as const)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, c]) => console.log(`  ${t}: ${c} series`));
  console.log(`Total unique types: ${typeSlugSets.size}`);

  // Count rows without type
  const noType = rows.filter(r => !r.type);
  console.log(`Rows without type: ${noType.length} (${new Set(noType.map((r: any) => r.slug)).size} slugs)`);

  // Target fish
  const fishSlugSets = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.target_fish || !Array.isArray(r.target_fish)) continue;
    for (const f of r.target_fish) {
      if (!fishSlugSets.has(f)) fishSlugSets.set(f, new Set());
      fishSlugSets.get(f)!.add(r.slug);
    }
  }
  console.log('\n=== TARGET FISH (unique series count) ===');
  [...fishSlugSets.entries()]
    .map(([f, s]) => [f, s.size] as const)
    .sort((a, b) => b[1] - a[1])
    .forEach(([f, c]) => console.log(`  ${f}: ${c} series`));
  console.log(`Total unique fish: ${fishSlugSets.size}`);

  // Count rows without target_fish
  const noFish = rows.filter(r => !r.target_fish || r.target_fish.length === 0);
  console.log(`Rows without target_fish: ${noFish.length} (${new Set(noFish.map((r: any) => r.slug)).size} slugs)`);
}

main().catch(console.error);
