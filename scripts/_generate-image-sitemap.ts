/**
 * 画像サイトマップ生成スクリプト
 * ビルド後に実行: npx tsx scripts/_generate-image-sitemap.ts
 */
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.castlog.xyz';
const CACHE_PATH = path.join(process.cwd(), '.cache/lures.json');
const OUTPUT_PATH = path.join(process.cwd(), 'dist/client/sitemap-images.xml');

interface LureRow {
  manufacturer_slug: string;
  slug: string;
  name: string;
  color_name: string;
  images: string[] | null;
}

function escapeXml(s: string): string {
  // XML 1.0で許可されない制御文字を除去（#x9, #xA, #xD以外の0x00-0x1F）
  const cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return cleaned.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function main() {
  const data: LureRow[] = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  
  // URLごとに画像をグルーピング
  const urlImages = new Map<string, {loc: string; images: {url: string; title: string}[]}>();
  
  for (const row of data) {
    if (!row.images?.length || row.manufacturer_slug === '__en__') continue;
    
    const pageUrl = `${SITE_URL}/${row.manufacturer_slug}/${row.slug}/`;
    
    if (!urlImages.has(pageUrl)) {
      urlImages.set(pageUrl, { loc: pageUrl, images: [] });
    }
    
    const entry = urlImages.get(pageUrl)!;
    for (const imgUrl of row.images) {
      if (imgUrl && !entry.images.some(i => i.url === imgUrl)) {
        entry.images.push({
          url: imgUrl,
          title: `${row.name} ${row.color_name || ''}`.trim(),
        });
      }
    }
  }
  
  // XML生成
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
  xml += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';
  
  let totalImages = 0;
  for (const [, entry] of urlImages) {
    if (entry.images.length === 0) continue;
    xml += `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n`;
    // 最大1000画像/URL（Googleの制限）
    for (const img of entry.images.slice(0, 1000)) {
      xml += `    <image:image>\n`;
      xml += `      <image:loc>${escapeXml(img.url)}</image:loc>\n`;
      xml += `      <image:title>${escapeXml(img.title)}</image:title>\n`;
      xml += `    </image:image>\n`;
      totalImages++;
    }
    xml += `  </url>\n`;
  }
  
  xml += '</urlset>';
  
  fs.writeFileSync(OUTPUT_PATH, xml);
  console.log(`画像サイトマップ生成完了: ${urlImages.size}ページ / ${totalImages}画像`);
  console.log(`出力: ${OUTPUT_PATH}`);
  
  // sitemap-index.xmlに追加
  const indexPath = path.join(process.cwd(), 'dist/client/sitemap-index.xml');
  if (fs.existsSync(indexPath)) {
    let indexXml = fs.readFileSync(indexPath, 'utf-8');
    if (!indexXml.includes('sitemap-images.xml')) {
      indexXml = indexXml.replace(
        '</sitemapindex>',
        `<sitemap><loc>${SITE_URL}/sitemap-images.xml</loc><lastmod>${new Date().toISOString()}</lastmod></sitemap>\n</sitemapindex>`
      );
      fs.writeFileSync(indexPath, indexXml);
      console.log('sitemap-index.xmlに画像サイトマップを追加');
    }
  }
}

main().catch(console.error);
