import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// キーワードベースの自動分類
const DELETE_PATTERNS = [
  // ロッド
  /\brod\b/i, /\bcasting\)$/i, /\bspinning\)$/i, /\b\d+['"].*(?:heavy|medium|light|fast|moderate)/i,
  /6 customs/i, /stache stick/i, /masterclass series.*rod/i, /usa custom rod/i, /salty 6.*inshore rod/i,
  // サングラス
  /sunglasses/i, /\bashor\b/i, /\baviator\b/i, /\bbedfishers\b/i, /\bcatchem\b/i,
  /\bcooker\b/i, /\bhybro\b/i, /\bjeune\b/i, /\bmilliken(?! fishing)/i, /\bsobro\b/i, /\bon 'em\b/i,
  // 帽子
  /\bmarina\b.*(?:hat|series|perforated|performance)/i, /\bwaterwood\b.*(?:hat|series|mesh|panel|vintage)/i,
  /\bmeshfest\b/i, /\bstaple\b.*(?:hat|series|mesh|panel)/i, /\bshow\b.*(?:hat|series|perforated)/i,
  /\byardfest\b/i, /\bseven\b.*(?:hat|series|semi-curved)/i, /\bjumper\b/i,
  /\bbeanie\b/i, /\bsnapback\b/i,
  // アパレル
  /premium tees/i, /\bt-shirt\b/i, /\btee\b.*(?:athletic|modern fit)/i,
  /\bhoodie\b/i, /\bflannel\b/i, /\bshorts\b/i, /\bjacket\b/i, /long sleeve/i,
  /\bpig patrol\b.*(?:l\/s|black)/i, /hunting giants hoodie/i,
  // アクセサリー
  /\bgraph cloth\b/i, /\bjungle cloth\b/i, /\bmouse pad\b/i, /\bdesk pad\b/i,
  /\brigging mat\b/i, /\bcan cooler\b/i, /\bsunglass retainer\b/i, /\bneon sign\b/i,
  /\bbackpack\b/i, /\bbait binder\b/i, /\bterminal binder\b/i, /\bclub banner\b/i,
  /\bdecal\b/i, /\bvinyl\b/i,
  // フック・タックル
  /\bflipping hook\b/i, /\bneko hook\b/i, /\bwacky hook\b/i, /\bjuggle shot\b/i,
  /\box flipping\b/i, /\bbait hook\b/i, /\bcroaker hook\b/i, /\bpanfish.*hook\b/i,
  /\bweight stoppers?\b/i, /\bsplit rings?\b/i, /\bpre-rig\b/i,
  /\b3d eyes\b/i, /\bsilicone skirt\b/i, /\breplacement (?:tail|split)/i,
  /\bhard bait gel\b/i, /\bpunch weight\b/i,
  // バンドル・サブスク
  /\bbundle\b/i, /\bsubscription\b/i, /\bsampler\b/i, /\bsack\b/i, /\bkit\b/i,
  /\bgarage sale\b/i,
  // その他
  /\bshears\b/i, /\bscissors\b/i, /\bglove\b/i, /\btackle (?:box|case)\b/i,
  /\bsticker\b/i, /\btowel\b/i, /\bgaiter\b/i, /\blanyard\b/i, /\bbag\b/i,
  // ロッド関連追記
  /\breel seat\b/i,
];

// ルアーとして再分類するパターン
const LURE_PATTERNS: Array<{pattern: RegExp; type: string; target_fish?: string[]}> = [
  // Speed Glide SW = グライドベイト
  {pattern: /speed glide.*sw/i, type: 'スイムベイト', target_fish: ['レッドフィッシュ', 'スヌーク', 'シートラウト']},
  // Movement Salt Wake = ウェイクベイト
  {pattern: /movement salt wake/i, type: 'トップウォーター', target_fish: ['レッドフィッシュ', 'スヌーク', 'シートラウト']},
  // Party Paddle Saltwater = スイムベイト
  {pattern: /party paddle.*saltwater/i, type: 'スイムベイト', target_fish: ['レッドフィッシュ', 'スヌーク', 'シートラウト']},
  // Party Prop = プロップベイト
  {pattern: /party prop/i, type: 'トップウォーター'},
  // HyperJerk SW = ジャークベイト
  {pattern: /hyperjerk.*sw/i, type: 'ジャークベイト', target_fish: ['レッドフィッシュ', 'スヌーク', 'シートラウト']},
  // Trace = スイムベイト
  {pattern: /^trace[®™]?\s/i, type: 'スイムベイト'},
];

async function main() {
  const brands = ['6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];

  const {data, error} = await sb.from('lures')
    .select('id, name, slug, manufacturer_slug, type, description')
    .in('manufacturer_slug', brands)
    .eq('type', 'その他')
    .order('manufacturer_slug');

  if (error) { console.error(error); process.exit(1); }

  // Dedupe by manufacturer_slug/slug
  const seen = new Map<string, any>();
  for (const r of data!) {
    const k = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(k)) seen.set(k, {...r, rowCount: 1});
    else seen.get(k)!.rowCount++;
  }

  const toDelete: Array<{manufacturer_slug: string; slug: string; name: string; reason: string; rowCount: number}> = [];
  const toReclassify: Array<{manufacturer_slug: string; slug: string; name: string; type: string; target_fish?: string[]; rowCount: number}> = [];
  const unknown: Array<{manufacturer_slug: string; slug: string; name: string; desc: string; rowCount: number}> = [];

  for (const [key, r] of seen) {
    const nameAndDesc = r.name + ' ' + (r.description || '');

    // Check lure patterns first
    let isLure = false;
    for (const lp of LURE_PATTERNS) {
      if (lp.pattern.test(r.name)) {
        toReclassify.push({
          manufacturer_slug: r.manufacturer_slug,
          slug: r.slug,
          name: r.name,
          type: lp.type,
          target_fish: lp.target_fish,
          rowCount: r.rowCount,
        });
        isLure = true;
        break;
      }
    }
    if (isLure) continue;

    // Check delete patterns
    let matched = false;
    for (const dp of DELETE_PATTERNS) {
      if (dp.test(r.name) || dp.test(r.description || '')) {
        toDelete.push({
          manufacturer_slug: r.manufacturer_slug,
          slug: r.slug,
          name: r.name,
          reason: dp.source,
          rowCount: r.rowCount,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Unknown - needs manual review
    unknown.push({
      manufacturer_slug: r.manufacturer_slug,
      slug: r.slug,
      name: r.name,
      desc: (r.description || '').substring(0, 120),
      rowCount: r.rowCount,
    });
  }

  console.log(`=== 分類結果 ===`);
  console.log(`削除: ${toDelete.length}件 (${toDelete.reduce((s,r) => s+r.rowCount, 0)}行)`);
  console.log(`再分類: ${toReclassify.length}件 (${toReclassify.reduce((s,r) => s+r.rowCount, 0)}行)`);
  console.log(`未分類: ${unknown.length}件 (${unknown.reduce((s,r) => s+r.rowCount, 0)}行)`);

  console.log(`\n--- 削除対象 (先頭20件) ---`);
  toDelete.slice(0, 20).forEach(r =>
    console.log(`  ${r.manufacturer_slug}/${r.slug} | ${r.name} | rows:${r.rowCount}`)
  );
  if (toDelete.length > 20) console.log(`  ... 他${toDelete.length - 20}件`);

  console.log(`\n--- 再分類対象 ---`);
  toReclassify.forEach(r =>
    console.log(`  ${r.manufacturer_slug}/${r.slug} → ${r.type} | ${r.name} | rows:${r.rowCount}`)
  );

  console.log(`\n--- 未分類（要確認） ---`);
  unknown.forEach(r =>
    console.log(`  ${r.manufacturer_slug}/${r.slug} | ${r.name} | ${r.desc}`)
  );

  // Save results
  const result = { toDelete, toReclassify, unknown };
  writeFileSync('/tmp/classify-result.json', JSON.stringify(result, null, 2));
  console.log('\n結果を /tmp/classify-result.json に保存');
}

main();
