import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb.from('lures').select('target_fish, type');
  const combos = new Map<string, number>();
  for (const row of data!) {
    if (!row.target_fish || !row.type) continue;
    const fishes = Array.isArray(row.target_fish) ? row.target_fish : [row.target_fish];
    for (const fish of fishes) {
      const key = fish + '|' + row.type;
      combos.set(key, (combos.get(key) || 0) + 1);
    }
  }
  const sorted = [...combos.entries()]
    .filter(([_, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1]);
  console.log('Total ranking combos (>=3):', sorted.length);
  
  // Read existing descriptions
  const descContent = fs.readFileSync('src/data/ranking-descriptions.ts', 'utf8');
  const existingKeys = new Set([...descContent.matchAll(/'([a-z0-9_-]+-[a-z0-9_-]+)':/g)].map(m => m[1]));
  console.log('Existing description keys:', existingKeys.size);
  
  // Need to convert fish/type names to slugs - read category-slugs
  const slugContent = fs.readFileSync('src/lib/category-slugs.ts', 'utf8');
  
  // Extract fish slug map
  const fishMap = new Map<string, string>();
  const fishMatches = slugContent.matchAll(/\['(.+?)',\s*'(.+?)'\]/g);
  // This is a rough parse, let's just output the raw combos with their fish|type names
  for (const [key, count] of sorted) {
    console.log(count + '\t' + key);
  }
}
main();
