/**
 * mukai 全商品の画像をR2に再アップロードするスクリプト
 * - source_urlからpost IDを抽出
 * - WP REST APIでfeatured_media → attached media → content内画像の順で取得
 * - sharp + S3でR2にアップロード
 * - DBのimagesフィールドを更新
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_REGION = process.env.R2_REGION || 'auto';
const IMAGE_WIDTH = parseInt(process.env.IMAGE_WIDTH || '800');

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const API_BASE = 'https://www.mukai-fishing.jp/wp-json/wp/v2';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function log(msg: string) { console.log(`[${new Date().toISOString().substring(11,19)}] ${msg}`); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function fixUrl(url: string): string {
  return url.replace('mukai-finshing.jp', 'mukai-fishing.jp');
}

async function getPostId(sourceUrl: string): Promise<number | null> {
  const m = sourceUrl.match(/\/archives\/(\d+)(?:\.html)?/);
  return m ? parseInt(m[1]) : null;
}

async function fetchFeaturedImageUrl(mediaId: number): Promise<string | null> {
  if (mediaId <= 0) return null;
  try {
    const res = await fetch(`${API_BASE}/media/${mediaId}?_fields=id,source_url`, {
      headers: { 'User-Agent': UA }
    });
    if (!res.ok) return null;
    const media = await res.json() as any;
    return fixUrl(media.source_url || '');
  } catch { return null; }
}

async function fetchAttachedMediaUrl(postId: number): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/media?parent=${postId}&per_page=5&_fields=id,source_url,media_details`, {
      headers: { 'User-Agent': UA }
    });
    if (!res.ok) return null;
    const items = await res.json() as any[];
    if (!items.length) return null;
    const sorted = items
      .filter(m => m.source_url && /\.(jpe?g|png|webp)$/i.test(m.source_url))
      .sort((a, b) => {
        const aSize = (a.media_details?.width || 0) * (a.media_details?.height || 0);
        const bSize = (b.media_details?.width || 0) * (b.media_details?.height || 0);
        return bSize - aSize;
      });
    return sorted[0] ? fixUrl(sorted[0].source_url) : null;
  } catch { return null; }
}

function extractMainImageFromContent(html: string): string | null {
  // aligncenter または wp-post-image を優先
  const preferredMatch = html.match(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*(?:aligncenter|wp-post-image)[^"]*"/);
  if (preferredMatch) return fixUrl(preferredMatch[1]);
  // 最初のimgタグ
  const firstImg = html.match(/<img[^>]+src="([^"]+)"/);
  return firstImg ? fixUrl(firstImg[1]) : null;
}

async function resolveImage(postId: number, html: string, featuredMediaId: number): Promise<string | null> {
  const fromContent = extractMainImageFromContent(html);
  if (fromContent) return fromContent;
  const fromFeatured = await fetchFeaturedImageUrl(featuredMediaId);
  if (fromFeatured) return fromFeatured;
  return fetchAttachedMediaUrl(postId);
}

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const res = await fetch(imageUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`画像取得失敗: ${res.status} ${imageUrl}`);
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
  // 全mukai商品取得（mukai-fishing.jp直リンクのみ対象）
  const { data, error } = await sb.from('lures')
    .select('id,slug,name,color_name,source_url,images')
    .eq('manufacturer_slug', 'mukai');
  if (error) throw error;

  // slug単位でユニーク化（各slugの最初のレコードを代表に）
  const slugMap = new Map<string, { source_url: string; imageUrl: string; rows: any[] }>();
  for (const row of data!) {
    if (!slugMap.has(row.slug)) {
      slugMap.set(row.slug, { source_url: row.source_url, imageUrl: row.images?.[0] || '', rows: [] });
    }
    slugMap.get(row.slug)!.rows.push(row);
  }

  // mukai-fishing.jpg直リンクのslugのみ処理
  const targets = [...slugMap.entries()].filter(([, v]) => v.imageUrl.includes('mukai-fishing.jp'));
  log(`対象: ${targets.length}商品（R2未アップロード）`);

  let success = 0, failed = 0;

  for (const [slug, info] of targets) {
    try {
      const postId = await getPostId(info.source_url);
      if (!postId) { log(`  ⚠️ post ID取得失敗: ${slug}`); failed++; continue; }

      // WP REST APIでポスト情報取得
      const res = await fetch(`${API_BASE}/posts/${postId}?_fields=id,title,content,featured_media`, {
        headers: { 'User-Agent': UA }
      });
      if (!res.ok) { log(`  ⚠️ WP API失敗 ${res.status}: ${slug}`); failed++; continue; }
      const post = await res.json() as any;

      const imageUrl = await resolveImage(postId, post.content?.rendered || '', post.featured_media || 0);
      if (!imageUrl) { log(`  ⚠️ 画像URL取得失敗: ${slug}`); failed++; continue; }

      // R2にアップロード
      const r2Key = `lures/mukai/${slug}/main.webp`;
      const r2Url = await processAndUploadImage(imageUrl, r2Key);

      // DB更新（全カラー）
      const { error: updateError } = await sb.from('lures')
        .update({ images: [r2Url] })
        .eq('manufacturer_slug', 'mukai')
        .eq('slug', slug);
      if (updateError) throw updateError;

      log(`  ✅ ${slug}: ${imageUrl.split('/').pop()} → R2`);
      success++;
      await sleep(300); // レート制限
    } catch (e: any) {
      log(`  ❌ ${slug}: ${e.message}`);
      failed++;
    }
  }

  log(`\n完了: 成功${success}件, 失敗${failed}件`);
}

main().catch(e => { console.error(e); process.exit(1); });
