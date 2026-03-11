import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!
);

// Get all Sea Falcon products
const { data, error } = await sb
  .from('lures')
  .select('name, type, slug, weight, price')
  .eq('manufacturer_slug', 'sea-falcon')
  .order('name');

if (error) { console.error(error); process.exit(1); }

// Group by name to see unique products
const byName = new Map<string, any>();
for (const row of data!) {
  if (!byName.has(row.name)) {
    byName.set(row.name, { name: row.name, type: row.type, slug: row.slug, count: 0 });
  }
  byName.get(row.name)!.count++;
}

console.log(`Sea Falcon: ${data!.length} total rows, ${byName.size} unique products\n`);
console.log('All products:');
for (const [name, info] of byName) {
  console.log(`  [${info.type || 'NO TYPE'}] ${name} (${info.count} colors) slug=${info.slug}`);
}
