// scripts/_color-slug-audit.ts
// 全メーカー カラー別slug監査 + 修正スクリプト
//
// 問題: 同一ルアーのカラー違いが別slugで登録されている
//   - 6th Sense: Shopifyで各カラーが独立商品 → slugにカラー名が含まれる (推定1,340+ slugs)
//   - Pickup: 同一商品名が連番slug (-2, -3, -4...) で重複登録 (推定105レコード)
//   - God Hands / Grassroots: 少数だが全レコードが同一商品の重複
//
// 使い方:
//   npx tsx scripts/_color-slug-audit.ts              # レポートのみ
//   npx tsx scripts/_color-slug-audit.ts --dry-run    # 修正プレビュー
//   npx tsx scripts/_color-slug-audit.ts --fix        # 実行（6th Sense のみ）
//
// 注意: SPRO は修正済みのため除外

import 'dotenv/config';
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} from './config.js';

// ---------------------------------------------------------------------------
// CLI引数
// ---------------------------------------------------------------------------

const MODE = process.argv.includes('--fix')
  ? 'fix'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : 'report';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

interface LureRecord {
  id: string;
  slug: string;
  name: string;
  manufacturer_slug: string;
  manufacturer: string;
  type: string;
  color_name: string | null;
  description: string | null;
  price: number;
  length: number | null;
  weight: number | null;
}

interface ColorSlugGroup {
  manufacturer_slug: string;
  manufacturer: string;
  series: string;
  correctSlug: string;
  slugs: string[];
  records: LureRecord[];
  issue: 'color-in-slug' | 'duplicate-numbered' | 'duplicate-other';
}

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

function ts(): string { return new Date().toISOString().slice(11, 19); }
function log(msg: string): void { console.log(`[${ts()}] ${msg}`); }
function logSection(title: string): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Supabase ヘルパー
// ---------------------------------------------------------------------------

async function supabaseRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res;
}

async function fetchAllLures(): Promise<LureRecord[]> {
  const all: LureRecord[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `/lures?select=id,slug,name,manufacturer_slug,manufacturer,type,color_name,description,price,length,weight&order=manufacturer_slug,slug&offset=${offset}&limit=${limit}`;
    const res = await supabaseRequest(url, {
      headers: { Range: `${offset}-${offset + limit - 1}` },
    });
    const data: LureRecord[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    offset += limit;
    if (data.length < limit) break;
  }

  return all;
}

// ---------------------------------------------------------------------------
// 検出ロジック
// ---------------------------------------------------------------------------

function detect6thSenseColorSlugs(records: LureRecord[]): ColorSlugGroup[] {
  const sixthSense = records.filter(r => r.manufacturer_slug === '6th-sense');
  const groups: ColorSlugGroup[] = [];

  // nameに " - " があるレコードをシリーズ名でグルーピング
  const seriesMap = new Map<string, LureRecord[]>();
  for (const r of sixthSense) {
    if (r.name.includes(' - ')) {
      const series = r.name.split(' - ')[0].trim();
      if (!seriesMap.has(series)) seriesMap.set(series, []);
      seriesMap.get(series)!.push(r);
    }
  }

  for (const [series, recs] of seriesMap) {
    const uniqueSlugs = [...new Set(recs.map(r => r.slug))];
    // 各slugが少数レコード = カラー別slug
    const singleSlugCount = uniqueSlugs.filter(s =>
      recs.filter(r => r.slug === s).length <= 2
    ).length;

    if (singleSlugCount >= 3 && uniqueSlugs.length >= 3) {
      // 正しいslugを推定: シリーズ名をslug化
      // ルール: [a-z0-9-] のみ許容、ピリオドはハイフンに変換
      const correctSlug = series
        .replace(/[®™]/g, '')
        .replace(/[^a-zA-Z0-9\s.-]/g, '')
        .toLowerCase()
        .replace(/\./g, '-') // ピリオドはハイフンに変換（slugルール準拠）
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      groups.push({
        manufacturer_slug: '6th-sense',
        manufacturer: '6th Sense',
        series,
        correctSlug,
        slugs: uniqueSlugs,
        records: recs,
        issue: 'color-in-slug',
      });
    }
  }

  return groups;
}

function detectPickupDuplicates(records: LureRecord[]): ColorSlugGroup[] {
  const pickup = records.filter(r => r.manufacturer_slug === 'pickup');
  const groups: ColorSlugGroup[] = [];

  // 同一name で異なるslugを持つグループ
  const byName = new Map<string, LureRecord[]>();
  for (const r of pickup) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push(r);
  }

  for (const [name, recs] of byName) {
    const uniqueSlugs = [...new Set(recs.map(r => r.slug))];
    if (uniqueSlugs.length <= 1) continue;

    // 正しいslug = 番号なし or 最短のもの
    const sortedSlugs = [...uniqueSlugs].sort((a, b) => {
      // 数字のみのslugは除外候補
      if (/^\d+-\d+$/.test(a) && !/^\d+-\d+$/.test(b)) return 1;
      if (!/^\d+-\d+$/.test(a) && /^\d+-\d+$/.test(b)) return -1;
      // 短い方を優先
      return a.length - b.length;
    });

    // カラー名がnameに含まれている場合はカラー別slug
    const isColorInName = recs.some(r => {
      const parts = r.name.split(/[　\s]+/);
      return parts.length >= 3; // 商品名 + カラー名
    });

    groups.push({
      manufacturer_slug: 'pickup',
      manufacturer: 'Pickup',
      series: name.split(/[　\s]+/).slice(0, 2).join(' '),
      correctSlug: sortedSlugs[0],
      slugs: uniqueSlugs,
      records: recs,
      issue: isColorInName ? 'color-in-slug' : 'duplicate-numbered',
    });
  }

  return groups;
}

function detectGodHandsDuplicates(records: LureRecord[]): ColorSlugGroup[] {
  const godHands = records.filter(r => r.manufacturer_slug === 'god-hands');
  if (godHands.length <= 1) return [];

  const uniqueSlugs = [...new Set(godHands.map(r => r.slug))];
  if (uniqueSlugs.length <= 1) return [];

  return [{
    manufacturer_slug: 'god-hands',
    manufacturer: 'GOD HANDS',
    series: 'GOD HANDS',
    correctSlug: 'god-hands',
    slugs: uniqueSlugs,
    records: godHands,
    issue: 'duplicate-other',
  }];
}

function detectGrassrootsDuplicates(records: LureRecord[]): ColorSlugGroup[] {
  const grassroots = records.filter(r => r.manufacturer_slug === 'grassroots');
  if (grassroots.length <= 1) return [];

  const uniqueSlugs = [...new Set(grassroots.map(r => r.slug))];
  if (uniqueSlugs.length <= 1) return [];

  return [{
    manufacturer_slug: 'grassroots',
    manufacturer: 'Grassroots',
    series: 'BASS LURE',
    correctSlug: 'basslure',
    slugs: uniqueSlugs,
    records: grassroots,
    issue: 'duplicate-other',
  }];
}

// ---------------------------------------------------------------------------
// 品質監査
// ---------------------------------------------------------------------------

function qualityAudit(records: LureRecord[]): void {
  logSection('品質監査');

  // 1. type が「その他」
  const sonota = records.filter(r => r.type === 'その他');
  const sonotaByMfr = new Map<string, number>();
  for (const r of sonota) {
    sonotaByMfr.set(r.manufacturer_slug, (sonotaByMfr.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log(`\n■ type「その他」: ${sonota.length}件`);
  const sortedSonota = [...sonotaByMfr.entries()].sort((a, b) => b[1] - a[1]);
  for (const [mfr, count] of sortedSonota.slice(0, 10)) {
    console.log(`  ${mfr}: ${count}`);
  }

  // 2. description が空/null
  const noDesc = records.filter(r => !r.description || r.description.trim() === '');
  const noDescByMfr = new Map<string, number>();
  for (const r of noDesc) {
    noDescByMfr.set(r.manufacturer_slug, (noDescByMfr.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log(`\n■ description 空/null: ${noDesc.length}件`);
  const sortedNoDesc = [...noDescByMfr.entries()].sort((a, b) => b[1] - a[1]);
  for (const [mfr, count] of sortedNoDesc) {
    const total = records.filter(r => r.manufacturer_slug === mfr).length;
    console.log(`  ${mfr}: ${count}/${total} (${Math.round(count / total * 100)}%)`);
  }

  // 3. 日本メーカーで英語のみdescription
  const isEnglishOnly = (text: string) => !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
  const jpMakers = new Set([
    'daiwa', 'shimano', 'jackall', 'megabass', 'evergreen', 'osp', 'deps',
    'imakatsu', 'ima', 'issei', 'hideup', 'blueblue', 'bassday', 'jackson',
    'viva', 'tiemco', 'duel', 'forest', 'duo', 'raid', 'zipbaits', 'gancraft',
    'engine', 'dstyle', 'longin', 'ecogear', 'yamashita', 'zeake', 'jumprize',
    'cb-one', 'crazy-ocean', 'gamakatsu', 'hmkl', 'bozles', 'sawamura',
    'madness', 'attic', 'drt', 'seafloor-control', 'mc-works', 'apia',
    'deepliner', 'ja-do', 'breaden', 'noike', 'flash-union', 'baitbreath',
    'coreman', 'maria', 'reins', 'hayabusa', 'tict', 'beat', 'thirtyfour',
    'd-claw', 'souls', 'dranckrazy', 'carpenter', 'pozidrive-garage', 'dreemup',
    'north-craft', 'itocraft', 'harimitsu', 'sea-falcon', 'yarie', 'obasslive',
    'god-hands', 'grassroots', 'pickup', 'majorcraft', 'nories', 'geecrack',
    'valleyhill', 'littlejack', 'bottomup', 'gary-yamamoto', 'jazz', 'mukai',
    'nature-boys', 'pazdesign', 'smith', 'tacklehouse', 'palms', 'hots',
    'valkein', 'fisharrow', 'zero-dragon', 'keitech', 'xesta',
  ]);

  const engOnly = records.filter(r =>
    jpMakers.has(r.manufacturer_slug) && r.description && isEnglishOnly(r.description)
  );
  const engOnlyByMfr = new Map<string, number>();
  for (const r of engOnly) {
    engOnlyByMfr.set(r.manufacturer_slug, (engOnlyByMfr.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log(`\n■ 日本メーカーで英語のみdescription: ${engOnly.length}件`);
  const sortedEngOnly = [...engOnlyByMfr.entries()].sort((a, b) => b[1] - a[1]);
  for (const [mfr, count] of sortedEngOnly) {
    console.log(`  ${mfr}: ${count}`);
  }

  // 4. 1レコードslug率が高いメーカー
  const slugRecCounts = new Map<string, number>();
  for (const r of records) {
    const key = `${r.manufacturer_slug}::${r.slug}`;
    slugRecCounts.set(key, (slugRecCounts.get(key) || 0) + 1);
  }

  const singleSlugByMfr = new Map<string, number>();
  const totalSlugByMfr = new Map<string, number>();
  for (const [key, count] of slugRecCounts) {
    const mfr = key.split('::')[0];
    totalSlugByMfr.set(mfr, (totalSlugByMfr.get(mfr) || 0) + 1);
    if (count === 1) {
      singleSlugByMfr.set(mfr, (singleSlugByMfr.get(mfr) || 0) + 1);
    }
  }

  console.log(`\n■ 1レコードslug率が高い（50%超、10slug以上）:`);
  const singleRatio = [];
  for (const [mfr, single] of singleSlugByMfr) {
    const total = totalSlugByMfr.get(mfr) || 0;
    const ratio = single / total;
    if (ratio > 0.5 && total > 10) {
      singleRatio.push({ mfr, single, total, ratio });
    }
  }
  singleRatio.sort((a, b) => b.ratio - a.ratio);
  for (const s of singleRatio) {
    console.log(`  ${s.mfr}: ${s.single}/${s.total} (${Math.round(s.ratio * 100)}%)`);
  }
}

// ---------------------------------------------------------------------------
// 修正実行 (6th Sense)
// ---------------------------------------------------------------------------
//
// 6th Sense のデータ構造:
//   name: "Provoke Series - 4K Bluegill"  (シリーズ名 - カラー名)
//   color_name: "3/8oz."                   (サイズ/ウェイト情報)
//   slug: "provoke-series-4k-bluegill"     (カラー名がslugに含まれる)
//
// 修正方針:
//   1. slug → correctSlug (シリーズ名のみ)
//   2. name → シリーズ名 (" - カラー名" を除去)
//   3. color_name → name の " - " 以降のカラー名に変更
//   4. 同一カラー × 複数サイズ のレコードは全て保持（正当な別レコード）
//   5. 完全重複（同一slug+同一color_name）のみ削除
//

async function fix6thSenseColorSlugs(
  groups: ColorSlugGroup[],
  dryRun: boolean,
): Promise<void> {
  logSection(`6th Sense カラー別slug修正 (${dryRun ? 'DRY-RUN' : '本番'})`);

  let totalUpdated = 0;
  let totalDupeDeleted = 0;

  for (const group of groups) {
    const { series, correctSlug, records: recs } = group;

    // 各レコードを更新: slug統一 + name正規化 + color_name にカラー名設定
    // 完全重複チェック用（slug+color_name+weight+length+price が同一）
    const seen = new Set<string>();
    const updates: Array<{ id: string; slug: string; name: string; color_name: string; isDupe: boolean }> = [];

    for (const r of recs) {
      const dashIndex = r.name.indexOf(' - ');
      const colorFromName = dashIndex >= 0 ? r.name.slice(dashIndex + 3).trim() : r.color_name || '(default)';

      // 重複チェックキー: 統合後slug + カラー名 + weight + length + price
      const dupeKey = `${correctSlug}::${colorFromName}::${r.weight}::${r.length}::${r.price}`;
      const isDupe = seen.has(dupeKey);
      seen.add(dupeKey);

      updates.push({
        id: r.id,
        slug: correctSlug,
        name: series,
        color_name: colorFromName,
        isDupe,
      });
    }

    const toUpdate = updates.filter(u => !u.isDupe);
    const toDelete = updates.filter(u => u.isDupe);

    if (dryRun) {
      log(`${series} → ${correctSlug}`);
      log(`  レコード: ${recs.length}件, 更新: ${toUpdate.length}件, 重複削除: ${toDelete.length}件`);
      // サンプル表示
      for (const u of toUpdate.slice(0, 3)) {
        log(`  更新: slug=${correctSlug}, color_name=${u.color_name}`);
      }
      if (toUpdate.length > 3) log(`  ... +${toUpdate.length - 3}件`);
      for (const d of toDelete.slice(0, 2)) {
        log(`  削除(重複): color_name=${d.color_name}`);
      }
    } else {
      // 実行
      for (const u of toUpdate) {
        await supabaseRequest(
          `/lures?id=eq.${u.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              slug: u.slug,
              name: u.name,
              color_name: u.color_name,
            }),
          },
        );
      }
      for (const d of toDelete) {
        await supabaseRequest(
          `/lures?id=eq.${d.id}`,
          { method: 'DELETE' },
        );
      }
      log(`${series}: ${toUpdate.length}件更新, ${toDelete.length}件削除 → ${correctSlug}`);
    }

    totalUpdated += toUpdate.length;
    totalDupeDeleted += toDelete.length;
  }

  log(`\n合計: slug更新 ${totalUpdated}件, 完全重複削除 ${totalDupeDeleted}件`);
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`モード: ${MODE}`);
  log('全レコード取得中...');
  const allRecords = await fetchAllLures();
  log(`取得完了: ${allRecords.length}件`);

  // ====================================================================
  // カラー別slug検出
  // ====================================================================
  logSection('カラー別slug検出');

  // 6th Sense
  const sixthSenseGroups = detect6thSenseColorSlugs(allRecords);
  const sixthSenseSlugs = sixthSenseGroups.reduce((sum, g) => sum + g.slugs.length, 0);
  const sixthSenseRecs = sixthSenseGroups.reduce((sum, g) => sum + g.records.length, 0);
  console.log(`\n■ 6th Sense: ${sixthSenseGroups.length}シリーズ, ${sixthSenseSlugs} slugs, ${sixthSenseRecs}レコード`);
  for (const g of sixthSenseGroups.slice(0, 10)) {
    console.log(`  ${g.series} → ${g.correctSlug} (${g.slugs.length} slugs)`);
  }
  if (sixthSenseGroups.length > 10) {
    console.log(`  ... +${sixthSenseGroups.length - 10}シリーズ`);
  }

  // Pickup
  const pickupGroups = detectPickupDuplicates(allRecords);
  const pickupSlugs = pickupGroups.reduce((sum, g) => sum + g.slugs.length, 0);
  const pickupRecs = pickupGroups.reduce((sum, g) => sum + g.records.length, 0);
  console.log(`\n■ Pickup: ${pickupGroups.length}グループ, ${pickupSlugs} slugs, ${pickupRecs}レコード`);
  for (const g of pickupGroups.slice(0, 10)) {
    console.log(`  ${g.series} → ${g.correctSlug} (${g.slugs.length} slugs, ${g.issue})`);
  }

  // God Hands
  const godHandsGroups = detectGodHandsDuplicates(allRecords);
  if (godHandsGroups.length > 0) {
    console.log(`\n■ God Hands: ${godHandsGroups[0].slugs.length} slugs → ${godHandsGroups[0].correctSlug}`);
  }

  // Grassroots
  const grassrootsGroups = detectGrassrootsDuplicates(allRecords);
  if (grassrootsGroups.length > 0) {
    console.log(`\n■ Grassroots: ${grassrootsGroups[0].slugs.length} slugs → ${grassrootsGroups[0].correctSlug}`);
  }

  // ====================================================================
  // 品質監査
  // ====================================================================
  qualityAudit(allRecords);

  // ====================================================================
  // 修正実行
  // ====================================================================
  if (MODE === 'dry-run' || MODE === 'fix') {
    const dryRun = MODE === 'dry-run';
    await fix6thSenseColorSlugs(sixthSenseGroups, dryRun);

    if (!dryRun) {
      logSection('修正完了サマリー');
      log('6th Sense のカラー別slug統合が完了しました。');
      log('Pickup / God Hands / Grassroots は手動確認後に別途修正してください。');
    }
  }

  logSection('監査完了');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
