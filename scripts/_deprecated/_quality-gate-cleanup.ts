// scripts/_quality-gate-cleanup.ts
// 品質ゲート: Supabaseから非ルアー製品を一括検出・削除
//
// Usage:
//   tsx scripts/_quality-gate-cleanup.ts           # dry-run（デフォルト）
//   tsx scripts/_quality-gate-cleanup.ts --delete   # 実際に削除

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 非ルアー製品の検出パターン（日本語 + 英語）
// ---------------------------------------------------------------------------

const NON_LURE_NAME_PATTERNS: RegExp[] = [
  // ===================== 日本語: 確実な非ルアー =====================

  // アフターパーツ・スペアパーツ
  /アフターパーツ/,
  /スペアパーツ/,
  /カスタムパーツ/,

  // ロッド（「〜ロッド」で終わるもの、型番+ロッド）
  /(?:キャスティング|ジギング|ベイト|スピニング|ショアジギング)ロッド/,

  // フック単体販売
  /フックユニット/,
  /アシストフック/,

  // シンカー（ルアー名にシンカーは出ない）
  /シンカー/,

  // アパレル
  /グローブ$/,      // 「半素手グローブ」等
  /ショルダーバッグ/,
  /Tシャツ/,

  // ===================== 英語: 確実な非ルアー =====================

  // フック単体販売（"hook" 単体は曖昧なので、明確な単体パターンのみ）
  /\b(?:dart|ewg|neko|treble|worm|widegap|flippin|finesse\s+wacky|finesse)\s+hook/i,
  /\bhook\s+\d+\/bag\b/i,     // "Hooks 8/Bag"

  // ジグヘッド単体（ルアーではなくフック+シンカー製品）
  /\bline[- ]?thru\s+jig\s+head\b/i,
  /\blite\s+jig\s+heads?\b/i,
  /\b(?:wacky|neko)\s+(?:rig\s+)?(?:jig\s+)?head\b/i,

  // ウェイト単体（"HEAVY WEIGHT"はルアーの重量名なので除外）
  /\b(?:dome\s+)?neko\s+weight\b/i,
  /\b(?:wacky|drop\s*shot|flipping|nail|split\s*shot|split\s*ball|lead\s+wacky)\s+weight\b/i,
  /\btungsten\s+worm\s+weight\b/i,
  /\boffset\s+sinker\b/i,

  // ロッド（英語）
  /\b(?:spinning|casting|travel)\s+rod\b/i,
  /^ROD$/i,  // 名前がまさに「ROD」

  // 釣り糸
  /\bfishing\s+line\b/i,

  // バッグ・ケース（確実なもののみ）
  /\bgear\s+bag\b/i,
  /\btackle\s+(?:box|bag)\b/i,

  // アパレル（確実なもの）
  /\b(?:t-?shirt|hoodie|jacket|glove|cap|hat)\b.*\b(?:\d+\/bag|pack)\b/i,
  /\bapparel\b/i,

  // スイベル・スナップ（釣具小物）
  /\bswivel\b/i,

  // 交換パーツ
  /\breplacement\s+(?:tail|fin)\b/i,
  /\bsilicone\s+skirt\b/i,
  /\bspare\s+parts?\b/i,

  // ===================== 特定型番・slug =====================

  // Zero Dragon ロッド型番
  /^ZF-/i,
  // Zero Dragon キャスティングロッド
  /キャスティングロッド/,
];

// 確実に非ルアーのslug（個別指定）
const NON_LURE_SLUGS = new Set([
  // Shimano アフターパーツ
  'a155f00000cehq0qan',  // アーマジョイント 190 カスタムパーツ
  'a155f00000cehnbqan',  // アーマジョイント 150 カスタムパーツ
  // XESTA
  'runway-xr',           // XESTAロッド
  'venus-crew-2026',     // XESTAレディースウェア
  // Viva
  'metalmagic-spare-parts',  // MetalMagic スペアパーツ
  'aw-offset-sinker',        // A.W.オフセットシンカー
  'datchak-hookunit',        // ダッチャクフックユニット
  'aw-shoulderbag',          // A.W.ショルダーバッグ
  'hansude-glove',           // 半素手グローブ
  'spark-assist-hook',       // スパーク・アシストフック
  // itocraft
  'rod',                     // ROD
  // Rapala
  'north-craft-cap',         // NORTH CRAFT CAP
  // Berkley US
  'ice-gear-bag',            // Ice Gear Bag
  // 6th Sense（全てフック/ジグヘッド/ウェイト）
  'treble-head-underspin-line-thru-jig-head-raw',
  'treble-head-underspin-line-thru-jig-head-perch-gill',
  'treble-head-underspin-line-thru-jig-head-baby-shad',
  'treble-head-line-thru-jig-head-perch-gill',
  'treble-head-line-thru-jig-head-baby-shad',
  'treble-head-line-thru-jig-head-raw',
  'dome-neko-weight-matte-brown',
  'dome-neko-weight-matte-green-pumpkin',
  'dome-neko-weight-matte-black',
  'lead-wacky-weight',
  'splitball-lead-splitshot-weight',
  // xzone-lures
  'tungsten-worm-weight',
  // z-man
  'zwg-weighted-swimbait-hook',
  // googan-baits (フック単体)
  'dart-n-toad-hook',
  'bandito-flippin-hook',
  'drop-n-finesse-hook',
  'gold-series-primo-finesse-hook',
  // Lunker City (ジグヘッド/フック単体)
  'lite-jig-heads-5-bag',
  '4oz-mr-crabs-tog-jig-1-bag',
  '3oz-mr-crabs-tog-jig-1-bag',
  '1-finesse-wacky-neko-rig-hooks-8-bag',
  // Coreman (フック単体)
  'cz-30-zettai-on-hook',
  // Smith D-S LINE (釣り糸)
  'trout-dsline',
]);

// ---------------------------------------------------------------------------
// Supabase REST API ヘルパー
// ---------------------------------------------------------------------------

interface LureRecord {
  id: number;
  name: string;
  slug: string;
  manufacturer_slug: string;
  type: string | null;
}

async function supabaseQuery(
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {}),
    },
  });
}

async function fetchAllLures(): Promise<LureRecord[]> {
  const all: LureRecord[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await supabaseQuery(
      `lures?select=id,name,slug,manufacturer_slug,type&order=id.asc&limit=${limit}&offset=${offset}`,
    );
    if (!res.ok) {
      throw new Error(`Supabase fetch error: ${res.status} ${await res.text()}`);
    }
    const rows: LureRecord[] = await res.json();
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }

  return all;
}

function isNonLureByName(name: string, slug: string): boolean {
  if (NON_LURE_SLUGS.has(slug)) return true;
  return NON_LURE_NAME_PATTERNS.some(p => p.test(name));
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  const deleteMode = process.argv.includes('--delete');

  console.log(`[quality-gate] モード: ${deleteMode ? '🔴 DELETE' : '🟡 DRY-RUN'}`);
  console.log('[quality-gate] 全ルアーを取得中...');

  const allLures = await fetchAllLures();
  console.log(`[quality-gate] 総レコード数: ${allLures.length}`);

  // 非ルアー製品を検出
  const nonLures = allLures.filter(l => isNonLureByName(l.name, l.slug));

  console.log(`\n[quality-gate] 非ルアー製品検出: ${nonLures.length}件\n`);

  if (nonLures.length === 0) {
    console.log('[quality-gate] 非ルアー製品なし。終了。');
    return;
  }

  // メーカー別に集計
  const byMaker = new Map<string, LureRecord[]>();
  for (const l of nonLures) {
    const existing = byMaker.get(l.manufacturer_slug) || [];
    existing.push(l);
    byMaker.set(l.manufacturer_slug, existing);
  }

  // slug単位でユニーク件数も表示
  const uniqueSlugs = new Set(nonLures.map(l => `${l.manufacturer_slug}/${l.slug}`));

  for (const [maker, records] of [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const slugs = new Set(records.map(r => r.slug));
    console.log(`\n--- ${maker} (${records.length}行, ${slugs.size}シリーズ) ---`);
    for (const slug of slugs) {
      const sample = records.find(r => r.slug === slug)!;
      const count = records.filter(r => r.slug === slug).length;
      console.log(`  ${sample.name} [${slug}] x${count}行`);
    }
  }

  console.log(`\n[quality-gate] 合計: ${nonLures.length}行 (${uniqueSlugs.size}ユニークシリーズ)`);

  if (!deleteMode) {
    console.log('\n[quality-gate] dry-runモード。削除するには --delete フラグを追加してください。');
    return;
  }

  // 実際に削除
  console.log('\n[quality-gate] 削除を開始...');
  const ids = nonLures.map(l => l.id);

  // バッチ削除（100件ずつ）
  let deleted = 0;
  const batchSize = 100;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const idList = batch.join(',');
    const res = await supabaseQuery(
      `lures?id=in.(${idList})`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      console.error(`[quality-gate] 削除エラー: ${res.status} ${await res.text()}`);
      continue;
    }
    deleted += batch.length;
    console.log(`[quality-gate] 削除済み: ${deleted}/${ids.length}`);
  }

  console.log(`\n[quality-gate] 完了: ${deleted}件削除`);
}

main().catch(err => {
  console.error('[quality-gate] Fatal error:', err);
  process.exit(1);
});
