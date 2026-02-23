// scripts/scrapers/rapala.ts
// Rapala Japan product page scraper
// Handles lure products from rapala.co.jp across multiple brands:
//   - Rapala   (/cn4/cn5/)
//   - Storm    (/cn6/cn26/)
//   - Blue Fox (/cn7/)
//   - Luhr-Jensen (/cn9/cn17/)
//   - North Craft (/cn10/)
//
// Site: BiND CMS v17 (static HTML), nginx, XSERVER hosting.
// Encoding: UTF-8
// Price: tax-included (税込) from rapala-e-shop.com links in spec table.
//        If no e-shop link → price = 0.
//
// IMPORTANT: No function declarations/expressions inside page.evaluate().
//   tsx + astro tsconfig injects __name which breaks browser-context eval.
//   All helpers must be inlined.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/POPPER/i, 'ポッパー'],
  [/PENCIL|SKITTER/i, 'ペンシルベイト'],
  [/PROP/i, 'プロップベイト'],
  [/RATTLIN|RIPPIN|CLACKIN/i, 'バイブレーション'],
  [/CRANK|DT|DIVES[\s-]?TO|SCATTER|CLACKIN.*CRANK/i, 'クランクベイト'],
  [/SHAD|JIGGING/i, 'シャッド'],
  [/MINNOW|HUSKY|X[\s-]?RAP|COUNTDOWN|ORIGINAL|ULTRA[\s-]?LIGHT|SHADOW[\s-]?RAP|RIPSTOP|FLAT[\s-]?RAP|MAGNUM|BX[\s-]?MINNOW|JOINTED|TAIL[\s-]?DANCER|MAX[\s-]?RAP|SNAP[\s-]?RAP/i, 'ミノー'],
  [/SPINNER|VIBRAX|MORESILDA/i, 'スピナー'],
  [/SPOON|SLIPPER|WOBBLER/i, 'スプーン'],
  [/GLIDE[\s-]?BAIT|ARASHI[\s-]?GLIDE/i, 'スイムベイト'],
  [/SWIM[\s-]?BAIT|STORM[\s-]?360/i, 'スイムベイト'],
  [/JIG|JIGG[\s-]?RAP/i, 'メタルジグ'],
  [/FROG/i, 'フロッグ'],
  [/DODGER|FLASHER/i, 'ドジャー'],
  [/CHATTER/i, 'チャターベイト'],
  [/BUZZ/i, 'バズベイト'],
  [/WORM|GRUB|SOFT|TUBE/i, 'ワーム'],
  [/SQUID/i, 'エギ'],
  [/CRAWLER/i, 'クローラーベイト'],
  [/BLADE/i, 'メタルバイブ'],
];

function detectType(name: string): string {
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(name)) return entry[1];
  }
  return 'その他';
}

// ---------------------------------------------------------------------------
// Brand detection and target_fish
// ---------------------------------------------------------------------------

function detectBrand(url: string): string {
  if (url.includes('/cn9/')) return 'luhr-jensen';
  if (url.includes('/cn10/')) return 'north-craft';
  if (url.includes('/cn7/')) return 'blue-fox';
  if (url.includes('/cn6/')) return 'storm';
  return 'rapala';
}

function detectTargetFish(name: string, brand: string): string[] {
  var nameUp = name.toUpperCase();
  if (/TROUT|トラウト|MASU|マス|IWANA|イワナ|YAMAME|ヤマメ|ULTRA[\s-]?LIGHT/i.test(nameUp)) {
    return ['トラウト'];
  }
  if (/BASS|バス|LARGEMOUTH|SMALLMOUTH/i.test(nameUp)) {
    return ['ブラックバス'];
  }
  if (/SEA[\s-]?BASS|シーバス|SALTWATER|ソルト|SHORE|COASTAL|BISCAY/i.test(nameUp)) {
    return ['シーバス'];
  }
  if (/SALMON|サーモン|STEELHEAD/i.test(nameUp)) {
    return ['トラウト', 'サーモン'];
  }
  switch (brand) {
    case 'luhr-jensen': return ['トラウト', 'サーモン'];
    case 'blue-fox': return ['トラウト'];
    case 'storm': return ['ブラックバス'];
    case 'north-craft': return ['ブラックバス'];
    default: return ['シーバス', 'トラウト'];
  }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function generateSlug(url: string): string {
  var match = url.match(/\/([^/]+)\.html$/);
  if (!match) return 'unknown';
  var code = match[1].toLowerCase();
  var brand = detectBrand(url);
  switch (brand) {
    case 'storm': return 'storm-' + code;
    case 'blue-fox': return 'bluefox-' + code;
    case 'luhr-jensen': return 'luhrjensen-' + code;
    case 'north-craft': return 'northcraft-' + code;
    default: return 'rapala-' + code;
  }
}

// ---------------------------------------------------------------------------
// Price fetching from e-shop
// ---------------------------------------------------------------------------

async function fetchEshopPrice(eshopUrl: string): Promise<number> {
  // rapala-e-shop.com (STORES) has Cloudflare protection that blocks headless browsers.
  // Must use headed browser with real User-Agent.
  var eshopBrowser = await chromium.launch({ headless: false });
  var context = await eshopBrowser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  var epage = await context.newPage();
  try {
    await epage.goto(eshopUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await epage.waitForTimeout(3000);

    var price = await epage.evaluate(function () {
      // No function declarations inside evaluate (tsx __name issue)
      var priceEl = document.querySelector('.item_price, [class*="item-price"]');
      if (priceEl) {
        var text = (priceEl.textContent || '').replace(/[,，]/g, '');
        var m = text.match(/(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
      // variant prices — get the minimum
      var minPrice = 0;
      var variants = document.querySelectorAll('[class*="result_item"] [class*="price"], .item_variation_price');
      for (var i = 0; i < variants.length; i++) {
        var vText = (variants[i].textContent || '').replace(/[,，]/g, '');
        var vMatch = vText.match(/(\d+)/);
        if (vMatch) {
          var val = parseInt(vMatch[1], 10);
          if (minPrice === 0 || val < minPrice) minPrice = val;
        }
      }
      return minPrice;
    });

    return price;
  } catch {
    return 0;
  } finally {
    await epage.close();
    await context.close();
    await eshopBrowser.close();
  }
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeRapalaPage(url: string): Promise<ScrapedLure> {
  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext();
    var page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // --- Extract all data via page.evaluate ---
    // IMPORTANT: NO function declarations/expressions inside this evaluate.
    //   tsx injects __name into any function, which breaks browser eval context.
    //   All text trimming is done inline: (s || '').replace(/[\s\u3000]+/g, ' ').trim()
    //   URL resolution: new URL(src, base).href
    var data = await page.evaluate(function () {
      var baseUrl = window.location.href;
      var result = {
        title: '',
        nameEn: '',
        nameJp: '',
        catchcopy: '',
        description: '',
        mainImage: '',
        weights: [] as number[],
        lengths: [] as number[],
        typeHint: '',
        colors: [] as Array<{ name: string; imageUrl: string }>,
        eshopUrls: [] as string[],
      };

      // ---- Title ----
      result.title = document.title || '';

      // ---- Find the PC description block (is-sp-hide) ----
      var spHideBlocks = document.querySelectorAll('div.b-plain.is-sp-hide');

      for (var bi = 0; bi < spHideBlocks.length; bi++) {
        var block = spHideBlocks[bi] as HTMLElement;
        var col = block.querySelector('.column.-column1, .column') as HTMLElement;
        if (!col) continue;

        var children = col.children;
        var foundName = false;

        for (var ci = 0; ci < children.length; ci++) {
          var child = children[ci] as HTMLElement;
          var tag = child.tagName;

          // Product name (H2 with text span) or Hero image (H2 with img)
          if (tag === 'H2') {
            var span = child.querySelector('span');
            if (span && !foundName) {
              var spanText = (span.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
              if (spanText) {
                result.nameEn = spanText;
                foundName = true;
                continue;
              }
            }
            // Hero image (H2 with img, typically no text span, or empty span)
            if (!result.mainImage) {
              var heroImg = child.querySelector('picture img, div.c-img img');
              if (heroImg) {
                var heroSrc = (heroImg as HTMLImageElement).src || heroImg.getAttribute('src') || '';
                if (heroSrc && heroSrc.indexOf('thumbnail') === -1) {
                  try { result.mainImage = heroSrc.startsWith('http') ? heroSrc : new URL(heroSrc, baseUrl).href; } catch (e) { result.mainImage = heroSrc; }
                }
              }
            }
          }

          // Japanese name / material+type (c-body c-center)
          if (child.classList.contains('c-body') && child.classList.contains('c-center')) {
            var bodySpan = child.querySelector('span');
            var bodyText = (bodySpan ? bodySpan.textContent || '' : child.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (bodyText) {
              if (!result.nameJp) {
                result.nameJp = bodyText;
              } else if (!result.typeHint) {
                result.typeHint = bodyText;
              }
            }
          }

          // Catchcopy (h4.c-small_headline.c-center)
          if (tag === 'H4' && child.classList.contains('c-small_headline')) {
            var h4Span = child.querySelector('span');
            if (h4Span) {
              result.catchcopy = (h4Span.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            }
          }

          // Description (c-body c-left)
          if (child.classList.contains('c-body') && child.classList.contains('c-left')) {
            var descSpan = child.querySelector('span');
            var descText = (descSpan ? descSpan.textContent || '' : child.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (descText && descText.length > 5) {
              if (result.description) result.description += '\n';
              result.description += descText;
            }
          }
        }

        // ---- Spec table in this block ----
        var tables = block.querySelectorAll('table');
        for (var ti = 0; ti < tables.length; ti++) {
          var tbl = tables[ti];
          var rows = tbl.querySelectorAll('tr');
          if (rows.length < 2) continue;

          // Parse header row to find column indices
          var headerCells = rows[0].querySelectorAll('td');
          var lengthCol = -1;
          var weightCol = -1;
          for (var hi = 0; hi < headerCells.length; hi++) {
            var ht = (headerCells[hi].textContent || '').replace(/[\s\u3000]+/g, ' ').trim().toUpperCase();
            if (ht.indexOf('BODY LENGTH') >= 0 || ht.indexOf('SIZE') >= 0 || ht === 'LENGTH') {
              lengthCol = hi;
            } else if (ht.indexOf('WEIGHT') >= 0) {
              weightCol = hi;
            }
          }

          // Parse data rows
          for (var ri = 1; ri < rows.length; ri++) {
            var cells = rows[ri].querySelectorAll('td');

            // Weight
            if (weightCol >= 0 && cells[weightCol]) {
              var wText = (cells[weightCol].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
              var wMatches = wText.match(/([\d.]+)\s*g/gi);
              if (wMatches) {
                for (var wi = 0; wi < wMatches.length; wi++) {
                  var wVal = parseFloat(wMatches[wi]);
                  if (!isNaN(wVal) && wVal > 0 && result.weights.indexOf(wVal) === -1) {
                    result.weights.push(wVal);
                  }
                }
              }
              if (!wMatches || wMatches.length === 0) {
                var ozMatch = wText.match(/([\d.]+)\s*oz/i);
                if (ozMatch) {
                  var gVal = Math.round(parseFloat(ozMatch[1]) * 28.3495 * 10) / 10;
                  if (!isNaN(gVal) && gVal > 0 && result.weights.indexOf(gVal) === -1) {
                    result.weights.push(gVal);
                  }
                }
              }
            }

            // Length
            if (lengthCol >= 0 && cells[lengthCol]) {
              var lText = (cells[lengthCol].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
              var cmMatch = lText.match(/([\d.]+)\s*cm/i);
              if (cmMatch) {
                var cmVal = parseFloat(cmMatch[1]) * 10;
                if (!isNaN(cmVal) && cmVal > 0 && result.lengths.indexOf(cmVal) === -1) {
                  result.lengths.push(cmVal);
                }
              }
              var mmMatch = lText.match(/([\d.]+)\s*mm/i);
              if (mmMatch) {
                var mmVal = parseFloat(mmMatch[1]);
                if (!isNaN(mmVal) && mmVal > 0 && result.lengths.indexOf(mmVal) === -1) {
                  result.lengths.push(mmVal);
                }
              }
              if (!cmMatch && !mmMatch) {
                var inchMatch = lText.match(/([\d]+(?:[\s-][\d]+\/[\d]+)?)\s*["″']/);
                if (inchMatch) {
                  var inchStr = inchMatch[1].replace(/\s/g, '');
                  var inchParts = inchStr.split('-');
                  var inches = parseFloat(inchParts[0]);
                  if (inchParts.length > 1) {
                    var fracParts = inchParts[1].split('/');
                    if (fracParts.length === 2) {
                      inches += parseFloat(fracParts[0]) / parseFloat(fracParts[1]);
                    }
                  }
                  var inMm = Math.round(inches * 25.4);
                  if (!isNaN(inMm) && inMm > 0 && result.lengths.indexOf(inMm) === -1) {
                    result.lengths.push(inMm);
                  }
                }
              }
            }

            // E-shop links
            var eLinks = rows[ri].querySelectorAll('a[href*="rapala-e-shop.com"]');
            for (var eli = 0; eli < eLinks.length; eli++) {
              var eHref = (eLinks[eli] as HTMLAnchorElement).href;
              if (eHref && result.eshopUrls.indexOf(eHref) === -1) {
                result.eshopUrls.push(eHref);
              }
            }
          }
        }
      }

      // ---- Color chart ----
      // Colors live in b-album blocks (BiND album layout), not b-plain.
      // Also check b-plain blocks that are NOT sp-hide/pc-hide (some pages).
      var colorBlocks = document.querySelectorAll('div.b-album, div.b-plain:not(.is-sp-hide):not(.is-pc-hide)');
      for (var cbi = 0; cbi < colorBlocks.length; cbi++) {
        var cBlock = colorBlocks[cbi] as HTMLElement;
        if (cBlock.className.indexOf('breadcrumb') >= 0) continue;

        // Each color is in a column div: column -column{N}
        var colorCols = cBlock.querySelectorAll('.column[class*="-column"]');
        for (var cci = 0; cci < colorCols.length; cci++) {
          var colorCol = colorCols[cci] as HTMLElement;
          // Must have h4 (color code) and img (color swatch)
          // Note: some pages have <h4><span>text</span></h4>, others have <h4>text</h4>
          var h4El = colorCol.querySelector('h4.c-small_headline');
          var imgEl = colorCol.querySelector('picture img, div.c-img img, div.c-photo img, a.js-zoomImage img') as HTMLImageElement;

          if (h4El && imgEl) {
            var colorName = (h4El.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            var imgSrc = imgEl.src || imgEl.getAttribute('src') || '';
            // Prefer webp source
            var sourceEl = colorCol.querySelector('picture source[type="image/webp"]');
            if (sourceEl) {
              var webpSrc = sourceEl.getAttribute('srcset') || '';
              if (webpSrc) imgSrc = webpSrc;
            }
            var colorUrl = '';
            if (imgSrc) {
              try { colorUrl = imgSrc.startsWith('http') ? imgSrc : new URL(imgSrc, baseUrl).href; } catch (e) { colorUrl = imgSrc; }
            }
            if (colorName && colorUrl) {
              result.colors.push({ name: colorName, imageUrl: colorUrl });
            }
          }
        }
      }

      // ---- Fallback main image ----
      if (!result.mainImage && result.colors.length > 0) {
        result.mainImage = result.colors[0].imageUrl;
      }
      if (!result.mainImage) {
        var ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) {
          result.mainImage = ogImg.getAttribute('content') || '';
        }
      }

      return result;
    });

    // --- Post-processing ---

    // Parse title: "CODE(FULL_NAME) | Rapala HP" → name = "FULL_NAME"
    var cleanTitle = data.title.replace(/\s*\|\s*Rapala\s*HP\s*$/i, '').trim();
    var titleMatch = cleanTitle.match(/^([A-Z0-9_\-]+)\s*\((.+)\)\s*$/i);
    var productCode = '';
    var productName = cleanTitle;
    if (titleMatch) {
      productCode = titleMatch[1].trim();
      productName = titleMatch[2].trim();
    }

    // name_kana: use Japanese name if available
    var nameKana = data.nameJp || '';

    // Build description
    var descParts: string[] = [];
    if (data.catchcopy) descParts.push(data.catchcopy);
    if (data.description) descParts.push(data.description);
    var description = descParts.join('\n') || 'N/A';

    // Type detection
    var lureType = detectType(productName);
    if (lureType === 'その他' && data.typeHint) {
      lureType = detectType(data.typeHint);
    }

    // Brand & target fish
    var brand = detectBrand(url);
    var targetFish = detectTargetFish(productName, brand);

    // Slug
    var slug = generateSlug(url);

    // Manufacturer: all under "Rapala"
    var manufacturer = 'Rapala';
    var manufacturerSlug = 'rapala';

    // Length: first (smallest) value in mm, or null
    var sortedLengths = data.lengths.sort(function (a, b) { return a - b; });
    var length = sortedLengths.length > 0 ? sortedLengths[0] : null;

    // Weights: sorted unique
    var weights = data.weights.sort(function (a, b) { return a - b; });

    // Price: fetch from e-shop if we have links
    var price = 0;
    if (data.eshopUrls.length > 0) {
      try {
        price = await fetchEshopPrice(data.eshopUrls[0]);
      } catch {
        price = 0;
      }
    }

    var mainImage = data.mainImage || '';

    await context.close();

    return {
      name: productName,
      name_kana: nameKana,
      slug: slug,
      manufacturer: manufacturer,
      manufacturer_slug: manufacturerSlug,
      type: lureType,
      target_fish: targetFish,
      description: description,
      price: price,
      colors: data.colors,
      weights: weights,
      length: length,
      mainImage: mainImage,
      sourceUrl: url,
    };
  } finally {
    if (browser) await browser.close();
  }
}
