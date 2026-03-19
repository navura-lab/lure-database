// Forest公式ページの構造を詳しく調査
import 'dotenv/config';

async function main() {
  const testUrl = 'https://forestjp.com/products/native-lure/bells/';
  const r = await fetch(testUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const html = await r.text();

  // entry-contentの中身を確認
  const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    console.log('entry-content found:');
    console.log(contentMatch[1].substring(0, 500));
  } else {
    console.log('entry-content not found');
  }

  // 全テキストから日本語含む部分を探す
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n');

  const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
  const lines = text.split('\n').filter(l => l.trim().length > 10 && HAS_JP.test(l));
  console.log('\n日本語行:');
  lines.slice(0, 20).forEach(l => console.log(`  "${l.trim().substring(0, 120)}"`));

  // meta description
  const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  console.log('\nmeta description:', metaMatch ? metaMatch[1].substring(0, 200) : 'なし');

  // og:description
  const ogMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  console.log('og:description:', ogMatch ? ogMatch[1].substring(0, 200) : 'なし');

  // 2つ目のテスト: area-lureのmiu
  console.log('\n\n=== MIU 1.4g テスト ===');
  const r2 = await fetch('https://forestjp.com/products/area-lure/miu-1-4g/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html2 = await r2.text();
  const text2 = html2
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  const lines2 = text2.split('\n').filter(l => l.trim().length > 10 && HAS_JP.test(l));
  console.log('日本語行:');
  lines2.slice(0, 20).forEach(l => console.log(`  "${l.trim().substring(0, 120)}"`));

  const meta2 = html2.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  console.log('meta description:', meta2 ? meta2[1].substring(0, 200) : 'なし');
}

main().catch(console.error);
