// scripts/scrapers/z-man.ts
// Z-Man Fishing スクレイパー（zmanfishing.com）
//
// アプローチ: Shopify JSON API（/products/{handle}.json）
// 認証不要。product URL → .json URL に変換してパース。

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
// 型検出: タグ + product_type + 商品名キーワード → カノニカルタイプ
// ---------------------------------------------------------------------------

interface TypeRule {
  keywords: RegExp;
  type: string;
}

const TYPE_RULES: TypeRule[] = [
  // ワイヤーベイト
  { keywords: /chatterbait|chatter\s*bait|bladed\s*jig/i, type: 'チャターベイト' },
  { keywords: /spinnerbait|spinner\s*bait/i, type: 'スピナーベイト' },
  { keywords: /buzzbait|buzz\s*bait/i, type: 'バズベイト' },
  // ハードベイト
  { keywords: /crankbait|crank\s*bait/i, type: 'クランクベイト' },
  { keywords: /jerkbait|jerk\s*bait/i, type: 'ミノー' },
  { keywords: /topwater|top\s*water|pop|walking/i, type: 'トップウォーター' },
  { keywords: /popper/i, type: 'ポッパー' },
  { keywords: /swimbait|swim\s*bait|swimmerz/i, type: 'スイムベイト' },
  { keywords: /frog|toad/i, type: 'フロッグ' },
  { keywords: /lipless|rattl/i, type: 'バイブレーション' },
  // ジグ
  { keywords: /jighead|jig\s*head|shroomz|finesse\s*shroomz|power\s*finesse/i, type: 'ジグヘッド' },
  { keywords: /jig\b(?!.*head)/i, type: 'ラバージグ' },
  { keywords: /spoon/i, type: 'スプーン' },
  { keywords: /spinner/i, type: 'スピナー' },
  // ソフトベイト（ElaZtech系は全てワーム）
  { keywords: /elaztech|plastic|worm|craw|creature|grub|tube|shad|minnow|finesse|ned|trick|swirl|stickbait|stick\s*bait|curl|curly|fluke|slug|bug|goat|crawdad|hog|lizard|trailer|diezel|zinkerz|baby\s*goat|trd|slim\s*swim/i, type: 'ワーム' },
];

function detectType(name: string, tags: string[], productType: string): string {
  const combined = `${name} ${tags.join(' ')} ${productType}`;

  // 1. キーワードマッチ（最も正確）
  for (const rule of TYPE_RULES) {
    if (rule.keywords.test(combined)) {
      return rule.type;
    }
  }

  return 'その他';
}

// ---------------------------------------------------------------------------
// ターゲットフィッシュ検出
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, description: string, tags: string[]): string[] {
  const text = `${name} ${description} ${tags.join(' ')}`.toLowerCase();
  const fish: string[] = [];

  // ソルトウォーター
  if (/saltwater|inshore|redfish|red\s*drum/i.test(text)) {
    if (/redfish|red\s*drum/i.test(text)) fish.push('レッドフィッシュ');
    if (/striper|striped\s*bass/i.test(text)) fish.push('ストライパー');
    if (/trout/i.test(text) && /speckled|sea|spotted/i.test(text)) fish.push('シートラウト');
    if (/flounder/i.test(text)) fish.push('ヒラメ');
    if (/snook/i.test(text)) fish.push('スヌーク');
    if (fish.length === 0 && /saltwater|inshore/i.test(text)) fish.push('シーバス');
  }

  // フレッシュウォーター
  if (/bass|largemouth|smallmouth/i.test(text)) fish.push('ブラックバス');
  if (/walleye/i.test(text)) fish.push('ウォールアイ');
  if (/crappie/i.test(text)) fish.push('クラッピー');
  if (/pike|musky|muskie/i.test(text)) fish.push('パイク');
  if (/trout(?!\s*bait)/i.test(text) && !/sea|speckled|spotted/i.test(text)) fish.push('トラウト');
  if (/panfish/i.test(text)) fish.push('パンフィッシュ');
  if (/perch/i.test(text)) fish.push('パーチ');

  // フォールバック: Z-Man は主にバス用
  if (fish.length === 0) fish.push('ブラックバス');

  // 重複除去
  return [...new Set(fish)];
}

// ---------------------------------------------------------------------------
// 重さ・長さパース（英語表記: oz, inch）
// ---------------------------------------------------------------------------

/** "3/8 oz" → g, "1 oz" → g, "1/2oz" → g, "9/16 oz" → g */
function parseOzToGrams(text: string): number[] {
  const weights: number[] = [];

  // 帯分数パターン: "1 3/8 oz"
  const mixedRegex = /(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(?:oz|OZ)\b/g;
  let match;
  while ((match = mixedRegex.exec(text)) !== null) {
    const val = parseInt(match[1]) + parseInt(match[2]) / parseInt(match[3]);
    const grams = Math.round(val * 28.3495 * 10) / 10;
    if (!weights.includes(grams)) weights.push(grams);
  }

  // 分数パターン: "3/8 oz"
  const fractionRegex = /(\d+)\s*\/\s*(\d+)\s*(?:oz|OZ)\b/g;
  while ((match = fractionRegex.exec(text)) !== null) {
    const val = parseInt(match[1]) / parseInt(match[2]);
    const grams = Math.round(val * 28.3495 * 10) / 10;
    if (!weights.includes(grams)) weights.push(grams);
  }

  // 小数/整数パターン
  const decimalRegex = /(?<!\d\s*\/\s*)(\d+(?:\.\d+)?)\s*(?:oz|OZ)\b/g;
  while ((match = decimalRegex.exec(text)) !== null) {
    const val = parseFloat(match[1]);
    if (val > 0 && val < 100) {
      const grams = Math.round(val * 28.3495 * 10) / 10;
      if (!weights.includes(grams)) weights.push(grams);
    }
  }

  return weights.sort((a, b) => a - b);
}

/** "2.75\"" → mm, "4.5 inches" → mm */
function parseInchToMm(text: string): number | null {
  // 帯分数: "2-1/2\"" → 2.5 inch
  let match = text.match(/(\d+)\s*[-–]\s*(\d+)\s*\/\s*(\d+)\s*(?:"|"|''|inches?)/i);
  if (match) {
    const val = parseInt(match[1]) + parseInt(match[2]) / parseInt(match[3]);
    return Math.round(val * 25.4);
  }

  // 小数/整数: "4\"" "4.5 inches" "2.75""
  match = text.match(/(\d+(?:\.\d+)?)\s*(?:"|"|''|inches?)/i);
  if (match) {
    return Math.round(parseFloat(match[1]) * 25.4);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shopify JSON 型定義
// ---------------------------------------------------------------------------

interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;           // "5.49"
  sku: string;
  available: boolean;
  image_id: number | null;
}

interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  variant_ids: number[];
}

interface ShopifyOption {
  id: number;
  name: string;            // "Size", "Color"
  position: number;
  values: string[];
}

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string | string[];  // Shopify は通常カンマ区切り string で返す
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
}

// ---------------------------------------------------------------------------
// ヘルパー: body_html → プレーンテキスト
// ---------------------------------------------------------------------------

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// ヘルパー: option のどの position が色・サイズかを判定
// ---------------------------------------------------------------------------

interface OptionMapping {
  colorOptionKey: 'option1' | 'option2' | 'option3' | null;
  sizeOptionKey: 'option1' | 'option2' | 'option3' | null;
}

function detectOptionMapping(options: ShopifyOption[]): OptionMapping {
  let colorOptionKey: 'option1' | 'option2' | 'option3' | null = null;
  let sizeOptionKey: 'option1' | 'option2' | 'option3' | null = null;

  for (const opt of options) {
    const key = `option${opt.position}` as 'option1' | 'option2' | 'option3';
    const nameLower = opt.name.toLowerCase();
    if (/color|colour/i.test(nameLower)) {
      colorOptionKey = key;
    } else if (/size|weight|length|pack/i.test(nameLower)) {
      sizeOptionKey = key;
    }
  }

  return { colorOptionKey, sizeOptionKey };
}

// ---------------------------------------------------------------------------
// ヘルパー: バリアント画像を探す
// ---------------------------------------------------------------------------

function findVariantImage(variant: ShopifyVariant, images: ShopifyImage[]): string {
  if (variant.image_id) {
    const img = images.find(i => i.id === variant.image_id);
    if (img) return img.src;
  }
  // 画像が variant_ids で紐づいている場合
  const img = images.find(i => i.variant_ids.includes(variant.id));
  if (img) return img.src;
  return '';
}

// ---------------------------------------------------------------------------
// メインスクレイパー
// ---------------------------------------------------------------------------

export async function scrapeZManPage(url: string): Promise<ScrapedLure> {
  // 1. URL → Shopify JSON URL
  //    https://zmanfishing.com/products/finesse-trd → https://zmanfishing.com/products/finesse-trd.json
  const cleanUrl = url.replace(/\/$/, '').replace(/\.json$/, '');
  const jsonUrl = `${cleanUrl}.json`;

  // 2. JSON取得（リトライ付き）
  let product: ShopifyProduct;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(jsonUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = await response.json() as { product: ShopifyProduct };
      product = json.product;
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  const name = product!.title || 'Unknown';
  const description = htmlToPlainText(product!.body_html || '');
  const variants = product!.variants || [];
  const images = product!.images || [];
  const options = product!.options || [];
  // Shopify は tags をカンマ区切り文字列で返す場合がある
  const rawTags = product!.tags || [];
  const tags: string[] = typeof rawTags === 'string'
    ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
    : rawTags;
  const productType = product!.product_type || '';

  if (variants.length === 0) {
    throw new Error(`バリアントが0件: ${url}`);
  }

  // 3. option マッピング検出（Color が option1 か option2 か）
  const { colorOptionKey, sizeOptionKey } = detectOptionMapping(options);

  // 4. カラー抽出（重複排除）
  const colorMap = new Map<string, { name: string; imageUrl: string }>();
  for (const v of variants) {
    const colorRaw = colorOptionKey ? (v[colorOptionKey] || '') : '';
    if (!colorRaw) continue;
    const colorName = colorRaw.trim();
    if (!colorMap.has(colorName)) {
      const img = findVariantImage(v, images);
      colorMap.set(colorName, { name: colorName, imageUrl: img });
    }
  }
  // colorOptionKey がない場合、バリアントタイトルが "Default Title" でなければ使う
  if (colorMap.size === 0) {
    for (const v of variants) {
      const title = v.title?.trim() || '';
      if (title && title !== 'Default Title') {
        if (!colorMap.has(title)) {
          const img = findVariantImage(v, images);
          colorMap.set(title, { name: title, imageUrl: img });
        }
      }
    }
  }
  const colors: ScrapedColor[] = Array.from(colorMap.values());

  // 5. 価格（最初のバリアントの USD 価格 → JPY）
  const firstPrice = parseFloat(variants[0]?.price || '0');
  const priceJpy = Math.round(firstPrice * 150);

  // 6. メイン画像
  const mainImage = images[0]?.src || '';

  // 7. サイズバリアントから長さ・重さを抽出
  const sizeValues = new Set<string>();
  if (sizeOptionKey) {
    for (const v of variants) {
      const sizeRaw = v[sizeOptionKey];
      if (sizeRaw) sizeValues.add(sizeRaw);
    }
  }

  // 長さ: サイズバリアントから inch 表記をパース
  let length: number | null = null;
  for (const sizeStr of sizeValues) {
    // "2.75" (8-pack)" のような表記に対応（ダブルクオートがインチマーク）
    // 先頭の数値 + " を抽出
    const inchMatch = sizeStr.match(/^(\d+(?:\.\d+)?)\s*[""]/)
      || sizeStr.match(/(\d+(?:\.\d+)?)\s*(?:inch|inches)/i);
    if (inchMatch) {
      const mm = Math.round(parseFloat(inchMatch[1]) * 25.4);
      if (length === null || mm > length) length = mm;
    } else {
      const mm = parseInchToMm(sizeStr);
      if (mm !== null && (length === null || mm > length)) length = mm;
    }
  }
  // 商品名からもトライ
  if (length === null) {
    length = parseInchToMm(name);
  }

  // 重さ: サイズバリアントから oz 表記をパース
  let weights: number[] = [];
  for (const sizeStr of sizeValues) {
    const w = parseOzToGrams(sizeStr);
    weights.push(...w);
  }
  // 商品名からも
  if (weights.length === 0) {
    weights = parseOzToGrams(name);
  }
  // description からも
  if (weights.length === 0) {
    weights = parseOzToGrams(description);
  }
  weights = [...new Set(weights)].sort((a, b) => a - b);

  // 8. タイプ検出
  const type = detectType(name, tags, productType);

  // 9. ターゲットフィッシュ
  const targetFish = detectTargetFish(name, description, tags);

  // 10. slug 生成
  const slug = slugify(name);

  return {
    name,
    name_kana: '',  // 英語ブランド: カタカナ読みなし
    slug,
    manufacturer: 'Z-Man',
    manufacturer_slug: 'z-man',
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
