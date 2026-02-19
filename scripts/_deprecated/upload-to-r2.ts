/**
 * Cloudflare R2 画像アップロードユーティリティ
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

// R2 Configuration
const R2_ENDPOINT = 'https://8ccd4c75c856d40d1cde0f1fdcc7f74d.r2.cloudflarestorage.com';
const R2_BUCKET = 'lure-db-images';
const R2_PUBLIC_URL = 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev';
const R2_ACCESS_KEY_ID = '0e9a7c94e211f5e200f0bcbed8527cda';
const R2_SECRET_ACCESS_KEY = '101b1f68300a91d45937e5797f3a1a473b7927cebc4c97743933d669350b88b1';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadImageToR2(
  sourceUrl: string,
  destPath: string,
  maxWidth: number = 500
): Promise<string> {
  console.log('[Download]', sourceUrl);
  
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'image/*,*/*',
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to download: ' + response.status);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  console.log('[Resize] max', maxWidth, 'px, size:', buffer.length, 'bytes');
  
  const resizedBuffer = await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .png({ quality: 85 })
    .toBuffer();
  
  console.log('[Upload]', destPath, 'size:', resizedBuffer.length, 'bytes');
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: destPath,
    Body: resizedBuffer,
    ContentType: 'image/png',
  });
  
  await s3Client.send(command);
  
  const publicUrl = R2_PUBLIC_URL + '/' + destPath;
  console.log('[Done]', publicUrl);
  
  return publicUrl;
}

// CLI
const args = process.argv.slice(2);
if (args.length >= 2) {
  uploadImageToR2(args[0], args[1])
    .then(url => console.log('Public URL:', url))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
