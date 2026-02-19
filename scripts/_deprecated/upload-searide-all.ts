import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

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

// シーライドのカラー画像（BlueBlueFishingから取得）
const searideColors = [
  { num: '01', name: 'bluepink' },
  { num: '02', name: 'akakinglow' },
  { num: '03', name: 'chart-back-glow' },
  { num: '04', name: 'pink-glow' },
  { num: '05', name: 'gold-green' },
  { num: '06', name: 'blue-sardine' },
  { num: '07', name: 'red-gold' },
  { num: '08', name: 'silver-rainbow' },
];

async function uploadImage(sourceUrl: string, destPath: string): Promise<string> {
  console.log('Downloading:', sourceUrl);
  
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    }
  });
  
  if (!response.ok) {
    throw new Error('Download failed: ' + response.status);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  
  const resizedBuffer = await sharp(buffer)
    .resize({ width: 500, withoutEnlargement: true })
    .png({ quality: 85 })
    .toBuffer();
  
  console.log('Uploading:', destPath, '(' + resizedBuffer.length + ' bytes)');
  
  await s3Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: destPath,
    Body: resizedBuffer,
    ContentType: 'image/png',
  }));
  
  return R2_PUBLIC_URL + '/' + destPath;
}

async function main() {
  const results: { color: string; url: string }[] = [];
  
  for (const color of searideColors) {
    const sourceUrl = 'https://www.bluebluefishing.com/files/item/searaid/searaid/new2022/choka/searide_c' + color.num + '.jpg';
    const destPath = 'blueblue/sea-ride/' + color.name + '.png';
    
    try {
      const publicUrl = await uploadImage(sourceUrl, destPath);
      results.push({ color: color.name, url: publicUrl });
      console.log('OK:', color.name);
    } catch (err) {
      console.error('FAIL:', color.name, err);
    }
    
    // 1秒待機
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n=== Results ===');
  for (const r of results) {
    console.log(r.color + ': ' + r.url);
  }
  
  console.log('\nTotal:', results.length + '/' + searideColors.length);
}

main().catch(console.error);
