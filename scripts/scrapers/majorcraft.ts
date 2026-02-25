// scripts/scrapers/majorcraft.ts
// Major Craft product page scraper
// Handles lure products from majorcraft.co.jp/lure/{slug}/
//
// Site: WordPress (twentytwentyone child theme), SSR HTML, no WAF, headless OK.
// Domain: www.majorcraft.co.jp
// Encoding: UTF-8
//
// SINGLE TEMPLATE — all product pages use the same layout:
//   - Product name: document.title → strip " – メジャークラフト｜Major Craft Web"
//   - Breadcrumb: not available as HTML — category derived from body class (postid-XXX)
//   - Main image: .js-products_sec__img_slider img (first image)
//   - Colors: li.lure-color_chart__color_list_item
//     - Name: figcaption.lure-color_chart__color_list_img_caption
//     - Image: .lure-color_chart__color_list_img_block_inner img (300x300 thumbnail)
//     - Dedup by name (same color in multiple size groups)
//   - Spec table: table inside .lure-spec or standalone
//     - Headers vary: SIZE/Weight/Type/Max Depth/Price etc.
//     - Price: "オープン価格" or "¥X,XXX（税込）" or "¥X,XXX(税込)"
//   - Size filters: .js-toggle_block_switch[data-size] — colors grouped by weight range
//
// Special cases:
//   - Password-protected pages: detect input[name="post_password"] → skip
//   - Some URLs use percent-encoded Japanese slugs
//   - Hook/blade/jig-head/rig products → still scrape (ジグヘッド, フック etc. are lure accessories)
//
// IMPORTANT: No arrow functions, no named function declarations inside page.evaluate().
//   Use var + function() syntax only.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name / description / URL category
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  // Product name-specific patterns (highest priority)
  [/ワーム|WORM|シャッドテール|ピンテール|グラブ|クロー|クリーチャー|ホッグ/i, 'ワーム'],
  [/エギ|EGIZO|餌木|SQUID/i, 'エギ'],
  [/タコ|OCTOPUS|TAKO|オクトパス/i, 'タコエギ'],
  [/テンヤ|TENYA|タイラバ|鯛ラバ/i, 'テンヤ'],
  [/バイブレーション|VIBRATION/i, 'バイブレーション'],
  [/メタルバイブ/i, 'メタルバイブ'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ダイビングペンシル|ダイペン/i, 'ダイビングペンシル'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW|ブレイクバック|BREAKBACK/i, 'ミノー'],
  [/ラバ|RUBA|RUBBER|ラバージグ|ナノラバ/i, 'ラバージグ'],
  [/ジグヘッド|JIG\s*HEAD|ヘッド.*ブンタ/i, 'ジグヘッド'],
  [/ブレードジグ|BLADE.*JIG|マキジグ/i, 'ブレードジグ'],
  [/メタルジグ|METAL.*JIG|ジグパラ|JIGPARA|JIG\s*PARA/i, 'メタルジグ'],
  [/ジグ(?!ヘッド|パラ)|JIG(?!HEAD|PARA)/i, 'メタルジグ'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/スピナーベイト|SPINNERBAIT/i, 'スピナーベイト'],
  [/フック|HOOK|ブレード|BLADE|アシスト/i, 'フック'],
  [/仕掛|サビキ|RIG|SABIKI/i, '仕掛'],
  [/スッテ|SUTTE/i, 'スッテ'],
  [/プラグ|PLUG/i, 'プラグ'],
];

function detectType(name: string, description: string, categoryUrl: string): string {
  var combined = name + ' ' + description.substring(0, 500) + ' ' + categoryUrl;
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(combined)) return entry[1];
  }
  return 'プラグ';
}

// ---------------------------------------------------------------------------
// Target fish detection from category URL / product name
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, description: string, categoryUrl: string): string[] {
  var combined = (name + ' ' + description + ' ' + categoryUrl).toLowerCase();

  if (/trout|トラウト|渓流/.test(combined)) return ['トラウト'];
  if (/タチウオ|太刀魚|scabbard/.test(combined)) return ['タチウオ'];
  if (/タコ|蛸|octopus/.test(combined)) return ['タコ'];
  if (/ロックフィッシュ|rock.?fish|根魚|カサゴ|ソイ|アイナメ/.test(combined)) return ['ロックフィッシュ'];
  if (/エギ|eging|squid|イカ|イカメタル|餌木/.test(combined)) return ['アオリイカ'];
  if (/black.?seabream|チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];
  if (/タイラバ|tai|鯛|マダイ|テンヤ/.test(combined)) return ['マダイ'];
  if (/バス|bass|fresh/.test(combined)) return ['ブラックバス'];
  if (/サーフ|surf|ヒラメ|マゴチ|フラット/.test(combined)) return ['ヒラメ', 'マゴチ'];
  if (/シーバス|sea.?bass/.test(combined)) return ['シーバス'];
  // アジ/メバル — only for explicit light game products
  if (/ライトゲーム|light.?game|鯵道|アジドー|adw|アジ.*ワーム|メバル/.test(combined)) return ['アジ', 'メバル'];
  if (/青物|ショアジギ|ジギング|ブリ|ヒラマサ/.test(combined)) return ['青物'];

  // Default: most Major Craft lures are saltwater shore jigging
  return ['青物', 'シーバス'];
}

// ---------------------------------------------------------------------------
// Slug extraction from URL
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  // URL: https://www.majorcraft.co.jp/lure/{slug}/
  var match = url.match(/\/lure\/([^/?]+)/);
  if (!match) return 'product';
  var raw = decodeURIComponent(match[1]);

  return raw
    .toLowerCase()
    .replace(/[^\w\s\-\u3000-\u9fff]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60) || 'product';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

var _browser: Browser | null = null;

export async function scrapeMajorcraftPage(url: string): Promise<ScrapedLure> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }

  var page = await _browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check for password-protected page
    var isPasswordProtected = await page.evaluate(function() {
      return !!document.querySelector('input[name="post_password"]');
    });
    if (isPasswordProtected) {
      throw new Error('Password-protected page: ' + url);
    }

    var data = await page.evaluate(function() {
      // ---------------------------------------------------------------
      // Product name from document.title
      // Format: "ジグパラ ショート – メジャークラフト｜Major Craft Web"
      // ---------------------------------------------------------------
      var name = '';
      var title = document.title || '';
      var dashIdx = title.indexOf(' – ');
      if (dashIdx > 0) {
        name = title.substring(0, dashIdx).trim();
      } else {
        name = title.replace(/\s*[–|]\s*メジャークラフト.*$/, '').trim();
      }

      // ---------------------------------------------------------------
      // Main image from slider
      // ---------------------------------------------------------------
      var mainImage = '';
      var sliderImgs = document.querySelectorAll('.js-products_sec__img_slider img');
      for (var si = 0; si < sliderImgs.length; si++) {
        var src = (sliderImgs[si] as HTMLImageElement).src || '';
        // Skip if it's a cloned slick slide (data-slick-index < 0)
        var slideParent = sliderImgs[si].closest('.slick-slide');
        if (slideParent) {
          var slickIdx = slideParent.getAttribute('data-slick-index');
          if (slickIdx && parseInt(slickIdx) < 0) continue;
        }
        if (src && src.indexOf('wp-content') > -1) {
          // Get the full-size version (remove -300x300 or -1024x1024)
          mainImage = src.replace(/-\d+x\d+(\.\w+)$/, '$1');
          break;
        }
      }

      // ---------------------------------------------------------------
      // Colors: li.lure-color_chart__color_list_item
      // Dedup by name (same color appears in multiple size filter groups)
      // ---------------------------------------------------------------
      var colors: { name: string; imageUrl: string }[] = [];
      var seenColors: Record<string, boolean> = {};

      var colorItems = document.querySelectorAll('li.lure-color_chart__color_list_item');
      for (var ci = 0; ci < colorItems.length; ci++) {
        var li = colorItems[ci];
        var captionEl = li.querySelector('figcaption');
        var imgEl = li.querySelector('.lure-color_chart__color_list_img_block_inner img') as HTMLImageElement | null;

        var colorName = captionEl ? captionEl.textContent.trim() : '';
        if (!colorName) continue;
        if (seenColors[colorName]) continue;
        seenColors[colorName] = true;

        var imgSrc = '';
        if (imgEl) {
          imgSrc = imgEl.src || '';
          // Get larger version: replace -300x300 with -1024x1024
          imgSrc = imgSrc.replace(/-300x300/, '-1024x1024');
        }

        colors.push({ name: colorName, imageUrl: imgSrc });
      }

      // ---------------------------------------------------------------
      // Spec table: weight, length, price
      // ---------------------------------------------------------------
      var weights: number[] = [];
      var length: number | null = null;
      var price = 0;
      var description = '';

      var tables = document.querySelectorAll('table');
      for (var ti = 0; ti < tables.length; ti++) {
        var tbl = tables[ti];
        var headers: string[] = [];
        var thEls = tbl.querySelectorAll('th');
        for (var thi = 0; thi < thEls.length; thi++) {
          headers.push((thEls[thi].textContent || '').trim().toLowerCase());
        }

        var dataRows = tbl.querySelectorAll('tr');
        for (var dr = 0; dr < dataRows.length; dr++) {
          var cells: string[] = [];
          var cellEls = dataRows[dr].querySelectorAll('td');
          for (var cdi = 0; cdi < cellEls.length; cdi++) {
            cells.push((cellEls[cdi].textContent || '').trim());
          }
          if (cells.length === 0) continue;

          // Try to match headers to cells
          for (var hi = 0; hi < headers.length && hi < cells.length; hi++) {
            var hdr = headers[hi];
            var val = cells[hi];

            // SIZE column — often contains weight: "20g", "30g", "40g" or "3.5号"
            if (/size|サイズ/.test(hdr)) {
              // Weight from size: "20g" pattern
              var sizeWeights = val.match(/([\d.]+)\s*g/gi);
              if (sizeWeights) {
                for (var swi = 0; swi < sizeWeights.length; swi++) {
                  var swMatch = sizeWeights[swi].match(/([\d.]+)/);
                  if (swMatch) {
                    var sw = parseFloat(swMatch[1]);
                    if (sw > 0 && weights.indexOf(sw) === -1) weights.push(sw);
                  }
                }
              }
              // Length from size: "120mm" pattern
              var sizeLen = val.match(/([\d.]+)\s*mm/);
              if (sizeLen && length === null) {
                length = parseFloat(sizeLen[1]);
              }
            }

            // Weight column
            if (/weight|重さ|重量|ウェイト/.test(hdr)) {
              var wm = val.match(/([\d.]+)\s*g/);
              if (wm) {
                var w = parseFloat(wm[1]);
                if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
              }
            }

            // Length column
            if (/length|全長|サイズ|レングス/.test(hdr) && !/weight|重/.test(hdr)) {
              var lm = val.match(/([\d.]+)\s*mm/);
              if (lm && length === null) {
                length = parseFloat(lm[1]);
              }
              var cm = val.match(/([\d.]+)\s*cm/);
              if (cm && length === null) {
                length = Math.round(parseFloat(cm[1]) * 10);
              }
            }

            // Price column
            if (/price|価格|希望.*小売|税込/.test(hdr)) {
              var priceMatches = val.match(/[¥￥]([\d,]+)/g);
              if (priceMatches) {
                // If "税込" present, take the tax-included price (usually the last one)
                if (val.indexOf('税込') > -1 && priceMatches.length >= 2) {
                  var pv = parseInt(priceMatches[priceMatches.length - 1].replace(/[¥￥,]/g, ''));
                  if (pv > price) price = pv;
                } else {
                  var pv2 = parseInt(priceMatches[0].replace(/[¥￥,]/g, ''));
                  if (val.indexOf('税込') > -1) {
                    if (pv2 > price) price = pv2;
                  } else if (pv2 > 0) {
                    // Tax-excluded → add 10%
                    if (Math.round(pv2 * 1.1) > price) price = Math.round(pv2 * 1.1);
                  }
                }
              }
            }
          }

          // Also check if row itself contains weight/size patterns (headerless rows)
          if (headers.length === 0 && cells.length > 0) {
            var rowText = cells.join(' ');
            var rwm = rowText.match(/([\d.]+)\s*g/g);
            if (rwm) {
              for (var rwi = 0; rwi < rwm.length; rwi++) {
                var rwMatch = rwm[rwi].match(/([\d.]+)/);
                if (rwMatch) {
                  var rw = parseFloat(rwMatch[1]);
                  if (rw > 0 && weights.indexOf(rw) === -1) weights.push(rw);
                }
              }
            }
          }
        }
      }

      // Size filter buttons can also give us weight info
      var sizeButtons = document.querySelectorAll('.js-toggle_block_switch[data-size]');
      for (var sbi = 0; sbi < sizeButtons.length; sbi++) {
        var sizeText = sizeButtons[sbi].textContent || '';
        var sizeWeightMatches = sizeText.match(/([\d.]+)\s*g/g);
        if (sizeWeightMatches) {
          for (var swmi = 0; swmi < sizeWeightMatches.length; swmi++) {
            var swmMatch = sizeWeightMatches[swmi].match(/([\d.]+)/);
            if (swmMatch) {
              var swmW = parseFloat(swmMatch[1]);
              if (swmW > 0 && weights.indexOf(swmW) === -1) weights.push(swmW);
            }
          }
        }
      }

      // Description from feature headings/text
      var h2h3 = document.querySelectorAll('h2, h3');
      var descParts: string[] = [];
      for (var di = 0; di < h2h3.length; di++) {
        var dt = (h2h3[di].textContent || '').trim();
        // Skip navigation headings (ROD, LURE, OTHER, SPEC, COLOR)
        if (dt.length > 8 && dt.length < 300 &&
            !/^(ROD|LURE|OTHER|SPEC|COLOR|ONLINE)$/i.test(dt)) {
          descParts.push(dt);
          if (descParts.length >= 3) break;
        }
      }
      description = descParts.join(' ').substring(0, 1000);

      // Category from body classes (WordPress taxonomy terms)
      var bodyClass = document.body.className || '';
      var categoryUrl = '';
      // Try to find lure_cate taxonomy links
      var catLinks = document.querySelectorAll('a[href*="lure_cate"]');
      for (var cli = 0; cli < catLinks.length; cli++) {
        var href = (catLinks[cli] as HTMLAnchorElement).href || '';
        if (href) {
          categoryUrl = href;
          break;
        }
      }
      // Fallback: extract from breadcrumb-like text
      if (!categoryUrl) {
        var bcEl = document.querySelector('.products__header_category, .breadcrumb');
        if (bcEl) categoryUrl = bcEl.textContent || '';
      }

      return {
        name: name,
        mainImage: mainImage,
        colors: colors,
        weights: weights,
        length: length,
        price: price,
        description: description,
        categoryUrl: categoryUrl,
        url: window.location.href
      };
    });

    // ---------------------------------------------------------------
    // Post-processing
    // ---------------------------------------------------------------

    // Detect type from name + description + category
    var type = detectType(data.name, data.description, data.categoryUrl);

    // Detect target fish
    var targetFish = detectTargetFish(data.name, data.description, data.categoryUrl);

    // Extract slug from URL
    var slug = extractSlug(url);

    // Sort weights
    data.weights.sort(function(a: number, b: number) { return a - b; });

    var result: ScrapedLure = {
      name: data.name || 'Unknown Product',
      name_kana: '',
      slug: slug,
      manufacturer: 'Major Craft',
      manufacturer_slug: 'majorcraft',
      type: type,
      target_fish: targetFish,
      description: data.description,
      price: data.price,
      colors: data.colors,
      weights: data.weights,
      length: data.length,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    return result;
  } finally {
    await page.close();
  }
}
