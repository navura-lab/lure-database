/**
 * BlueBlueFishing スクレイピング + R2アップロード
 */

import { chromium } from 'playwright';
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

async function uploadBufferToR2(buffer: Buffer, destPath: string): Promise<string> {
  const resizedBuffer = await sharp(buffer)
    .resize({ width: 500, withoutEnlargement: true })
    .png({ quality: 85 })
    .toBuffer();

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: destPath,
    Body: resizedBuffer,
    ContentType: 'image/png',
  });

  await s3Client.send(command);
  return R2_PUBLIC_URL + '/' + destPath;
}

interface ColorInfo {
  colorName: string;
  colorCode: string;
  imageUrl: string;
  r2Url?: string;
}

interface LureInfo {
  name: string;
  weights: string[];
  colors: ColorInfo[];
  description: string;
  price: string;
}

async function scrapeBlueBlueLure(productUrl: string): Promise<LureInfo> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('[Navigate]', productUrl);
  await page.goto(productUrl, { waitUntil: 'networkidle' });
  
  // 商品名取得
  const name = await page.locator('h1.product-name, .product-title h1').first().textContent() || 'Unknown';
  console.log('[Found] Name:', name.trim());
  
  // 説明取得
  const description = await page.locator('.product-description, .description').first().textContent() || '';
  
  // 価格取得
  const price = await page.locator('.price, .product-price').first().textContent() || '';
  
  // 重量取得
  const weights: string[] = [];
  const weightElements = await page.locator('.weight-option, .spec-weight').all();
  for (const el of weightElements) {
    const w = await el.textContent();
    if (w) weights.push(w.trim());
  }
  
  // カラー情報取得
  const colors: ColorInfo[] = [];
  const colorElements = await page.locator('.color-item, .color-option').all();
  
  for (const el of colorElements) {
    const colorName = await el.getAttribute('data-color-name') || await el.textContent() || '';
    const colorCode = await el.getAttribute('data-color-code') || '';
    
    // カラーをクリックして画像を取得
    await el.click();
    await page.waitForTimeout(500);
    
    const imgUrl = await page.locator('.product-image img, .main-image img').first().getAttribute('src') || '';
    
    colors.push({
      colorName: colorName.trim(),
      colorCode: colorCode.trim(),
      imageUrl: imgUrl,
    });
  }
  
  await browser.close();
  
  return {
    name: name.trim(),
    weights,
    colors,
    description: description.trim(),
    price: price.trim(),
  };
}

// CLI
const url = process.argv[2];
if (url) {
  scrapeBlueBlueLure(url)
    .then(info => {
      console.log('\n=== Result ===');
      console.log(JSON.stringify(info, null, 2));
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
} else {
  console.log('Usage: npx tsx scripts/scrape-blueblue.ts <product-url>');
}
