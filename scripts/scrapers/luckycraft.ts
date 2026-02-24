// scripts/scrapers/luckycraft.ts
// LUCKY CRAFT product page scraper
// Handles lure products from luckycraft.co.jp/product/{category}/{slug}.html
//
// Site: Static HTML (Dreamweaver templates), UTF-8, jQuery, no WAF, headless OK.
// TWO templates exist:
//   1. New (2023.dwt): div.buy + div.text-name + div.text-1 + table.itemlist
//   2. Old: div.headerArea/.headerSalt + tableCategory/tableInside + tableColorImage/tableColorName
// One page contains multiple size variants (e.g. Sammy55, Sammy65, Sammy85...)
// NO price information on the site.
// Colors: table.itemlist or tableColorImage/tableColorName
// Images: product/images/{series}/ or product/cc/{category}/{series}/

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LUCKYCRAFT_BASE = 'https://www.luckycraft.co.jp';

// ---------------------------------------------------------------------------
// Type detection: based on product name + slug + category
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Crank
  [/crank|クランク|CB|Clutch|クラッチ/i, 'クランクベイト'],
  // Minnow / Jerkbait
  [/minnow|ミノー|B'?Freeze|Bfreeze|Staysee|ステイシー|Flash\s*Minnow|フラッシュミノー|Pointer|ポインター|Humpback/i, 'ミノー'],
  // Shad
  [/shad|シャッド|Bevy\s*Shad/i, 'シャッド'],
  // Vibration
  [/vib|バイブ|LV\b|Real\s*Vib/i, 'バイブレーション'],
  // Pencil / Topwater
  [/pencil|ペンシル|Sammy|サミー|Gunni?sh|ガニッシュ|Splash\s*Tail|スプラッシュテール|Tone\s*Splash|Wake\s*Tail|SammyBug|Snap\s*Kick/i, 'ペンシルベイト'],
  // Popper
  [/popper|ポッパー/i, 'ポッパー'],
  // Prop bait
  [/prop|プロップ/i, 'プロップベイト'],
  // Spinner bait
  [/spinner|スピナー|Area'?s/i, 'スピナーベイト'],
  // Blade / Metal vib
  [/blade|ブレード|Salty\s*Beats|ソルティービーツ/i, 'メタルバイブ'],
  // Wander (Sinking pencil)
  [/wander|ワンダー/i, 'シンキングペンシル'],
  // Big bait
  [/bull|ブル|Input\s*Swimmer|インプットスイマー|Real\s*Bait|Real\s*Ayu/i, 'ビッグベイト'],
  // Egi (squid jig)
  [/egi|エギ|kirari|キラリ/i, 'エギ'],
  // Spoon
  [/spoon|スプーン|CraPea|クラピー|cra-pea|SRoller|WAH\b|unfair|Air\s*Beatle|Air\s*Blow|Air\s*Claw|Air\s*Pellet|Poko/i, 'スプーン'],
  // Jig
  [/jig|ジグ/i, 'ジグ'],
  // Stream minnow
  [/stream|ストリーム|Two\s*Twicher|Watch\b|Raiou/i, 'ミノー'],
  // Malas (swim jig)
  [/malas|マラス/i, 'スイムジグ'],
  // Screw driver
  [/screw|スクリュー/i, 'バイブレーション'],
  // Varid (sea bass vibration)
  [/varid|バリッド/i, 'バイブレーション'],
  // Surface wander
  [/surface/i, 'トップウォーター'],
  // C-Cube
  [/C-?Cube|シーキューブ/i, 'バイブレーション'],
  // Rat
  [/rat|ラット/i, 'トップウォーター'],
  // Sea Swim
  [/sea\s*swim/i, 'メタルジグ'],
  // Surf pointer
  [/surf\s*pointer/i, 'ミノー'],
  // Keroll
  [/keroll|ケロール/i, 'トップウォーター'],
  // Kingyo
  [/kingyo|金魚/i, 'トップウォーター'],
  // Wobty
  [/wobty|ウォブティー/i, 'シャッド'],
  // Amago
  [/amago|アマゴ/i, 'ミノー'],
  // LC MTO / MTS
  [/LCMT|MTO|MTS/i, 'ミノー'],
];

// ---------------------------------------------------------------------------
// Target fish detection — category-based
// ---------------------------------------------------------------------------

function detectTargetFish(category: string, urlPath: string): string[] {
  const combined = `${category} ${urlPath}`.toLowerCase();

  if (combined.includes('area') || combined.includes('trout')) return ['トラウト'];
  if (combined.includes('native') || combined.includes('stream')) return ['トラウト'];
  if (combined.includes('ayu')) return ['アユ'];
  if (combined.includes('namazu')) return ['ナマズ'];
  if (combined.includes('chinu')) return ['チヌ'];
  if (combined.includes('haze')) return ['ハゼ'];
  if (combined.includes('ika')) return ['アオリイカ'];
  if (combined.includes('jack')) return ['アジ'];
  if (combined.includes('mlg')) return ['メバル', 'アジ'];
  if (combined.includes('salt') || combined.includes('seabass') || combined.includes('sw')) return ['シーバス'];
  // Default: bass
  return ['ブラックバス'];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [luckycraft] ${message}`);
}

/**
 * Extract product slug from URL.
 * /product/bass/BevyCrank.html → "bevycrank"
 * /product/salt/FlashMinnow.html → "flashminnow-salt"
 * /product/swlightgame/MLG/Wander.html → "wander-mlg"
 */
function extractSlug(url: string): string {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/\/product\/([^?#]+?)(?:\.html)?$/);
  if (!match) {
    const segments = new URL(decoded).pathname.split('/').filter(Boolean);
    return (segments[segments.length - 1] || '').toLowerCase().replace(/\.html$/, '');
  }

  const parts = match[1].split('/');
  // parts = ["bass", "BevyCrank"] or ["swlightgame", "MLG", "Wander"]
  const fileName = (parts[parts.length - 1] || '').toLowerCase().replace(/\.html$/, '');
  const category = (parts[0] || '').toLowerCase();

  // For salt/seabass/area/native/namazu/swlightgame — append category suffix to avoid collisions
  if (category === 'salt' || category === 'native' || category === 'namazu') {
    return `${fileName}-${category}`;
  }
  if (category === 'swlightgame' && parts.length >= 3) {
    const subcat = (parts[1] || '').toLowerCase();
    return `${fileName}-${subcat}`;
  }
  if (category === 'area') {
    return `${fileName}-area`;
  }
  // For bass and spinnerbait — just use filename
  return fileName;
}

/**
 * Detect lure type from product name and slug.
 */
function detectType(name: string, slug: string): string {
  const combined = `${name} ${slug}`;
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeLuckyCraftPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    log(`Navigating to ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response || response.status() === 404) {
      throw new Error(`Page not found (404): ${url}`);
    }

    // Wait for static content to render
    await page.waitForTimeout(2000);

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate(() => {
      var BASE = 'https://www.luckycraft.co.jp/';

      // Helper: resolve relative URLs against current page URL
      var pageUrl = window.location.href;
      var pageDir = pageUrl.substring(0, pageUrl.lastIndexOf('/') + 1);

      // --- Detect template type ---
      var isNewTemplate = !!document.querySelector('.text-name');
      var isOldTemplate = !!document.querySelector('.headerArea, .headerSalt, .headerBass, .headerNative, .headerSW, .headerNamazu, .headerPup, .headerYlw, .headerLight');

      // --- Product name ---
      var name = '';
      // New template: from <title> or headerArea
      var titleEl = document.querySelector('title');
      var titleText = (titleEl ? titleEl.textContent : '') || '';
      // "Lucky Craft JAPAN - ベビークランク" → "ベビークランク"
      var titleMatch = titleText.match(/Lucky\s*Craft\s*JAPAN\s*[-–—]\s*(.+)/i);
      if (titleMatch) {
        name = titleMatch[1].trim();
      }
      // Old template: span.itemName
      if (!name) {
        var itemNameEl = document.querySelector('.itemName');
        if (itemNameEl) {
          name = (itemNameEl.textContent || '').trim();
        }
      }

      // --- Category from header ---
      var category = '';
      var headerEl = document.querySelector('.headerArea, .headerSalt, .headerBass, .headerNative, .headerSW, .headerNamazu, .headerPup, .headerYlw, .headerLight');
      if (headerEl) {
        var headerText = (headerEl.textContent || '').trim();
        // "Seabass / Flash Minnow" → "Seabass"
        var catMatch = headerText.match(/^([^/]+)\//);
        if (catMatch) {
          category = catMatch[1].trim();
        }
      }

      // --- Description ---
      var description = '';
      // New template: #section1 > p
      var section1P = document.querySelector('#section1 > p');
      if (section1P) {
        description = (section1P.textContent || '').trim().substring(0, 500);
      }
      // Old template: first block of text content
      if (!description) {
        var textBlocks = document.querySelectorAll('#container p, #containerSalt p, #containerArea p, #containerBass p');
        for (var i = 0; i < textBlocks.length; i++) {
          var txt = (textBlocks[i].textContent || '').trim();
          if (txt.length > 30) {
            description = txt.substring(0, 500);
            break;
          }
        }
      }

      // --- Variants (size-specific data) from new template ---
      var variants: { name: string; lengthMm: number; weightG: number; type: string }[] = [];

      if (isNewTemplate) {
        var buyDivs = document.querySelectorAll('.buy');
        for (var b = 0; b < buyDivs.length; b++) {
          var vNameEl = buyDivs[b].querySelector('.text-name, .text-name-namisu, .text-name-akanen');
          var vSpecEl = buyDivs[b].querySelector('.text-1');
          if (!vNameEl || !vSpecEl) continue;
          var vName = (vNameEl.textContent || '').trim();
          var vSpec = (vSpecEl.textContent || '').trim();

          // Parse "長さ : 45mm / 重さ: 4.8g / タイプ : フローティング / 深度 : 0.3~0.6m"
          var lenMatch = vSpec.match(/長さ\s*[:：]\s*([\d.]+)\s*mm/);
          var wMatch = vSpec.match(/重さ\s*[:：]\s*([\d.]+)\s*g/);
          var typeMatch = vSpec.match(/タイプ\s*[:：]\s*([^\s/]+)/);

          variants.push({
            name: vName,
            lengthMm: lenMatch ? parseFloat(lenMatch[1]) : 0,
            weightG: wMatch ? parseFloat(wMatch[1]) : 0,
            type: typeMatch ? typeMatch[1].trim() : '',
          });
        }
      }

      // --- Variants from old template (tableCategory/tableInside) ---
      if (isOldTemplate && variants.length === 0) {
        // Old template has a horizontal table: rows are categories (アイテム, 全長, 重量, etc.)
        // Columns are variants
        var categoryRows = document.querySelectorAll('tr');
        var itemNames: string[] = [];
        var lengths: string[] = [];
        var weights: string[] = [];
        var types: string[] = [];

        for (var r = 0; r < categoryRows.length; r++) {
          var row = categoryRows[r];
          var catCell = row.querySelector('.tableCategory');
          if (!catCell) continue;
          var catText = (catCell.textContent || '').trim();
          var dataCells = row.querySelectorAll('.tableInside');

          if (catText === 'アイテム' || catText === 'Item') {
            for (var d = 0; d < dataCells.length; d++) {
              itemNames.push((dataCells[d].textContent || '').trim());
            }
          } else if (catText === '全長' || catText === 'Length') {
            for (var d2 = 0; d2 < dataCells.length; d2++) {
              lengths.push((dataCells[d2].textContent || '').trim());
            }
          } else if (catText === '重量' || catText === 'Weight') {
            for (var d3 = 0; d3 < dataCells.length; d3++) {
              weights.push((dataCells[d3].textContent || '').trim());
            }
          } else if (catText === 'タイプ' || catText === 'Type') {
            for (var d4 = 0; d4 < dataCells.length; d4++) {
              types.push((dataCells[d4].textContent || '').trim());
            }
          }
        }

        var numVariants = Math.max(itemNames.length, lengths.length, weights.length);
        for (var v = 0; v < numVariants; v++) {
          var lenStr = lengths[v] || '';
          var wStr = weights[v] || '';
          var lmatch = lenStr.match(/([\d.]+)\s*mm/i);
          var wmatch = wStr.match(/([\d.]+)\s*g/i);

          variants.push({
            name: itemNames[v] || '',
            lengthMm: lmatch ? parseFloat(lmatch[1]) : 0,
            weightG: wmatch ? parseFloat(wmatch[1]) : 0,
            type: types[v] || '',
          });
        }
      }

      // --- Colors from new template (table.itemlist) ---
      var colors: { name: string; imageUrl: string }[] = [];
      var seenColorNames = new Set<string>();

      if (isNewTemplate) {
        // Collect from ALL itemlist tables (each variant has its own color chart)
        var itemTables = document.querySelectorAll('table.itemlist');
        for (var t = 0; t < itemTables.length; t++) {
          var rows = itemTables[t].querySelectorAll('tbody tr');
          for (var cr = 0; cr < rows.length; cr++) {
            var imgEl = rows[cr].querySelector('img');
            var nameCell = rows[cr].querySelector('td[data-label="商品名"]');
            if (!nameCell) continue;

            // Color name: first line (Japanese) of the cell
            // innerHTML has "ワカサギ<br>Wakasagi" — take only Japanese part
            var cellHtml = nameCell.innerHTML || '';
            var brParts = cellHtml.split(/<br\s*\/?>/i);
            var firstLine = (brParts[0] || '').replace(/<[^>]*>/g, '').trim();
            if (!firstLine) {
              // fallback to textContent first line
              var cellText = (nameCell.textContent || '').trim();
              firstLine = cellText.split('\n')[0].trim();
            }
            if (!firstLine || seenColorNames.has(firstLine)) continue;
            seenColorNames.add(firstLine);

            var imgSrc = imgEl ? (imgEl.getAttribute('src') || '') : '';
            if (imgSrc && !imgSrc.startsWith('http')) {
              if (imgSrc.startsWith('//')) {
                imgSrc = 'https:' + imgSrc;
              } else {
                // Resolve relative paths using URL constructor
                try { imgSrc = new URL(imgSrc, pageDir).href; } catch(e) { imgSrc = ''; }
              }
            }
            // Skip "comingsoon" images
            if (imgSrc.includes('comingsoon')) imgSrc = '';

            // Push color even without image (pipeline handles missing images)
            colors.push({ name: firstLine, imageUrl: imgSrc });
          }
        }
      }

      // --- Colors from old template (tableColorImage/tableColorName) ---
      if (isOldTemplate && colors.length === 0) {
        var colorImgs = document.querySelectorAll('.tableColorImage img');
        var colorNames = document.querySelectorAll('.tableColorName');

        var count = Math.min(colorImgs.length, colorNames.length);
        for (var ci = 0; ci < count; ci++) {
          // innerHTML has "ワカサギ<br>Wakasagi" — take only Japanese part
          var cHtml = colorNames[ci].innerHTML || '';
          var cParts = cHtml.split(/<br\s*\/?>/i);
          var cFirstLine = (cParts[0] || '').replace(/<[^>]*>/g, '').trim();
          if (!cFirstLine) {
            var cName = (colorNames[ci].textContent || '').trim();
            cFirstLine = cName.split('\n')[0].trim();
          }
          if (!cFirstLine || seenColorNames.has(cFirstLine)) continue;
          seenColorNames.add(cFirstLine);

          var cSrc = colorImgs[ci].getAttribute('src') || '';
          if (cSrc && !cSrc.startsWith('http')) {
            if (cSrc.startsWith('//')) {
              cSrc = 'https:' + cSrc;
            } else {
              try { cSrc = new URL(cSrc, pageDir).href; } catch(e) { cSrc = ''; }
            }
          }
          if (cSrc.includes('comingsoon') || cSrc.includes('ImageComingSoon')) cSrc = '';

          // Push color even without image (pipeline handles missing images)
          colors.push({ name: cFirstLine, imageUrl: cSrc });
        }
      }

      // --- Fallback: if neither template matched but tableColorImage exists ---
      if (colors.length === 0) {
        var fbColorImgs = document.querySelectorAll('.tableColorImage img');
        var fbColorNames = document.querySelectorAll('.tableColorName');
        var fbCount = Math.min(fbColorImgs.length, fbColorNames.length);
        for (var fci = 0; fci < fbCount; fci++) {
          var fbHtml = fbColorNames[fci].innerHTML || '';
          var fbParts = fbHtml.split(/<br\s*\/?>/i);
          var fbFirstLine = (fbParts[0] || '').replace(/<[^>]*>/g, '').trim();
          if (!fbFirstLine) {
            var fbName = (fbColorNames[fci].textContent || '').trim();
            fbFirstLine = fbName.split('\n')[0].trim();
          }
          if (!fbFirstLine || seenColorNames.has(fbFirstLine)) continue;
          seenColorNames.add(fbFirstLine);

          var fbSrc = fbColorImgs[fci].getAttribute('src') || '';
          if (fbSrc && !fbSrc.startsWith('http')) {
            if (fbSrc.startsWith('//')) {
              fbSrc = 'https:' + fbSrc;
            } else {
              try { fbSrc = new URL(fbSrc, pageDir).href; } catch(e) { fbSrc = ''; }
            }
          }
          if (fbSrc.includes('comingsoon') || fbSrc.includes('ImageComingSoon')) fbSrc = '';

          colors.push({ name: fbFirstLine, imageUrl: fbSrc });
        }
      }

      // --- Main image ---
      var mainImageUrl = '';
      // New template: #section1 img
      var mainImg = document.querySelector('#section1 > img');
      if (mainImg) {
        var src = (mainImg as HTMLImageElement).getAttribute('src') || '';
        if (src.startsWith('http')) { mainImageUrl = src; }
        else if (src.startsWith('//')) { mainImageUrl = 'https:' + src; }
        else if (src) { try { mainImageUrl = new URL(src, pageDir).href; } catch(e) {} }
      }
      // Old template: #imgFrameFull img
      if (!mainImageUrl) {
        var oldMain = document.querySelector('#imgFrameFull img');
        if (oldMain) {
          var osrc = (oldMain as HTMLImageElement).getAttribute('src') || '';
          if (osrc.startsWith('http')) { mainImageUrl = osrc; }
          else if (osrc.startsWith('//')) { mainImageUrl = 'https:' + osrc; }
          else if (osrc) { try { mainImageUrl = new URL(osrc, pageDir).href; } catch(e) {} }
        }
      }
      // Broader fallback: .ccimg or first product image (new template sub-pages)
      if (!mainImageUrl) {
        var ccimg = document.querySelector('img.ccimg');
        if (ccimg) {
          var csrc = (ccimg as HTMLImageElement).getAttribute('src') || '';
          if (csrc && !csrc.includes('comingsoon')) {
            if (csrc.startsWith('http')) { mainImageUrl = csrc; }
            else if (csrc.startsWith('//')) { mainImageUrl = 'https:' + csrc; }
            else { try { mainImageUrl = new URL(csrc, pageDir).href; } catch(e) {} }
          }
        }
      }
      // Last resort: first img with /product/images/ in src
      if (!mainImageUrl) {
        var productImgs = document.querySelectorAll('img[src*="/product/images/"]');
        for (var pi = 0; pi < productImgs.length; pi++) {
          var psrc = (productImgs[pi] as HTMLImageElement).getAttribute('src') || '';
          if (psrc && !psrc.includes('comingsoon') && !psrc.includes('Shop-logo')) {
            if (psrc.startsWith('http')) { mainImageUrl = psrc; }
            else if (psrc.startsWith('//')) { mainImageUrl = 'https:' + psrc; }
            else { try { mainImageUrl = new URL(psrc, pageDir).href; } catch(e) {} }
            break;
          }
        }
      }

      return {
        name: name,
        category: category,
        description: description,
        variants: variants,
        colors: colors,
        mainImageUrl: mainImageUrl,
        isNewTemplate: isNewTemplate,
        isOldTemplate: isOldTemplate,
      };
    });

    log(
      `Extracted: name="${pageData.name}", cat="${pageData.category}", variants=${pageData.variants.length}, colors=${pageData.colors.length}, template=${pageData.isNewTemplate ? 'new' : pageData.isOldTemplate ? 'old' : 'unknown'}`,
    );

    // ----- Post-process extracted data -----
    const slug = extractSlug(url);
    const name = pageData.name || slug.replace(/[-_]/g, ' ');
    const type = detectType(name, slug);
    const urlPath = new URL(url).pathname;
    const targetFish = detectTargetFish(pageData.category, urlPath);

    // Aggregate weights and find representative length from variants
    const weights: number[] = [];
    let length: number | null = null;

    for (const v of pageData.variants) {
      if (v.weightG > 0 && !weights.includes(Math.round(v.weightG * 10) / 10)) {
        weights.push(Math.round(v.weightG * 10) / 10);
      }
      // Use the first valid length as representative
      if (length === null && v.lengthMm > 0) {
        length = Math.round(v.lengthMm);
      }
    }
    weights.sort((a, b) => a - b);

    // Colors
    const colors: ScrapedColor[] = pageData.colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl,
    }));

    // Fallback: if 0 colors but we have main image, create a default color entry
    if (colors.length === 0 && pageData.mainImageUrl) {
      colors.push({ name: name, imageUrl: pageData.mainImageUrl });
      log(`No colors found — created default entry from main image`);
    }

    // Main image
    const mainImage = pageData.mainImageUrl || (colors.length > 0 ? colors[0].imageUrl : '');

    const result: ScrapedLure = {
      name,
      name_kana: name,
      slug,
      manufacturer: 'LUCKY CRAFT',
      manufacturer_slug: 'luckycraft',
      type,
      target_fish: targetFish,
      description: pageData.description,
      price: 0, // Lucky Craft site has no price information
      colors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(
      `Done: ${name} | type=${type} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | fish=${targetFish.join(',')}`,
    );

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
