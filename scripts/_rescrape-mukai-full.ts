/**
 * mukai全商品をWP REST APIから再スクレイプしてDBを更新する
 * source_urlがない商品が大半のため、_rescrape-maker.tsでは対応不可。
 * WP REST APIで全商品URLを取得→スクレイパー実行→DB更新の流れ。
 *
 * Usage:
 *   npx tsx scripts/_rescrape-mukai-full.ts --limit 10 --dry-run   # テスト
 *   npx tsx scripts/_rescrape-mukai-full.ts                        # 全件実行
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { scrapeMukaiPage } from './scrapers/mukai.js';
import {
  R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_REGION,
} from './config.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const IMAGE_WIDTH = 800;
const DELAY_BETWEEN_MS = 1_500;
const SCRAPE_TIMEOUT_MS = 30_000;
const MANUFACTURER_SLUG = 'mukai';
const API_BASE = 'https://www.mukai-fishing.jp/wp-json/wp/v2';

// スキップ対象（スクレイパーと同じ）
const SKIP_POST_IDS = new Set([
  2750, 2651, 2443, 2240, 2061, 1849, 318, 264, 203,
]);

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

interface WPPost {
  id: number;
  title: { rendered: string };
  link: string;
  categories: number[];
}

async function fetchAllPostUrls(): Promise<{ id: number; url: string; title: string }[]> {
  const all: { id: number; url: string; title: string }[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = `${API_BASE}/posts?categories=4&per_page=100&page=${page}&_fields=id,title,link,categories`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      if (res.status === 400) break;
      throw new Error(`WP API error: ${res.status}`);
    }
    const posts = await res.json() as WPPost[];
    for (const p of posts) {
      if (SKIP_POST_IDS.has(p.id)) continue;
      all.push({
        id: p.id,
        url: p.link,
        title: p.title.rendered.replace(/<[^>]+>/g, ''),
      });
    }
    log(`WP API page ${page}: ${posts.length}件`);
    if (posts.length < 100) break;
    await sleep(500);
  }
  return all;
}

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const webp = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: r2Key, Body: webp, ContentType: 'image/webp',
  }));
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1]) : 0;

  log(`=== mukai 全商品再スクレイプ ${dryRun ? '(DRY RUN)' : ''} ${limit > 0 ? `(limit: ${limit})` : '(全件)'} ===\n`);

  // 1) WP REST APIから全商品URLを取得
  log('WP REST APIから商品一覧取得...');
  let posts = await fetchAllPostUrls();
  log(`取得: ${posts.length}商品\n`);

  if (limit > 0) {
    posts = posts.slice(0, limit);
    log(`limit=${limit}件に制限\n`);
  }

  // 2) 既存DBのslug一覧を取得（type上書き防止用）
  const existingSlugs = new Map<string, { type: string; target_fish: string[] }>();
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from('lures')
      .select('slug, type, target_fish')
      .eq('manufacturer_slug', MANUFACTURER_SLUG)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!existingSlugs.has(r.slug)) {
        existingSlugs.set(r.slug, { type: r.type, target_fish: r.target_fish });
      }
    }
    offset += data.length;
    if (data.length < 1000) break;
  }
  log(`既存DB: ${existingSlugs.size} ユニークslug\n`);

  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let imagesUploaded = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    log(`[${i + 1}/${posts.length}] #${post.id} ${post.title.substring(0, 40)}`);

    try {
      // スクレイプ実行（タイムアウト付き）
      const result = await Promise.race([
        scrapeMukaiPage(post.url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${SCRAPE_TIMEOUT_MS}ms`)), SCRAPE_TIMEOUT_MS)
        ),
      ]);

      if (!result || !result.slug) {
        log(`  SKIP: スクレイプ結果なし`);
        skipped++;
        continue;
      }

      // type上書き防止: 既存typeがあればそれを使う
      const existing = existingSlugs.get(result.slug);
      const finalType = existing?.type || result.type;
      const finalTargetFish = existing?.target_fish || result.target_fish;

      const colorCount = result.colors?.length || 0;
      const weightCount = result.weights?.length || 0;

      log(`  slug=${result.slug}, type=${finalType}, ${colorCount}色, ${weightCount}ウェイト, desc=${(result.description || '').length}文字, img=${result.mainImage ? 'あり' : 'なし'}`);

      if (dryRun) {
        updated++;
        continue;
      }

      // 画像アップロード（カラー別）
      const imageUrls = new Map<string, string>();
      for (let c = 0; c < (result.colors || []).length; c++) {
        const color = result.colors[c];
        if (!color.imageUrl) continue;
        try {
          const r2Key = `${MANUFACTURER_SLUG}/${result.slug}/${c}.webp`;
          const publicUrl = await processAndUploadImage(color.imageUrl, r2Key);
          imageUrls.set(color.name, publicUrl);
          imagesUploaded++;
        } catch (e: any) {
          // 画像エラーは無視して続行
        }
      }

      // メイン画像フォールバック
      if (imageUrls.size === 0 && result.mainImage) {
        try {
          const r2Key = `${MANUFACTURER_SLUG}/${result.slug}/main.webp`;
          const publicUrl = await processAndUploadImage(result.mainImage, r2Key);
          imageUrls.set('__main__', publicUrl);
          imagesUploaded++;
        } catch {}
      }

      // ウェイトリスト
      const effectiveWeights: (number | null)[] = result.weights.length > 0
        ? result.weights
        : [null];

      // 各カラー×ウェイトのDB処理
      for (const color of (result.colors || [])) {
        const r2Url = imageUrls.get(color.name) || imageUrls.get('__main__') || '';

        for (const w of effectiveWeights) {
          // 既存チェック
          let query = sb
            .from('lures')
            .select('id, source_url, description, images')
            .eq('manufacturer_slug', MANUFACTURER_SLUG)
            .eq('slug', result.slug)
            .eq('color_name', color.name);

          if (w !== null) {
            query = query.eq('weight', w);
          } else {
            query = query.is('weight', null);
          }

          const { data: existingRows } = await query.limit(1);

          if (existingRows && existingRows.length > 0) {
            // 既存行を更新（source_url, description, images）
            const row = existingRows[0];
            const updates: Record<string, unknown> = {};

            // source_url設定
            if (!row.source_url) {
              updates.source_url = post.url;
            }

            // description更新（空 or 短い場合のみ）
            if (result.description && result.description.length > 10) {
              if (!row.description || row.description.length < 10) {
                updates.description = result.description;
              }
            }

            // 画像更新（なし→ありの場合）
            if (r2Url && (!row.images || row.images.length === 0)) {
              updates.images = [r2Url];
            }

            if (Object.keys(updates).length > 0) {
              await sb
                .from('lures')
                .update(updates)
                .eq('id', row.id);
              updated++;
            }
          } else {
            // 新規行を挿入
            await sb.from('lures').insert({
              manufacturer: 'MUKAI',
              manufacturer_slug: MANUFACTURER_SLUG,
              name: result.name,
              slug: result.slug,
              type: finalType,
              color_name: color.name,
              weight: w,
              length: result.length,
              price: result.price || null,
              images: r2Url ? [r2Url] : null,
              description: result.description || null,
              target_fish: finalTargetFish,
              source_url: post.url,
              is_limited: false,
              is_discontinued: false,
            });
            inserted++;
          }
        }
      }

    } catch (e: any) {
      log(`  ERR: ${e.message?.slice(0, 80)}`);
      errors++;
    }

    // サイトに優しく待つ
    if (i < posts.length - 1) {
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  log(`\n========================================`);
  log(`mukai 再スクレイプ完了`);
  log(`========================================`);
  log(`対象: ${posts.length}商品`);
  log(`更新: ${updated}行`);
  log(`新規: ${inserted}行`);
  log(`スキップ: ${skipped}`);
  log(`画像: ${imagesUploaded}枚`);
  log(`エラー: ${errors}`);
  log(`========================================`);
}

main().catch(e => {
  console.error(`Fatal: ${e}`);
  process.exit(1);
});
