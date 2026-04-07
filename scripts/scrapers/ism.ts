// scripts/scrapers/ism.ts
// INFINITE SEEDS MAKERS (ism) product page scraper
// Handles items from https://ismfishing.base.shop/items/{id}
//
// Site: BASE プラットフォーム
// 取得方法: HTML fetch + JSON-LD Product schema パース（Playwright不要、超軽量）
// JSON-LD Product schema が標準で埋め込まれているため信頼性が高い

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISM_BASE_URL = 'https://ismfishing.base.shop';

// 商品名→ルアータイプ判定（既知のラインナップから）
const TYPE_KEYWORDS: [RegExp, string][] = [
  // バスルアー
  [/PULL[-\s]?\d+|プル/i, 'トップウォーター'],          // 表層波紋系
  [/シャッドテール|SHAD\s*TAIL/i, 'ワーム'],
  [/龍乱|RYURAN/i, 'ワーム'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/バイブ|VIB/i, 'バイブレーション'],
  [/メタル|METAL|JIG/i, 'メタルジグ'],
  [/シンキングペンシル|SINKING\s*PENCIL/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシル'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/スピナー|SPINNER/i, 'スピナーベイト'],
  [/チャター|CHATTER/i, 'チャターベイト'],
  [/フロッグ|FROG/i, 'フロッグ'],
  // ザザフィールド (ソルト系)
  [/ザザ|ZAZA/i, 'ソルトルアー'],
  // 非ルアー（除外用 — type='その他'にして後段でフィルタ）
  [/HOODIE|フーディ|キャップ|CAP|ジャケット|JACKET|シャツ|SHIRT|タオル|TOWEL/i, 'その他'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [ism] ${message}`);
}

function extractItemId(url: string): string {
  // /items/140552604 → "140552604"
  const m = url.match(/\/items\/(\d+)/);
  if (!m) throw new Error(`Cannot extract item ID from URL: ${url}`);
  return m[1];
}

/**
 * 商品名から slug を生成
 * "PULL-70F" → "pull-70f"
 * "龍乱シャッドテール Made by KIOB" → "ryuran-shadtail-made-by-kiob"
 * 日本語が混じる場合は item ID をフォールバックとして使う
 */
function makeSlug(name: string, itemId: string): string {
  // 半角英数字と既知のローマ字単語のみで slug 化
  const ascii = name
    .replace(/[（(].*?[)）]/g, '') // 括弧内除去
    .replace(/\s*Made by .*$/i, '') // "Made by KIOB" 系除去
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (ascii.length >= 3 && /[a-z]/.test(ascii)) {
    return ascii.substring(0, 60);
  }
  // 日本語のみ等で slug 化できなければ item ID
  return `ism-${itemId}`;
}

function detectType(name: string): string {
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(name)) return type;
  }
  return 'ルアー';
}

/**
 * 商品名・説明文から重さ・サイズを抽出
 * "70mm 　ウエイト：≒4.5g" → length=70, weight=4.5
 */
function parseSpecs(name: string, description: string): { weights: number[]; length: number | null } {
  const text = `${name} ${description}`;
  const weights: number[] = [];
  const lengths: number[] = [];

  // weight: "4.5g", "≒4.5g", "ウエイト：4.5g"
  const weightMatches = text.matchAll(/(?:ウエイト|ウェイト|WEIGHT|重さ|≒)?[:：\s]*([\d.]+)\s*(?:g|グラム)\b/gi);
  for (const m of weightMatches) {
    const w = parseFloat(m[1]);
    if (w > 0 && w < 200) weights.push(w);
  }

  // length: "70mm", "サイズ：70mm", "全長 70mm"
  const lengthMatches = text.matchAll(/(?:サイズ|SIZE|全長|LENGTH)?[:：\s]*([\d.]+)\s*mm\b/gi);
  for (const m of lengthMatches) {
    const l = parseFloat(m[1]);
    if (l > 5 && l < 500) lengths.push(l);
  }

  return {
    weights: [...new Set(weights)],
    length: lengths.length > 0 ? Math.max(...lengths) : null,
  };
}

/**
 * 商品名・説明文から対象魚を推定
 */
function detectTargetFish(name: string, description: string): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const fish: string[] = [];

  if (/バス|bass|ブラックバス/i.test(text)) fish.push('ブラックバス');
  if (/シーバス|seabass|スズキ/i.test(text)) fish.push('シーバス');
  if (/トラウト|trout|マス|アマゴ/i.test(text)) fish.push('トラウト');
  if (/チヌ|クロダイ|chinu/i.test(text)) fish.push('クロダイ');
  if (/メバル|mebaru/i.test(text)) fish.push('メバル');
  if (/アジ|aji/i.test(text)) fish.push('アジ');
  if (/タチウオ|太刀魚/i.test(text)) fish.push('タチウオ');
  if (/ロックフィッシュ|根魚|アイナメ|ソイ/i.test(text)) fish.push('ロックフィッシュ');
  if (/青物|ブリ|ハマチ|ヒラマサ/i.test(text)) fish.push('青物');

  return fish;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeIsmPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  const itemId = extractItemId(url);

  // HTML を取得（Playwright不要、軽量）
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  const html = await res.text();

  // JSON-LD Product schema を抽出
  const ldMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
  let product: any = null;
  for (const m of ldMatches) {
    try {
      const data = JSON.parse(m[1]);
      if (data['@type'] === 'Product' && data.name) {
        product = data;
        break;
      }
    } catch {
      /* ignore */
    }
  }

  if (!product) {
    throw new Error(`No Product JSON-LD found in ${url}`);
  }

  const name: string = (product.name || '').trim();
  if (!name) throw new Error(`Empty product name in ${url}`);

  // description: JSON-LD の description (HTMLエンティティ・改行込み)
  let description: string = (product.description || '').trim();
  // og:description のほうが整形されているのでフォールバックに利用
  if (!description || description.length < 30) {
    const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/);
    if (ogDescMatch) {
      description = ogDescMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    }
  }
  description = description.substring(0, 800);

  // images: JSON-LD の image[]（既に絶対URL）
  const images: string[] = Array.isArray(product.image) ? product.image : (product.image ? [product.image] : []);
  const mainImage = images[0] || '';

  // price: offers から
  let price = 0;
  if (product.offers) {
    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (offers && offers.price) {
      price = parseInt(String(offers.price).replace(/,/g, ''), 10) || 0;
    }
  }
  // フォールバック: HTML本文の "¥1,815" 等から
  if (price === 0) {
    const priceMatch = html.match(/¥\s*([\d,]+)/);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/,/g, ''), 10) || 0;
    }
  }

  // type 判定
  const type = detectType(name);

  // スペック抽出
  const { weights, length } = parseSpecs(name, description);

  // 対象魚
  const targetFish = detectTargetFish(name, description);

  // colors: BASE は商品ページに variant 概念が薄い。
  // 各画像を1カラーとして扱う（商品によっては全部同じ画像になる）
  // 1色しかない商品も多いので、画像が1枚なら "(default)" として1色登録
  const colors: ScrapedColor[] = [];
  if (images.length === 0) {
    // 画像なし
    colors.push({ name: '(default)', imageUrl: '' });
  } else if (images.length === 1) {
    colors.push({ name: '(default)', imageUrl: mainImage });
  } else {
    // 複数画像 = 異なる角度 or カラーバリエーション
    // 商品名にカラー情報が無いため "(image-N)" として登録
    for (let i = 0; i < Math.min(images.length, 10); i++) {
      colors.push({
        name: i === 0 ? '(default)' : `(image-${i + 1})`,
        imageUrl: images[i],
      });
    }
  }

  const slug = makeSlug(name, itemId);

  log(`Done: ${name} | type=${type} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | price=${price}`);

  return {
    name,
    name_kana: name,
    slug,
    manufacturer: 'INFINITE SEEDS MAKERS',
    manufacturer_slug: 'ism',
    type,
    target_fish: targetFish,
    description,
    price,
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };
}
