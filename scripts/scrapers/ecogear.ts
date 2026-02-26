// scripts/scrapers/ecogear.ts
// Ecogear (マルキユー) product page scraper
// Handles lure products from ecogear.jp/ecogear/{slug}/ and ecogear.jp/fishleague/{slug}/
//
// Site: WordPress 5.5.17, custom theme "ecogear".
// WP REST API available: /wp-json/wp/v2/ecogear and /wp-json/wp/v2/fishleague
// URL patterns: /ecogear/{slug}/ or /fishleague/{slug}/
// Title: h2.mainh2 (Japanese name)
// English name: first h3 inside article
// Colors: .ChangeElem_Panel.colorchart table tr — skip header rows (first cell is th)
//   First td: <img> (swatch image) + text node (color name like "J01 オキアミ")
// Specs: .ChangeElem_Panel.specs table:first-of-type tr — Length, Weight, Pcs, Price
// Categories: .metabox span.newscate
// Targets: bass + saltwater (depends on product)

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/ミノー|minnow/i, 'ルアー'],
  [/バイブ|vibe/i, 'バイブレーション'],
  [/ブレード|blade/i, 'ルアー'],
  [/ジグヘッド|jig\s*head/i, 'ジグヘッド'],
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/エギ|egi|dartmax|squid/i, 'エギ'],
  [/スッテ|sutte|ika.*metal/i, 'スッテ'],
  [/テンヤ|tenya/i, 'テンヤ'],
  [/クランク|crank/i, 'クランクベイト'],
  [/スピナー|spinner/i, 'スピナーベイト'],
];

function detectType(name: string, categories: string[]): string {
  var catStr = categories.join(' ');
  // Category-based WORM/AQUA check first (soft bait category is most reliable)
  if (/WORM|ワーム|AQUA|熟成/i.test(catStr)) return 'ワーム';
  // Name-based checks (for hard baits, name is most reliable — overrides other categories)
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  // Category-based fallback for other types
  if (/JIG\s*HEAD|ジグヘッド/i.test(catStr)) return 'ジグヘッド';
  if (/EGIING|TIP.*RUN/i.test(catStr)) return 'エギ';
  if (/IKA.*METAL/i.test(catStr)) return 'スッテ';
  // Default: soft lure = ワーム
  return 'ワーム';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, categories: string[]): string[] {
  var all = (name + ' ' + categories.join(' ')).toLowerCase();
  var targets: string[] = [];
  if (/bass|バス|freshwater/i.test(all)) targets.push('ブラックバス');
  if (/rock|ロック|メバル|カサゴ|アジ|aji|mebaru|gasago|light.*game/i.test(all)) targets.push('メバル');
  if (/sea.*bass|シーバス/i.test(all)) targets.push('シーバス');
  if (/egiing|egi|エギ|イカ|ika|squid/i.test(all)) targets.push('アオリイカ');
  if (/flat|ヒラメ|マゴチ/i.test(all)) targets.push('ヒラメ');
  if (/trout|トラウト/i.test(all)) targets.push('トラウト');
  if (/chinu|チヌ|黒鯛|breamer/i.test(all)) targets.push('チヌ');
  // Default if nothing specific found
  if (targets.length === 0) targets.push('ソルト');
  return targets;
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [ecogear] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeEcogearPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    // Navigate with retry
    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log('Navigating to ' + url + ' (attempt ' + attempt + '/' + maxRetries + ')');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      } catch (navErr: any) {
        if (attempt === maxRetries) throw navErr;
        log('Navigation failed, retrying in 3s...');
        await page.waitForTimeout(3000);
      }
    }

    await page.waitForTimeout(2000);

    // ---------- Extract all data from page ----------
    var data = await page.evaluate(function() {
      // Title: h2.mainh2
      var h2 = document.querySelector('h2.mainh2');
      var title = h2 ? (h2.textContent || '').trim() : '';

      // English name: first h3 inside article
      var h3 = document.querySelector('article h3');
      var englishName = h3 ? (h3.textContent || '').trim() : '';

      // Categories from metabox
      var categories: string[] = [];
      var catEls = document.querySelectorAll('.metabox span.newscate');
      for (var ci = 0; ci < catEls.length; ci++) {
        var catText = (catEls[ci].textContent || '').trim();
        if (catText) categories.push(catText);
      }

      // Description: first substantial p inside article after h3
      var desc = '';
      var articlePs = document.querySelectorAll('article p');
      for (var pi = 0; pi < articlePs.length; pi++) {
        var pText = (articlePs[pi].textContent || '').trim();
        if (pText.length > 20 && !pText.startsWith('※')) {
          desc = pText.substring(0, 500);
          break;
        }
      }

      // Main image: first substantial img in article
      var mainImage = '';
      var articleImgs = document.querySelectorAll('article img');
      for (var ii = 0; ii < articleImgs.length; ii++) {
        var src = articleImgs[ii].getAttribute('src') || '';
        if (src && src.includes('wp-content/uploads') && !src.includes('INDEX_')) {
          mainImage = src;
          break;
        }
      }
      if (mainImage && !mainImage.startsWith('http')) {
        mainImage = 'https://ecogear.jp' + mainImage;
      }

      // Specs from .ChangeElem_Panel.specs table
      // Three layouts:
      //   Layout A: a pure-TH row (headers) followed by pure-TD rows (data)
      //   Layout B (matrix): each row has th (spec name) + td cells (values per size variant)
      //   Layout C: mixed rows — find the first pure-TH row as header, use subsequent pure-TD rows
      var specs: Record<string, string> = {};
      var specsTable = document.querySelector('.ChangeElem_Panel.specs table');
      if (specsTable) {
        var specRows = specsTable.querySelectorAll('tr');

        // Find first pure-TH row (all cells are th, no td)
        var headerRowIdx = -1;
        var headerTexts: string[] = [];
        for (var ri = 0; ri < specRows.length; ri++) {
          var ths = specRows[ri].querySelectorAll('th');
          var tds = specRows[ri].querySelectorAll('td');
          if (ths.length > 0 && tds.length === 0) {
            headerRowIdx = ri;
            for (var hi = 0; hi < ths.length; hi++) {
              headerTexts.push((ths[hi].textContent || '').trim());
            }
            break;
          }
        }

        if (headerRowIdx >= 0 && headerTexts.length > 0) {
          // Layout A/C: header row found, collect data from subsequent pure-TD rows
          for (var sri = headerRowIdx + 1; sri < specRows.length; sri++) {
            var dataCells = specRows[sri].querySelectorAll('td');
            var rowThs = specRows[sri].querySelectorAll('th');
            if (dataCells.length === 0 || rowThs.length > 0) continue; // skip non-data rows
            for (var dci = 0; dci < dataCells.length && dci < headerTexts.length; dci++) {
              var val = (dataCells[dci].textContent || '').trim();
              if (headerTexts[dci] && val) {
                if (specs[headerTexts[dci]]) {
                  specs[headerTexts[dci]] += ', ' + val;
                } else {
                  specs[headerTexts[dci]] = val;
                }
              }
            }
          }
        } else {
          // Layout B (matrix): each row has th as key, td cells as values
          for (var sri = 0; sri < specRows.length; sri++) {
            var th = specRows[sri].querySelector('th');
            if (!th) continue;
            var key = (th.textContent || '').trim();
            if (!key) continue;
            var tds = specRows[sri].querySelectorAll('td');
            var vals: string[] = [];
            for (var tdi = 0; tdi < tds.length; tdi++) {
              var tv = (tds[tdi].textContent || '').trim();
              if (tv) vals.push(tv);
            }
            if (vals.length > 0) {
              specs[key] = vals.join(', ');
            }
          }
        }
      }

      // Price from specs
      var priceValue = 0;
      var priceStr = specs['Price'] || specs['price'] || '';
      if (priceStr) {
        var priceMatch = priceStr.match(/[¥￥]\s*([\d,]+)/);
        if (priceMatch) {
          priceValue = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }
      // Fallback: search all spec values for ¥ amount
      if (priceValue === 0) {
        var allSpecValues = Object.values(specs).join(' ');
        var fallbackMatch = allSpecValues.match(/[¥￥]\s*([\d,]+)/);
        if (fallbackMatch) {
          priceValue = parseInt(fallbackMatch[1].replace(/,/g, ''), 10);
        }
      }
      // Fallback 2: search full page text for ¥ amount near "Price"
      if (priceValue === 0) {
        var bodyText = document.body.textContent || '';
        var priceAreaMatch = bodyText.match(/Price[^¥￥]*[¥￥]\s*([\d,]+)/i);
        if (priceAreaMatch) {
          priceValue = parseInt(priceAreaMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Colors from .ChangeElem_Panel.colorchart table
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorSeen = new Set();
      var colorPanel = document.querySelector('.ChangeElem_Panel.colorchart');
      if (colorPanel) {
        var colorTable = colorPanel.querySelector('table');
        if (colorTable) {
          var rows = colorTable.querySelectorAll('tr');
          for (var ri = 0; ri < rows.length; ri++) {
            var firstCell = rows[ri].querySelector('td');
            if (!firstCell) continue; // Skip header rows (th cells)

            // Color image: img inside first td
            var imgEl = firstCell.querySelector('img');
            var imgUrl = '';
            if (imgEl) {
              imgUrl = imgEl.getAttribute('src') || '';
              // Get full-size by removing -NNNxNNN suffix
              imgUrl = imgUrl.replace(/-\d+x\d+(\.\w+)$/, '$1');
              if (imgUrl && !imgUrl.startsWith('http')) {
                imgUrl = 'https://ecogear.jp' + imgUrl;
              }
            }

            // Color name: text content of first td (after img and br)
            var colorName = (firstCell.textContent || '').trim();
            if (!colorName) continue;

            if (!colorSeen.has(colorName)) {
              colorSeen.add(colorName);
              colors.push({ name: colorName, imageUrl: imgUrl });
            }
          }
        }
      }

      return {
        title: title,
        englishName: englishName,
        categories: categories,
        description: desc,
        mainImage: mainImage,
        specs: specs,
        price: priceValue,
        colors: colors,
      };
    });

    var fullName = (data.title || '').trim();
    log('Product: ' + fullName);
    log('English: ' + data.englishName);
    log('Categories: ' + data.categories.join(', '));
    log('Main image: ' + data.mainImage);
    log('Colors: ' + data.colors.length);
    log('Price: ' + data.price);
    log('Specs: ' + JSON.stringify(data.specs));

    // Generate slug from URL path
    var urlPath = new URL(url).pathname;
    var slugMatch = urlPath.match(/\/(?:ecogear|fishleague)\/([^\/]+)/);
    var slug = slugMatch ? slugMatch[1] : '';
    if (!slug) {
      slug = fullName.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'ecogear-product';
    }

    // Display name
    var displayName = fullName || data.englishName;

    // Detect type
    var lureType = detectType(fullName + ' ' + data.englishName, data.categories);

    // Detect target fish
    var targetFish = detectTargetFish(fullName + ' ' + data.englishName, data.categories);

    // Extract length from specs
    var lengthMm: number | null = null;
    var lengthSpec = data.specs['Length (inch / mm)'] || data.specs['Length'] || data.specs['length'] || '';
    if (lengthSpec) {
      var mmMatch = lengthSpec.match(/(\d+)\s*mm/);
      if (mmMatch) {
        lengthMm = parseInt(mmMatch[1], 10);
      } else {
        var inchMatch = lengthSpec.match(/([\d.]+)\s*["″inch]/i);
        if (inchMatch) {
          lengthMm = Math.round(parseFloat(inchMatch[1]) * 25.4);
        }
      }
    }

    // Extract weights
    var weights: number[] = [];
    var weightSpec = data.specs['Weight'] || data.specs['weight'] || '';
    if (weightSpec) {
      var gMatches = weightSpec.match(/[\d.]+\s*g/gi);
      if (gMatches) {
        for (var wi = 0; wi < gMatches.length; wi++) {
          var gVal = parseFloat(gMatches[wi]);
          if (gVal > 0) weights.push(gVal);
        }
      }
    }

    // Determine manufacturer name based on URL
    var isFL = url.includes('/fishleague/');
    var manufacturer = isFL ? 'FishLeague' : 'Ecogear';
    var manufacturerSlug = 'ecogear'; // both under ecogear

    var result: ScrapedLure = {
      name: displayName,
      name_kana: '',
      slug: slug,
      manufacturer: manufacturer,
      manufacturer_slug: manufacturerSlug,
      type: lureType,
      target_fish: targetFish,
      description: data.description,
      price: data.price,
      colors: data.colors,
      weights: weights,
      length: lengthMm,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log('Done: ' + result.name + ' | type=' + result.type + ' | colors=' + result.colors.length + ' | price=' + result.price + ' | slug=' + result.slug + ' | length=' + result.length);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
