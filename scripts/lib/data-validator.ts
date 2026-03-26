/**
 * データバリデーター — スクレイプ後・ビルド前の品質ゲート
 *
 * 全スクレイプ結果に対して自動実行される。
 * 問題が見つかった場合:
 * 1. 問題を検出・分類
 * 2. 同じパターンの問題を全メーカーで横断検索
 * 3. 根本原因を推定
 * 4. 修正提案を出力
 *
 * Usage:
 *   import { validateLureData, runFullAudit } from './data-validator';
 *
 *   // 単体バリデーション（スクレイプ時）
 *   const issues = validateLureData(lure);
 *   if (issues.length > 0) { ... }
 *
 *   // 全件監査（定期実行）
 *   const report = await runFullAudit(supabase);
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  category: string;
  message: string;
  slug: string;
  manufacturer?: string;
  suggestion?: string;
}

interface LureRecord {
  slug: string;
  name: string;
  manufacturer?: string;
  manufacturer_slug?: string;
  type?: string;
  description?: string;
  color_name?: string;
  images?: string[];
  price?: number;
  weight?: number;
  target_fish?: string[];
}

// ========== type×target_fish ルール読み込み ==========
// config/type-fish-rules.json の形式:
// { [type]: { valid_fish: string[], invalid_fish: string[] } }
type TypeFishRulesConfig = Record<string, { valid_fish: string[]; invalid_fish: string[] }>;

// 重量×対象魚ルール（コード内定義、頻繁に変わらない）
const WEIGHT_FISH_LIMITS: Array<{ targetFish: string; maxWeight: number; reason: string }> = [
  { targetFish: 'メバル', maxWeight: 20, reason: 'メバル用ルアーで20g超は非現実的' },
  { targetFish: 'アジ', maxWeight: 15, reason: 'アジング用ルアーで15g超は非現実的' },
  { targetFish: 'トラウト', maxWeight: 30, reason: 'トラウト用ルアーで30g超は非現実的（レイクトラウト除く）' },
];

let _typeFishRules: TypeFishRulesConfig | null = null;
let _typeFishRulesLoaded = false;

function loadTypeFishRules(): TypeFishRulesConfig | null {
  if (_typeFishRulesLoaded) return _typeFishRules;
  _typeFishRulesLoaded = true;

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const rulesPath = resolve(__dirname, '../../config/type-fish-rules.json');
    if (!existsSync(rulesPath)) return null;
    const raw = readFileSync(rulesPath, 'utf-8');
    _typeFishRules = JSON.parse(raw) as TypeFishRulesConfig;
    return _typeFishRules;
  } catch {
    return null;
  }
}

// ========== 非ルアー検出パターン（description用） ==========
// descriptionの文脈から非ルアーを検出する。名前だけでは判定できないものを補完
const NON_LURE_DESC_PATTERNS = [
  // ツール・アクセサリー
  { pattern: /特許取得ツール|挿入ツール|insertion\s+tool|rigging\s+tool/i, category: 'tool' },
  { pattern: /\b(tool|ツール)\b.*\b(insert|挿入|punch|押し込)\b/i, category: 'tool' },
  // ウェイト・シンカー（descriptionでの自称）
  { pattern: /タングステン.*ウェイト|tungsten.*spike|nail.*weight|ネイルウェイト/i, category: 'weight' },
  { pattern: /ドロップショット.*ウェイト|フリッピング.*ウェイト|ウェイト.*挿入/i, category: 'weight' },
  // スカート・パーツ
  { pattern: /交換用スカート|replacement\s+skirt|spare\s+skirt|カスタムスカート/i, category: 'parts' },
  { pattern: /交換用テール|replacement\s+tail|spare\s+tail/i, category: 'parts' },
  // 帽子・サングラス
  { pattern: /\b(snapback|snap\s+back)\s+(hat|cap)\b/i, category: 'apparel' },
  { pattern: /\b(sunglasses|sunglass|偏光グラス|サングラス)\b/i, category: 'apparel' },
  // ストレージ・ケース
  { pattern: /\b(storage|ストレージ|tackle\s+bag|タックルバッグ)\b/i, category: 'tool' },
  // ラトル（ルアーに入れるパーツ）
  { pattern: /ラトル.*挿入|rattle.*insert|グラスラトル\d+個付属/i, category: 'parts' },
];

// ========== 非ルアー検出パターン（名前用） ==========
const NON_LURE_NAME_PATTERNS = [
  // 集魚剤・ケミカル
  { pattern: /\b(bite\s+powder|bite\s+liquid|attractant|fish\s+scent|scent\s+spray|chum|dip\s+bait)\b/i, category: 'chemical' },
  // ロッド
  { pattern: /\b(spinning\s+rod|casting\s+rod|rod\s+combo|reel\s+combo)\b/i, category: 'rod' },
  { pattern: /\d+'\d+"\s+(extra[- ]?heavy|heavy|medium|light|moderate)/i, category: 'rod' },
  { pattern: /キャスティングロッド|ジギングロッド|ベイトロッド|スピニングロッド/i, category: 'rod' },
  // フック・ウェイト
  { pattern: /\b(worm\s+hook|treble\s+hook|ewg\s+hook|widegap.*hook|assist\s+hook)\b/i, category: 'hook' },
  { pattern: /\b(tungsten.*weight|nail\s+weight|drop\s*shot\s+weight|flipping\s+weight)\b/i, category: 'weight' },
  // アパレル
  { pattern: /\b(hoodie|t-?shirt|jacket|hat\b|cap\b|beanie|glove|shorts|pants)\b/i, category: 'apparel' },
  // パーツ
  { pattern: /アフターパーツ|スペアパーツ|補修部材|替え串|替え針|\breplacement\s+(?:tail|fin)\b|\bspare\s+parts?\b/i, category: 'parts' },
  // ライン
  { pattern: /\b(fishing\s+line|bulk\s+spool|braid\s+line)\b/i, category: 'line' },
  { pattern: /PEライン|フロロライン|ナイロンライン|ブレイデッドライン|エステルライン/i, category: 'line' },
  // バッグ・ツール
  { pattern: /\b(tackle\s+box|backpack|pliers|scissors|fish\s+grip)\b/i, category: 'tool' },
  // 仕掛け（JP）
  { pattern: /仕掛け?[　\s]|五目仕掛|サビキ|天秤|オモリ|ハリス|幹糸|枝糸|ウキ止め/i, category: 'rig' },
  // 針・フック（JP）
  { pattern: /アシストフック|フェザーフック|替え針|替えフック|がまかつ.*針|オーナー.*針/i, category: 'hook' },
  // シンカー・ウェイト（JP）
  { pattern: /シンカー|ジグヘッド用ウェイト|ネイルシンカー|バレットシンカー|ドロップショットシンカー/i, category: 'weight' },
  // アパレル（JP）
  { pattern: /シューズ|ブーツ|ウェーダー|グローブ|キャップ|ハット|ジャケット|レインウェア|Tシャツ/i, category: 'apparel' },
  // ロッド（JP）
  { pattern: /パックロッド|ロッドケース|竿袋|ティップカバー/i, category: 'rod' },
  // リール（JP）
  { pattern: /スプール|ドラグノブ|ハンドルノブ|ベアリング/i, category: 'reel_parts' },
  // 食品（まさかの）
  { pattern: /キムチ|調味料|食品/i, category: 'food' },
  // セット・バンドル
  { pattern: /\bbundle\b|アソートセット|ルアーセット|お買い得セット/i, category: 'bundle' },
  // サングラス・その他
  { pattern: /サングラス|偏光グラス|\bsunglasses?\b/i, category: 'eyewear' },
];

// ========== カラー別slug検出パターン ==========
// 同一商品のカラーが個別slugで登録されているパターン
function detectColorSplitSlug(slug: string, name: string): boolean {
  // slug末尾が連番（-2, -3, ...）
  if (/-\d+$/.test(slug) && !/\d+g$/.test(slug)) return true;
  // 名前にカラー名が含まれていてslugが長い
  const colorKeywords = /クリア|ボーン|ゴールド|シルバー|ピンク|レッド|ブルー|グリーン|チャート|ホロ|グロー|UV/;
  if (colorKeywords.test(name) && slug.length > 40) return true;
  return false;
}

// ========== 単体バリデーション ==========
export function validateLureData(lure: LureRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. 非ルアー製品チェック
  for (const { pattern, category } of NON_LURE_NAME_PATTERNS) {
    if (pattern.test(lure.name) || pattern.test(lure.slug)) {
      issues.push({
        severity: 'error',
        category: 'non-lure',
        message: `非ルアー製品（${category}）: ${lure.name}`,
        slug: lure.slug,
        manufacturer: lure.manufacturer_slug,
        suggestion: `DBから削除し、isNonLureProduct()にパターン追加`,
      });
    }
  }

  // 1b. 非ルアー製品チェック（description版）
  if (lure.description) {
    for (const { pattern, category } of NON_LURE_DESC_PATTERNS) {
      if (pattern.test(lure.description)) {
        issues.push({
          severity: 'error',
          category: 'non-lure',
          message: `非ルアー製品（${category}、description検出）: ${lure.name}`,
          slug: lure.slug,
          manufacturer: lure.manufacturer_slug,
          suggestion: `descriptionに「${category}」関連の記述あり。DBから削除を検討`,
        });
        break; // 1件見つかれば十分
      }
    }
  }

  // 2. カラー別slug検出
  if (detectColorSplitSlug(lure.slug, lure.name)) {
    issues.push({
      severity: 'warning',
      category: 'color-split-slug',
      message: `カラー別slugの疑い: ${lure.slug} (${lure.name})`,
      slug: lure.slug,
      manufacturer: lure.manufacturer_slug,
      suggestion: `同一商品名の他slugを検索し、統合を検討`,
    });
  }

  // 3. 画像なしチェック
  if (!lure.images || lure.images.length === 0) {
    issues.push({
      severity: 'warning',
      category: 'no-image',
      message: `画像なし: ${lure.name}`,
      slug: lure.slug,
      manufacturer: lure.manufacturer_slug,
    });
  }

  // 4. description品質チェック
  if (!lure.description || lure.description.length < 10) {
    issues.push({
      severity: 'warning',
      category: 'no-description',
      message: `descriptionが空/短い: ${lure.name}`,
      slug: lure.slug,
      manufacturer: lure.manufacturer_slug,
    });
  }

  // 5. 日本メーカーの英語description
  const jpManufacturers = new Set([
    'forest', 'pazdesign', 'tiemco', 'jackson', 'palms', 'smith',
    'daiwa', 'shimano', 'megabass', 'jackall', 'evergreen', 'deps',
    'osp', 'nories', 'tacklehouse', 'duel', 'yamashita', 'geecrack',
    'majorcraft', 'blueblue', 'ima', 'apia', 'coreman', 'bassday',
  ]);
  if (lure.manufacturer_slug && jpManufacturers.has(lure.manufacturer_slug)) {
    if (lure.description && !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(lure.description)) {
      issues.push({
        severity: 'warning',
        category: 'english-description',
        message: `日本メーカーなのに英語description: ${lure.name}`,
        slug: lure.slug,
        manufacturer: lure.manufacturer_slug,
        suggestion: `公式サイトから日本語descriptionを再取得`,
      });
    }
  }

  // 6. type未分類
  if (!lure.type || lure.type === 'その他') {
    issues.push({
      severity: 'warning',
      category: 'untyped',
      message: `type未分類: ${lure.name}`,
      slug: lure.slug,
      manufacturer: lure.manufacturer_slug,
      suggestion: `name/descriptionからtype推定を試行`,
    });
  }

  // 7. descriptionとtypeの矛盾チェック
  if (lure.type && lure.description) {
    const typeKeywords: Record<string, RegExp> = {
      'ワーム': /ワーム|ソフトベイト|soft\s*bait|worm/i,
      'ミノー': /ミノー|minnow|jerkbait/i,
      'メタルジグ': /メタルジグ|metal\s*jig|jigging/i,
      'スプーン': /スプーン|spoon/i,
      'エギ': /エギ|餌木|squid\s*jig/i,
    };
    for (const [correctType, kw] of Object.entries(typeKeywords)) {
      if (lure.type !== correctType && kw.test(lure.description.slice(0, 50))) {
        // description冒頭に別タイプのキーワードがある
        issues.push({
          severity: 'warning',
          category: 'type-mismatch',
          message: `type「${lure.type}」だがdescriptionは「${correctType}」を示唆: ${lure.name}`,
          slug: lure.slug,
          manufacturer: lure.manufacturer_slug,
          suggestion: `typeを「${correctType}」に変更するか、descriptionを確認`,
        });
      }
    }
  }

  // 8. type×target_fish妥当性チェック（config/type-fish-rules.jsonベース）
  const rules = loadTypeFishRules();
  if (rules && lure.type && lure.target_fish && lure.target_fish.length > 0) {
    const typeRule = rules[lure.type];
    if (typeRule) {
      for (const fish of lure.target_fish) {
        if (typeRule.invalid_fish.includes(fish)) {
          issues.push({
            severity: 'warning',
            category: 'invalid-type-fish',
            message: `type「${lure.type}」× target_fish「${fish}」は不正な組み合わせ (${lure.name})`,
            slug: lure.slug,
            manufacturer: lure.manufacturer_slug,
            suggestion: `target_fishから「${fish}」を除去`,
          });
        }
      }
    }

    // 9. 重量×対象魚の妥当性チェック
    if (lure.weight && lure.weight > 0) {
      for (const wRule of WEIGHT_FISH_LIMITS) {
        if (lure.target_fish.includes(wRule.targetFish) && lure.weight > wRule.maxWeight) {
          issues.push({
            severity: 'warning',
            category: 'weight-fish-mismatch',
            message: `重量${lure.weight}g × target_fish「${wRule.targetFish}」は不正: ${wRule.reason} (${lure.name})`,
            slug: lure.slug,
            manufacturer: lure.manufacturer_slug,
            suggestion: `target_fishから「${wRule.targetFish}」を除去するか、重量を確認`,
          });
        }
      }
    }
  }

  return issues;
}

// ========== 全件監査 ==========
export async function runFullAudit(supabase: any): Promise<{
  total: number;
  issues: ValidationIssue[];
  summary: Record<string, number>;
}> {
  // 全レコード取得（ページネーション）
  const allRecords: LureRecord[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('lures')
      .select('slug, name, manufacturer, manufacturer_slug, type, description, color_name, images, price, weight, target_fish')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allRecords.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // 全件バリデーション
  const allIssues: ValidationIssue[] = [];
  for (const record of allRecords) {
    const issues = validateLureData(record);
    allIssues.push(...issues);
  }

  // カテゴリ別サマリー
  const summary: Record<string, number> = {};
  for (const issue of allIssues) {
    const key = `${issue.severity}:${issue.category}`;
    summary[key] = (summary[key] || 0) + 1;
  }

  return {
    total: allRecords.length,
    issues: allIssues,
    summary,
  };
}
