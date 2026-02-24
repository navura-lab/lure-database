// scripts/scrapers/valleyhill.ts
// ValleyHill product page scraper
// Handles lure products from valleyhill1.jp/{numeric-id}
//
// Site: WordPress + Welcart (usc-e-shop), SSR HTML, no WAF, headless OK.
// Domain: valleyhill1.jp (NOT valleyhill.co.jp which is a different company)
// Encoding: UTF-8
//
// TWO TEMPLATES:
//   A) WordPress template (majority):
//      - Product name: meta[property="og:title"] → strip " - https://..." suffix
//      - Main image: img[src*='main400X1000']
//      - Colors: .lc-item a.fancybox → href = color image
//      - Color names: .hentry.jan table → first td (or color column for No./color layout)
//      - Specs: visible tables in .lure-spec (NOT inside .fancybox-hidden)
//        - Dynamic headers: length/weight/price/size(号)/length(inch) etc
//        - Price format: "¥X,XXX\n（税込 ¥Y,YYY）"
//      - Multiple weight rows possible (e.g., squid jigs with 15号/20号/25号/30号)
//
//   B) Static HTML template (shoregame / ohno series):
//      - Product name: og:title (same pattern)
//      - Colors: a.fancybox with title="XX：カラー名" in .listitem
//      - Specs: inline text "weight：XXg　length：XXXmm　price：￥X,XXX（税込）"
//      - Main image: first fancybox image or content image
//
// Brand: ValleyHill (main) + KAMIWAZA (sub-brand, same domain)
// Price: Tax-included (税込) from spec table or inline text
//
// IMPORTANT: No arrow functions, no named function declarations inside page.evaluate().
//   Use var + function() syntax only.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name / description
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/エギ|SQUID SEEKER|Squid Seeker|イカメタル|IKA|エギング|EGGING/i, 'エギ'],
  [/タコ|オクトパス|OCTOPUS|TAKO|タコエギ/i, 'タコエギ'],
  [/テンヤ|TENYA|タイラバ|鯛ラバ|TIP RUN|ティップラン/i, 'テンヤ'],
  [/バイブレーション|VIBRATION|鉄板バイブ/i, 'バイブレーション'],
  [/メタルバイブ/i, 'メタルバイブ'],
  [/ポッパー|POPPER|DECOPOP/i, 'ポッパー'],
  [/ダイビングペンシル|ダイペン|DIVING PENCIL/i, 'ダイビングペンシル'],
  [/シンキングペンシル|シンペン|SINKING PENCIL/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/メタルジグ|METAL JIG|ジグ(?!ヘッド)|JIG(?!HEAD)/i, 'メタルジグ'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ワーム|WORM|シャッドテール|ピンテール|グラブ|クロー|クリーチャー|ホッグ|エビ|TORPEDO|TANK/i, 'ワーム'],
  [/トップウォーター|TOPWATER|スイッシャー/i, 'トップウォーター'],
  [/ジグヘッド|JIG HEAD/i, 'ジグヘッド'],
  [/スピナーベイト|SPINNERBAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZBAIT/i, 'バズベイト'],
  [/フロッグ|FROG/i, 'フロッグ'],
  [/チャターベイト|CHATTER/i, 'チャターベイト'],
  [/ブレード|BLADE/i, 'スピンテール'],
  [/スッテ|SUTTE/i, 'スッテ'],
  [/インチク|INCHIKU/i, 'インチク'],
  [/球|ダマ|dama/i, 'テンヤ'],
];

function detectType(name: string, description: string): string {
  var combined = name + ' ' + description.substring(0, 500);
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(combined)) return entry[1];
  }
  return 'プラグ';
}

// ---------------------------------------------------------------------------
// Target fish detection from category URL / product name
// ---------------------------------------------------------------------------

function detectTargetFish(categoryUrl: string, name: string, description: string): string[] {
  var combined = (categoryUrl + ' ' + name + ' ' + description).toLowerCase();

  // Freshwater
  if (/fresh-water|fw-|ブラックバス|ギガノト|giganoto/.test(combined)) {
    if (/バス|bass/.test(combined)) return ['ブラックバス'];
    return ['ブラックバス'];
  }
  if (/catfish|ナマズ|なまず/.test(combined)) return ['ナマズ'];
  if (/snakehead|雷魚|ライギョ/.test(combined)) return ['ライギョ'];

  // Saltwater specific
  if (/tachiuo|タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
  if (/tako|タコ|蛸|オクトパス/.test(combined)) return ['タコ'];
  if (/ajing|アジ/.test(combined)) return ['アジ'];
  if (/rock-fish|ロックフィッシュ|アイナメ|ソイ|カサゴ|根魚/.test(combined)) return ['ロックフィッシュ'];
  if (/eging|エギング/.test(combined)) return ['アオリイカ'];
  if (/ika-metal|イカメタル|スクイッドシーカー|squid seeker/.test(combined)) return ['イカ'];
  if (/flatfish|フラット|ヒラメ|マゴチ/.test(combined)) return ['ヒラメ', 'マゴチ'];
  if (/tai|鯛|タイラバ|マダイ|tiprun|ティップラン/.test(combined)) return ['マダイ'];
  if (/jigging|ジギング|青物|ブリ|ヒラマサ|カンパチ/.test(combined)) return ['青物'];
  if (/shoregame|ショアゲーム|シーバス|seabass/.test(combined)) return ['シーバス'];

  // KAMIWAZA is mostly shore saltwater
  if (/kamiwaza/i.test(combined)) return ['シーバス', '青物'];

  return ['シーバス'];
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function generateSlug(name: string): string {
  // Remove bracket content e.g. "ORUTANA 150［オルタナ］" → "ORUTANA 150"
  var cleaned = name.replace(/[［\[][^\]］]*[］\]]/g, '').trim();
  // Also remove leading/trailing brackets
  cleaned = cleaned.replace(/^[［\[]+/, '').replace(/[］\]]+$/, '').trim();

  // Extract English name part if exists
  var englishMatch = cleaned.match(/^([A-Za-z0-9\s\-_.&'+]+)/);
  var slug = '';

  if (englishMatch && englishMatch[1].trim().length > 2) {
    slug = englishMatch[1].trim();
  } else {
    // For Japanese-only names, romanize common patterns
    var romanMap: Record<string, string> = {
      '蛸家': 'takoya', '大二郎': 'daijiro', '小四郎': 'koshiro',
      '鉄板': 'teppan', '太刀': 'tachi', '球': 'tama',
      '斬': 'zan', '鋏': 'hasami',
    };
    var romanized = cleaned;
    Object.keys(romanMap).forEach(function(k) {
      romanized = romanized.replace(new RegExp(k, 'g'), romanMap[k]);
    });
    slug = romanized;
  }

  return slug
    .toLowerCase()
    .replace(/[^\w\s\-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60) || 'product';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

var _browser: Browser | null = null;

export async function scrapeValleyhillPage(url: string): Promise<ScrapedLure> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }

  var page = await _browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    var data = await page.evaluate(function() {
      // ---------------------------------------------------------------
      // Detect template type
      // ---------------------------------------------------------------
      var hasLureSpec = document.querySelector('.lure-spec') !== null;
      var hasJanTable = document.querySelector('.hentry.jan') !== null;
      var isWPTemplate = hasLureSpec || hasJanTable;

      // ---------------------------------------------------------------
      // Product name extraction (priority order):
      // 1. og:title (WP template): "商品名 - https://valleyhill1.jp/ ..."
      // 2. document.title (static template): "グラバー Hi 68S"
      // 3. Logo image filename: "*_rogo.png" → product slug
      // 4. First meaningful h2
      // ---------------------------------------------------------------
      var name = '';

      // Try og:title first (WP template)
      var ogTitleEl = document.querySelector('meta[property="og:title"]');
      if (ogTitleEl) {
        var ogTitle = ogTitleEl.getAttribute('content') || '';
        // Strip everything after " - https://" or " - http://"
        var dashIdx = ogTitle.indexOf(' - http');
        if (dashIdx > 0) {
          name = ogTitle.substring(0, dashIdx).trim();
        } else {
          var parts = ogTitle.split(' - ');
          if (parts.length > 1) {
            name = parts[0].trim();
          }
        }
      }

      // Fallback: document.title (static HTML template has good titles)
      if (!name || name.length < 2) {
        var docTitle = document.title.trim();
        // Static template titles are short and useful (e.g., "グラバー Hi 68S")
        // WP template titles are the long site description → skip those
        if (docTitle.length > 2 && docTitle.length < 80 && docTitle.indexOf('バレーヒルの公式') === -1) {
          name = docTitle;
        }
      }

      // Fallback: logo image filename
      if (!name || name.length < 2) {
        var imgs = document.querySelectorAll('img');
        for (var ii = 0; ii < imgs.length; ii++) {
          var imgSrc = (imgs[ii] as HTMLImageElement).src || '';
          if (imgSrc.indexOf('_rogo') > -1) {
            var fn = imgSrc.match(/\/([^/]+?)_rogo/);
            if (fn) {
              name = fn[1].replace(/_/g, ' ').replace(/-/g, ' ');
              break;
            }
          }
        }
      }

      // Last resort: first meaningful h2
      if (!name || name.length < 2) {
        var h2List = document.querySelectorAll('h2');
        for (var hh = 0; hh < h2List.length; hh++) {
          var h2text = (h2List[hh].textContent || '').trim();
          if (h2text.length > 2 && h2text.length < 100) {
            name = h2text;
            break;
          }
        }
      }

      // Clean: if name is entirely wrapped in brackets like ［ワーム球］ → ワーム球
      // But keep brackets in the middle like "ORUTANA 150［オルタナ］"
      if (name.match(/^[［\[]/)) {
        name = name.replace(/^[［\[]+/, '').replace(/[］\]]+$/, '');
      }

      name = name.replace(/\s+/g, ' ').trim();

      // ---------------------------------------------------------------
      // Main image
      // ---------------------------------------------------------------
      var mainImage = '';
      var allImgs2 = document.querySelectorAll('img');
      for (var mi = 0; mi < allImgs2.length; mi++) {
        var miSrc = (allImgs2[mi] as HTMLImageElement).src || '';
        if (miSrc.indexOf('main400X1000') > -1) {
          mainImage = miSrc;
          break;
        }
      }

      // Fallback: first fancybox image
      if (!mainImage) {
        var fbImgs = document.querySelectorAll('a.fancybox');
        if (fbImgs.length > 0) {
          mainImage = (fbImgs[0] as HTMLAnchorElement).href || '';
        }
      }

      // ---------------------------------------------------------------
      // Colors extraction
      // ---------------------------------------------------------------
      var colors: { name: string; imageUrl: string }[] = [];

      if (isWPTemplate) {
        // WP template: color images from .lc-item a.fancybox
        var lcImages: string[] = [];
        document.querySelectorAll('.lc-item a.fancybox').forEach(function(el) {
          lcImages.push((el as HTMLAnchorElement).href || '');
        });

        // Color names from .hentry.jan table
        var janNames: string[] = [];
        var janTbl = document.querySelector('.hentry.jan table');
        if (janTbl) {
          // Detect table format: check headers
          var janHeaders: string[] = [];
          janTbl.querySelectorAll('th').forEach(function(th) {
            janHeaders.push((th.textContent || '').trim().toLowerCase());
          });

          // Determine which column has color name
          var colorColIdx = 0; // default: first td
          var hasNoColumn = false;
          for (var jhi = 0; jhi < janHeaders.length; jhi++) {
            if (janHeaders[jhi] === 'no.' || janHeaders[jhi] === 'no') {
              hasNoColumn = true;
            }
            if (janHeaders[jhi] === 'color' || janHeaders[jhi] === 'カラー') {
              colorColIdx = jhi;
            }
          }

          // If has No. column but no explicit color column, color is in column after No.
          if (hasNoColumn && colorColIdx === 0) {
            colorColIdx = 1; // color is the second column
          }

          // If headers are ["商品名", "JAN..."], color is in first column (idx 0)
          // This is the most common pattern

          var janRows = janTbl.querySelectorAll('tr');
          for (var jr = 1; jr < janRows.length; jr++) {
            var tds = janRows[jr].querySelectorAll('td');
            if (tds.length > colorColIdx) {
              var colorName = (tds[colorColIdx].textContent || '').trim();
              // Remove "NEW\n" prefix
              colorName = colorName.replace(/^NEW\s*/i, '').trim();

              // If No. column exists and color column is separate, combine them
              if (hasNoColumn && colorColIdx > 0) {
                var noText = (tds[0].textContent || '').trim();
                colorName = noText + ' ' + colorName;
              }

              janNames.push(colorName);
            } else if (tds.length > 0) {
              // Fallback: first column
              var cn = (tds[0].textContent || '').trim().replace(/^NEW\s*/i, '').trim();
              janNames.push(cn);
            }
          }
        }

        // Match images to names
        // When JAN table has FEWER names than lc-item images,
        // TERI BULL case: JAN has 9 names but lc-item has 18 images
        // This happens when JAN table only lists a SUBSET of colors.
        // In this case, use lc-item count as truth and name extras from filenames.
        if (lcImages.length > 0 && janNames.length > 0) {
          var useCount = lcImages.length; // images are the truth for total color count
          for (var ci = 0; ci < useCount; ci++) {
            var cname = '';
            if (ci < janNames.length) {
              cname = janNames[ci];
            } else {
              // Try to get name from image filename (JAN code based)
              var imgUrl = ci < lcImages.length ? lcImages[ci] : '';
              var fnMatch = imgUrl.match(/\/([^/]+)\.\w+$/);
              if (fnMatch) {
                cname = fnMatch[1].replace(/_/g, ' ').replace(/-/g, ' ');
              } else {
                cname = 'カラー' + (ci + 1);
              }
            }
            colors.push({
              name: cname,
              imageUrl: ci < lcImages.length ? lcImages[ci] : ''
            });
          }
          // Also add any extra JAN names without images (rare but possible)
          for (var ci4 = lcImages.length; ci4 < janNames.length; ci4++) {
            colors.push({ name: janNames[ci4], imageUrl: '' });
          }
        } else if (lcImages.length > 0) {
          for (var ci2 = 0; ci2 < lcImages.length; ci2++) {
            var fnm = lcImages[ci2].match(/\/([^/]+)\.\w+$/);
            colors.push({
              name: fnm ? fnm[1].replace(/_/g, ' ') : ('カラー' + (ci2 + 1)),
              imageUrl: lcImages[ci2]
            });
          }
        } else if (janNames.length > 0) {
          for (var ci3 = 0; ci3 < janNames.length; ci3++) {
            colors.push({ name: janNames[ci3], imageUrl: '' });
          }
        }
      } else {
        // Static template: colors from a.fancybox with title in .listitem
        document.querySelectorAll('.listitem a.fancybox').forEach(function(el) {
          var a = el as HTMLAnchorElement;
          var title = a.getAttribute('title') || '';
          if (title) {
            // Format: "XX：カラー名" or "XX-X：カラー名"
            var colorName = title.replace(/^[\w\-]+[\s：:]+/, '').trim();
            if (!colorName) colorName = title;
            colors.push({
              name: colorName,
              imageUrl: a.href || ''
            });
          }
        });

        // If no listitem, try all fancybox with title
        if (colors.length === 0) {
          document.querySelectorAll('a.fancybox[title]').forEach(function(el) {
            var a = el as HTMLAnchorElement;
            var title = a.getAttribute('title') || '';
            if (title && title.length > 1) {
              var colorName = title.replace(/^[\w\-]+[\s：:]+/, '').trim();
              if (!colorName) colorName = title;
              colors.push({
                name: colorName,
                imageUrl: a.href || ''
              });
            }
          });
        }
      }

      // ---------------------------------------------------------------
      // Specs: weight, length, price
      // ---------------------------------------------------------------
      var weights: number[] = [];
      var length: number | null = null;
      var price = 0;
      var description = '';

      if (isWPTemplate) {
        // Find visible spec tables (not inside .fancybox-hidden)
        var lureSpecEl = document.querySelector('.lure-spec');
        if (lureSpecEl) {
          var allTables = lureSpecEl.querySelectorAll('table');
          for (var ti = 0; ti < allTables.length; ti++) {
            var tbl = allTables[ti];

            // Check if this table is inside a hidden fancybox div
            var isHidden = false;
            var parent = tbl.parentElement;
            while (parent && parent !== lureSpecEl) {
              if (parent.style && parent.style.display === 'none') { isHidden = true; break; }
              if (parent.className && parent.className.indexOf('fancybox-hidden') > -1) { isHidden = true; break; }
              if (parent.className && parent.className.indexOf('hentry') > -1) { isHidden = true; break; }
              parent = parent.parentElement;
            }
            if (isHidden) continue;

            // Parse this visible spec table
            var headers: string[] = [];
            tbl.querySelectorAll('th').forEach(function(th) {
              headers.push((th.textContent || '').trim().toLowerCase());
            });

            // Skip if headers look like JAN table (商品名, jan, no., color)
            var isJanLike = headers.some(function(h) {
              return h.indexOf('jan') > -1 || h === '商品名' || h === 'no.';
            });
            if (isJanLike) continue;

            var dataRows = tbl.querySelectorAll('tr');
            for (var dr = 1; dr < dataRows.length; dr++) {
              var cells: string[] = [];
              dataRows[dr].querySelectorAll('td').forEach(function(td) {
                cells.push((td.textContent || '').trim());
              });

              for (var hi = 0; hi < headers.length && hi < cells.length; hi++) {
                var hdr = headers[hi];
                var val = cells[hi];

                // Weight (various header patterns)
                if (/weight|重さ|重量|naked weight/.test(hdr)) {
                  // Extract grams: "30g", "56g class", "100g"
                  var wm = val.match(/([\d.]+)\s*g/);
                  if (wm) {
                    var w = parseFloat(wm[1]);
                    if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
                  }
                }

                // Size in 号 (for squid jigs etc)
                if (/size|サイズ/.test(hdr) && /号/.test(hdr)) {
                  // Size column might have just a number (e.g., "15")
                  var goNum = parseFloat(val);
                  if (goNum > 0) {
                    // Don't convert to grams, just store as-is if we have weight column too
                  }
                }

                // Length
                if (/length|長さ|全長/.test(hdr) && length === null) {
                  // Check for inch
                  if (/inch/.test(hdr)) {
                    var inchVal = parseFloat(val);
                    if (inchVal > 0) length = Math.round(inchVal * 25.4);
                  } else {
                    var lm = val.match(/([\d.]+)\s*mm/);
                    if (lm) length = parseFloat(lm[1]);
                    var cm = val.match(/([\d.]+)\s*cm/);
                    if (cm && length === null) length = Math.round(parseFloat(cm[1]) * 10);
                    // Plain number might be mm
                    if (length === null) {
                      var plainNum = parseFloat(val);
                      if (plainNum > 10 && plainNum < 1000) length = plainNum;
                    }
                  }
                }

                // Price (tax-included)
                if (/price|価格/.test(hdr)) {
                  // Pattern: "¥2,000\n（税込 ¥2,200）" or "¥2,000\n(税込 ¥2,200)"
                  var allPrices = val.match(/[¥￥]([\d,]+)/g);
                  if (allPrices && allPrices.length >= 2 && val.indexOf('税込') > -1) {
                    // Last price is tax-included
                    var taxInclPrice = parseInt(allPrices[allPrices.length - 1].replace(/[¥￥,]/g, ''));
                    if (taxInclPrice > price) price = taxInclPrice;
                  } else if (allPrices && allPrices.length === 1) {
                    var singlePrice = parseInt(allPrices[0].replace(/[¥￥,]/g, ''));
                    if (val.indexOf('税込') > -1) {
                      if (singlePrice > price) price = singlePrice;
                    } else {
                      // Tax-excluded: multiply by 1.1
                      if (singlePrice > price) price = Math.round(singlePrice * 1.1);
                    }
                  }
                }
              }
            }
          }
        }

        // Description from h2 elements (feature text)
        var h2s = document.querySelectorAll('h2, h3');
        var descParts: string[] = [];
        for (var di = 0; di < h2s.length; di++) {
          var dt = (h2s[di].textContent || '').trim();
          if (dt.length > 5 && dt.length < 300 && dt !== '製品SPEC') {
            descParts.push(dt);
          }
        }
        description = descParts.join(' ').substring(0, 1000);

      } else {
        // Static template: parse inline spec text
        var bodyText = document.body.innerText || '';

        // Weight: "weight：11g" or similar
        var specLine = bodyText.match(/weight[：:]\s*([\d.]+)\s*g/i);
        if (specLine) {
          var sw = parseFloat(specLine[1]);
          if (sw > 0) weights.push(sw);
        }

        // Length: "length：68mm"
        var lengthLine = bodyText.match(/length[：:]\s*([\d.]+)\s*mm/i);
        if (lengthLine) {
          length = parseFloat(lengthLine[1]);
        }

        // Price: "price：￥2,178（税込）" or "￥2,178（税込）"
        var priceLine = bodyText.match(/[¥￥]([\d,]+)\s*（税込）/);
        if (priceLine) {
          price = parseInt(priceLine[1].replace(/,/g, ''));
        }

        // Description from body text
        var lines = bodyText.split('\n');
        var descLines: string[] = [];
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (line.length > 10 && line.length < 300 && descLines.length < 5) {
            descLines.push(line);
          }
        }
        description = descLines.join(' ').substring(0, 1000);
      }

      return {
        name: name,
        mainImage: mainImage,
        colors: colors,
        weights: weights,
        length: length,
        price: price,
        description: description,
        isWPTemplate: isWPTemplate,
        url: window.location.href
      };
    });

    // ---------------------------------------------------------------
    // Post-processing
    // ---------------------------------------------------------------

    // Ensure absolute URLs
    var baseUrl = 'https://valleyhill1.jp';
    if (data.mainImage && !data.mainImage.startsWith('http')) {
      data.mainImage = baseUrl + (data.mainImage.startsWith('/') ? '' : '/') + data.mainImage;
    }

    for (var c of data.colors) {
      if (c.imageUrl && !c.imageUrl.startsWith('http')) {
        c.imageUrl = baseUrl + (c.imageUrl.startsWith('/') ? '' : '/') + c.imageUrl;
      }
    }

    // Detect type from name + description
    var type = detectType(data.name, data.description);

    // Detect target fish from URL + name
    var targetFish = detectTargetFish(url, data.name, data.description);

    // Generate slug
    var slug = generateSlug(data.name);

    // Generate name_kana (leave empty — pipeline handles this)
    var name_kana = '';

    var result: ScrapedLure = {
      name: data.name || 'Unknown Product',
      name_kana: name_kana,
      slug: slug,
      manufacturer: 'ValleyHill',
      manufacturer_slug: 'valleyhill',
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
