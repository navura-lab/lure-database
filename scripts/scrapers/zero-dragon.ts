// scripts/scrapers/zero-dragon.ts
// ZERO DRAGON (zero-dragon.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: Shop-Pro e-commerce platform (Color Me Shop)
// Product URL pattern: https://zero-dragon.com/?pid={PRODUCT_ID}
// JS object: var Colorme = { product: { name, sales_price, ... } }
// Product images from img02.shop-pro.jp
// Types: メタルジグ, タイラバ
// Target fish: マダイ, 青物
//
// ⚠️ カラー分裂問題対策（2026-03-23）:
// このサイトは1カラー=1商品ページ（別pid）。
// 商品名に「Valgo 60g ピンク（P）」のようにカラー名が含まれる。
// スクレイパーはサイトの商品一覧から同一ベース名の全カラーを収集し、
// 1つのScrapedLureとして返す。

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'ZERO DRAGON';
const MANUFACTURER_SLUG = 'zero-dragon';
const SITE_BASE = 'https://zero-dragon.com';
const DEFAULT_TARGET_FISH = ['マダイ', '青物'];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'ja,en;q=0.9',
};

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|metal\s*jig|ジグ|DENJIG|jig/i, 'メタルジグ'],
  [/タイラバ|鯛ラバ|tai\s*raba/i, 'タイラバ'],
  [/インチク|inchiku/i, 'インチク'],
  [/スロージグ|slow\s*jig/i, 'スロージグ'],
  [/ミノー|minnow/i, 'ミノー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/スプーン|spoon/i, 'スプーン'],
  [/ワーム|worm/i, 'ワーム'],
  [/プラグ|plug/i, 'プラグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [zero-dragon] ${msg}`);
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
  return 'メタルジグ';
}

function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  const taxInclMatch = cleaned.match(/税込[^\d]*([\d,]+)/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  const taxExclMatch = cleaned.match(/([\d,]+)円[（(]税別/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  const plainMatch = cleaned.match(/([\d,]+)円/);
  if (plainMatch) return parseInt(plainMatch[1].replace(/,/g, ''), 10);

  const yenMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

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

  if (/マダイ|真鯛|鯛|タイ|tai/i.test(combined)) fish.push('マダイ');
  if (/青物|ブリ|ハマチ|カンパチ|ヒラマサ/i.test(combined)) fish.push('青物');
  if (/根魚|ロック|カサゴ|ハタ/i.test(combined)) fish.push('ロックフィッシュ');
  if (/ヒラメ|マゴチ|フラット/i.test(combined)) fish.push('ヒラメ');
  if (/タチウオ|太刀魚/i.test(combined)) fish.push('タチウオ');
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/イカ|squid/i.test(combined)) fish.push('イカ');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

// ---------------------------------------------------------------------------
// カラー分裂対策: 商品名からベース名とカラー名を分離
// ---------------------------------------------------------------------------

/**
 * 商品名からカラー部分を除去してベース名を返す。
 *
 * パターン例:
 *   "Valgo　200g　オレンジホロ（OH）" → base="Valgo 200g", color="オレンジホロ（OH）"
 *   "DENJIG MIMIC 230g シルバー背腹グロー（SGCW)" → base="DENJIG MIMIC 230g", color="シルバー背腹グロー（SGCW)"
 *   "DENJIG LEAF 400g　オレンジゼブラ" → base="DENJIG LEAF 400g", color="オレンジゼブラ"
 */
function parseBaseName(fullName: string): { baseName: string; colorName: string } {
  // 全角スペースを半角に正規化
  const normalized = fullName.replace(/\u3000/g, ' ').trim();

  // パターン1: "{BaseName} {Weight}g {ColorName}（{Code}）" or "{BaseName} {Weight}g {ColorName}"
  // ウェイト(Ng)の後のテキストをカラーとして分離
  const weightColorMatch = normalized.match(
    /^(.+?\s+\d+(?:\.\d+)?\s*g)\s+(.+)$/i
  );
  if (weightColorMatch) {
    return {
      baseName: weightColorMatch[1].trim(),
      colorName: weightColorMatch[2].trim(),
    };
  }

  // パターン2: 末尾に括弧でカラーコード「{Name}（{Code}）」
  const trailingParenMatch = normalized.match(
    /^(.+?)\s+([^\s]+[（(][^）)]+[）)])\s*$/
  );
  if (trailingParenMatch) {
    return {
      baseName: trailingParenMatch[1].trim(),
      colorName: trailingParenMatch[2].trim(),
    };
  }

  // カラー分離できない場合はそのまま返す
  return { baseName: normalized, colorName: '' };
}

// ---------------------------------------------------------------------------
// EUC-JPページを取得してデコード
// ---------------------------------------------------------------------------

async function fetchEucJpPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const rawBytes = await res.arrayBuffer();
  return new TextDecoder('euc-jp').decode(rawBytes);
}

// ---------------------------------------------------------------------------
// Colorme JS からプロダクト名・価格を抽出
// ---------------------------------------------------------------------------

interface ColormeData {
  name: string;
  price: number;
  priceIncTax: number;
}

function extractColormeData(html: string): ColormeData {
  const result: ColormeData = { name: '', price: 0, priceIncTax: 0 };

  const colormeMatch = html.match(/var\s+Colorme\s*=\s*(\{[\s\S]*?\});/);
  if (!colormeMatch) return result;

  try {
    const nameMatch = colormeMatch[1].match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      try {
        result.name = JSON.parse(`"${nameMatch[1]}"`);
      } catch {
        result.name = nameMatch[1];
      }
    }

    const priceMatch = colormeMatch[1].match(/"sales_price"\s*:\s*(\d+)/);
    if (priceMatch) result.price = parseInt(priceMatch[1], 10);

    const priceIncMatch = colormeMatch[1].match(/"sales_price_including_tax"\s*:\s*(\d+)/);
    if (priceIncMatch) result.priceIncTax = parseInt(priceIncMatch[1], 10);
  } catch { /* ignore parse errors */ }

  return result;
}

// ---------------------------------------------------------------------------
// 商品一覧ページから全商品(pid, name)を取得
// ---------------------------------------------------------------------------

interface ProductEntry {
  pid: string;
  name: string;
  url: string;
}

async function fetchAllProducts(): Promise<ProductEntry[]> {
  const products: ProductEntry[] = [];
  const seenPids = new Set<string>();

  log('Fetching product listing to find color variants...');

  for (let pageNum = 1; pageNum <= 10; pageNum++) {
    const listUrl = `${SITE_BASE}/?mode=srh&sort=n&page=${pageNum}`;
    let html: string;
    try {
      // 商品一覧もEUC-JPの可能性があるが、リンクテキストのpidだけ取れればよい
      const res = await fetch(listUrl, { headers: FETCH_HEADERS });
      if (!res.ok) break;
      const rawBytes = await res.arrayBuffer();
      html = new TextDecoder('euc-jp').decode(rawBytes);
    } catch {
      break;
    }

    // 各商品ページのリンクとColorme名を取得
    // リンクパターン: href="/?pid=NNNN" with テキスト
    const linkRegex = /<a\s+[^>]*href="(?:https?:\/\/zero-dragon\.com)?\/?[?&]pid=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    let foundOnPage = 0;

    while ((match = linkRegex.exec(html)) !== null) {
      const pid = match[1];
      if (seenPids.has(pid)) continue;
      seenPids.add(pid);

      const linkText = stripHtml(match[2]).trim();
      if (!linkText) continue;

      products.push({
        pid,
        name: linkText,
        url: `${SITE_BASE}/?pid=${pid}`,
      });
      foundOnPage++;
    }

    if (foundOnPage === 0) break;

    // 適度な遅延
    if (pageNum < 10) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  log(`Found ${products.length} total products in listing`);
  return products;
}

// ---------------------------------------------------------------------------
// 同一ベース名の兄弟バリアントを検出
// ---------------------------------------------------------------------------

function findSiblingVariants(
  allProducts: ProductEntry[],
  baseName: string,
): ProductEntry[] {
  // ベース名でフィルタ: 各商品名をparseBaseNameして同一ベース名のものを収集
  return allProducts.filter(p => {
    const parsed = parseBaseName(p.name);
    return parsed.baseName === baseName;
  });
}

// ---------------------------------------------------------------------------
// 1つの商品ページからメイン画像を取得
// ---------------------------------------------------------------------------

function extractMainImage(html: string): string {
  // Shop-Pro商品画像: /product/ パスを含むURLを優先
  // ロゴ画像（PA01317983.jpg等）ではなく商品固有画像（product/NNNNN.jpg）を取得
  const productImgRegex = /<img[^>]+src=["'](https?:\/\/img\d+\.shop-pro\.jp\/[^"']*\/product\/[^"']+)["']/gi;
  let productImgMatch: RegExpExecArray | null;
  while ((productImgMatch = productImgRegex.exec(html)) !== null) {
    return productImgMatch[1];
  }

  // フォールバック: og:image
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) return ogImageMatch[1];

  // フォールバック: 任意のshop-pro画像（ロゴも含む）
  const shopProImg = html.match(/<img[^>]+src=["'](https?:\/\/img\d+\.shop-pro\.jp\/[^"']+)["']/i);
  if (shopProImg) return shopProImg[1];

  const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
  if (imgMatch) return imgMatch[1];

  return '';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export const scrapeZeroDragonPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  log(`Starting scrape: ${url}`);

  // --- 1) メインページを取得 ---
  const html = await fetchEucJpPage(url);
  const colorme = extractColormeData(html);

  // --- 2) 商品名を取得 ---
  let rawName = colorme.name || '';
  if (!rawName) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) rawName = stripHtml(h1Match[1]).trim();
  }
  if (!rawName) {
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) rawName = stripHtml(h2Match[1]).trim();
  }
  if (!rawName) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) rawName = stripHtml(titleMatch[1]).replace(/\s*[|｜–—].*$/, '').replace(/\s*ZERODRAGON.*$/i, '').replace(/\s*ZERO DRAGON.*$/i, '').trim();
  }
  if (!rawName) rawName = 'Unknown';
  log(`Raw product name: ${rawName}`);

  // --- 3) ベース名とカラー名を分離 ---
  const { baseName, colorName: currentColor } = parseBaseName(rawName);
  log(`Base name: "${baseName}", Color: "${currentColor}"`);

  // --- 4) slug はベース名から生成（カラー名を含めない） ---
  const slug = slugify(baseName) || 'zero-dragon-unknown';
  log(`Slug: ${slug}`);

  // --- 5) メイン画像 ---
  const mainImage = makeAbsolute(extractMainImage(html));
  log(`Main image: ${mainImage}`);

  // --- 6) 説明文 ---
  let description = '';
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (metaDescMatch && metaDescMatch[1].length > 20) {
    description = stripHtml(metaDescMatch[1]).substring(0, 500);
  }
  if (!description) {
    const descAreaMatch = html.match(/<div[^>]*class=["'][^"']*(?:product_description|product-detail|item_description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (descAreaMatch) {
      description = stripHtml(descAreaMatch[1]).substring(0, 500);
    }
  }
  if (!description) {
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 30 && !/spec|スペック|カラー|copyright|menu|nav/i.test(text.substring(0, 30))) {
        description = text.substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- 7) 価格 ---
  let price = colorme.priceIncTax || colorme.price || 0;
  if (price === 0) price = parsePrice(stripHtml(html));

  // --- 8) ウェイト（ベース名から） ---
  const bodyText = stripHtml(html);
  let weights = parseWeights(baseName);
  if (weights.length === 0) weights = parseWeights(bodyText);
  weights = Array.from(new Set(weights)).sort((a, b) => a - b);

  // --- 9) 長さ ---
  const length = parseLength(bodyText);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- 10) カラー収集: 商品一覧から同一ベース名の全バリアントを取得 ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // まずメインページのカラーを追加
  if (currentColor) {
    // カラー名から括弧内のコードを除去して表示名にする
    // 例: "オレンジホロ（OH）" → "オレンジホロ" をカラー名に、コードも保持
    const cleanColorName = currentColor.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || currentColor;
    seenColors.add(cleanColorName);
    colors.push({ name: cleanColorName, imageUrl: mainImage });
  }

  // 商品一覧ページから兄弟バリアントを検索
  if (currentColor) {
    // カラーが分離できた場合のみ兄弟検索を実行
    try {
      const allProducts = await fetchAllProducts();
      const siblings = findSiblingVariants(allProducts, baseName);
      log(`Found ${siblings.length} sibling variants for "${baseName}"`);

      // 兄弟バリアントの各ページからカラー名と画像を取得
      for (const sibling of siblings) {
        const siblingParsed = parseBaseName(sibling.name);
        if (!siblingParsed.colorName) continue;

        const sibColorClean = siblingParsed.colorName.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || siblingParsed.colorName;
        if (seenColors.has(sibColorClean)) continue;
        seenColors.add(sibColorClean);

        // 各バリアントページから画像を取得
        try {
          log(`Fetching sibling: ${sibling.name} (${sibling.url})`);
          const sibHtml = await fetchEucJpPage(sibling.url);
          const sibImage = makeAbsolute(extractMainImage(sibHtml));
          colors.push({ name: sibColorClean, imageUrl: sibImage });

          // 適度な遅延
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          log(`Failed to fetch sibling ${sibling.url}: ${err}`);
          // 画像なしでもカラー名は登録
          colors.push({ name: sibColorClean, imageUrl: '' });
        }
      }
    } catch (err) {
      log(`Failed to fetch product listing: ${err}`);
    }
  }

  // カラーが1つも取れなかった場合のフォールバック
  if (colors.length === 0) {
    // ページ内のfigure/img等からカラーを試行
    const figureMatches = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
    for (const fig of figureMatches) {
      const imgMatch = fig.match(/<img[^>]+src=["']([^"']+)["']/i);
      const captionMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      if (imgMatch && captionMatch) {
        const cName = stripHtml(captionMatch[1]).trim();
        if (cName && !seenColors.has(cName)) {
          seenColors.add(cName);
          colors.push({ name: cName, imageUrl: makeAbsolute(imgMatch[1]) });
        }
      }
    }
  }

  log(`Colors: ${colors.length} [${colors.map(c => c.name).join(', ')}]`);

  // --- 11) Type detection ---
  const type = detectType(baseName, description);
  log(`Type: ${type}`);

  // --- 12) Target fish ---
  const target_fish = deriveTargetFish(baseName, description);
  log(`Target fish: [${target_fish.join(', ')}]`);

  const result: ScrapedLure = {
    name: baseName,
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

  log(`Done: ${baseName} | type=${type} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | price=${price}`);
  return result;
};
