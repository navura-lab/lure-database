// scripts/scrapers/zoom.ts
// Zoom Bait Company スクレイパー（zoombait.com / order.zoombait.com）
//
// アプローチ: order.zoombait.com (WooCommerce) の商品ページをfetch
// JSON-LD (Product) + HTML パース でデータ抽出。
// カラーは WooCommerce バリエーションセレクタ（<select> or variation data）からパース。
// Zoom はソフトプラスチック専門 → type は全て 'ワーム'。

import type { ScrapedLure, ScrapedColor } from './types.js';
import { slugify } from '../../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// EC サイトのドメイン
const EC_DOMAIN = 'order.zoombait.com';

// ---------------------------------------------------------------------------
// URL 正規化: zoombait.com → order.zoombait.com
// ---------------------------------------------------------------------------

/**
 * zoombait.com のURL → order.zoombait.com のURLに変換。
 * zoombait.com: /trick-worm/
 * order.zoombait.com: /tackle/trick-worm/
 *
 * すでに order.zoombait.com ならそのまま返す。
 */
function normalizeToEcUrl(url: string): string {
  const parsed = new URL(url);

  // すでに EC ドメインならそのまま
  if (parsed.hostname === EC_DOMAIN) {
    return url;
  }

  // zoombait.com → order.zoombait.com/tackle/{slug}/
  // zoombait.com のパスは /{product-slug}/ 形式
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  const productSlug = pathSegments[pathSegments.length - 1] || '';

  if (!productSlug) {
    throw new Error(`商品スラグが取得できません: ${url}`);
  }

  return `https://${EC_DOMAIN}/tackle/${productSlug}/`;
}

// ---------------------------------------------------------------------------
// JSON-LD パース（WooCommerce Product）
// ---------------------------------------------------------------------------

interface WooJsonLdProduct {
  '@type'?: string;
  name?: string;
  description?: string;
  image?: string;
  url?: string;
  sku?: string;
  offers?: Array<{
    '@type'?: string;
    price?: string | number;
    priceCurrency?: string;
    availability?: string;
  }> | {
    '@type'?: string;
    price?: string | number;
    priceCurrency?: string;
    availability?: string;
  };
}

function extractJsonLd(html: string): WooJsonLdProduct | null {
  const regex = /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const data = JSON.parse(jsonStr);

      // 単体 Product
      if (data['@type'] === 'Product') {
        return data as WooJsonLdProduct;
      }

      // @graph 配列（WooCommerce Yoast SEO 等）
      if (data['@graph'] && Array.isArray(data['@graph'])) {
        const product = data['@graph'].find(
          (d: Record<string, unknown>) => d['@type'] === 'Product'
        );
        if (product) return product as WooJsonLdProduct;
      }

      // 配列の場合
      if (Array.isArray(data)) {
        const product = data.find(
          (d: Record<string, unknown>) => d['@type'] === 'Product'
        );
        if (product) return product as WooJsonLdProduct;
      }
    } catch {
      // JSON パースエラー → 次のスクリプトタグを試す
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML パース ヘルパー
// ---------------------------------------------------------------------------

/** <h1 class="product_title ...">Name</h1> からテキスト取得 */
function parseProductName(html: string): string {
  const match = html.match(/<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (match) {
    return match[1].replace(/<[^>]+>/g, '').trim();
  }
  // フォールバック: 最初の <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
}

/** 商品説明文（WooCommerce .woocommerce-product-details__short-description または .description） */
function parseDescription(html: string): string {
  // short description
  const shortMatch = html.match(
    /<div[^>]*class="[^"]*woocommerce-product-details__short-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (shortMatch) {
    return shortMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // タブの description
  const tabMatch = html.match(
    /<div[^>]*id="tab-description"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (tabMatch) {
    return tabMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

/** メイン商品画像を取得 */
function parseMainImage(html: string): string {
  // WooCommerce のメイン画像
  const match = html.match(
    /<div[^>]*class="[^"]*woocommerce-product-gallery__image[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"/i
  );
  if (match) return match[1];

  // og:image フォールバック
  const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (ogMatch) return ogMatch[1];

  return '';
}

// ---------------------------------------------------------------------------
// カラー抽出
// ---------------------------------------------------------------------------

/**
 * WooCommerce のバリエーション <select> からカラー名を抽出。
 * <select id="pa_color"> <option value="slug">Color Name</option> ... </select>
 */
function parseColorsFromSelect(html: string): ScrapedColor[] {
  const colors: ScrapedColor[] = [];

  // pa_color セレクタを探す
  const selectMatch = html.match(
    /<select[^>]*id="pa_color"[^>]*>([\s\S]*?)<\/select>/i
  );
  if (!selectMatch) {
    // 別のID名を試す: pa_colors, pa_colour 等
    const altMatch = html.match(
      /<select[^>]*id="pa_colou?rs?"[^>]*>([\s\S]*?)<\/select>/i
    );
    if (!altMatch) return colors;
    return parseOptionsFromSelect(altMatch[1]);
  }

  return parseOptionsFromSelect(selectMatch[1]);
}

function parseOptionsFromSelect(selectInner: string): ScrapedColor[] {
  const colors: ScrapedColor[] = [];
  const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/gi;
  let match;
  while ((match = optionRegex.exec(selectInner)) !== null) {
    const value = match[1].trim();
    const label = match[2].trim();
    // 空のvalue（"Choose an option" 等）をスキップ
    if (!value || value === '' || label.toLowerCase().includes('choose')) continue;
    colors.push({
      name: label || value,
      imageUrl: '', // Zoom はカラー別画像が基本的にない
    });
  }
  return colors;
}

/**
 * WooCommerce の variations JSON データからカラーを抽出。
 * <form class="variations_form" data-product_variations="[...]">
 */
function parseColorsFromVariationData(html: string): ScrapedColor[] {
  const colors: ScrapedColor[] = [];
  const seen = new Set<string>();

  const match = html.match(/data-product_variations="([^"]+)"/i);
  if (!match) return colors;

  try {
    // HTML エンティティをデコード
    const jsonStr = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#039;/g, "'");

    const variations = JSON.parse(jsonStr) as Array<{
      attributes?: Record<string, string>;
      image?: { url?: string; full_src?: string };
    }>;

    for (const v of variations) {
      const attrs = v.attributes || {};
      // attribute_pa_color or similar
      const colorValue =
        attrs['attribute_pa_color'] ||
        attrs['attribute_pa_colors'] ||
        attrs['attribute_pa_colour'] ||
        '';

      if (!colorValue || seen.has(colorValue)) continue;
      seen.add(colorValue);

      // slug → 表示名に変換（ハイフンをスペースに、各単語先頭大文字）
      const displayName = colorValue
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      const imageUrl = v.image?.full_src || v.image?.url || '';

      colors.push({
        name: displayName,
        imageUrl,
      });
    }
  } catch {
    // JSONパースエラー → 空で返す
  }

  return colors;
}

// ---------------------------------------------------------------------------
// サイズ（長さ）パース
// ---------------------------------------------------------------------------

/**
 * 商品名や説明文から長さ（インチ）を検出し mm に変換。
 * 例: "Size = 6.5 inches", "6.5"", "4 inch", 商品名 "Trick Worm 6.5"
 */
function parseLengthFromText(text: string): number | null {
  // "Size = 6.5 inches" or "Size = 6.5""
  let match = text.match(/size\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:inches?|"|")/i);
  if (match) {
    return Math.round(parseFloat(match[1]) * 25.4);
  }

  // "6.5 inches" "4 inch" "10""
  match = text.match(/(\d+(?:\.\d+)?)\s*(?:inches?|"|")\b/i);
  if (match) {
    const val = parseFloat(match[1]);
    if (val > 0 && val < 30) { // 妥当な範囲
      return Math.round(val * 25.4);
    }
  }

  // "6-1/2 inches" 帯分数
  match = text.match(/(\d+)\s*[-–]\s*(\d+)\s*\/\s*(\d+)\s*(?:inches?|"|")/i);
  if (match) {
    const val = parseInt(match[1]) + parseInt(match[2]) / parseInt(match[3]);
    return Math.round(val * 25.4);
  }

  return null;
}

/**
 * 商品名の末尾の数字をサイズとして抽出。
 * 例: "Trick Worm 6.5" → 6.5 inches → 165mm
 */
function parseLengthFromProductName(name: string): number | null {
  // 末尾の数字（サイズとして解釈）: "Super Fluke 5" → 5
  const match = name.match(/\b(\d+(?:\.\d+)?)\s*$/);
  if (match) {
    const val = parseFloat(match[1]);
    // ルアーサイズとして妥当な範囲（1〜15インチ）
    if (val >= 1 && val <= 15) {
      return Math.round(val * 25.4);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 価格パース
// ---------------------------------------------------------------------------

function parsePriceUsd(jsonLd: WooJsonLdProduct | null, html: string): number {
  // 1. JSON-LD から
  if (jsonLd?.offers) {
    const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers : [jsonLd.offers];
    for (const offer of offers) {
      if (offer.price) {
        const price = typeof offer.price === 'string' ? parseFloat(offer.price) : offer.price;
        if (!isNaN(price) && price > 0) return price;
      }
    }
  }

  // 2. HTML の .price から
  const priceMatch = html.match(/<span[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>.*?(\d+(?:\.\d+)?)/i);
  if (priceMatch) {
    const price = parseFloat(priceMatch[1]);
    if (!isNaN(price) && price > 0) return price;
  }

  // 3. HTML の meta itemprop="price"
  const metaMatch = html.match(/<meta\s+itemprop="price"\s+content="([^"]+)"/i);
  if (metaMatch) {
    const price = parseFloat(metaMatch[1]);
    if (!isNaN(price) && price > 0) return price;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// メインスクレイパー
// ---------------------------------------------------------------------------

export async function scrapeZoomPage(url: string): Promise<ScrapedLure> {
  // 1. URL正規化（zoombait.com → order.zoombait.com）
  const ecUrl = normalizeToEcUrl(url);

  // 2. HTML取得（リトライ付き）
  let html = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(ecUrl, {
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

  // 3. JSON-LD 抽出
  const jsonLd = extractJsonLd(html);

  // 4. 商品名
  const name = jsonLd?.name || parseProductName(html);
  if (!name) {
    throw new Error(`商品名が取得できません: ${ecUrl}`);
  }

  // 5. 説明文
  const description = jsonLd?.description
    ? jsonLd.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : parseDescription(html);

  // 6. カラー抽出（variation data を優先 → 画像付きカラーが取れる）
  let colors = parseColorsFromVariationData(html);
  if (colors.length === 0) {
    // variation data がない場合は select タグから（画像なし）
    colors = parseColorsFromSelect(html);
  }

  // 7. 価格（USD → JPY @ 150x）
  const priceUsd = parsePriceUsd(jsonLd, html);
  const priceJpy = Math.round(priceUsd * 150);

  // 8. メイン画像
  const mainImage = jsonLd?.image || parseMainImage(html);

  // 9. 長さ（説明文 → 商品名の順で検出）
  let length = parseLengthFromText(description);
  if (length === null) {
    length = parseLengthFromText(name);
  }
  if (length === null) {
    length = parseLengthFromProductName(name);
  }

  // 10. slug 生成
  const slug = slugify(name);

  return {
    name,
    name_kana: '', // 英語ブランド: カタカナ読みなし
    slug,
    manufacturer: 'Zoom',
    manufacturer_slug: 'zoom',
    type: 'ワーム', // Zoom は全てソフトプラスチック
    target_fish: ['ブラックバス'], // Zoom の主要ターゲット
    description,
    price: priceJpy,
    colors,
    weights: [], // ソフトプラスチックは個数売り、重さなし
    length,
    mainImage: typeof mainImage === 'string' ? mainImage : '',
    sourceUrl: url,
  };
}
