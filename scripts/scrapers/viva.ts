// scripts/scrapers/viva.ts
// VIVA (vivanet.co.jp/viva/) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: WordPress (Cormoran Products)
// Product URL pattern: https://vivanet.co.jp/viva/{product-slug}/
// Specs: <div class="item_spec"><p>型番 : 55mm / 9.5g / ￥1,500（税別）</p></div>
// Description: <div class="item_content"><p>...</p></div>
// Color chart: <ul class="color_list popup-gallery"><li><a title="#11E<br>キンクロ"><img><p>#11E<br>キンクロ</p></a></li>
// Types: various (クローラー, ポッパー, バイブ, ワーム, etc.)
// Target fish: ブラックバス, ナマズ, トラウト

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'VIVA';
const MANUFACTURER_SLUG = 'viva';
const SITE_BASE = 'https://vivanet.co.jp';
const DEFAULT_TARGET_FISH = ['ブラックバス'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/クローラー|crawler/i, 'クローラーベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/バイブレーション|vibration|バイブ|vib/i, 'バイブレーション'],
  [/メタルバイブ|metal\s*vib/i, 'メタルバイブ'],
  [/ミノー|minnow/i, 'ミノー'],
  [/シャッド|shad/i, 'シャッド'],
  [/クランク|crank/i, 'クランクベイト'],
  [/スピナーベイト|spinner\s*bait|スピン/i, 'スピナーベイト'],
  [/バズベイト|buzz/i, 'バズベイト'],
  [/ビッグベイト|big\s*bait/i, 'ビッグベイト'],
  [/ワーム|worm|ネイル|サターン/i, 'ワーム'],
  [/スプーン|spoon/i, 'スプーン'],
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/トップウォーター|topwater|マウス|mouse/i, 'トップウォーター'],
  [/プラグ|plug/i, 'プラグ'],
  [/ブレード|blade/i, 'ブレードベイト'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [viva] ${msg}`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function makeAbsolute(href: string): string {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return SITE_BASE + href;
  return SITE_BASE + '/' + href;
}

function detectType(name: string, description: string): string {
  const combined = `${name} ${description}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return typeName;
  }
  return 'ルアー';
}

/**
 * Parse price from VIVA format: "￥1,700（税別）" or "￥1,870（税込）"
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  // Tax-included price
  const taxInclMatch = cleaned.match(/[¥￥]([\d,]+)[（(]税込/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  // Tax-excluded price — convert to tax-included
  const taxExclMatch = cleaned.match(/[¥￥]([\d,]+)[（(]税別/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  // Plain yen
  const yenMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

  const enMatch = cleaned.match(/([\d,]+)円/);
  if (enMatch) return parseInt(enMatch[1].replace(/,/g, ''), 10);

  return 0;
}

function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];
  const normalized = text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/ｇ/g, 'g');

  let match: RegExpExecArray | null;
  const re = /([\d.]+)\s*g/gi;
  while ((match = re.exec(normalized)) !== null) {
    const w = parseFloat(match[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }
  return Array.from(new Set(weights)).sort((a, b) => a - b);
}

function parseLength(text: string): number | null {
  if (!text) return null;
  const normalized = text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

  const mmMatch = normalized.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }
  const cmMatch = normalized.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    const mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }
  return null;
}

function deriveTargetFish(name: string, description: string): string[] {
  const combined = `${name} ${description}`;
  const fish: string[] = [];

  if (/ブラックバス|バス|bass/i.test(combined)) fish.push('ブラックバス');
  if (/ナマズ|鯰|catfish|ナマズSP/i.test(combined)) fish.push('ナマズ');
  if (/トラウト|trout|マス/i.test(combined)) fish.push('トラウト');
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/メバル|アジ|ライトゲーム/i.test(combined)) fish.push('メバル');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export const scrapeVivaPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  log(`Starting scrape: ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();

  // --- Product name ---
  // VIVA's <h1> contains marketing catchphrases, NOT the product name.
  // The real product name is in <div class="item_spec"><h3> or <title>.
  let name = '';

  // Primary: <div class="item_spec"><h3> — the real product name
  const itemSpecH3 = html.match(/<div[^>]*class=["'][^"']*item_spec[^"']*["'][^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (itemSpecH3) name = stripHtml(itemSpecH3[1]).trim();

  // Fallback 1: <title> tag, stripping " | Vivanet" suffix
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜–—].*$/, '').replace(/\s*Viva.*$/i, '').trim();
  }

  // Fallback 2: last breadcrumb <li class="notranslate">
  if (!name) {
    const breadcrumbs = html.match(/<li[^>]*class=["'][^"']*notranslate[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi) || [];
    if (breadcrumbs.length > 0) {
      const lastCrumb = stripHtml(breadcrumbs[breadcrumbs.length - 1]).trim();
      if (lastCrumb && lastCrumb !== 'TOP' && lastCrumb !== 'VIVA' && lastCrumb !== 'AquaWave') {
        name = lastCrumb;
      }
    }
  }

  // Fallback 3: og:title
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*[|｜–—].*$/, '').trim();
  }
  if (!name) name = 'Unknown';
  log(`Product name: ${name}`);

  // --- Slug from URL ---
  let slug = '';
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // URL: /viva/{slug}/ — skip 'viva' prefix
    const lastSegment = segments[segments.length - 1] || '';
    slug = lastSegment.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  } catch { /* ignore */ }
  if (!slug) slug = slugify(name);
  log(`Slug: ${slug}`);

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) mainImage = ogImageMatch[1];
  if (!mainImage) {
    // Look for product images (not logo, not color chart)
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+(?:product|main|hero|wp-content\/uploads)[^"']*)["'][^>]*(?:class=["'][^"']*(?:product|main|featured)[^"']*["'])?/i);
    if (imgMatch) mainImage = imgMatch[1];
  }
  if (!mainImage) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
    if (imgMatch) mainImage = imgMatch[1];
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Description ---
  // VIVA: 商品説明は <div class="item_content"> 直下の最初の <p> にある
  // meta[name=description] はサイト全体の説明文なので使わない
  let description = '';
  const itemContentMatch = html.match(/<div[^>]*class=["'][^"']*item_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (itemContentMatch) {
    // item_content内の最初の<p>を取得（feature_wrapやyoutube_wrapの前）
    const firstP = itemContentMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (firstP) {
      const text = stripHtml(firstP[1]).trim();
      if (text.length > 10 && !/バスフィッシング専門/.test(text)) {
        description = text.substring(0, 500);
      }
    }
  }
  // Fallback: og:description（meta descriptionよりはマシ）
  if (!description) {
    const ogDescMatch = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:description["']/i);
    if (ogDescMatch) {
      const text = stripHtml(ogDescMatch[1]).trim();
      if (text.length > 20 && !/バスフィッシング専門/.test(text)) {
        description = text.substring(0, 500);
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Official YouTube video ---
  let officialVideoUrl = '';
  const youtubeIframeMatch = html.match(/<iframe[^>]+src=["'](?:https?:)?\/\/(?:www\.)?youtube\.com\/embed\/([^"'?]+)/i);
  if (youtubeIframeMatch) {
    officialVideoUrl = `https://www.youtube.com/watch?v=${youtubeIframeMatch[1]}`;
    log(`Official video: ${officialVideoUrl}`);
  }

  // --- Specs: VIVA uses inline format "58mm / 12g / ¥1,700（税別）" ---
  const bodyText = stripHtml(html);
  let price = 0;
  let weights: number[] = [];
  let length: number | null = null;

  // Try the slash-separated spec format first
  const inlineSpecMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*mm\s*[/／]\s*([\d.]+)\s*g\s*[/／]\s*[¥￥]([\d,]+)/);
  if (inlineSpecMatch) {
    length = Math.round(parseFloat(inlineSpecMatch[1]));
    weights = [parseFloat(inlineSpecMatch[2])];
    price = parsePrice(`¥${inlineSpecMatch[3]}`);
  }

  // Also try reversed format: "12g / 58mm / ¥1,700"
  if (weights.length === 0) {
    const reversedSpec = bodyText.match(/([\d.]+)\s*g\s*[/／]\s*(\d+(?:\.\d+)?)\s*mm\s*[/／]\s*[¥￥]([\d,]+)/);
    if (reversedSpec) {
      weights = [parseFloat(reversedSpec[1])];
      length = Math.round(parseFloat(reversedSpec[2]));
      price = parsePrice(`¥${reversedSpec[3]}`);
    }
  }

  // Fallback: general parsing
  if (weights.length === 0) weights = parseWeights(bodyText);
  if (length === null) length = parseLength(bodyText);
  if (price === 0) price = parsePrice(bodyText);

  // Parse tables if any
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const tableText = stripHtml(tableHtml);
    if (/重量|ウエイト|weight|全長|length|価格|price|円/i.test(tableText)) {
      if (weights.length === 0) weights = parseWeights(tableText);
      if (length === null) length = parseLength(tableText);
      if (price === 0) price = parsePrice(tableText);
    }
  }

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors: VIVA uses <ul class="color_list popup-gallery"><li><a title="..."><img><p>...</p></a></li> ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // VIVAのカラーチャートは <ul class="color_list popup-gallery"> 内に格納
  // 各カラー: <li><a href="フルサイズ画像URL" title="#11E<br>キンクロ"><img src="サムネイル"><p>#11E<br>キンクロ</p></a></li>
  const colorListMatch = html.match(/<ul[^>]*class=["'][^"']*color_list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
  if (colorListMatch) {
    const colorListHtml = colorListMatch[1];
    const liMatches = colorListHtml.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
    for (const li of liMatches) {
      // フルサイズ画像は <a href="..."> から取得
      const aHrefMatch = li.match(/<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/i);
      // サムネイル画像は <img src="..."> から取得
      const imgMatch = li.match(/<img[^>]+src=["']([^"']+)["']/i);
      // カラー名は <p> タグから取得（"#11E<br>キンクロ" 形式）
      const pMatch = li.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      // フォールバック: <a title="..."> から取得
      const titleMatch = li.match(/<a[^>]+title=["']([^"']+)["']/i);

      const rawColorText = pMatch ? pMatch[1] : (titleMatch ? titleMatch[1] : '');
      if (!rawColorText) continue;

      // <br> をスペースに変換してHTMLタグ除去
      const colorText = rawColorText.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
      if (!colorText || colorText.length === 0) continue;

      // ナビゲーション要素・ブランド名・ECリンクを除外
      if (/Viva-net|ビバネット|AquaWave|コーモラン|CORMORAN|TOP|HOME|ホーム|お問い合わせ|EC\s*shop|ショップ|カート|お買い物/i.test(colorText)) continue;
      if (colorText.length > 80) continue; // 明らかに説明文が混入

      if (seenColors.has(colorText)) continue;
      seenColors.add(colorText);

      // 画像URL: フルサイズ > サムネイル
      const imageUrl = makeAbsolute(aHrefMatch ? aHrefMatch[1] : (imgMatch ? imgMatch[1] : ''));
      colors.push({ name: colorText, imageUrl });
    }
  }

  // Fallback: color_list が見つからない場合、<li><a><p>パターンを広めに検索
  if (colors.length === 0) {
    const allLiMatches = html.match(/<li[^>]*>\s*<a[^>]*>[\s\S]*?<\/a>\s*<\/li>/gi) || [];
    for (const li of allLiMatches) {
      const imgMatch = li.match(/<img[^>]+src=["']([^"']+)["']/i);
      const pMatch = li.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (imgMatch && pMatch) {
        const rawText = pMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
        if (!rawText || rawText.length === 0 || rawText.length > 80) continue;
        // サイトナビやブランド名を除外
        if (/Viva|AquaWave|コーモラン|CORMORAN|TOP|HOME|Bass|Namazu|Trout|Hard\s*Bait|Soft\s*Bait|NEW/i.test(rawText)) continue;
        if (seenColors.has(rawText)) continue;
        seenColors.add(rawText);
        colors.push({ name: rawText, imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  log(`Colors: ${colors.length}`);

  // --- Type detection ---
  const type = detectType(name, description);
  log(`Type: ${type}`);

  // --- Target fish ---
  const target_fish = deriveTargetFish(name, description);
  log(`Target fish: [${target_fish.join(', ')}]`);

  const result: ScrapedLure = {
    name,
    name_kana: '',
    slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type,
    target_fish,
    description,
    price,
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };

  log(`Done: ${name} | type=${type} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | price=${price}`);
  return result;
};
