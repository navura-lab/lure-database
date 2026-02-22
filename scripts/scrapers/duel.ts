// scripts/scrapers/duel.ts
// DUEL / HARDCORE / YO-ZURI product page scraper
// Handles lure products from duel.co.jp/products/detail.php?pid=XXXX
//
// Site: PHP-based, UTF-8, jQuery + Slick.js, headless OK.
// Structure:
//   - Product name: h1.l-hero-detail_ttl > span._main / span._sub
//   - Spec table: .p-spec-table tbody tr  (type, size, weight, hook, range, price)
//   - Colors: .p-product-list_wrapper > div(img) + div.p-product-list_body(h2 code + h3 name)
//   - Multi-size: .p-color-title for size group labels, .c-grid-product_col classes for grouping
//   - Color filtering: .p-color-select_item onclick narrowDownColors2()
//   - JAN code table: .p-code-table tbody tr
//   - Images: /storage/product/{random}.jpg/.png
//   - All prices: "オープン価格" → 0
//
// One page may contain multiple size variants with different color sets per size.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DUEL_BASE = 'https://www.duel.co.jp';

// ---------------------------------------------------------------------------
// Type detection based on product name + brand
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Minnow
  [/ミノー|Minnow|ダーター|Darter|ダイバー|Diver|ミッドダイバー|MidDiver|シャローランナー|ShallowRunner/i, 'ミノー'],
  // Shad
  [/シャッド|Shad/i, 'シャッド'],
  // Crank
  [/クランク|Crank/i, 'クランクベイト'],
  // Vibration
  [/バイブ|Vib|フラッシンバイブ|ラトリンバイブ/i, 'バイブレーション'],
  // Popper
  [/ポッパー|Popper|ポップ|Pop|バブルジェット|BubbleJet/i, 'ポッパー'],
  // Pencil / Topwater
  [/ペンシル|Pencil|ウォータードライブ|WaterDrive/i, 'ペンシルベイト'],
  // Sinking pencil
  [/SBショット|SBシュート|SBダイブ|ソニックブーム|SonicBoom|バレットファスト|BulletFast|バレットダイブ|BulletDive|バレットブル|BulletBull|ヘビーショット|HeavyShot|モンスターショット|MonsterShot/i, 'シンキングペンシル'],
  // Metal jig
  [/ジグ|Jig|ブランカ|Blanca|ソリッドスピン|SolidSpin|ソリッドバイブ|SolidVib/i, 'メタルジグ'],
  // Rubber jig / Tai rubber
  [/ラバー|Rubber|タイラバ|インチク|スライドヘッド|SlideHead/i, 'タイラバ'],
  // Topwater
  [/トップ|Top|ハイドロポッパー|HydroPopper/i, 'トップウォーター'],
  // Worm / Soft bait  ← ワームもルアーやろ？
  [/ワーム|Worm|ベイト™|Bait|バイブワイドテール|VibWideTail/i, 'ワーム'],
  // Squid jig
  [/スクアート|Squat|3D\s*ダイバー|3D\s*Diver|マグナム|Magnum/i, 'プラグ'],
];

// ---------------------------------------------------------------------------
// Target fish detection from product page URL and product name
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, url: string): string[] {
  const combined = `${name} ${url}`.toLowerCase();

  if (/trout|トラウト|ストゥープ|ヘビーフラット|ボトムスキップ|ヘビートゥイッチ/.test(combined)) return ['トラウト'];
  if (/tachi|タチウオ|タチ魚/.test(combined)) return ['タチウオ'];
  if (/madai|マダイ|タイラバ|インチク|ラ\s*トゥール/.test(combined)) return ['マダイ'];
  if (/kurodai|クロダイ|チヌ/.test(combined)) return ['クロダイ'];
  if (/flat|フラット|ヒラメ/.test(combined)) return ['ヒラメ', 'マゴチ'];
  if (/rock|ロック|メバル|カサゴ/.test(combined)) return ['メバル', 'カサゴ'];
  if (/light\s*game|ライトゲーム|アジ/.test(combined)) return ['アジ', 'メバル'];
  if (/青物|ブリ|ヒラマサ|カンパチ|ショア|ジギング|モンスターショット|ボニータ|ブランカ|マグナム/.test(combined)) return ['青物'];
  if (/bass|バス|フレッシュ|クランク|シャッド/.test(combined)) return ['ブラックバス'];
  // Default: seabass for most DUEL salt products
  return ['シーバス'];
}

function detectType(name: string): string {
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(name)) return TYPE_KEYWORDS[i][1];
  }
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [duel] ${message}`);
}

/**
 * Generate slug from English sub-name or Japanese name.
 * "HARDCORE® MONSTER SHOT®（S） 65mm/80mm/..." → "hardcore-monster-shot-s"
 * "SONICBOOM® SB SHOT 75S/95S/115S" → "sonicboom-sb-shot"
 */
function nameToSlug(englishName: string, japaneseName: string): string {
  // Prefer English name
  let base = englishName || japaneseName;

  // Strip everything after the first size/variant info:
  // "HARDCORE® MONSTER SHOT®（S） 65mm/80mm/..." → "HARDCORE® MONSTER SHOT®（S）"
  // "SONICBOOM® SB SHOT 75S/95S/115S" → "SONICBOOM® SB SHOT"
  // "La Tour® CRANK 1+ 65F/2+ 60F/3+ 70F/4+ 75F" → "La Tour® CRANK 1+2+3+4+"
  base = base.replace(/\s+\d+\s*mm(?:\/.*)?$/, '');          // "90mm/H2 120mm..." trailing
  base = base.replace(/\s+\d+\w*(?:\/\d+\w*)+\s*$/, '');     // "75S/95S/115S" trailing
  base = base.replace(/\s+\d+\+\s+\d+\w+(?:\/.*)?$/, '');    // "1+ 65F/2+ 60F/..." trailing

  // Remove ® ™ © symbols
  base = base.replace(/[®™©]/g, '');
  // Remove brackets
  base = base.replace(/[（）()【】\[\]]/g, '');
  // Replace non-ASCII (Japanese) if using English name
  if (englishName) {
    base = base.replace(/[^\x20-\x7E]/g, '');
  }
  // Normalize
  return base
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Shared browser
// ---------------------------------------------------------------------------

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeDuelPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    const data = await page.evaluate(function () {
      var result: any = {};

      // --- Product name ---
      // ogTitle is cleanest: "ソニックブーム® SBショット - 釣具の総合メーカー デュエル"
      var ogMeta = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
      var ogTitle = ogMeta ? ogMeta.content.replace(/\s*-\s*釣具の総合メーカー\s*デュエル\s*$/, '').trim() : '';

      // Fallback: span._main (split on 2+ whitespace to strip size suffix)
      var titleEl = document.querySelector('h1.l-hero-detail_ttl');
      var mainSpan = titleEl ? titleEl.querySelector('span._main') : null;
      var mainText = mainSpan ? mainSpan.textContent.trim().split(/\s{2,}/)[0].trim() : '';

      // English sub-name for slug generation
      var subSpan = titleEl ? titleEl.querySelector('span._sub') : null;
      var subText = subSpan ? subSpan.textContent.trim() : '';

      result.name = ogTitle || mainText;
      result.subName = subText;

      // --- Spec table ---
      result.specs = [];
      var specRows = document.querySelectorAll('.p-spec-table tbody tr');
      for (var i = 0; i < specRows.length; i++) {
        var cells = specRows[i].querySelectorAll('td');
        if (cells.length >= 5) {
          result.specs.push({
            orderNum: cells[0] ? cells[0].textContent.trim() : '',
            type: cells[1] ? cells[1].textContent.trim() : '',
            size: cells[2] ? cells[2].textContent.trim() : '',
            weight: cells[3] ? cells[3].textContent.trim() : '',
            price: cells.length >= 9 ? (cells[8] ? cells[8].textContent.trim() : '') : '',
          });
        }
      }

      // --- Colors ---
      result.colors = [];
      var wrappers = document.querySelectorAll('.p-product-list_wrapper');
      for (var j = 0; j < wrappers.length; j++) {
        var wrapper = wrappers[j];
        var body = wrapper.querySelector('.p-product-list_body');
        if (body === null) continue;

        var h2 = body.querySelector('h2.p-product-list_ttl');
        var h3 = body.querySelector('h3');
        var colorCode = h2 ? h2.textContent.trim().replace(/^\d+\./, '') : '';
        var colorName = h3 ? h3.textContent.trim() : colorCode;

        // Image is in the sibling div (first child of wrapper, not the body)
        var imgDiv = wrapper.children[0];
        var img = imgDiv ? imgDiv.querySelector('img') : null;
        var imgSrc = img ? img.src : '';

        // Get size group from parent c-grid-product_col class
        var col = wrapper.closest('.c-grid-product_col');
        var sizeGroup = col ? col.className.replace('c-grid-product_col', '').trim() : 'all';

        if (colorName || colorCode) {
          result.colors.push({
            code: colorCode,
            name: colorName || colorCode,
            imageUrl: imgSrc,
            sizeGroup: sizeGroup,
          });
        }
      }

      // --- Size group labels (for multi-size products) ---
      result.sizeLabels = [];
      var colorTitles = document.querySelectorAll('.p-color-title');
      for (var k = 0; k < colorTitles.length; k++) {
        var titleClasses = colorTitles[k].className.replace('p-color-title', '').trim();
        result.sizeLabels.push({
          text: colorTitles[k].textContent.trim(),
          classes: titleClasses,
        });
      }

      // --- Filter buttons for size-specific colors ---
      result.sizeFilters = [];
      var filterItems = document.querySelectorAll('.p-color-select_item');
      for (var f = 0; f < filterItems.length; f++) {
        var onclick = filterItems[f].getAttribute('onclick') || '';
        var matchGroup = onclick.match(/narrowDownColors2\(this,'([^']+)'\)/);
        if (matchGroup && matchGroup[1] !== 'all') {
          result.sizeFilters.push({
            text: filterItems[f].textContent.trim(),
            group: matchGroup[1],
          });
        }
      }

      // --- Main product image (first large image) ---
      var mainImgEl = document.querySelector('.p-slick-slide_img img, .slick-slide img');
      result.mainImage = mainImgEl ? (mainImgEl as HTMLImageElement).src : '';

      // --- Description ---
      var descEl = document.querySelector('.p-product-text, .product-description, .p-detail-text');
      result.description = descEl ? descEl.textContent.trim().substring(0, 500) : '';

      return result;
    });

    // --- Post-process ---
    const productName = data.name || 'Unknown';
    const subName = data.subName || '';
    const fullName = subName ? `${productName} ${subName}` : productName;

    log(`Extracted: name="${productName}", sub="${subName}", specs=${data.specs.length}, colors=${data.colors.length}`);

    // Weights & lengths from spec table
    const weights: number[] = [];
    const lengths: number[] = [];
    let detectedType = '';

    for (const spec of data.specs) {
      // Weight: "25g" → 25
      const wMatch = spec.weight.match(/([\d.]+)\s*g/);
      if (wMatch) {
        const w = parseFloat(wMatch[1]);
        if (w > 0 && !weights.includes(w)) weights.push(w);
      }
      // Size: "65mm" → 65
      const sMatch = spec.size.match(/([\d.]+)\s*mm/);
      if (sMatch) {
        const l = parseFloat(sMatch[1]);
        if (l > 0 && !lengths.includes(l)) lengths.push(l);
      }
      // Type from spec
      if (!detectedType && spec.type) {
        const t = spec.type.trim();
        if (t === 'シンキング' || t === 'ファストシンキング' || t === 'スローシンキング') {
          // Will detect from name
        } else if (t === 'フローティング' || t === 'サスペンド') {
          // Will detect from name
        }
      }
    }

    // Type detection from name
    const type = detectType(fullName) || detectType(productName) || 'ルアー';

    // Target fish
    const targetFish = detectTargetFish(fullName, url);

    // Slug — prefer English sub-name for ASCII slug
    const slug = nameToSlug(subName, productName);

    // Length: use first (smallest) size as representative
    const length = lengths.length > 0 ? lengths[0] : null;

    // Deduplicate colors (same name → keep first)
    const seenColors = new Set<string>();
    const colors: ScrapedColor[] = [];
    for (const c of data.colors) {
      const key = c.name;
      if (seenColors.has(key)) continue;
      seenColors.add(key);
      if (c.imageUrl) {
        colors.push({
          name: c.name,
          imageUrl: c.imageUrl,
        });
      }
    }

    // Main image: first color image or dedicated main image
    const mainImage = data.mainImage || (colors.length > 0 ? colors[0].imageUrl : '');

    const result: ScrapedLure = {
      name: productName,
      name_kana: '',
      slug,
      manufacturer: 'DUEL',
      manufacturer_slug: 'duel',
      type,
      target_fish: targetFish,
      description: data.description || '',
      price: 0, // All "オープン価格"
      colors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(`Done: ${productName} | type=${type} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | fish=${targetFish.join(',')}`);

    return result;
  } finally {
    await context.close();
  }
}
