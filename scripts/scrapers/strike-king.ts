// scripts/scrapers/strike-king.ts
// Strike King スクレイパー（strikeking.com）
//
// アプローチ: fetch + JSON-LD (ProductGroup) パース
// Optimizely Commerce ベースだが、構造化データが完全なので fetch のみで十分。
// Playwright 不要。

import type { ScrapedLure, ScrapedColor } from './types.js';
import { slugify } from '../../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// 型検出: URL カテゴリパス + 商品名キーワード → カノニカルタイプ
// ---------------------------------------------------------------------------

interface TypeRule {
  keywords: RegExp;
  type: string;
}

const TYPE_RULES: TypeRule[] = [
  // ハードベイト
  { keywords: /crankbait|crank\s*bait|series\s*\d+\s*crankbait/i, type: 'クランクベイト' },
  { keywords: /jerkbait|jerk\s*bait|j300|j200/i, type: 'ミノー' },
  { keywords: /topwater|top\s*water|sexy\s*dawg|splash|pop|walking|plopper/i, type: 'トップウォーター' },
  { keywords: /popper/i, type: 'ポッパー' },
  { keywords: /pencil\s*popper/i, type: 'ペンシルベイト' },
  { keywords: /swimbait|swim\s*bait|shadalicious/i, type: 'スイムベイト' },
  { keywords: /frog|toad/i, type: 'フロッグ' },
  { keywords: /lipless|rattlin|red\s*eyed?\s*shad/i, type: 'バイブレーション' },
  { keywords: /squarebill|square\s*bill/i, type: 'クランクベイト' },
  // ワイヤーベイト
  { keywords: /spinnerbait|spinner\s*bait/i, type: 'スピナーベイト' },
  { keywords: /chatterbait|chatter\s*bait/i, type: 'チャターベイト' },
  { keywords: /buzzbait|buzz\s*bait/i, type: 'バズベイト' },
  { keywords: /spinner/i, type: 'スピナー' },
  { keywords: /bladed\s*jig/i, type: 'チャターベイト' },
  // ジグ・スプーン
  { keywords: /spoon/i, type: 'スプーン' },
  { keywords: /jig\b(?!.*head)/i, type: 'ラバージグ' },
  { keywords: /jighead|jig\s*head/i, type: 'ジグヘッド' },
  // ソフトベイト（フォールバック）
  { keywords: /worm|craw|creature|bug|grub|tube|fluke|stick|shad|swirl|finesse|ned|rage|ocho|yamasenko/i, type: 'ワーム' },
];

// URL カテゴリからの大分類
const CATEGORY_TYPE_MAP: Record<string, string> = {
  'hard-baits': 'クランクベイト',     // デフォルト、キーワードで上書き
  'soft-baits': 'ワーム',
  'jigs--spoons': 'ラバージグ',
  'wire-baits': 'スピナーベイト',
  'saltwater': 'その他',
  'terminal-tackle': 'その他',
  'fishing-line': 'その他',
  'apparel': 'その他',
  'eyewear': 'その他',
  'tools-acc': 'その他',
  'gifts': 'その他',
  'accessories': 'その他',
};

function detectType(name: string, url: string): string {
  // 1. 商品名のキーワードマッチ（最も正確）
  for (const rule of TYPE_RULES) {
    if (rule.keywords.test(name)) {
      return rule.type;
    }
  }

  // 2. URLカテゴリからフォールバック
  const urlPath = new URL(url).pathname;
  const segments = urlPath.split('/').filter(Boolean);
  // /en/shop/{category}/{sku} → category = segments[2]
  const category = segments[2] || '';
  return CATEGORY_TYPE_MAP[category] || 'その他';
}

// ---------------------------------------------------------------------------
// ターゲットフィッシュ検出
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, description: string, url: string): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const urlPath = url.toLowerCase();
  const fish: string[] = [];

  // ソルトウォーターカテゴリ
  if (urlPath.includes('/saltwater')) {
    if (/redfish|red\s*drum/i.test(text)) fish.push('レッドフィッシュ');
    if (/striper|striped\s*bass/i.test(text)) fish.push('ストライパー');
    if (/trout/i.test(text) && /speckled|sea/i.test(text)) fish.push('シートラウト');
    if (/flounder/i.test(text)) fish.push('ヒラメ');
    if (fish.length === 0) fish.push('シーバス'); // ソルトウォーター汎用
    return fish;
  }

  // フレッシュウォーター
  if (/bass|largemouth|smallmouth/i.test(text)) fish.push('ブラックバス');
  if (/walleye/i.test(text)) fish.push('ウォールアイ');
  if (/crappie/i.test(text)) fish.push('クラッピー');
  if (/pike|musky|muskie/i.test(text)) fish.push('パイク');
  if (/trout(?!\s*bait)/i.test(text) && !/sea|speckled|spotted/i.test(text)) fish.push('トラウト');
  if (/panfish/i.test(text)) fish.push('パンフィッシュ');

  // フォールバック: ほとんどの Strike King 製品はバス用
  if (fish.length === 0) fish.push('ブラックバス');
  return fish;
}

// ---------------------------------------------------------------------------
// 重さ・長さパース（英語表記: oz, inch）
// ---------------------------------------------------------------------------

/** "3/8 oz" → g, "1 oz" → g, "1/2oz" → g, "9/16 oz" → g */
function parseOzToGrams(text: string): number[] {
  const weights: number[] = [];

  // パターン: "N oz", "N/N oz", "N-N/N oz", "N.N oz"
  const patterns = [
    /(\d+)\s*[-\/]\s*(\d+)\s*(?:oz|OZ)\b/g,       // 分数: 3/8 oz
    /(\d+)\s+(\d+)\s*[-\/]\s*(\d+)\s*(?:oz|OZ)\b/g, // 帯分数: 1 3/8 oz
    /(\d+(?:\.\d+)?)\s*(?:oz|OZ)\b/g,               // 小数/整数: 1.5 oz, 2 oz
  ];

  // 分数パターン
  const fractionRegex = /(\d+)\s*\/\s*(\d+)\s*(?:oz|OZ)\b/g;
  let match;
  while ((match = fractionRegex.exec(text)) !== null) {
    const val = parseInt(match[1]) / parseInt(match[2]);
    const grams = Math.round(val * 28.3495 * 10) / 10;
    if (!weights.includes(grams)) weights.push(grams);
  }

  // 帯分数パターン: "1 3/8 oz"
  const mixedRegex = /(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(?:oz|OZ)\b/g;
  while ((match = mixedRegex.exec(text)) !== null) {
    const val = parseInt(match[1]) + parseInt(match[2]) / parseInt(match[3]);
    const grams = Math.round(val * 28.3495 * 10) / 10;
    if (!weights.includes(grams)) weights.push(grams);
  }

  // 小数/整数パターン
  const decimalRegex = /(?<!\d\s*\/\s*)(\d+(?:\.\d+)?)\s*(?:oz|OZ)\b/g;
  while ((match = decimalRegex.exec(text)) !== null) {
    const val = parseFloat(match[1]);
    if (val > 0 && val < 100) { // 妥当な範囲チェック
      const grams = Math.round(val * 28.3495 * 10) / 10;
      if (!weights.includes(grams)) weights.push(grams);
    }
  }

  return weights.sort((a, b) => a - b);
}

/** "3\"" → mm, "2-1/2\"" → mm, "4.5 inches" → mm */
function parseInchToMm(text: string): number | null {
  // "2-1/2\"" → 2.5 inch（帯分数を先にチェック）
  let match = text.match(/(\d+)\s*[-–]\s*(\d+)\s*\/\s*(\d+)\s*(?:"|"|''|inches?)/i);
  if (match) {
    const val = parseInt(match[1]) + parseInt(match[2]) / parseInt(match[3]);
    return Math.round(val * 25.4);
  }

  // "4\"" "4"" "4 inch" "4 inches" "4.5\""
  match = text.match(/(\d+(?:\.\d+)?)\s*(?:"|"|''|inches?)/i);
  if (match) {
    return Math.round(parseFloat(match[1]) * 25.4);
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSON-LD パース
// ---------------------------------------------------------------------------

interface JsonLdVariant {
  '@id'?: string;
  name?: string;
  image?: string[];
  description?: string;
  sku?: string;
  offers?: {
    price?: number;
    priceCurrency?: string;
    availability?: string;
  };
  gtin12?: string;
  'Lure Color'?: string;
  'Lure Size'?: string;
}

interface JsonLdProductGroup {
  '@type'?: string;
  name?: string;
  description?: string;
  image?: string[];
  brand?: { name?: string };
  productGroupID?: string;
  variesBy?: string[];
  hasVariant?: JsonLdVariant[];
  aggregateRating?: {
    ratingValue?: number;
    reviewCount?: number;
  };
}

function extractJsonLd(html: string): JsonLdProductGroup | null {
  const regex = /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let jsonStr = match[1].trim();
    // Strike King のサイトは JSON-LD 末尾に不正なカンマが付くバグあり
    // "}, " → "}" に修正
    jsonStr = jsonStr.replace(/,\s*$/, '');
    try {
      const data = JSON.parse(jsonStr);
      if (data['@type'] === 'ProductGroup') {
        return data as JsonLdProductGroup;
      }
      // 配列の場合
      if (Array.isArray(data)) {
        const pg = data.find((d: Record<string, unknown>) => d['@type'] === 'ProductGroup');
        if (pg) return pg as JsonLdProductGroup;
      }
    } catch {
      // JSON パースエラー → 次のスクリプトタグを試す
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// メインスクレイパー
// ---------------------------------------------------------------------------

export async function scrapeStrikeKingPage(url: string): Promise<ScrapedLure> {
  // 1. HTML取得（リトライ付き）
  let html = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      html = await response.text();
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  // 2. JSON-LD 抽出
  const productGroup = extractJsonLd(html);
  if (!productGroup) {
    throw new Error(`JSON-LD ProductGroup が見つかりません: ${url}`);
  }

  const name = productGroup.name || 'Unknown';
  const description = productGroup.description || '';
  const variants = productGroup.hasVariant || [];

  if (variants.length === 0) {
    throw new Error(`バリアントが0件: ${url}`);
  }

  // 3. カラー抽出（重複排除: Lure Color 値でグルーピング）
  const colorMap = new Map<string, { name: string; imageUrl: string }>();
  for (const v of variants) {
    const colorRaw = v['Lure Color'] || '';
    // "503 - Blue Chartreuse" → "Blue Chartreuse"
    const colorName = colorRaw.replace(/^\d+\s*-\s*/, '').trim() || colorRaw.trim() || v.name || 'Default';
    if (!colorMap.has(colorName)) {
      const img = v.image && v.image.length > 0 ? v.image[0] : '';
      colorMap.set(colorName, { name: colorName, imageUrl: img });
    }
  }
  const colors: ScrapedColor[] = Array.from(colorMap.values());

  // 4. 価格（最初のバリアントの USD 価格）
  const firstPrice = variants[0]?.offers?.price || 0;
  // USD → 円換算（概算: 1 USD ≈ 150 JPY）
  const priceJpy = Math.round(firstPrice * 150);

  // 5. メイン画像
  const mainImage = productGroup.image?.[0] || variants[0]?.image?.[0] || '';

  // 6. サイズバリアント → 長さ (mm)
  const sizeValues = new Set<string>();
  for (const v of variants) {
    if (v['Lure Size']) sizeValues.add(v['Lure Size']);
  }

  // 最大サイズを length として使用
  let length: number | null = null;
  for (const sizeStr of sizeValues) {
    const mm = parseInchToMm(sizeStr);
    if (mm !== null && (length === null || mm > length)) {
      length = mm;
    }
  }

  // 商品名からも length を試みる
  if (length === null) {
    length = parseInchToMm(name);
  }

  // 7. 重さ（商品名からパース）
  let weights = parseOzToGrams(name);
  // descriptionからも
  if (weights.length === 0) {
    weights = parseOzToGrams(description);
  }

  // サイズバリアントから重さを抽出（"1/4 oz" 形式の場合）
  if (weights.length === 0) {
    for (const sizeStr of sizeValues) {
      const w = parseOzToGrams(sizeStr);
      weights.push(...w);
    }
    weights = [...new Set(weights)].sort((a, b) => a - b);
  }

  // 8. タイプ検出
  const type = detectType(name, url);

  // 9. ターゲットフィッシュ
  const targetFish = detectTargetFish(name, description, url);

  // 10. slug 生成
  const slug = slugify(name);

  return {
    name,
    name_kana: '',  // 英語ブランド: カタカナ読みなし
    slug,
    manufacturer: 'Strike King',
    manufacturer_slug: 'strike-king',
    type,
    target_fish: targetFish,
    description,
    price: priceJpy,
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };
}
