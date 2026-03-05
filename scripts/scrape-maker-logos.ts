#!/usr/bin/env npx tsx
/**
 * メーカーロゴ スクレイピング & R2アップロード
 *
 * 各メーカー公式サイトのヘッダーからロゴ画像を取得し、
 * R2にアップロード → src/data/maker-logos.json に保存する。
 *
 * Usage:
 *   npx tsx scripts/scrape-maker-logos.ts           # 全メーカー
 *   npx tsx scripts/scrape-maker-logos.ts --dry-run  # 画像URLだけ表示
 *   npx tsx scripts/scrape-maker-logos.ts --maker daiwa  # 特定メーカーのみ
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// ─── Config ───────────────────────────────────────────

const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_REGION = process.env.R2_REGION || 'auto';

const DRY_RUN = process.argv.includes('--dry-run');
const MAKER_FILTER = process.argv.includes('--maker')
  ? process.argv[process.argv.indexOf('--maker') + 1]
  : null;

const OUTPUT_FILE = path.join(
  import.meta.dirname, '..', 'src', 'data', 'maker-logos.json',
);

// ─── Maker definitions ────────────────────────────────

interface MakerLogoConfig {
  slug: string;
  url: string;
  /** CSS selector for the logo <img>. Falls back to generic header img search. */
  selector?: string;
}

const MAKERS: MakerLogoConfig[] = [
  { slug: 'daiwa', url: 'https://www.daiwa.com/jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'tacklehouse', url: 'https://tacklehouse.co.jp/', selector: 'img[alt="TACKLEHOUSE"], a.navbar-brand img, header img' },
  { slug: 'jackall', url: 'https://www.jackall.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'majorcraft', url: 'https://www.majorcraft.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'rapala', url: 'https://rapala.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'luckycraft', url: 'https://www.luckycraft.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'geecrack', url: 'https://www.geecrack.com/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'shimano', url: 'https://fish.shimano.com/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'evergreen', url: 'https://www.evergreen-fishing.com/', selector: 'img[alt*="EVERGREEN"], a > img[src*="logo"], header img' },
  // 追加メーカーはここに足す
  { slug: 'megabass', url: 'https://www.megabass.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'osp', url: 'https://www.o-s-p.net/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'deps', url: 'https://www.depsweb.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'smith', url: 'https://www.smith.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'duo', url: 'https://www.duo-inc.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'ima', url: 'https://www.ima-ams.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'apia', url: 'https://www.apiajapan.com/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'zipbaits', url: 'https://www.zipbaits.com/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'tiemco', url: 'https://www.tiemco.co.jp/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'gancraft', url: 'https://gancraft.com/', selector: 'header img, .header img, [class*="logo"] img' },
  { slug: 'nories', url: 'https://nories.com/', selector: 'header img, .header img, [class*="logo"] img' },
];

// ─── R2 Client ────────────────────────────────────────

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ─── Helpers ──────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': new URL(url).origin + '/',
    },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processAndUpload(imageBuffer: Buffer, slug: string): Promise<string> {
  // Resize to max 200x200, keep aspect ratio, convert to WebP
  const webpBuffer = await sharp(imageBuffer)
    .resize({ width: 200, height: 200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } }) // white bg for transparency
    .webp({ quality: 85 })
    .toBuffer();

  const r2Key = `logos/${slug}.webp`;

  log(`  Uploading to R2: ${r2Key} (${(webpBuffer.length / 1024).toFixed(1)} KB)`);
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

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== Maker Logo Scraper ===');

  const targets = MAKER_FILTER
    ? MAKERS.filter(m => m.slug === MAKER_FILTER)
    : MAKERS;

  if (targets.length === 0) {
    log(`No maker found: ${MAKER_FILTER}`);
    process.exit(1);
  }

  log(`Targets: ${targets.length} makers${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // Load existing logos
  let logos: Record<string, string> = {};
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      logos = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    }
  } catch {
    // ignore
  }

  const results: { slug: string; status: string; url?: string }[] = [];

  for (const maker of targets) {
    log(`\n[${maker.slug}] ${maker.url}`);

    try {
      const page = await context.newPage();
      await page.goto(maker.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

      // Try to find logo image
      let logoUrl: string | null = null;

      // Strategy 1: Use the configured selector
      const selector = maker.selector || 'header img';
      const images = await page.$$(selector);

      for (const img of images) {
        const src = await img.getAttribute('src');
        const alt = (await img.getAttribute('alt'))?.toLowerCase() || '';
        const className = (await img.getAttribute('class'))?.toLowerCase() || '';
        const parentClass = await img.evaluate(el => el.parentElement?.className?.toLowerCase() || '');

        if (!src) continue;

        // Skip tiny tracking pixels, spacers
        const width = await img.evaluate(el => (el as HTMLImageElement).naturalWidth || el.getBoundingClientRect().width);
        if (width < 30) continue;

        // Prioritize images that look like logos
        const isLikelyLogo =
          alt.includes('logo') ||
          alt.includes(maker.slug) ||
          className.includes('logo') ||
          parentClass.includes('logo') ||
          src.includes('logo');

        // Use the first "likely logo" match, or fall back to the first header img
        if (isLikelyLogo || !logoUrl) {
          logoUrl = src.startsWith('http')
            ? src
            : src.startsWith('//')
              ? `https:${src}`
              : `${new URL(maker.url).origin}${src.startsWith('/') ? '' : '/'}${src}`;
        }

        if (isLikelyLogo) break; // Found a strong match
      }

      // Strategy 2: Check for <svg> logos if no img found
      if (!logoUrl) {
        const svgLogo = await page.$('header svg, [class*="logo"] svg');
        if (svgLogo) {
          // Extract SVG as data URI
          const svgHtml = await svgLogo.evaluate(el => el.outerHTML);
          if (svgHtml.length > 50 && svgHtml.length < 50000) {
            // Convert SVG to PNG buffer via sharp
            const svgBuffer = Buffer.from(svgHtml);
            if (!DRY_RUN) {
              const publicUrl = await processAndUpload(svgBuffer, maker.slug);
              logos[maker.slug] = publicUrl;
              results.push({ slug: maker.slug, status: 'ok (svg)', url: publicUrl });
              log(`  ✅ SVG logo → ${publicUrl}`);
            } else {
              log(`  📋 SVG logo found (${svgHtml.length} chars)`);
              results.push({ slug: maker.slug, status: 'dry-run (svg)' });
            }
            await page.close();
            continue;
          }
        }
      }

      if (!logoUrl) {
        log(`  ❌ No logo found`);
        results.push({ slug: maker.slug, status: 'not-found' });
        await page.close();
        continue;
      }

      log(`  Found: ${logoUrl.substring(0, 100)}`);

      if (DRY_RUN) {
        results.push({ slug: maker.slug, status: 'dry-run', url: logoUrl });
        await page.close();
        continue;
      }

      // Download and upload
      const imgBuffer = await downloadImage(logoUrl);
      const publicUrl = await processAndUpload(imgBuffer, maker.slug);
      logos[maker.slug] = publicUrl;
      results.push({ slug: maker.slug, status: 'ok', url: publicUrl });
      log(`  ✅ ${publicUrl}`);

      await page.close();
    } catch (e: any) {
      log(`  ❌ Error: ${e.message}`);
      results.push({ slug: maker.slug, status: `error: ${e.message}` });
    }
  }

  await browser.close();

  // Save logo mapping
  if (!DRY_RUN && Object.keys(logos).length > 0) {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(logos, null, 2) + '\n');
    log(`\nSaved ${Object.keys(logos).length} logos to ${OUTPUT_FILE}`);
  }

  // Summary
  log('\n=== Summary ===');
  const ok = results.filter(r => r.status.startsWith('ok')).length;
  const failed = results.filter(r => r.status === 'not-found' || r.status.startsWith('error')).length;
  log(`✅ Success: ${ok}`);
  log(`❌ Failed:  ${failed}`);
  for (const r of results) {
    log(`  ${r.status.startsWith('ok') || r.status.startsWith('dry') ? '✅' : '❌'} ${r.slug}: ${r.status}`);
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
