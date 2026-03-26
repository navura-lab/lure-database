import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!
);

const existing = new Set(
  readFileSync('/tmp/existing-editorials.txt', 'utf-8')
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
);

const EXCLUDE_TYPES = ['ジグヘッド', 'テンヤ', 'シンカー', 'アクセサリー', 'タイラバ', 'その他', 'テキサスリグ'];

let allData: any[] = [];
let from = 0;
const pageSize = 1000;

while (true) {
  const { data, error } = await sb
    .from('lures')
    .select('slug, manufacturer_slug, name, type, target_fish, weight, length, description')
    .range(from, from + pageSize - 1);
  
  if (error) { process.stderr.write(JSON.stringify(error) + '\n'); break; }
  if (!data || data.length === 0) break;
  allData = allData.concat(data);
  if (data.length < pageSize) break;
  from += pageSize;
}

process.stderr.write(`Total rows: ${allData.length}\n`);

const bySlug = new Map<string, any[]>();
for (const row of allData) {
  const key = row.slug;
  if (!bySlug.has(key)) bySlug.set(key, []);
  bySlug.get(key)!.push(row);
}

const candidates: any[] = [];
for (const [slug, rows] of bySlug) {
  const types = [...new Set(rows.map((r: any) => r.type))];
  if (types.some((t: any) => EXCLUDE_TYPES.includes(t))) continue;
  if (existing.has(slug)) continue;
  
  const colorCount = rows.length;
  const sample = rows[0];
  
  candidates.push({
    slug,
    manufacturer_slug: sample.manufacturer_slug,
    name: sample.name,
    type: sample.type,
    target_fish: sample.target_fish,
    weight: sample.weight,
    length: sample.length,
    description: sample.description,
    colorCount,
  });
}

candidates.sort((a: any, b: any) => b.colorCount - a.colorCount);

const top30 = candidates.slice(0, 60);
process.stdout.write(JSON.stringify(top30, null, 2) + '\n');
