// scripts/_zero-dragon-fix.ts
// Zero Dragon 全353件の不正データを修正するスクリプト
//
// 問題:
//   1. slug: 日本語がUnicodeエスケープ風リテラル（u30b7u30ebu30d0u30fc等）
//   2. description: 全件文字化け（EUC-JPをUTF-8でデコードしたため）
//   3. color_name: 313/353件が(default) — カラー抽出失敗
//   4. images: R2パスに壊れたslugが使われている
//
// 根本原因: zero-dragon.comはEUC-JPだが、スクレイパーがUTF-8でデコードしていた
//
// 修正手順:
//   1. 全source_urlから再スクレイプ（EUC-JP対応済み）
//   2. 正しいslug, name, description, color_name を再生成
//   3. 画像を元サイトから再取得してR2にアップロード
//   4. Supabaseレコードを更新

import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '../src/lib/slugify.js';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;

const IMAGE_WIDTH = 500;
const MANUFACTURER_SLUG = 'zero-dragon';
const CONCURRENCY = 3; // 同時スクレイプ数（サイトに負荷をかけすぎない）
const DELAY_MS = 1000; // リクエスト間隔

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function makeAbsolute(href: string): string {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return 'https://zero-dragon.com' + href;
  return 'https://zero-dragon.com/' + href;
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

// ---------------------------------------------------------------------------
// Re-scrape a single page with EUC-JP decoding
// ---------------------------------------------------------------------------

interface ScrapedData {
  name: string;
  slug: string;
  description: string;
  price: number;
  weight: number | null;
  colorName: string;
  mainImageUrl: string;
}

async function scrapePage(url: string): Promise<ScrapedData> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  // EUC-JPで正しくデコード
  const rawBytes = await res.arrayBuffer();
  const html = new TextDecoder('euc-jp').decode(rawBytes);

  // --- Colorme JS object ---
  let colormeName = '';
  let colormePrice = 0;
  let colormePriceInc = 0;

  const colormeMatch = html.match(/var\s+Colorme\s*=\s*(\{[\s\S]*?\});/);
  if (colormeMatch) {
    try {
      const nameMatch = colormeMatch[1].match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        try {
          colormeName = JSON.parse(`"${nameMatch[1]}"`);
        } catch {
          colormeName = nameMatch[1];
        }
      }
      const priceMatch = colormeMatch[1].match(/"sales_price"\s*:\s*(\d+)/);
      if (priceMatch) colormePrice = parseInt(priceMatch[1], 10);
      const priceIncMatch = colormeMatch[1].match(/"sales_price_including_tax"\s*:\s*(\d+)/);
      if (priceIncMatch) colormePriceInc = parseInt(priceIncMatch[1], 10);
    } catch { /* ignore */ }
  }

  // --- Product name ---
  let name = colormeName || '';
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) name = stripHtml(h1Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜–—].*$/, '').replace(/\s*ZERODRAGON.*$/i, '').replace(/\s*ZERO DRAGON.*$/i, '').trim();
  }
  if (!name) name = 'Unknown';

  // --- Slug（統一slugify使用） ---
  const slug = slugify(name) || `zero-dragon-${Date.now()}`;

  // --- Description ---
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

  // --- Price ---
  let price = colormePriceInc || colormePrice || 0;
  if (price === 0) price = parsePrice(stripHtml(html));

  // --- Weight from name ---
  let weight: number | null = null;
  const weightMatch = name.match(/([\d.]+)\s*g/i);
  if (weightMatch) {
    const w = parseFloat(weightMatch[1]);
    if (w > 0 && w < 10000) weight = Math.round(w * 10) / 10;
  }

  // --- Color from name ---
  let colorName = '(default)';
  // パターン1: 括弧内のカラー名 — "DENJIG MIMIC 230g センターピンクライン（CPL）"
  const colorInParen = name.match(/[（(]([^）)]+)[）)]\s*$/);
  if (colorInParen) {
    colorName = colorInParen[1].trim();
  }
  // パターン2: 重量後のテキスト — "280g センターピンクライン"
  if (colorName === '(default)') {
    const afterWeight = name.match(/\d+\s*g[\s　]+(.+?)(?:\s*[（(]|$)/);
    if (afterWeight && afterWeight[1].trim().length > 1) {
      colorName = afterWeight[1].trim();
    }
  }
  // パターン3: 全角スペース後のテキスト — "DENJIG LEAF 270g　オレンジゼブラ"
  if (colorName === '(default)') {
    const afterZenkaku = name.match(/\d+\s*g\s*　(.+?)$/);
    if (afterZenkaku && afterZenkaku[1].trim().length > 1) {
      colorName = afterZenkaku[1].trim();
    }
  }

  // --- Main image ---
  let mainImageUrl = '';
  const shopProImg = html.match(/<img[^>]+src=["'](https?:\/\/img\d+\.shop-pro\.jp\/[^"']+)["']/i);
  if (shopProImg) mainImageUrl = shopProImg[1];
  if (!mainImageUrl) {
    const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
    if (ogImageMatch) mainImageUrl = ogImageMatch[1];
  }
  mainImageUrl = makeAbsolute(mainImageUrl);

  return { name, slug, description, price, weight, colorName, mainImageUrl };
}

// ---------------------------------------------------------------------------
// R2 image upload
// ---------------------------------------------------------------------------

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!response.ok) throw new Error(`Failed to download: ${response.status} ${imageUrl}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  const webpBuffer = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: webpBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== Zero Dragon データ修正開始 ===');

  // 1. 全レコード取得
  const { data: records, error } = await supabase
    .from('lures')
    .select('id, slug, name, color_name, weight, price, description, images, source_url')
    .eq('manufacturer_slug', MANUFACTURER_SLUG)
    .order('source_url');

  if (error) throw new Error(`Supabase fetch error: ${error.message}`);
  if (!records || records.length === 0) {
    log('レコードなし。終了。');
    return;
  }

  log(`対象レコード数: ${records.length}`);

  // 2. source_url ごとにグループ化（同じURLの複数ウェイト/カラーがある場合）
  const byUrl = new Map<string, typeof records>();
  for (const r of records) {
    const url = r.source_url || '';
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url)!.push(r);
  }
  log(`ユニークURL数: ${byUrl.size}`);

  // 3. 各URLを再スクレイプして修正
  let successCount = 0;
  let errorCount = 0;
  let imageUpdateCount = 0;
  const urlEntries = [...byUrl.entries()];

  for (let i = 0; i < urlEntries.length; i += CONCURRENCY) {
    const batch = urlEntries.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async ([url, recs]) => {
      if (!url) {
        log(`SKIP: source_url が空 (${recs.length}件)`);
        errorCount += recs.length;
        return;
      }

      try {
        const scraped = await scrapePage(url);
        log(`[${i + 1}/${urlEntries.length}] ${scraped.name} → slug: ${scraped.slug}, color: ${scraped.colorName}`);

        for (const rec of recs) {
          // 画像の再アップロード
          let newImages = rec.images;
          if (scraped.mainImageUrl) {
            try {
              const colorSlug = slugify(scraped.colorName).substring(0, 40) || '01';
              const r2Key = `${MANUFACTURER_SLUG}/${scraped.slug}/${colorSlug}.webp`;
              const publicUrl = await processAndUploadImage(scraped.mainImageUrl, r2Key);
              newImages = [publicUrl];
              imageUpdateCount++;
            } catch (imgErr) {
              log(`  画像アップロード失敗: ${imgErr instanceof Error ? imgErr.message : imgErr}`);
              // 画像失敗でもデータは更新する
            }
          }

          // Supabase更新
          const updates: Record<string, unknown> = {
            name: scraped.name,
            name_kana: scraped.name,
            slug: scraped.slug,
            description: scraped.description || null,
            price: scraped.price || rec.price,
            color_name: scraped.colorName,
          };
          if (scraped.weight !== null) updates.weight = scraped.weight;
          if (newImages) updates.images = newImages;

          const { error: updateErr } = await supabase
            .from('lures')
            .update(updates)
            .eq('id', rec.id);

          if (updateErr) {
            log(`  UPDATE失敗 id=${rec.id}: ${updateErr.message}`);
            errorCount++;
          } else {
            successCount++;
          }
        }
      } catch (err) {
        log(`ERROR: ${url}: ${err instanceof Error ? err.message : err}`);
        errorCount += recs.length;
      }
    }));

    // レート制限
    if (i + CONCURRENCY < urlEntries.length) {
      await sleep(DELAY_MS);
    }
  }

  // 4. 結果報告
  log('');
  log('=== 修正完了 ===');
  log(`成功: ${successCount} / ${records.length}`);
  log(`エラー: ${errorCount}`);
  log(`画像更新: ${imageUpdateCount}`);

  // 5. 修正後のデータ品質チェック
  const { data: afterData } = await supabase
    .from('lures')
    .select('slug, name, color_name, description')
    .eq('manufacturer_slug', MANUFACTURER_SLUG);

  if (afterData) {
    const badSlugs = afterData.filter(r => /u[0-9a-f]{4}/.test(r.slug));
    const badDesc = afterData.filter(r => r.description && /[�]/.test(r.description));
    const defaultColor = afterData.filter(r => r.color_name === '(default)');
    log(`修正後 - Bad slugs: ${badSlugs.length}, Bad desc: ${badDesc.length}, Default color: ${defaultColor.length}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
