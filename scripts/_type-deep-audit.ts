import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.PUBLIC_SUPABASE_ANON_KEY as string
);

async function main() {
  const allData: any[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('type, name, manufacturer_slug, slug, source_url')
      .range(from, from + batchSize - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  // Deduplicate by name+manufacturer (each name appears multiple times due to colors)
  const uniqueByName = new Map<string, any>();
  for (const r of allData) {
    const key = `${r.manufacturer_slug}:::${r.name}`;
    if (!uniqueByName.has(key)) uniqueByName.set(key, r);
  }
  const products = [...uniqueByName.values()];
  console.log(`Total rows: ${allData.length}, Unique products: ${products.length}`);

  // ========= DEEP CHECK: ミノー =========
  console.log('\n\n====== ミノー に分類された商品で疑わしいもの ======');
  const minnows = products.filter(p => p.type === 'ミノー');
  const suspiciousMinnow = minnows.filter(p => {
    const n = p.name;
    return (
      /バイブ/i.test(n) || /ジグ/i.test(n) || /スプーン/i.test(n) ||
      /ポッパー/i.test(n) || /ペンシル/i.test(n) || /クランク/i.test(n) ||
      /ワーム/i.test(n) || /エギ/i.test(n) || /フロッグ/i.test(n) ||
      /スピナー/i.test(n) || /チャター/i.test(n) || /バズ/i.test(n) ||
      /タイラバ/i.test(n) || /テンヤ/i.test(n) || /スッテ/i.test(n) ||
      /ブレード/i.test(n) || /スイムベイト/i.test(n)
    );
  });
  for (const p of suspiciousMinnow) {
    console.log(`  [${p.manufacturer_slug}] ${p.name}`);
  }

  // ========= DEEP CHECK: メーカー別の type 分布 =========
  console.log('\n\n====== メーカー別 type 分布 ======');
  const byMaker: Record<string, Record<string, number>> = {};
  for (const p of products) {
    const m = p.manufacturer_slug;
    const t = p.type || '(null)';
    if (!byMaker[m]) byMaker[m] = {};
    byMaker[m][t] = (byMaker[m][t] || 0) + 1;
  }

  // Show makers where ONE type dominates >80% (likely broken scraper)
  console.log('\n--- メーカーで1つのタイプが80%以上を占めるもの（スクレイパーが壊れている可能性）---');
  for (const [maker, types] of Object.entries(byMaker)) {
    const total = Object.values(types).reduce((a, b) => a + b, 0);
    if (total < 5) continue; // skip tiny makers
    const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
    const topType = sorted[0][0];
    const topCount = sorted[0][1];
    const pct = (topCount / total * 100);
    // Skip makers that SHOULD have one type (e.g., spoon makers, jig makers)
    if (pct > 80 && total > 10 &&
        !['forest', 'valkein', 'god-hands', 'ivy-line', 'yarie'].includes(maker) &&
        topType !== 'ワーム' && topType !== 'メタルジグ' && topType !== 'スプーン' && topType !== 'エギ') {
      console.log(`  ${maker}: ${topType} = ${topCount}/${total} (${pct.toFixed(0)}%)`);
      // Show other types
      for (const [t, c] of sorted.slice(1)) {
        console.log(`    ${t}: ${c}`);
      }
    }
  }

  // Show ALL makers with their type distribution
  console.log('\n\n--- 全メーカーtype分布（product数>5のみ）---');
  const makersSorted = Object.entries(byMaker)
    .map(([m, types]) => ({
      maker: m,
      total: Object.values(types).reduce((a, b) => a + b, 0),
      types
    }))
    .filter(m => m.total > 5)
    .sort((a, b) => b.total - a.total);

  for (const { maker, total, types } of makersSorted) {
    const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
    const topTypes = sorted.slice(0, 5).map(([t, c]) => `${t}:${c}`).join(', ');
    const others = sorted.length > 5 ? ` +${sorted.length - 5}` : '';
    console.log(`  ${maker.padEnd(20)} (${total}) → ${topTypes}${others}`);
  }

  // ========= VIVA check: products with descriptions as names =========
  console.log('\n\n====== VIVA: 商品名が説明文になっている（壊れてる）======');
  const vivaProducts = products.filter(p => p.manufacturer_slug === 'viva');
  for (const p of vivaProducts) {
    if (p.name.length > 30 || p.name.includes('\n')) {
      console.log(`  [${p.type}] ${p.name.substring(0, 60)}...`);
    }
  }

  // ========= Check: "ルアー" type (should not exist, should be normalized) =========
  const lureType = products.filter(p => p.type === 'ルアー');
  if (lureType.length > 0) {
    console.log('\n\n====== 未正規化: type="ルアー" ======');
    for (const p of lureType) {
      console.log(`  [${p.manufacturer_slug}] ${p.name}`);
    }
  }

  // ========= Specific maker deep dives =========
  // Check DAIWA - big maker, likely many types
  console.log('\n\n====== DAIWA 全タイプ分布 ======');
  const daiwaProducts = products.filter(p => p.manufacturer_slug === 'daiwa');
  const daiwaTypes: Record<string, string[]> = {};
  for (const p of daiwaProducts) {
    if (!daiwaTypes[p.type]) daiwaTypes[p.type] = [];
    daiwaTypes[p.type].push(p.name);
  }
  for (const [type, names] of Object.entries(daiwaTypes).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${type} (${names.length}): ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`);
  }

  // Check SHIMANO
  console.log('\n\n====== SHIMANO 全タイプ分布 ======');
  const shimanoProducts = products.filter(p => p.manufacturer_slug === 'shimano');
  const shimanoTypes: Record<string, string[]> = {};
  for (const p of shimanoProducts) {
    if (!shimanoTypes[p.type]) shimanoTypes[p.type] = [];
    shimanoTypes[p.type].push(p.name);
  }
  for (const [type, names] of Object.entries(shimanoTypes).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${type} (${names.length}): ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`);
  }

  // Check MEGABASS
  console.log('\n\n====== MEGABASS 全タイプ分布 ======');
  const megabassProducts = products.filter(p => p.manufacturer_slug === 'megabass');
  const megabassTypes: Record<string, string[]> = {};
  for (const p of megabassProducts) {
    if (!megabassTypes[p.type]) megabassTypes[p.type] = [];
    megabassTypes[p.type].push(p.name);
  }
  for (const [type, names] of Object.entries(megabassTypes).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${type} (${names.length}): ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`);
  }

  // Check JACKALL
  console.log('\n\n====== JACKALL 全タイプ分布 ======');
  const jackallProducts = products.filter(p => p.manufacturer_slug === 'jackall');
  const jackallTypes: Record<string, string[]> = {};
  for (const p of jackallProducts) {
    if (!jackallTypes[p.type]) jackallTypes[p.type] = [];
    jackallTypes[p.type].push(p.name);
  }
  for (const [type, names] of Object.entries(jackallTypes).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${type} (${names.length}): ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`);
  }

  // ========= Non-lure products in DB =========
  console.log('\n\n====== 非ルアー商品（DBに残っているべきでないもの）======');
  const nonLureKeywords = /フック|シンカー|ウェイト|ロッド|リール|ライン|スナップ|リング|スカート|替え針|替鈎|ネクタイ|アシスト|パーツ|ケース|バッグ|ツール|キャップ|CAP|帽子|Tシャツ|ステッカー|セット|パック|ドジャー|バイス|キーパー/;
  const nonLure = products.filter(p => nonLureKeywords.test(p.name));
  console.log(`非ルアー候補: ${nonLure.length}件`);
  for (const p of nonLure.slice(0, 40)) {
    console.log(`  [${p.manufacturer_slug}] [${p.type}] ${p.name}`);
  }
}

main();
