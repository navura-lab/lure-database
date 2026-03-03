import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const PAGE = 1000;
  const typeCount = new Map<string, number>();
  const typeSamples = new Map<string, string[]>();
  let from = 0;
  let total = 0;

  while (true) {
    const { data } = await sb.from('lures').select('type,name,slug,manufacturer_slug').range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) {
      total++;
      const t = r.type || '(null)';
      typeCount.set(t, (typeCount.get(t) || 0) + 1);
      if (!typeSamples.has(t)) typeSamples.set(t, []);
      const samples = typeSamples.get(t)!;
      if (samples.length < 3) {
        samples.push(`${r.manufacturer_slug}/${r.name}`);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Sort by count desc
  const sorted = [...typeCount.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`=== Type distribution (${sorted.length} types, ${total} total rows) ===\n`);
  for (const [type, count] of sorted) {
    const pct = ((count / total) * 100).toFixed(1);
    const samples = typeSamples.get(type)?.join(' | ') || '';
    console.log(`${type.padEnd(28)} ${count.toString().padStart(6)} (${pct.padStart(5)}%)  ${samples}`);
  }
}

main();
