#!/usr/bin/env npx tsx
/**
 * target_fish 釣果検証スクリプト
 *
 * 「{ルアー名} 釣果」でSerper.dev検索し、検索結果から魚種を抽出。
 * DBのtarget_fishと比較して不一致を検出する。
 *
 * Usage:
 *   npx tsx scripts/audit/verify-target-fish.ts --test              # テスト5件
 *   npx tsx scripts/audit/verify-target-fish.ts --slugs "ima/gun-suke-40g,coreman/vj-16"
 *   npx tsx scripts/audit/verify-target-fish.ts --flagged            # rule-based-scanのフラグ済みを対象
 *   npx tsx scripts/audit/verify-target-fish.ts --limit 50           # 上位50件
 *   npx tsx scripts/audit/verify-target-fish.ts --dry-run            # 検索せず対象一覧のみ
 *   npx tsx scripts/audit/verify-target-fish.ts --verbose            # 詳細出力
 *
 * Serper.dev: 2,500クエリ/月（無料枠）
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { searchWithSerper, isSerperConfigured } from '../lib/serper.js';

// ── 定数 ─────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, '../..');
const CACHE_PATH = resolve(ROOT, '.cache/lures.json');
const FLAGGED_PATH = resolve(ROOT, 'data/audit/flagged-lures.json');
const OUT_DIR = resolve(ROOT, 'data/audit');
const DELAY_MS = 1200; // API rate limit対策

// ── CLI引数 ──────────────────────────────────────────
const IS_TEST = process.argv.includes('--test');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const USE_FLAGGED = process.argv.includes('--flagged');
const SLUGS_ARG = (() => {
  const idx = process.argv.indexOf('--slugs');
  return idx !== -1 ? process.argv[idx + 1]?.split(',').map(s => s.trim()) : null;
})();
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 50 : 50;
})();

// ── テスト対象 ───────────────────────────────────────
const TEST_SLUGS = [
  'ima/gun-40g-2',                      // GUN助 40g（ユーザー指摘: 青物用なのにシーバス）
  'coreman/vj-16-vibration-jighead',    // VJ-16（シーバス用）
  'jackall/flick-shake-2',              // フリックシェイク（バス用）
  'yamashita/egi-k',                    // エギ王 K（エギング用）
  'jackson/pintail-sawara-tune',        // ピンテールサワラチューン（サワラ用）
];

// ── 魚種定義 ─────────────────────────────────────────
// キー: 正規化された魚種名（DB上の表記）
// 値: 検索テキストで出現しうるバリエーション
const FISH_ALIASES: Record<string, string[]> = {
  'シーバス': ['シーバス', 'スズキ', 'セイゴ', 'フッコ', 'ハネ', 'マルスズキ', 'ヒラスズキ'],
  'ブラックバス': ['ブラックバス', 'ラージマウス', 'スモールマウス', 'バス釣り', 'バスフィッシング'],
  'ヒラメ': ['ヒラメ', '平目'],
  'マゴチ': ['マゴチ', 'コチ'],
  'ブリ': ['ブリ', 'ハマチ', 'メジロ', 'ワラサ', 'イナダ', 'ツバス'],
  'ヒラマサ': ['ヒラマサ'],
  'カンパチ': ['カンパチ', 'ショゴ', 'シオ'],
  'メバル': ['メバル'],
  'アジ': ['アジ', '鯵', 'アジング'],
  'クロダイ': ['クロダイ', 'チヌ', '黒鯛', 'チニング'],
  'マダイ': ['マダイ', '真鯛', 'タイラバ'],
  'タチウオ': ['タチウオ', '太刀魚', 'タチウオジギング'],
  'トラウト': ['トラウト', 'ニジマス', 'ヤマメ', 'イワナ', 'アマゴ', 'ブラウン', 'レインボー', 'サクラマス', 'サーモン'],
  'サワラ': ['サワラ', 'サゴシ'],
  'ナマズ': ['ナマズ', '鯰', 'キャットフィッシュ'],
  '雷魚': ['雷魚', 'ライギョ'],
  'アオリイカ': ['アオリイカ', 'イカ', 'エギング', 'ヤリイカ', 'ケンサキイカ', 'コウイカ'],
  'タコ': ['タコ', '蛸', 'オクトパス', 'タコエギ'],
  'カサゴ': ['カサゴ', 'ガシラ', 'アラカブ', 'ロックフィッシュ'],
  'アイナメ': ['アイナメ', 'アブラコ'],
  'ソイ': ['ソイ', 'クロソイ', 'ムラソイ'],
  'キジハタ': ['キジハタ', 'アコウ'],
  'ハタ': ['ハタ', 'オオモンハタ', 'アカハタ'],
  'サバ': ['サバ', '鯖'],
  'カマス': ['カマス'],
  'シイラ': ['シイラ', 'マヒマヒ'],
  'クロマグロ': ['マグロ', 'クロマグロ', 'キハダ'],
};

// 「青物」は複合グループ（ブリ/ヒラマサ/カンパチ/サワラをまとめる）
const AOMONO_FISH = ['ブリ', 'ヒラマサ', 'カンパチ', 'サワラ', 'シイラ'];
const AOMONO_ALIASES = ['青物', 'ショアジギ', 'ジギング', 'ショアジギング', 'ライトショアジギング'];

// 釣果文脈パターン（魚種名の近くに出現すると信頼度UP）
const CATCH_PATTERNS = [
  '釣れた', '釣った', '釣り上げ', 'ヒット', 'キャッチ', 'ゲット',
  'バイト', '釣果', 'ランディング', '釣行', '実釣', 'HIT',
  'GET', 'CATCH', '爆釣', '連発', 'サイズ', 'cm',
];

// ── 型定義 ────────────────────────────────────────────
interface CacheLure {
  slug: string;
  manufacturer_slug: string;
  name: string;
  name_kana: string | null;
  type: string | null;
  target_fish: string[] | null;
  weight: number | null;
}

interface DetectedFish {
  fish: string;           // 正規化された魚種名
  count: number;          // 出現した検索結果の数
  confidence: 'high' | 'medium' | 'low';
  sources: string[];      // 出現元のドメイン（最大3件）
}

interface VerifyResult {
  slug: string;
  name: string;
  type: string;
  db_target_fish: string[];
  detected_fish: DetectedFish[];
  search_results_count: number;
  mismatch: boolean;
  missing_in_db: string[];    // 検索で見つかったがDBにない
  extra_in_db: string[];      // DBにあるが検索で見つからない
  recommendation: string;
}

// ── ヘルパー ──────────────────────────────────────────
function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 検索クエリ用に商品名を最適化
 * - 長すぎる英語サブタイトルを除去
 * - name_kanaがあればそちらを優先（日本語の方が釣果検索に有利）
 */
function optimizeSearchName(lure: CacheLure): string {
  const name = (lure as any).name_kana || lure.name;

  // 英語の冗長部分を削除（全角・半角括弧内も）
  let cleaned = name
    .replace(/\s*[\(（].*?[\)）]/g, '')  // 括弧内を除去
    .replace(/\s+(VIBRATIONJIGHEAD|JIGHEAD|ORIGINAL|SERIES)\b/gi, '')  // 冗長サフィックス
    .trim();

  // 50文字以上なら最初のスペース区切りのトークンに絞る
  if (cleaned.length > 50) {
    const tokens = cleaned.split(/\s+/);
    cleaned = tokens.slice(0, 3).join(' ');
  }

  return cleaned;
}

/**
 * 検索結果テキストから魚種を抽出
 */
function extractFishFromText(texts: { text: string; domain: string }[]): DetectedFish[] {
  const fishCounts = new Map<string, { count: number; sources: Set<string>; contextHits: number }>();

  for (const { text, domain } of texts) {
    const foundInThis = new Set<string>();
    const hasCatchContext = CATCH_PATTERNS.some(p => text.includes(p));

    // 各魚種のエイリアスを検索
    for (const [canonical, aliases] of Object.entries(FISH_ALIASES)) {
      for (const alias of aliases) {
        if (text.includes(alias) && !foundInThis.has(canonical)) {
          foundInThis.add(canonical);
          const entry = fishCounts.get(canonical) || { count: 0, sources: new Set(), contextHits: 0 };
          entry.count++;
          entry.sources.add(domain);
          if (hasCatchContext) entry.contextHits++;
          fishCounts.set(canonical, entry);
        }
      }
    }

    // 「青物」グループの検出
    for (const alias of AOMONO_ALIASES) {
      if (text.includes(alias)) {
        // 青物の各魚種にもカウントを加算（ただし個別で既に検出済みならスキップ）
        for (const fish of AOMONO_FISH) {
          if (!foundInThis.has(fish)) {
            foundInThis.add(fish);
            const entry = fishCounts.get(fish) || { count: 0, sources: new Set(), contextHits: 0 };
            entry.count++;
            entry.sources.add(domain);
            if (hasCatchContext) entry.contextHits++;
            fishCounts.set(fish, entry);
          }
        }
      }
    }
  }

  // 信頼度判定 & ソート
  const results: DetectedFish[] = [];
  for (const [fish, data] of fishCounts.entries()) {
    let confidence: 'high' | 'medium' | 'low';
    if (data.count >= 3 && data.contextHits >= 1) {
      confidence = 'high';
    } else if (data.count >= 2) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
    results.push({
      fish,
      count: data.count,
      confidence,
      sources: [...data.sources].slice(0, 3),
    });
  }

  // count降順
  results.sort((a, b) => b.count - a.count);
  return results;
}

/**
 * DB上のtarget_fishを正規化（「青物」→個別魚種に展開）
 */
function normalizeDbFish(dbFish: string[]): string[] {
  const result = new Set<string>();
  for (const f of dbFish) {
    if (f === '青物') {
      // 青物は個別魚種に展開しない（比較時に特別扱い）
      result.add('青物');
    } else {
      result.add(f);
    }
  }
  return [...result];
}

// 上位カテゴリ → サブカテゴリの関係
// DB上の「イカ」は「アオリイカ」等を包含する
const FISH_HIERARCHY: Record<string, string[]> = {
  'イカ': ['アオリイカ'],
  'ロックフィッシュ': ['カサゴ', 'アイナメ', 'ソイ', 'キジハタ', 'ハタ'],
};

/**
 * 検出された魚種とDB上のtarget_fishを比較
 */
function compareFish(
  dbFish: string[],
  detected: DetectedFish[]
): { missing: string[]; extra: string[]; mismatch: boolean } {
  // medium以上のみ比較対象
  const significantDetected = detected.filter(d => d.confidence !== 'low');
  const detectedNames = new Set(significantDetected.map(d => d.fish));

  // DB上の青物を展開して比較
  const expandedDb = new Set<string>();
  for (const f of dbFish) {
    if (f === '青物') {
      for (const af of AOMONO_FISH) expandedDb.add(af);
      expandedDb.add('青物'); // 青物自体も保持
    } else {
      expandedDb.add(f);
      // 上位カテゴリのサブカテゴリも展開
      if (FISH_HIERARCHY[f]) {
        for (const sub of FISH_HIERARCHY[f]) expandedDb.add(sub);
      }
    }
  }

  // DBにない魚種（検索で見つかったがDBにない）
  const missing: string[] = [];
  for (const d of significantDetected) {
    if (!expandedDb.has(d.fish)) {
      // 検出された魚種が上位カテゴリのサブなら、上位がDBにあればスキップ
      let coveredByParent = false;
      for (const [parent, subs] of Object.entries(FISH_HIERARCHY)) {
        if (subs.includes(d.fish) && dbFish.includes(parent)) {
          coveredByParent = true;
          break;
        }
      }
      if (!coveredByParent) {
        missing.push(d.fish);
      }
    }
  }

  // DB上にあるが検索で見つからない魚種
  const extra: string[] = [];
  for (const f of dbFish) {
    if (f === '青物') {
      const hasAny = AOMONO_FISH.some(af => detectedNames.has(af));
      if (!hasAny && significantDetected.length > 0) {
        extra.push('青物');
      }
    } else if (!detectedNames.has(f) && significantDetected.length > 0) {
      // 上位カテゴリの場合、サブカテゴリが検出されていればOK
      const subs = FISH_HIERARCHY[f];
      if (subs && subs.some(s => detectedNames.has(s))) {
        // サブカテゴリが検出されているのでOK
      } else if (!detectedNames.has(f)) {
        extra.push(f);
      }
    }
  }

  const mismatch = missing.length > 0 || extra.length > 0;
  return { missing, extra, mismatch };
}

/**
 * 推奨アクションの生成
 */
function makeRecommendation(missing: string[], extra: string[], detected: DetectedFish[]): string {
  const parts: string[] = [];

  if (missing.length > 0) {
    const highConf = missing.filter(f => detected.find(d => d.fish === f)?.confidence === 'high');
    if (highConf.length > 0) {
      parts.push(`追加推奨(高確度): ${highConf.join(', ')}`);
    }
    const medConf = missing.filter(f => detected.find(d => d.fish === f)?.confidence === 'medium');
    if (medConf.length > 0) {
      parts.push(`追加検討(中確度): ${medConf.join(', ')}`);
    }
  }

  if (extra.length > 0) {
    parts.push(`削除検討: ${extra.join(', ')}（釣果報告で確認できず）`);
  }

  if (parts.length === 0) {
    return 'target_fishは妥当';
  }
  return parts.join(' / ');
}

// ── メイン処理 ────────────────────────────────────────
async function main() {
  if (!isSerperConfigured()) {
    console.error('SERPER_API_KEY が設定されていません');
    process.exit(1);
  }

  // キャッシュ読み込み
  log('.cache/lures.json を読み込み中...');
  const raw: CacheLure[] = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));

  // slug単位でユニーク化
  const lureMap = new Map<string, CacheLure>();
  for (const r of raw) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!lureMap.has(key)) lureMap.set(key, r);
  }
  log(`ユニークslug: ${lureMap.size}`);

  // 対象ルアーの選定
  let targetSlugs: string[];

  if (IS_TEST) {
    targetSlugs = TEST_SLUGS;
    log(`テストモード: ${targetSlugs.length}件`);
  } else if (SLUGS_ARG) {
    targetSlugs = SLUGS_ARG;
    log(`指定slug: ${targetSlugs.length}件`);
  } else if (USE_FLAGGED) {
    if (!existsSync(FLAGGED_PATH)) {
      console.error(`${FLAGGED_PATH} が見つかりません。先に rule-based-scan.ts を実行してください`);
      process.exit(1);
    }
    const flagged = JSON.parse(readFileSync(FLAGGED_PATH, 'utf-8'));
    targetSlugs = flagged.flags.map((f: any) => f.slug).slice(0, LIMIT);
    log(`フラグ済み対象: ${targetSlugs.length}件（全${flagged.flags.length}件中）`);
  } else {
    // target_fishが空または1種のみのルアーを優先
    const candidates = [...lureMap.values()]
      .filter(l => l.target_fish && l.target_fish.length > 0)
      .sort((a, b) => (a.target_fish?.length ?? 0) - (b.target_fish?.length ?? 0));
    targetSlugs = candidates.slice(0, LIMIT).map(l => `${l.manufacturer_slug}/${l.slug}`);
    log(`デフォルト対象: ${targetSlugs.length}件`);
  }

  if (DRY_RUN) {
    console.log('\n=== DRY RUN: 対象ルアー一覧 ===');
    for (const slug of targetSlugs) {
      const lure = lureMap.get(slug);
      if (lure) {
        console.log(`  ${slug} — ${lure.name} [${lure.target_fish?.join(', ') || 'なし'}]`);
      } else {
        console.log(`  ${slug} — ⚠️ キャッシュに存在しない`);
      }
    }
    console.log(`\n対象: ${targetSlugs.length}件 / 推定API消費: ${targetSlugs.length}クエリ`);
    return;
  }

  // 検証実行
  const results: VerifyResult[] = [];
  let apiCalls = 0;
  let mismatchCount = 0;

  for (let i = 0; i < targetSlugs.length; i++) {
    const slug = targetSlugs[i];
    const lure = lureMap.get(slug);

    if (!lure) {
      log(`⚠️ ${slug} はキャッシュに存在しない、スキップ`);
      continue;
    }

    const dbFish = lure.target_fish ?? [];
    const searchName = optimizeSearchName(lure);
    const searchQuery = `${searchName} 釣果`;

    log(`[${i + 1}/${targetSlugs.length}] "${searchQuery}" — DB: [${dbFish.join(', ')}]`);

    try {
      const searchResults = await searchWithSerper(searchQuery, { num: 10, gl: 'jp', hl: 'ja' });
      apiCalls++;

      // テキスト結合
      const texts = searchResults.map(r => ({
        text: `${r.title} ${r.snippet}`,
        domain: r.domain,
      }));

      logV(`  検索結果: ${searchResults.length}件`);
      if (VERBOSE) {
        for (const r of searchResults.slice(0, 3)) {
          logV(`    ${r.title.slice(0, 60)} — ${r.domain}`);
        }
      }

      // 魚種抽出
      const detected = extractFishFromText(texts);

      if (VERBOSE && detected.length > 0) {
        logV(`  検出魚種: ${detected.map(d => `${d.fish}(${d.count}件/${d.confidence})`).join(', ')}`);
      }

      // 比較
      const { missing, extra, mismatch } = compareFish(dbFish, detected);

      const result: VerifyResult = {
        slug,
        name: lure.name,
        type: lure.type ?? '(なし)',
        db_target_fish: dbFish,
        detected_fish: detected,
        search_results_count: searchResults.length,
        mismatch,
        missing_in_db: missing,
        extra_in_db: extra,
        recommendation: makeRecommendation(missing, extra, detected),
      };

      results.push(result);

      if (mismatch) {
        mismatchCount++;
        console.log(`  ❌ 不一致: ${result.recommendation}`);
      } else {
        console.log(`  ✅ 一致`);
      }

      // Rate limit
      if (i < targetSlugs.length - 1) {
        await sleep(DELAY_MS);
      }
    } catch (err: any) {
      log(`  ❌ エラー: ${err.message}`);
      results.push({
        slug,
        name: lure.name,
        type: lure.type ?? '(なし)',
        db_target_fish: dbFish,
        detected_fish: [],
        search_results_count: 0,
        mismatch: false,
        missing_in_db: [],
        extra_in_db: [],
        recommendation: `エラー: ${err.message}`,
      });
    }
  }

  // 結果保存
  const today = new Date().toISOString().split('T')[0];
  const output = {
    scan_date: today,
    total_scanned: results.length,
    api_calls: apiCalls,
    mismatches: mismatchCount,
    results,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, `target-fish-verify-${today}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  // サマリー表示
  console.log('\n' + '='.repeat(60));
  console.log('=== target_fish 釣果検証 結果サマリー ===');
  console.log('='.repeat(60));
  console.log(`スキャン: ${results.length}件`);
  console.log(`API消費: ${apiCalls}クエリ`);
  console.log(`不一致: ${mismatchCount}件`);
  console.log(`出力: ${outPath}`);

  if (mismatchCount > 0) {
    console.log('\n── 不一致一覧 ──');
    for (const r of results.filter(r => r.mismatch)) {
      console.log(`\n  ${r.slug} (${r.name}) [type: ${r.type}]`);
      console.log(`    DB:    [${r.db_target_fish.join(', ')}]`);
      const topDetected = r.detected_fish.filter(d => d.confidence !== 'low').slice(0, 5);
      console.log(`    検出:  [${topDetected.map(d => `${d.fish}(${d.count})`).join(', ')}]`);
      console.log(`    推奨:  ${r.recommendation}`);
    }
  }
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
