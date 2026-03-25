import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

let allData: any[] = [];
let from = 0;
const pageSize = 1000;
while (true) {
  const { data, error } = await sb.from('lures').select('slug, manufacturer_slug, name, type, weight, length, price, description').range(from, from + pageSize - 1);
  if (error) { console.error(JSON.stringify(error)); break; }
  if (!data || data.length === 0) break;
  allData = allData.concat(data);
  if (data.length < pageSize) break;
  from += pageSize;
}

const slugMap = new Map<string, any>();
for (const r of allData) {
  if (!slugMap.has(r.slug)) {
    slugMap.set(r.slug, { slug: r.slug, manufacturer_slug: r.manufacturer_slug, name: r.name, type: r.type, weight: r.weight, length: r.length, price: r.price, description: r.description, colorCount: 0 });
  }
  slugMap.get(r.slug).colorCount++;
}

const sorted = [...slugMap.values()].sort((a: any, b: any) => b.colorCount - a.colorCount);
const top60 = sorted.slice(0, 60);
fs.writeFileSync('/tmp/top60_by_colors.json', JSON.stringify(top60, null, 2));
console.log('Done:', top60.length, 'items');
top60.slice(0, 60).forEach((r: any, i: number) => console.log(i+1, r.slug, r.colorCount, r.type));
