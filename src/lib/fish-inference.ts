/**
 * L2 魚種推定: ルアー名・説明文からの魚種絞り込み
 *
 * ブランドライン名やカテゴリキーワードに基づき、
 * L1バリデーション後のtarget_fishをさらに絞り込む。
 *
 * 方針:
 * - 「追加」ではなく「絞り込み」方向（過剰紐付けの是正）
 * - 高信頼度パターンのみ適用（偽陽性リスク回避）
 * - 絞り込み後にtarget_fishが空になる場合は元のまま返す（安全弁）
 */

// ========== ブランドライン → 許可魚種 ==========
// メーカーが特定魚種向けに展開するプロダクトラインを検出し、
// そのライン以外の魚種を除去する。

interface BrandLineRule {
  /** ルアー名にマッチする正規表現 */
  namePattern: RegExp;
  /** メーカーslug（誤マッチ防止用、省略可） */
  manufacturerSlug?: string;
  /** このブランドラインの対象魚種 */
  allowedFish: Set<string>;
}

const BRAND_LINE_RULES: BrandLineRule[] = [
  // --- DAIWA ---
  {
    namePattern: /エメラルダス/,
    manufacturerSlug: 'daiwa',
    allowedFish: new Set(['アオリイカ', 'イカ', 'イカ（アオリイカ、ヤリイカ等）', 'ケンサキイカ', 'ヤリイカ', 'コウイカ', 'タコ']),
  },
  {
    namePattern: /モアザン/,
    manufacturerSlug: 'daiwa',
    allowedFish: new Set(['シーバス', 'ヒラメ', 'マゴチ', 'クロダイ', 'チヌ・クロダイ', 'ヒラメ・マゴチ']),
  },
  {
    namePattern: /月下美人/,
    manufacturerSlug: 'daiwa',
    allowedFish: new Set(['アジ', 'メバル', 'カサゴ', 'ロックフィッシュ', 'ロックフィッシュ（カサゴ、アイナメ等）']),
  },
  {
    namePattern: /ソルティガ/,
    manufacturerSlug: 'daiwa',
    allowedFish: new Set(['青物', 'マグロ', 'ヒラマサ', 'カンパチ', 'ブリ', 'GT', 'シイラ', 'マダイ', 'タチウオ', '青物（ブリ、ヒラマサ、カンパチ等）']),
  },
  // --- SHIMANO ---
  {
    namePattern: /エクスセンス/,
    manufacturerSlug: 'shimano',
    allowedFish: new Set(['シーバス', 'ヒラメ', 'マゴチ', 'クロダイ', 'チヌ・クロダイ', 'ヒラメ・マゴチ']),
  },
  {
    namePattern: /ソアレ/,
    manufacturerSlug: 'shimano',
    allowedFish: new Set(['アジ', 'メバル', 'カサゴ', 'ロックフィッシュ', 'ロックフィッシュ（カサゴ、アイナメ等）']),
  },
  {
    namePattern: /コルトスナイパー/,
    manufacturerSlug: 'shimano',
    allowedFish: new Set(['青物', 'ヒラマサ', 'カンパチ', 'ブリ', 'マグロ', 'シイラ', 'GT', '青物（ブリ、ヒラマサ、カンパチ等）', 'ヒラメ', 'シーバス']),
  },
  // --- BlueBlueFishing ---
  {
    namePattern: /ニンジャリ|ジョルティ/,
    manufacturerSlug: 'blueblue',
    allowedFish: new Set(['シーバス', 'ヒラメ', 'マゴチ', 'クロダイ', 'ヒラメ・マゴチ', 'チヌ・クロダイ', '青物', 'タチウオ']),
  },
  // --- APIA ---
  {
    namePattern: /パンチライン|フーリガン|ハイドロアッパー/,
    manufacturerSlug: 'apia',
    allowedFish: new Set(['シーバス', 'ヒラメ', 'マゴチ', 'クロダイ', 'ヒラメ・マゴチ', 'チヌ・クロダイ']),
  },
];

// ========== カテゴリキーワード → 許可魚種 ==========
// 説明文中の釣法・カテゴリキーワードで絞り込む。
// 「〜専用」「〜向け」「〜ゲーム」等の強い表現のみ対象。

interface CategoryKeywordRule {
  /** 説明文にマッチする正規表現（強い表現のみ） */
  pattern: RegExp;
  /** このカテゴリの対象魚種 */
  allowedFish: Set<string>;
}

const CATEGORY_KEYWORD_RULES: CategoryKeywordRule[] = [
  {
    pattern: /アジング\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['アジ', 'メバル']),
  },
  {
    pattern: /メバリング\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['メバル', 'アジ', 'カサゴ']),
  },
  {
    pattern: /エギング\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['アオリイカ', 'イカ', 'イカ（アオリイカ、ヤリイカ等）']),
  },
  {
    pattern: /(?:渓流|ネイティブトラウト)\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['トラウト', 'トラウト（管理釣り場・ネイティブ含む）', 'サーモン']),
  },
  {
    pattern: /(?:管理釣り場|エリアトラウト|エリア)\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['トラウト', 'トラウト（管理釣り場・ネイティブ含む）']),
  },
  {
    pattern: /チニング\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['クロダイ', 'チヌ・クロダイ', 'キビレ']),
  },
  {
    pattern: /シーバス\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['シーバス', 'ヒラメ', 'マゴチ', 'ヒラメ・マゴチ']),
  },
  {
    pattern: /バス\s*(?:専用|向け|モデル|特化)/,
    allowedFish: new Set(['ブラックバス', 'バス']),
  },
];

/**
 * L2 魚種推定: ルアー名・説明文に基づいてtarget_fishを絞り込む
 *
 * @param name ルアー名
 * @param description 説明文
 * @param currentFish L1バリデーション後のtarget_fish
 * @param manufacturerSlug メーカーslug（ブランドライン判定用）
 * @returns 絞り込み後のtarget_fish（空になる場合は元のまま）
 */
export function refineFishByContent(
  name: string,
  description: string,
  currentFish: string[],
  manufacturerSlug: string,
): string[] {
  if (currentFish.length === 0) return currentFish;

  const text = `${name} ${description || ''}`;

  // 1. ブランドライン検出
  for (const rule of BRAND_LINE_RULES) {
    if (!rule.namePattern.test(name)) continue;
    if (rule.manufacturerSlug && rule.manufacturerSlug !== manufacturerSlug) continue;

    const refined = currentFish.filter(f => rule.allowedFish.has(f));
    if (refined.length > 0) return refined;
    // 空になる場合は次のルールへ（安全弁）
  }

  // 2. カテゴリキーワード検出（descriptionのみ）
  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (!rule.pattern.test(text)) continue;

    const refined = currentFish.filter(f => rule.allowedFish.has(f));
    if (refined.length > 0) return refined;
  }

  // どのルールにもマッチしない → 元のまま
  return currentFish;
}
