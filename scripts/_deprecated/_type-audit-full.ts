import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.PUBLIC_SUPABASE_ANON_KEY as string
);

async function main() {
  // Fetch all lures with type, name, manufacturer_slug
  const allData: any[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('type, name, manufacturer_slug, slug')
      .range(from, from + batchSize - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  console.log(`Total rows: ${allData.length}`);

  // Type distribution
  const typeCounts: Record<string, number> = {};
  for (const r of allData) {
    const t = r.type || '(null)';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  console.log('\n=== Type Distribution ===');
  for (const [type, count] of sorted) {
    console.log(`${type.padEnd(25)} ${count}`);
  }
  console.log(`Total types: ${sorted.length}`);

  // Show samples per type (unique names only)
  const byType: Record<string, { name: string; maker: string }[]> = {};
  for (const r of allData) {
    const t = r.type || '(null)';
    if (!byType[t]) byType[t] = [];
    if (!byType[t].find((x) => x.name === r.name)) {
      byType[t].push({ name: r.name, maker: r.manufacturer_slug });
    }
  }

  const sortedTypes = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
  for (const [type, items] of sortedTypes) {
    console.log(`\n=== ${type} (${items.length} unique products) ===`);
    // Show first 12 examples
    for (const item of items.slice(0, 12)) {
      console.log(`  [${item.maker}] ${item.name}`);
    }
    if (items.length > 12) console.log(`  ... and ${items.length - 12} more`);
  }

  // Check suspicious cases: common misclassifications
  console.log('\n\n========== SUSPICIOUS TYPE ASSIGNMENTS ==========');

  // Worms classified as non-worm
  const wormKeywords = /ワーム|グラブ|ホッグ|クロー|シャッドテール|ストレート|スティック|ピンテール|カーリー/;
  const nonWormTypes = sortedTypes.filter(([t]) => t !== 'ワーム' && t !== 'その他');
  for (const [type, items] of nonWormTypes) {
    const suspicious = items.filter(i => wormKeywords.test(i.name));
    if (suspicious.length > 0) {
      console.log(`\n⚠️ "${type}" に分類されたワーム系商品:`);
      for (const s of suspicious.slice(0, 5)) {
        console.log(`  [${s.maker}] ${s.name}`);
      }
    }
  }

  // Metal jigs classified as non-metal-jig
  const jigKeywords = /メタルジグ|ジグ.*g$|ジグパラ|ジグフラット/;
  const nonJigTypes = sortedTypes.filter(([t]) => t !== 'メタルジグ' && t !== 'その他');
  for (const [type, items] of nonJigTypes) {
    const suspicious = items.filter(i => jigKeywords.test(i.name));
    if (suspicious.length > 0) {
      console.log(`\n⚠️ "${type}" に分類されたメタルジグ系商品:`);
      for (const s of suspicious.slice(0, 5)) {
        console.log(`  [${s.maker}] ${s.name}`);
      }
    }
  }

  // Minnows that might be wrong
  const minnowItems = byType['ミノー'] || [];
  const suspMinnow = minnowItems.filter(i =>
    /スプーン|スピナー|ジグ|ワーム|ラバー|エギ|スッテ|タイラバ|テンヤ|クランク|バイブ|ポッパー/.test(i.name)
  );
  if (suspMinnow.length > 0) {
    console.log(`\n⚠️ "ミノー" に分類された疑わしい商品:`);
    for (const s of suspMinnow.slice(0, 10)) {
      console.log(`  [${s.maker}] ${s.name}`);
    }
  }

  // Crankbaits that might be wrong
  const crankItems = byType['クランクベイト'] || [];
  const suspCrank = crankItems.filter(i =>
    /ミノー|ジグ|ワーム|バイブ|ペンシル|ポッパー|スプーン/.test(i.name)
  );
  if (suspCrank.length > 0) {
    console.log(`\n⚠️ "クランクベイト" に分類された疑わしい商品:`);
    for (const s of suspCrank.slice(0, 10)) {
      console.log(`  [${s.maker}] ${s.name}`);
    }
  }

  // Spoons that might be wrong
  const spoonItems = byType['スプーン'] || [];
  const suspSpoon = spoonItems.filter(i =>
    /ミノー|ジグ|ワーム|バイブ|ペンシル|ポッパー|クランク/.test(i.name)
  );
  if (suspSpoon.length > 0) {
    console.log(`\n⚠️ "スプーン" に分類された疑わしい商品:`);
    for (const s of suspSpoon.slice(0, 10)) {
      console.log(`  [${s.maker}] ${s.name}`);
    }
  }

  // "その他" - should these be classified?
  const otherItems = byType['その他'] || [];
  console.log(`\n=== "その他" に分類された全商品 (${otherItems.length}件) ===`);
  for (const item of otherItems.slice(0, 30)) {
    console.log(`  [${item.maker}] ${item.name}`);
  }
  if (otherItems.length > 30) console.log(`  ... and ${otherItems.length - 30} more`);
}

main();
