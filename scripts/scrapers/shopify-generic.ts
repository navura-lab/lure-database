// scripts/scrapers/shopify-generic.ts
// 汎用 Shopify JSON API スクレイパーファクトリー
//
// Shopify ベースの釣具ブランド（Z-Man, 6th Sense 等）に共通するロジックを
// モジュールレベルの共有関数として定義し、ブランド固有設定を注入するだけで
// 新ブランドのスクレイパーを生成できるようにする。

import type { ScrapedLure, ScrapedColor, ScraperFunction } from './types.js';
import { slugify } from '../../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// 型定義: ブランド設定
// ---------------------------------------------------------------------------

/** 型検出ルール: キーワード正規表現 → カノニカルタイプ */
export interface TypeRule {
  keywords: RegExp;
  type: string;
}

/** Shopify ブランド設定 */
export interface ShopifyBrandConfig {
  name: string;                // 表示名: "6th Sense"
  slug: string;                // manufacturer_slug: "6th-sense"
  baseUrl: string;             // "https://6thsensefishing.com"
  extraTypeRules?: TypeRule[];  // ブランド固有ルール（デフォルトに先行して適用）
  defaultTargetFish?: string;  // フォールバック対象魚（デフォルト: "ブラックバス"）
}

// ---------------------------------------------------------------------------
// Shopify JSON 型定義
// ---------------------------------------------------------------------------

export interface ShopifyVariant {
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

export interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  variant_ids: number[];
}

export interface ShopifyOption {
  id: number;
  name: string;            // "Size", "Color"
  position: number;
  values: string[];
}

export interface ShopifyProduct {
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
// 型検出: タグ + product_type + 商品名キーワード → カノニカルタイプ
// ---------------------------------------------------------------------------

/**
 * 非ルアー商品を検出するキーワードパターン
 * Shopify ブランドはルアー以外（衣類・ロッド・タックル等）も販売しているため、
 * これらをスクレイプ段階で弾く。detectType() の最初にチェックされる。
 */
const NON_LURE_PATTERNS: RegExp[] = [
  // 衣類・アパレル
  /\b(hoodie|pullover|jacket|windbreaker|sweater|flannel|polo\b|shorts|pants|pant\b|beanie|visor|sunglasses?|bracelet|lanyard|t-?shirt|tee\b|tank\s+top|crew\s+neck|boot|glove|sun\s+mask|sun\s+shield)\b/i,
  // 帽子（cap/hat は曖昧だが、youth/kids と組み合わせて確実にアパレル）
  /\b(snapback|trucker|flat\s+bill|ball\s+cap|fitted\s+cap)\b/i,
  // ロッド・リール・コンボ
  /\b(spinning\s+rod|casting\s+rod|rod\s+combo|reel\s+combo|micro\s+combo)\b/i,
  // ロッド名パターン（フィート/インチ表記: "7'3" Heavy, Fast (Casting)"）
  /\d+'\d+"\s+(extra[- ]?heavy|heavy|medium|light|moderate)/i,
  // 釣り糸
  /\b(fishing\s+line|bulk\s+spool|filler\s+spool|sinking\s+braid|ghost\s+carbon)\b/i,
  // 収納・バッグ
  /\b(tackle\s+box|bait\s+binder|bait\s+folder|bait\s+chamber|duffel|satchel|backpack|soft\s+cooler|casket\b|tackle\s+toter)\b/i,
  // ツール・工具
  /\b(pliers|scissors|braid\s+scissors|bait\s+knife|fish\s+lip\s+grip|digital\s+scale|spooling\s+station|head\s+lamp|spotlight|cap\s+light)\b/i,
  // バンドル・キット・サブスク
  /\b(bundle|starter\s+kit|gift\s+pack|gift\s+kit|subscription|sampler\s+pack|mystery.*hook|garage\s+sale|trading\s+post)\b/i,
  // フック・ウェイト・小物（単体販売）
  /\b(hook\s+series|dart\s+hook|ewg\s+hook|neko\s+hook|treble\s+hook|worm\s+hook|widegap.*hook|dropbarb|maggap)\b/i,
  /\b(tungsten.*weight|nail\s+weight|drop\s*shot\s+weight|flipping\s+weight|split\s+shot\s+\d+\s*pack|peg\s+stopp)/i,
  /\b(swivel|coastlock|duo\s+lock\s+snap|twin\s+lock\s+snap|split\s+ring|welded\s+ring|assist\s+hook)\b/i,
  // パーツ・消耗品
  /\b(replacement\s+tail|replacement\s+fin|3d\s+eyes|silicone\s+skirt|rigging\s+dots|rigging\s+tool|wacky\s+rigging\s+tool|screen\s+spray|bait\s+cover|glass\s+rattl)\b/i,
  // その他非ルアー
  /\b(digital\s+catalog|turkey\s+call|can\s+cooler|sunglass\s+retainer|super\s+stank|scent)\b/i,
  // 日本語: 非ルアー製品
  /アフターパーツ/,
  /スペアパーツ/,
  /カスタムパーツ/,
  /(?:キャスティング|ジギング|ベイト|スピニング|ショアジギング)ロッド/,
  /フックユニット/,
  /アシストフック/,
  /シンカー/,
  /グローブ$/,
  /ショルダーバッグ/,
  /Tシャツ/,
  /キャスティングロッド/,
];

/**
 * Shopify の product_type で明らかに非ルアーと判定できるもの。
 * combined テキストへのパターンマッチより先にチェックして確実に弾く。
 */
const NON_LURE_PRODUCT_TYPES = /^(terminal\s+tackle|apparel|headwear|apparel\s*&\s*headwear|accessories|rods?|reels?|lines?|tools?|hooks?|weights?|sinkers?|bags?|clothing|gear|tackle|parts?)$/i;

/** 非ルアー商品かどうかを判定する */
export function isNonLureProduct(name: string, tags: string[], productType: string): boolean {
  // product_type による早期判定
  if (productType && NON_LURE_PRODUCT_TYPES.test(productType.trim())) {
    return true;
  }
  const combined = `${name} ${tags.join(' ')} ${productType}`;
  return NON_LURE_PATTERNS.some(pattern => pattern.test(combined));
}

/** デフォルトの型検出ルール（全 Shopify ブランド共通） */
export const TYPE_RULES: TypeRule[] = [
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
  // ソフトベイト
  { keywords: /elaztech|plastic|worm|craw|creature|grub|tube|shad|minnow|finesse|ned|trick|swirl|stickbait|stick\s*bait|curl|curly|fluke|slug|bug|goat|crawdad|hog|lizard|trailer|diezel|zinkerz|baby\s*goat|trd|slim\s*swim/i, type: 'ワーム' },
];

/**
 * タイプ検出
 * extraRules があればデフォルトルールより先に評価する
 */
export function detectType(
  name: string,
  tags: string[],
  productType: string,
  extraRules?: TypeRule[],
): string {
  const combined = `${name} ${tags.join(' ')} ${productType}`;

  // 非ルアー商品を先にチェック（衣類、ロッド、タックル等を除外）
  if (isNonLureProduct(name, tags, productType)) {
    return '__non_lure__';
  }

  const rules = extraRules ? [...extraRules, ...TYPE_RULES] : TYPE_RULES;

  for (const rule of rules) {
    if (rule.keywords.test(combined)) {
      return rule.type;
    }
  }

  return 'その他';
}

// ---------------------------------------------------------------------------
// ターゲットフィッシュ検出
// ---------------------------------------------------------------------------

/**
 * ターゲットフィッシュ検出
 * defaultFish はキーワードに一切マッチしなかった場合のフォールバック
 */
export function detectTargetFish(
  name: string,
  description: string,
  tags: string[],
  defaultFish: string = 'ブラックバス',
): string[] {
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

  // フォールバック
  if (fish.length === 0) fish.push(defaultFish);

  // 重複除去
  return [...new Set(fish)];
}

// ---------------------------------------------------------------------------
// 重さ・長さパース（英語表記: oz, inch）
// ---------------------------------------------------------------------------

/** "3/8 oz" → g, "1 oz" → g, "1/2oz" → g, "9/16 oz" → g */
export function parseOzToGrams(text: string): number[] {
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
export function parseInchToMm(text: string): number | null {
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
// ヘルパー: body_html → プレーンテキスト
// ---------------------------------------------------------------------------

export function htmlToPlainText(html: string): string {
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

export function detectOptionMapping(options: ShopifyOption[]): OptionMapping {
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

export function findVariantImage(variant: ShopifyVariant, images: ShopifyImage[]): string {
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
// ファクトリー: createShopifyScraper
// ---------------------------------------------------------------------------

/**
 * Shopify JSON API を使うスクレイパー関数を生成する。
 *
 * 使い方:
 * ```ts
 * const scrape6thSensePage = createShopifyScraper({
 *   name: '6th Sense',
 *   slug: '6th-sense',
 *   baseUrl: 'https://6thsensefishing.com',
 *   extraTypeRules: [
 *     { keywords: /cloud\s*9/i, type: 'クランクベイト' },
 *   ],
 * });
 * ```
 */
export function createShopifyScraper(config: ShopifyBrandConfig): ScraperFunction {
  const defaultFish = config.defaultTargetFish ?? 'ブラックバス';

  return async function shopifyScraper(url: string): Promise<ScrapedLure> {
    // 1. URL → Shopify JSON URL
    const cleanUrl = url.replace(/\/$/, '').replace(/\.json$/, '');
    const jsonUrl = `${cleanUrl}.json`;

    // 2. JSON取得（リトライ付き）
    let product!: ShopifyProduct;
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

    const name = product.title || 'Unknown';
    const description = htmlToPlainText(product.body_html || '');
    const variants = product.variants || [];
    const images = product.images || [];
    const options = product.options || [];
    // Shopify は tags をカンマ区切り文字列で返す場合がある
    const rawTags = product.tags || [];
    const tags: string[] = typeof rawTags === 'string'
      ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : rawTags;
    const productType = product.product_type || '';

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
    // colorOptionKey がない場合、バリアントタイトルが "Default Title" でなければ使う。
    // ただし sizeOptionKey がある場合、タイトルはサイズ値（"Size 1/2 oz." 等）なので
    // 色として使わない（SPRO等のSize-only商品でcolor_nameにサイズが入るバグの修正）。
    if (colorMap.size === 0 && !sizeOptionKey) {
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

    // 4.1 画像フォールバック: バリアント画像がないカラーにメイン画像を割り当て
    const fallbackImage = images[0]?.src || '';
    if (fallbackImage) {
      for (const c of colors) {
        if (!c.imageUrl) c.imageUrl = fallbackImage;
      }
    }

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

    // 8. タイプ検出（ブランド固有ルールを優先）
    const type = detectType(name, tags, productType, config.extraTypeRules);

    // 9. ターゲットフィッシュ
    const targetFish = detectTargetFish(name, description, tags, defaultFish);

    // 10. slug 生成 & カラーバリアント統合
    //
    // Shopifyストアは "ProductName - ColorName" 形式で1商品1カラーを別URLにする。
    // これが原因でGoogle「重複ページ - 別のcanonicalを選択」が発生する。
    // 対策: " - " でベース名とカラー名を分離し、ベース名のslugで統合する。
    //
    let finalName = name;
    let finalColors = colors;
    const dashSplit = name.match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (dashSplit && finalColors.length <= 1) {
      const baseName = dashSplit[1].trim();
      const colorFromTitle = dashSplit[2].trim();
      // ベース名が3文字以上で、カラー名がサイズ表記でない場合のみ
      if (baseName.length >= 3 && !/^\d/.test(colorFromTitle)) {
        finalName = baseName;
        // カラーをタイトルのカラー部分に置き換え
        const img = finalColors.length > 0 ? finalColors[0].imageUrl : mainImage;
        finalColors = [{ name: colorFromTitle, imageUrl: img }];
      }
    }
    const slug = slugify(finalName);

    return {
      name: finalName,
      name_kana: '',  // 英語ブランド: カタカナ読みなし
      slug,
      manufacturer: config.name,
      manufacturer_slug: config.slug,
      type,
      target_fish: targetFish,
      description,
      price: priceJpy,
      colors: finalColors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };
  };
}

// ---------------------------------------------------------------------------
// ファクトリー: createShopifyDiscover
// ---------------------------------------------------------------------------

/**
 * Shopify サイトマップから商品URLを検出するディスカバー関数を生成する。
 *
 * Shopify の標準構造:
 *   /sitemap.xml → sitemap_products_1.xml を参照
 *   sitemap_products_1.xml → /products/{handle} の一覧
 *
 * 使い方:
 * ```ts
 * const discoverBrand = createShopifyDiscover({
 *   domain: '6thsensefishing.com',
 *   slug: '6th-sense',
 *   excludedHandlePatterns: [/hoodie/i, /hat/i, /gift-card/i],
 * });
 * ```
 */
export function createShopifyDiscover(config: {
  domain: string;
  slug: string;
  excludedHandlePatterns?: RegExp[];
}): (page: any) => Promise<Array<{ url: string; name: string }>> {
  const { domain, slug, excludedHandlePatterns = [] } = config;

  return async function shopifyDiscover(_page: any): Promise<Array<{ url: string; name: string }>> {
    // 1. サイトマップインデックスを取得
    const sitemapIndexUrl = `https://${domain}/sitemap.xml`;
    const indexResp = await fetch(sitemapIndexUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!indexResp.ok) {
      throw new Error(`Failed to fetch ${slug} sitemap index: ${indexResp.status}`);
    }
    const indexXml = await indexResp.text();

    // 2. sitemap_products_1.xml のURLを見つける
    //    ドメインをエスケープして動的に正規表現を構築
    const escapedDomain = domain.replace(/\./g, '\\.');
    const productSitemapRegex = new RegExp(
      `<loc>(https://${escapedDomain}/sitemap_products_1[^<]*)</loc>`,
    );
    const productSitemapMatch = indexXml.match(productSitemapRegex);
    if (!productSitemapMatch) {
      throw new Error(`${slug} product sitemap not found in sitemap index`);
    }
    const productSitemapUrl = productSitemapMatch[1];

    // 3. 商品サイトマップを取得
    const resp = await fetch(productSitemapUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${slug} product sitemap: ${resp.status}`);
    }
    const xml = await resp.text();

    // 4. /products/{handle} URLを抽出
    const locRegex = new RegExp(
      `<loc>(https://${escapedDomain}/products/([^<]+))</loc>`,
      'g',
    );
    const results: Array<{ url: string; name: string }> = [];
    const seen = new Set<string>();
    let match;

    while ((match = locRegex.exec(xml)) !== null) {
      const url = match[1];
      const handle = match[2];
      if (seen.has(url)) continue;
      seen.add(url);

      // 除外パターンチェック
      let excluded = false;
      for (const pattern of excludedHandlePatterns) {
        if (pattern.test(handle)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;

      const name = handle.replace(/-/g, ' ');
      results.push({ url, name });
    }

    return results;
  };
}
