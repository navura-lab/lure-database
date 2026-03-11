import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 全ルアーのslug + description取得
  let allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('lures')
      .select('manufacturer_slug, slug, description')
      .order('manufacturer_slug')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // ユニークslug
  const seen = new Map<string, any>();
  for (const r of allData) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }

  // canonical-groups.ts と同じロジック
  const groups = new Map<string, string[]>();
  for (const [key, r] of seen) {
    const desc = (r.description || '').substring(0, 200).trim();
    if (desc.length < 20) continue;
    const groupKey = `${r.manufacturer_slug}|${desc}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(key);
  }

  let overrideCount = 0;
  let groupCount = 0;
  for (const [, slugs] of groups) {
    if (slugs.length >= 2) {
      groupCount++;
      overrideCount += slugs.length - 1; // 1つがcanonical、残りがoverride
    }
  }

  console.log(`ユニークslug総数: ${seen.size}`);
  console.log(`同一descグループ数: ${groupCount}`);
  console.log(`canonical override対象ページ数: ${overrideCount}`);
  console.log(`→ Google重複判定が解消される推定ページ数: ${overrideCount}`);
  console.log(`\n上位グループ:`);
  const sorted = [...groups.entries()]
    .filter(([, s]) => s.length >= 5)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, slugs] of sorted.slice(0, 10)) {
    const maker = key.split('|')[0];
    console.log(`  ${maker}: ${slugs.length}件 - ${slugs[0]}`);
  }
}
main();
