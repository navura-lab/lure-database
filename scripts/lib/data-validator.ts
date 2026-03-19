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
 *   if (issues.length > 0) { /* reject or warn */ }
 *
 *   // 全件監査（定期実行）
 *   const report = await runFullAudit(supabase);
 */

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

// ========== 非ルアー検出パターン ==========
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
  { pattern: /アフターパーツ|スペアパーツ|\breplacement\s+(?:tail|fin)\b|\bspare\s+parts?\b/i, category: 'parts' },
  // ライン
  { pattern: /\b(fishing\s+line|bulk\s+spool|braid\s+line)\b/i, category: 'line' },
  // バッグ・ツール
  { pattern: /\b(tackle\s+box|backpack|pliers|scissors|fish\s+grip)\b/i, category: 'tool' },
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
