import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const s3 = new S3Client({
  region: process.env.R2_REGION || 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET || 'lure-db-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

async function main() {
  // DBからVIVA全商品の画像URLを取得
  const { data, error } = await sb
    .from('lures')
    .select('images')
    .eq('manufacturer_slug', 'viva');

  if (error || !data) {
    console.error('DB error:', error);
    return;
  }

  // DBに登録されている有効なR2キーのセットを構築
  const validKeys = new Set<string>();
  for (const row of data) {
    if (row.images) {
      for (const url of row.images) {
        // URLからキーを抽出: https://pub-xxx.r2.dev/viva/slug/01.webp -> viva/slug/01.webp
        const key = url.replace(R2_PUBLIC_URL + '/', '');
        validKeys.add(key);
      }
    }
  }
  console.log(`Valid DB image keys: ${validKeys.size}`);

  // R2のviva/プレフィックス配下の全オブジェクトをリスト
  let allR2Keys: string[] = [];
  let continuationToken: string | undefined;
  
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'viva/',
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    const resp = await s3.send(cmd);
    if (resp.Contents) {
      for (const obj of resp.Contents) {
        if (obj.Key) allR2Keys.push(obj.Key);
      }
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  console.log(`Total R2 objects under viva/: ${allR2Keys.length}`);

  // 孤児を特定（R2にあるがDBにない）
  const orphanKeys = allR2Keys.filter(key => !validKeys.has(key));
  console.log(`Orphan images to delete: ${orphanKeys.length}`);

  if (orphanKeys.length === 0) {
    console.log('No orphans found!');
    return;
  }

  // 最初の20件を表示
  console.log('\nFirst 20 orphans:');
  for (const key of orphanKeys.slice(0, 20)) {
    console.log(`  ${key}`);
  }

  // 1000件ずつバッチ削除（R2/S3の上限）
  let deleted = 0;
  for (let i = 0; i < orphanKeys.length; i += 1000) {
    const batch = orphanKeys.slice(i, i + 1000);
    const cmd = new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: batch.map(key => ({ Key: key })),
        Quiet: true,
      },
    });
    
    try {
      const resp = await s3.send(cmd);
      const batchErrors = resp.Errors?.length || 0;
      deleted += batch.length - batchErrors;
      if (batchErrors > 0) {
        console.log(`Batch ${Math.floor(i/1000)+1}: ${batch.length - batchErrors} deleted, ${batchErrors} errors`);
        resp.Errors?.forEach(e => console.log(`  Error: ${e.Key} - ${e.Message}`));
      } else {
        console.log(`Batch ${Math.floor(i/1000)+1}: ${batch.length} deleted`);
      }
    } catch (e: any) {
      console.error(`Batch ${Math.floor(i/1000)+1} failed:`, e.message);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total R2 objects (viva/): ${allR2Keys.length}`);
  console.log(`Valid (in DB): ${allR2Keys.length - orphanKeys.length}`);
  console.log(`Orphans deleted: ${deleted}`);
  console.log(`Remaining: ${allR2Keys.length - deleted}`);
}

main();
