// scripts/scrapers/tacklehouse.ts
// Tackle House product page scraper
// Handles lure products from tacklehouse.co.jp/product/{slug}.html
//
// Site: Static HTML, Bootstrap 5.0.2, jQuery 3.6.0, headless OK.
// Structure:
//   - Product name: h2 (first one)
//   - Model names: h5 elements (＜RB99＞ format)
//   - Spec table: table.table.table-striped.table-condensed (variable columns)
//   - Colors: div.yubi.border with img + text (code.name format)
//   - Images: /productphoto/{model}_{colorcode}.jpg
//   - Breadcrumb: .breadcrumb → Home > SALTWATER > PRODUCT
//   - Prices: ￥1,800 format (tax-excluded)
//
// One page may contain multiple model variants (e.g., RB99/RB88/RB77/RB66)
// with a single shared color chart, or separate color charts per model group.
// Spec table columns vary: some have Maxdepth, Pb free columns.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TH_BASE = 'https://tacklehouse.co.jp';

// ---------------------------------------------------------------------------
// Type detection based on product name + breadcrumb
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Popper
  [/ポッパー|Popper|Feed\.?Popper|CFP|フィード\.?ポッパー/i, 'ポッパー'],
  // Pencil
  [/ペンシル|Pencil|Feed\.?Walking|ウォーキング/i, 'ペンシルベイト'],
  // Sinking pencil
  [/シンキングペンシル|Sinking\s*Pencil|CRSP|クルーズ\s*SP|ストリーマー|Streamer|SST/i, 'シンキングペンシル'],
  // Vibration / Rolling Bait
  [/バイブ|Vib|ローリングベイト|Rolling\s*Bait|RBM|RBS/i, 'バイブレーション'],
  // Crank
  [/クランク|Crank|エルフィン\s*クリスタル/i, 'クランクベイト'],
  // Minnow
  [/ミノー|Minnow|K2F|K2S|TKF|TKW|TKR|TKLM|M\s*Sound|Blue\s*Ocean|ブルーオーシャン|BKF|BKLM|コンタクト\s*フリッツ|Flitz|Feed\.?Shallow|CFS|BEZEL|NODE|ノード|ベゼル/i, 'ミノー'],
  // Metal jig
  [/ジグ|Jig|メタル|Metal|PBJ|ショアーズ\s*ジグ|TJ|ソル|Sol/i, 'メタルジグ'],
  // Topwater (cicada, grasshopper etc.)
  [/シケイダー|Cicada|グラスホッパー|Grasshopper|シュリンプ|Shrimp|クリケット|Cricket|オーバル|Oval|プラグ|Plug|フィード\.?ポッパー/i, 'トップウォーター'],
  // Shad
  [/シャッド|Shad|プルシャッド|Pull\s*Shad/i, 'シャッド'],
];

// ---------------------------------------------------------------------------
// Target fish detection from breadcrumb
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, breadcrumb: string): string[] {
  var combined = (name + ' ' + breadcrumb).toLowerCase();

  // Specific fish from product name
  if (/青物|ヒラマサ|カンパチ|ブリ/.test(combined)) return ['青物'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ', 'マゴチ'];
  if (/メバル|ロック/.test(combined)) return ['メバル'];
  if (/アジ|ライトゲーム/.test(combined)) return ['アジ', 'メバル'];
  if (/チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];
  if (/タチウオ/.test(combined)) return ['タチウオ'];

  // Category from breadcrumb
  if (/elfin/.test(breadcrumb)) return ['トラウト'];
  if (/freshwater|バス/i.test(breadcrumb)) return ['ブラックバス'];

  // Default: seabass for most Tackle House products (saltwater brand)
  return ['シーバス'];
}

function detectType(name: string, breadcrumb: string): string {
  var combined = name + ' ' + breadcrumb;
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(combined)) return TYPE_KEYWORDS[i][1];
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
  console.log('[' + timestamp() + '] [tacklehouse] ' + message);
}

function nameToSlug(url: string): string {
  // /product/rollingbait.html → rollingbait
  var match = url.match(/\/product\/([^/]+)\.html/);
  if (match) return match[1];
  // fallback: last path segment
  var parts = url.replace(/\.html$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
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

export async function scrapeTacklehousePage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser = await getBrowser();
  var context = await browser.newContext();
  var page = await context.newPage();

  try {
    log('Navigating to ' + url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    var data = await page.evaluate(function () {
      var result: any = {};

      // --- Product name from h2 ---
      var h2Els = document.querySelectorAll('h2');
      result.name = '';
      for (var i = 0; i < h2Els.length; i++) {
        var text = h2Els[i].textContent || '';
        text = text.trim();
        // Skip empty or navigation-like h2s
        if (text && text.length > 1 && text.length < 100) {
          result.name = text;
          break;
        }
      }

      // --- Breadcrumb ---
      var bcEl = document.querySelector('.breadcrumb');
      result.breadcrumb = bcEl ? (bcEl.textContent || '').trim() : '';

      // --- Spec tables (may have multiple) ---
      result.specs = [];
      var tables = document.querySelectorAll('table.table-striped');
      for (var t = 0; t < tables.length; t++) {
        var table = tables[t];
        // Parse header row to build column mapping
        var headers: string[] = [];
        var thEls = table.querySelectorAll('th');
        for (var h = 0; h < thEls.length; h++) {
          headers.push((thEls[h].textContent || '').trim().toLowerCase());
        }

        // Find column indices
        var modelIdx = -1;
        var typeIdx = -1;
        var lengthIdx = -1;
        var weightIdx = -1;
        var priceIdx = -1;

        for (var ci = 0; ci < headers.length; ci++) {
          var hdr = headers[ci];
          if (hdr === 'model' || hdr === 'モデル') modelIdx = ci;
          else if (hdr === 'type' || hdr === 'タイプ') typeIdx = ci;
          else if (hdr === 'length' || hdr === '全長') lengthIdx = ci;
          else if (hdr === 'weight' || hdr === '重量' || hdr === 'ウェイト') weightIdx = ci;
          else if (hdr === 'price' || hdr === '価格' || hdr === '税込価格') priceIdx = ci;
        }

        // Parse data rows
        var rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) {
          // Some tables don't use tbody
          rows = table.querySelectorAll('tr');
        }
        for (var r = 0; r < rows.length; r++) {
          var cells = rows[r].querySelectorAll('td');
          if (cells.length < 3) continue; // skip header row or empty

          var spec: any = {};
          if (modelIdx >= 0 && cells[modelIdx]) {
            spec.model = (cells[modelIdx].textContent || '').trim();
          }
          if (typeIdx >= 0 && cells[typeIdx]) {
            spec.type = (cells[typeIdx].textContent || '').trim();
          }
          if (lengthIdx >= 0 && cells[lengthIdx]) {
            spec.length = (cells[lengthIdx].textContent || '').trim();
          }
          if (weightIdx >= 0 && cells[weightIdx]) {
            spec.weight = (cells[weightIdx].textContent || '').trim();
          }
          if (priceIdx >= 0 && cells[priceIdx]) {
            spec.price = (cells[priceIdx].textContent || '').trim();
          }

          if (spec.model || spec.length || spec.weight) {
            result.specs.push(spec);
          }
        }
      }

      // --- Colors from .yubi elements ---
      result.colors = [];
      var yubiEls = document.querySelectorAll('.yubi');
      for (var y = 0; y < yubiEls.length; y++) {
        var el = yubiEls[y];
        // Get text content (first line = color code.name)
        var fullText = (el.textContent || '').trim();
        var firstLine = fullText.split('\n')[0].trim();

        // Get image
        var imgEl = el.querySelector('img');
        var imgSrc = imgEl ? (imgEl.getAttribute('src') || '') : '';

        if (firstLine && imgSrc) {
          result.colors.push({
            text: firstLine,
            imageUrl: imgSrc,
          });
        }
      }

      // --- Main product image (first productphoto img) ---
      result.mainImage = '';
      var allImgs = document.querySelectorAll('img');
      for (var im = 0; im < allImgs.length; im++) {
        var src = allImgs[im].getAttribute('src') || '';
        if (src.indexOf('productphoto/') >= 0 && src.indexOf('s_for_mixup') < 0 && src.indexOf('_') < 0) {
          // This is a main product photo (no underscore = not a color variant)
          // But some main images have underscores in model name... check differently
          result.mainImage = src;
          break;
        }
      }
      // Fallback: first productphoto image of any kind
      if (!result.mainImage) {
        for (var im2 = 0; im2 < allImgs.length; im2++) {
          var src2 = allImgs[im2].getAttribute('src') || '';
          if (src2.indexOf('productphoto/') >= 0 && src2.indexOf('s_for_mixup') < 0) {
            result.mainImage = src2;
            break;
          }
        }
      }

      // --- Description (first p with meaningful content after h2) ---
      result.description = '';
      var pEls = document.querySelectorAll('p');
      for (var p = 0; p < pEls.length; p++) {
        var pText = (pEls[p].textContent || '').trim();
        // Skip very short or navigation text
        if (pText.length > 30 && pText.length < 500) {
          result.description = pText.substring(0, 500);
          break;
        }
      }

      return result;
    });

    // --- Post-process ---
    var productName = data.name || 'Unknown';
    var breadcrumb = data.breadcrumb || '';

    log('Extracted: name="' + productName + '", breadcrumb="' + breadcrumb + '", specs=' + data.specs.length + ', colors=' + data.colors.length);

    // Slug from URL
    var slug = nameToSlug(url);

    // Weights & lengths from spec table
    var weights: number[] = [];
    var lengths: number[] = [];
    var prices: number[] = [];

    for (var s = 0; s < data.specs.length; s++) {
      var spec = data.specs[s];

      // Weight: "30g" or "24g" or "74g(87g)" → first number
      if (spec.weight) {
        var wMatch = spec.weight.match(/([\d.]+)\s*g/);
        if (wMatch) {
          var w = parseFloat(wMatch[1]);
          if (w > 0 && weights.indexOf(w) < 0) weights.push(w);
        }
      }

      // Length: "99mm" → 99
      if (spec.length) {
        var lMatch = spec.length.match(/([\d.]+)\s*mm/);
        if (lMatch) {
          var l = parseFloat(lMatch[1]);
          if (l > 0 && lengths.indexOf(l) < 0) lengths.push(l);
        }
      }

      // Price: "￥1,800" or "￥2,600" → numeric
      if (spec.price) {
        var pMatch = spec.price.match(/[￥¥]\s*([\d,]+)/);
        if (pMatch) {
          var p = parseInt(pMatch[1].replace(/,/g, ''), 10);
          if (p > 0 && prices.indexOf(p) < 0) prices.push(p);
        }
      }
    }

    // Type detection from name + breadcrumb
    var type = detectType(productName, breadcrumb);

    // Target fish from breadcrumb
    var targetFish = detectTargetFish(productName, breadcrumb);

    // Length: use first (smallest) size as representative
    var length = lengths.length > 0 ? lengths[0] : null;

    // Price: use minimum price
    var price = prices.length > 0 ? Math.min.apply(null, prices) : 0;

    // Process colors: deduplicate and resolve relative URLs
    var seenColors = new Set<string>();
    var colors: ScrapedColor[] = [];
    for (var c = 0; c < data.colors.length; c++) {
      var colorData = data.colors[c];

      // Parse color text: "01.PWレッド・ヘッド" or "B101.イワシ" or "No.1 オーロラ・ブラック"
      var colorText = colorData.text;
      var colorName = colorText;

      // Try pattern: {code}.{name}
      var colorMatch = colorText.match(/^([A-Za-z0-9*]+)\.\s*(.+)$/);
      if (colorMatch) {
        colorName = colorMatch[2].trim();
      } else {
        // Try pattern: No.{num} {name}
        var noMatch = colorText.match(/^No\.\s*\d+\s+(.+)$/i);
        if (noMatch) {
          colorName = noMatch[1].trim();
        }
      }

      // Resolve image URL
      var imageUrl = colorData.imageUrl;
      if (imageUrl.startsWith('../')) {
        imageUrl = TH_BASE + '/' + imageUrl.replace(/^\.\.\//g, '');
      } else if (imageUrl.startsWith('/')) {
        imageUrl = TH_BASE + imageUrl;
      } else if (!imageUrl.startsWith('http')) {
        imageUrl = TH_BASE + '/productphoto/' + imageUrl;
      }

      // Deduplicate by color name
      if (seenColors.has(colorName)) continue;
      seenColors.add(colorName);

      if (imageUrl) {
        colors.push({
          name: colorName,
          imageUrl: imageUrl,
        });
      }
    }

    // Main image: resolve relative URL
    var mainImage = data.mainImage || '';
    if (mainImage.startsWith('../')) {
      mainImage = TH_BASE + '/' + mainImage.replace(/^\.\.\//g, '');
    } else if (mainImage.startsWith('/')) {
      mainImage = TH_BASE + mainImage;
    } else if (mainImage && !mainImage.startsWith('http')) {
      mainImage = TH_BASE + '/productphoto/' + mainImage;
    }
    if (!mainImage && colors.length > 0) {
      mainImage = colors[0].imageUrl;
    }

    var result: ScrapedLure = {
      name: productName,
      name_kana: '',
      slug: slug,
      manufacturer: 'Tackle House',
      manufacturer_slug: 'tacklehouse',
      type: type,
      target_fish: targetFish,
      description: data.description || '',
      price: price,
      colors: colors,
      weights: weights,
      length: length,
      mainImage: mainImage,
      sourceUrl: url,
    };

    log('Done: ' + productName + ' | type=' + type + ' | colors=' + colors.length + ' | weights=[' + weights.join(',') + '] | length=' + length + 'mm | price=' + price + ' | fish=' + targetFish.join(','));

    return result;
  } finally {
    await context.close();
  }
}
