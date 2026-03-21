/**
 * 全メーカー横断 type 誤分類監査スクリプト
 *
 * Supabaseから全レコードを取得し、name/descriptionからtype誤分類を検出・修正する
 * slug単位でデデュプ（カラーバリアント重複を排除）
 *
 * 方針: 偽陽性ゼロを目指す。確実な誤分類のみ自動修正。
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ========== type 定義 ==========
const SOFT_BAIT_TYPES = new Set(['ワーム', 'ソフトベイト']);

const HARD_BAIT_TYPES = new Set([
  'ミノー', 'クランクベイト', 'バイブレーション', 'メタルバイブ',
  'シャッド', 'ペンシルベイト', 'ポッパー', 'トップウォーター',
  'ビッグベイト', 'ジョイントベイト', 'クローラーベイト',
  'フロッグ', 'バズベイト', 'スピナーベイト', 'スピンテール',
  'ダイビングペンシル', 'プロップベイト', 'チャターベイト',
  'ブレードベイト', 'シンキングペンシル', 'i字系',
]);

const METAL_TYPES = new Set(['メタルジグ', 'ジグ', 'スプーン']);

// ========== 型 ==========

interface LureRow {
  id: string;
  manufacturer_slug: string;
  slug: string;
  name: string;
  type: string;
  description: string | null;
  length: unknown;
  weight: unknown;
}

interface UniqueLure {
  manufacturer_slug: string;
  slug: string;
  name: string;
  type: string;
  description: string | null;
  variant_count: number;
}

interface Misclass {
  lure: UniqueLure;
  reason: string;
  suggested_type: string;
  confidence: 'high' | 'medium';
}

// ============================================================
// 検出ルール
// ============================================================

/**
 * nameベース検出: 製品名に明確なワーム系キーワードがあるのにtypeがワーム以外
 *
 * 偽陽性対策:
 * - 「クロー」→ CLAW/CRAWL/クローラーベイト名と衝突するので除外
 * - 「ホッグ」→ ラバージグ名に含まれることがあるので除外
 * - フロッグtype、ラバージグtype、スイムベイトtypeは除外
 * - タイラバの「ワームネクタイ」「ワームトレーラー」→ タイラバ用パーツだがワーム分類が正しい
 */
const NAME_RULES: { pattern: RegExp; label: string; excludeTypes?: Set<string> }[] = [
  // 日本語: 明確なワーム名
  { pattern: /ワーム/, label: 'ワーム', excludeTypes: new Set(['フロッグ', 'チャターベイト']) },
  { pattern: /シャッドテール/, label: 'シャッドテール' },
  { pattern: /グラブ$/, label: 'グラブ' },

  // 英語: 明確なワーム名
  // 「worm」: Li-worm（valkein, メタルバイブ）等の偽陽性あり → descにソフト系証拠がある場合のみ
  { pattern: /\bworm\b/i, label: 'worm' },
  { pattern: /\bgrub\b/i, label: 'grub' },
  { pattern: /\bfinesse\s*worm\b/i, label: 'finesse worm' },
  { pattern: /\bstick\s*worm\b/i, label: 'stick worm' },
  { pattern: /\bribbon\s*tail\b/i, label: 'ribbon tail' },
  { pattern: /\bshad\s*tail\b/i, label: 'shad tail' },
  { pattern: /\bleech\b/i, label: 'leech' },
  { pattern: /\bsenko\b/i, label: 'senko' },
  { pattern: /\bfluke\b/i, label: 'fluke' },
];

/**
 * descriptionベース検出（厳格版）
 *
 * descriptionの最初の50文字以内にワーム系キーワードがあり、かつ
 * ハードベイト系キーワードがdesc全体にない場合のみ発火
 *
 * これにより「ワームのように」「ワームと組み合わせ」等の偽陽性を排除
 */
const DESC_WORM_KEYWORDS_STRICT = [
  'ストレートワーム',
  'soft plastic bait', 'soft plastic lure',
];

/**
 * descriptionにワーム専用リグ名があるのにハードベイトtype
 * （ネコリグ、ダウンショット、テキサスリグ、ワッキー は間違いなくワーム用）
 *
 * ただし「〜のようなアクション」「〜リグ対応」等の文脈もあるので
 * descの最初の100文字以内に出現する場合のみ
 */
const DESC_RIG_KEYWORDS = [
  'ネコリグ', 'ダウンショット', 'テキサスリグ', 'ワッキーリグ',
  'ノーシンカーリグ', 'ジグヘッドリグ',
  'neko rig', 'drop shot rig', 'texas rig', 'wacky rig',
  'ned rig', 'shaky head rig',
];

/** ハードベイトであることを示す反証キーワード */
const HARD_EVIDENCE = [
  'トレブルフック', 'トリプルフック', 'リップ', 'ウォブリング', 'ローリングアクション',
  'フローティング', 'サスペンド', 'ラトル音', 'プラスチックボディ', 'ABSボディ',
  'treble hook', 'lip design', 'wobbling', 'floating', 'suspend',
  'rattle', 'abs body', 'hard body', 'hard bait',
];

function detectMisclassifications(lures: UniqueLure[]): Misclass[] {
  const results: Misclass[] = [];

  for (const lure of lures) {
    const { name, type, description } = lure;
    if (!type) continue;

    const desc = (description || '').toLowerCase();
    const descFirst100 = desc.slice(0, 100);
    const hasHardEvidence = HARD_EVIDENCE.some(kw => desc.includes(kw.toLowerCase()));

    // ========== Rule 0: 6th-senseの特定パターン（Rule 1より先に評価）==========
    // 6th-senseはジグヘッド/シンカー/ワームが大量にスピナーベイト等に誤分類されている
    if (lure.manufacturer_slug === '6th-sense') {
      // シンカー/ウェイト → ルアーアクセサリー
      if (/worm\s*weights?/i.test(name) || /\bsinker\b/i.test(name)) {
        results.push({
          lure, reason: `[6th-sense] nameに"worm weight/sinker" → 非ルアー`,
          suggested_type: 'ルアーアクセサリー', confidence: 'high',
        });
        continue;
      }
      // Jig Head が名前に含まれる + スピナーベイト/フロッグtype → ジグヘッド
      if (['スピナーベイト', 'フロッグ'].includes(type) && /jig\s*head/i.test(name)) {
        results.push({
          lure, reason: `[6th-sense] nameに"Jig Head"があるがtype="${type}"`,
          suggested_type: 'ジグヘッド', confidence: 'high',
        });
        continue;
      }
      // Umbrella Rig → ルアーアクセサリー
      if (/umbrella\s*rig/i.test(name) && type === 'スピナーベイト') {
        results.push({
          lure, reason: `[6th-sense] "Umbrella Rig"はリグ → ルアーアクセサリー`,
          suggested_type: 'ルアーアクセサリー', confidence: 'high',
        });
        continue;
      }
      // Swimbait + スピナーベイトtype → スイムベイト
      if (/swimbait/i.test(name) && type === 'スピナーベイト') {
        results.push({
          lure, reason: `[6th-sense] nameに"Swimbait"があるがtype="${type}"`,
          suggested_type: 'スイムベイト', confidence: 'high',
        });
        continue;
      }
      // Hybrid Jig / Scrape Grass Jig / BallHead Jig → ラバージグ
      if (/(?:hybrid|scrape|ballhead|finesse)\s*jig/i.test(name) && ['スピナーベイト', 'クランクベイト'].includes(type)) {
        results.push({
          lure, reason: `[6th-sense] nameに"Jig"系があるがtype="${type}"`,
          suggested_type: 'ラバージグ', confidence: 'high',
        });
        continue;
      }
      // Ned Rig Football Heads → ジグヘッド
      if (/ned\s*rig.*head/i.test(name) && type === 'スピナーベイト') {
        results.push({
          lure, reason: `[6th-sense] Ned Rig Head → ジグヘッド`,
          suggested_type: 'ジグヘッド', confidence: 'high',
        });
        continue;
      }
    }

    // ========== Rule 1: nameにワーム系キーワードがあるのにワーム以外 ==========
    if (!SOFT_BAIT_TYPES.has(type) && type !== 'スイムベイト') {
      for (const rule of NAME_RULES) {
        if (rule.excludeTypes?.has(type)) continue;
        if (rule.pattern.test(name)) {
          // タイラバの「ビンビンワームネクタイ」等 → ワームが正しい
          // ただしタイラバtype全般はオーバーライドしない（パーツ名にワームが入っている）
          if (type === 'タイラバ' && /ワーム(?:ネクタイ|トレーラー|カール)/i.test(name)) {
            results.push({
              lure, reason: `nameに"${rule.label}"があるがtype="${type}"（タイラバ用パーツ → ワーム分類が妥当）`,
              suggested_type: 'ワーム', confidence: 'high',
            });
            break;
          }
          // ポッパーワーム（issei）→ ワーム
          // ジグヘッド + ワーム名 → medium
          if (type === 'ジグヘッド') {
            results.push({
              lure, reason: `nameに"${rule.label}"があるがtype="${type}"`,
              suggested_type: 'ワーム', confidence: 'medium',
            });
            break;
          }
          // descにワーム/ソフト系の証拠がなければmedium（例: valkein Li-worm = メタルバイブ）
          // desc内の製品名自体にwormが含まれるケースを除外するため、nameを除去してチェック
          const descWithoutName = desc.replace(name.toLowerCase(), '').replace(lure.slug, '');
          const descHasWormEvidence = descWithoutName.includes('ワーム') || descWithoutName.includes('ソフト')
            || descWithoutName.includes('worm') || descWithoutName.includes('soft')
            || descWithoutName.includes('リグ') || descWithoutName.includes('rig')
            || descWithoutName.includes('ノーシンカー');
          results.push({
            lure, reason: `nameに"${rule.label}"があるがtype="${type}"`,
            suggested_type: 'ワーム',
            confidence: descHasWormEvidence ? 'high' : 'medium',
          });
          break;
        }
      }
      // Rule 1でhitしたらcontinue
      if (results.length > 0 && results[results.length - 1].lure === lure) continue;
    }

    // ========== Rule 2: descの冒頭にワーム専用キーワード（厳格版）==========
    // フロッグはソフト素材でもフロッグ分類が一般的なので除外
    if ((HARD_BAIT_TYPES.has(type) || METAL_TYPES.has(type)) && type !== 'フロッグ') {
      if (!hasHardEvidence) {
        const strictMatch = DESC_WORM_KEYWORDS_STRICT.find(kw =>
          desc.slice(0, 60).includes(kw.toLowerCase())
        );
        if (strictMatch) {
          results.push({
            lure, reason: `desc冒頭に"${strictMatch}"があるがtype="${type}"`,
            suggested_type: 'ワーム', confidence: 'high',
          });
          continue;
        }
      }
    }

    // ========== Rule 3: descにワーム専用リグ名（冒頭100文字）==========
    // スピナーベイト/チャターベイトはリグ名が出てもトレーラー説明の可能性
    if ((HARD_BAIT_TYPES.has(type) || METAL_TYPES.has(type))
      && type !== 'フロッグ' && type !== 'スピナーベイト' && type !== 'チャターベイト') {
      if (!hasHardEvidence) {
        const rigMatch = DESC_RIG_KEYWORDS.find(kw =>
          descFirst100.includes(kw.toLowerCase())
        );
        if (rigMatch) {
          results.push({
            lure, reason: `desc冒頭100文字に"${rigMatch}"があるがtype="${type}"`,
            suggested_type: 'ワーム', confidence: 'medium',
          });
          continue;
        }
      }
    }

    // ========== Rule 5: desc全体で「soft plastic」が2回以上出現（確実にソフトベイト説明文）==========
    if ((HARD_BAIT_TYPES.has(type) || METAL_TYPES.has(type)) && type !== 'フロッグ') {
      const spCount = (desc.match(/soft plastic/g) || []).length;
      if (spCount >= 2 && !hasHardEvidence) {
        results.push({
          lure, reason: `descに"soft plastic"が${spCount}回出現、type="${type}"`,
          suggested_type: 'ワーム', confidence: 'high',
        });
        continue;
      }
    }
  }

  return results;
}

async function fetchAllLures(): Promise<LureRow[]> {
  const allLures: LureRow[] = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('lures')
      .select('id, manufacturer_slug, slug, name, type, description, length, weight')
      .range(from, from + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allLures.push(...data);
    if (allLures.length % 10000 === 0) console.log(`  取得: ${allLures.length}件...`);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  console.log(`  取得完了: ${allLures.length}件`);
  return allLures;
}

function deduplicateBySlug(rows: LureRow[]): UniqueLure[] {
  const map = new Map<string, { row: LureRow; count: number }>();
  for (const row of rows) {
    const key = `${row.manufacturer_slug}/${row.slug}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { row, count: 1 });
    } else {
      existing.count++;
    }
  }
  return Array.from(map.values()).map(({ row, count }) => ({
    manufacturer_slug: row.manufacturer_slug,
    slug: row.slug,
    name: row.name,
    type: row.type,
    description: row.description,
    variant_count: count,
  }));
}

async function fixBySlug(fixes: Misclass[]): Promise<{ slugs: number; rows: number }> {
  let slugCount = 0;
  let rowCount = 0;

  for (const fix of fixes) {
    if (fix.suggested_type === '要確認') continue;
    const { manufacturer_slug, slug } = fix.lure;

    const { data, error } = await supabase
      .from('lures')
      .update({ type: fix.suggested_type })
      .eq('manufacturer_slug', manufacturer_slug)
      .eq('slug', slug)
      .select('id');

    if (error) {
      console.error(`  ✗ [${manufacturer_slug}] ${fix.lure.name}: ${error.message}`);
    } else {
      slugCount++;
      rowCount += data?.length || 0;
    }
  }
  return { slugs: slugCount, rows: rowCount };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== type 誤分類 全メーカー横断監査 ===\n');

  console.log('1. Supabaseから全レコード取得...');
  const rawLures = await fetchAllLures();

  const typeDist: Record<string, number> = {};
  for (const l of rawLures) {
    typeDist[l.type || '(null)'] = (typeDist[l.type || '(null)'] || 0) + 1;
  }
  console.log('\ntype分布（全行）:');
  Object.entries(typeDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([t, c]) => console.log(`  ${t}: ${c}`));
  console.log('  ...');

  const uniqueLures = deduplicateBySlug(rawLures);
  console.log(`\n2. ユニークslug数: ${uniqueLures.length}\n`);

  console.log('3. 誤分類検出...');
  const misclassifications = detectMisclassifications(uniqueLures);
  console.log(`   検出: ${misclassifications.length}件（slug単位）\n`);

  const highConf = misclassifications.filter(m => m.confidence === 'high');
  const medConf = misclassifications.filter(m => m.confidence === 'medium');

  console.log(`=== 確実な誤分類（自動修正可能）: ${highConf.length}件 ===`);
  const highByMaker = new Map<string, Misclass[]>();
  for (const m of highConf) {
    const arr = highByMaker.get(m.lure.manufacturer_slug) || [];
    arr.push(m);
    highByMaker.set(m.lure.manufacturer_slug, arr);
  }
  for (const [maker, items] of [...highByMaker.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  --- ${maker} (${items.length}件) ---`);
    for (const m of items) {
      const vars = m.lure.variant_count > 1 ? ` (${m.lure.variant_count}var)` : '';
      console.log(`  ${m.lure.name}${vars}`);
      console.log(`    ${m.lure.type} → ${m.suggested_type} | ${m.reason}`);
    }
  }
  console.log();

  console.log(`=== 要確認（手動判断必要）: ${medConf.length}件 ===`);
  for (const m of medConf) {
    const vars = m.lure.variant_count > 1 ? ` (${m.lure.variant_count}var)` : '';
    console.log(`  [${m.lure.manufacturer_slug}] ${m.lure.name}${vars}`);
    console.log(`    ${m.lure.type} → ${m.suggested_type} | ${m.reason}`);
  }
  console.log();

  const highTotalRows = highConf.reduce((sum, m) => sum + m.lure.variant_count, 0);
  const medTotalRows = medConf.reduce((sum, m) => sum + m.lure.variant_count, 0);

  if (dryRun) {
    console.log('DRY RUN モード: 修正は実行しません');
  } else {
    console.log(`4. 確実な誤分類 ${highConf.length} slugs を修正中...`);
    const result = await fixBySlug(highConf);
    console.log(`   完了: ${result.slugs} slugs / ${result.rows} rows 修正`);
  }

  console.log('\n=== サマリー ===');
  console.log(`全レコード: ${rawLures.length}`);
  console.log(`ユニークslug: ${uniqueLures.length}`);
  console.log(`誤分類検出: ${misclassifications.length} slugs`);
  console.log(`  high: ${highConf.length} slugs (${highTotalRows} rows)`);
  console.log(`  medium: ${medConf.length} slugs (${medTotalRows} rows)`);
}

main().catch(console.error);
