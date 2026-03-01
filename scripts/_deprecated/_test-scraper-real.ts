// Test scrapers with REAL URLs from discover
import { getScraper } from './scrapers/index.js';

async function testWithRealUrl(slug: string, url: string) {
  const scraper = getScraper(slug);
  if (!scraper) {
    console.log(`❌ ${slug}: No scraper registered`);
    return;
  }
  try {
    console.log(`\nTesting ${slug}: ${url}`);
    const result = await scraper(url);
    console.log(`  ✅ name: ${result.name}`);
    console.log(`  colors: ${result.colors.length}`);
    console.log(`  weights: ${result.weights.length}`);
    console.log(`  price: ${result.price}`);
    console.log(`  type: ${result.type}`);
    if (result.colors.length > 0) {
      console.log(`  first color: ${result.colors[0].name} (img: ${result.colors[0].imageUrl ? 'yes' : 'no'})`);
    }
  } catch (err: any) {
    console.log(`  ❌ ERROR: ${err.message?.substring(0, 300)}`);
  }
}

async function main() {
  // 1. PICKUP - from product-sitemap.xml
  console.log('\n=== Getting real PICKUP URL from sitemap ===');
  const pickupSitemap = await fetch('https://pickup-m.jp/product-sitemap.xml', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' }
  });
  if (pickupSitemap.ok) {
    const xml = await pickupSitemap.text();
    const match = xml.match(/<loc>(https:\/\/pickup-m\.jp\/product\/[^<]+)<\/loc>/);
    if (match) await testWithRealUrl('pickup', match[1]);
    else console.log('No PICKUP URLs in sitemap');
  } else {
    console.log('PICKUP sitemap: HTTP ' + pickupSitemap.status);
  }

  // 2. SHOUT - from /products/ page
  console.log('\n=== Getting real SHOUT URL ===');
  const shoutRes = await fetch('https://shout-net.com/products/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' }
  });
  if (shoutRes.ok) {
    const html = await shoutRes.text();
    const match = html.match(/<a\s+[^>]*href="((?:https?:\/\/shout-net\.com)?\/item\/[^"]+)"/i);
    if (match) {
      const url = match[1].startsWith('http') ? match[1] : 'https://shout-net.com' + match[1];
      await testWithRealUrl('shout', url);
    } else console.log('No SHOUT product URLs found');
  }

  // 3. SEA-FALCON - WP REST API
  console.log('\n=== Getting real SEA-FALCON URL ===');
  const sfRes = await fetch('https://seafalcon.jp/wp-json/wp/v2/posts?per_page=1');
  if (sfRes.ok) {
    const posts: any[] = await sfRes.json();
    if (posts.length > 0) await testWithRealUrl('sea-falcon', posts[0].link);
    else console.log('No SEA-FALCON posts');
  }

  // 4. ATTIC - from /products/
  console.log('\n=== Getting real ATTIC URL ===');
  const atticRes = await fetch('https://www.attic.ne.jp/products/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' }
  });
  if (atticRes.ok) {
    const html = await atticRes.text();
    const match = html.match(/<a\s+[^>]*href="((?:https?:\/\/(?:www\.)?attic\.ne\.jp)?\/products\/[^"]+)"/i);
    if (match) {
      const url = match[1].startsWith('http') ? match[1] : 'https://www.attic.ne.jp' + match[1];
      if (!/\/products\/?$/.test(url) && !/\/products\/page\//.test(url)) {
        await testWithRealUrl('attic', url);
      }
    }
  }

  // 5. DREEMUP - WP REST API custom post types
  console.log('\n=== Getting real DREEMUP URL ===');
  for (const postType of ['service', 'company', 'posts']) {
    const res = await fetch(`https://dreem-up.com/wp-json/wp/v2/${postType}?per_page=1`);
    if (res.ok) {
      const posts: any[] = await res.json();
      if (posts.length > 0) {
        await testWithRealUrl('dreemup', posts[0].link);
        break;
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
