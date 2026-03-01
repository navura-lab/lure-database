import { getScraper } from './scrapers/index.js';

// Test Phase 3 scrapers with sample URLs
const tests: [string, string][] = [
  ['pickup', 'https://pickup-m.jp/product/worm-ss/'],
  ['shout', 'https://shout-net.com/product/curve-point/'],
  ['sea-falcon', 'https://seafalcon.jp/z-slow4/'],
  ['dreemup', 'https://dreem-up.com/darts-80s-2/'],
  ['pozidrive-garage', 'https://pdg.co.jp/product/slow-rider-sg-120/'],
  ['viva', 'https://www.viva316.com/products/detail/88'],
  ['yarie', 'https://www.yarie.co.jp/products/710-t-roll-sw/'],
  ['souls', 'https://www.souls-jp.com/product/tf-e50hs-2/'],
  ['grassroots', 'https://grassroots-kms.com/product/gb-d5/'],
  ['attic', 'https://attic.ne.jp/products/el-camino-sb/'],
];

async function main() {
  for (const [slug, url] of tests) {
    const scraper = getScraper(slug);
    if (!scraper) {
      console.log(`❌ ${slug}: No scraper registered`);
      continue;
    }
    try {
      console.log(`\nTesting ${slug}: ${url}`);
      const result = await scraper(url);
      console.log(`  ✅ name: ${result.name}`);
      console.log(`  colors: ${result.colors.length}`);
      console.log(`  weights: ${result.weights.length}`);
      console.log(`  price: ${result.price}`);
      if (result.colors.length > 0) {
        console.log(`  first color: ${result.colors[0].name} (img: ${result.colors[0].imageUrl ? 'yes' : 'no'})`);
      }
    } catch (err: any) {
      console.log(`  ❌ ERROR: ${err.message?.substring(0, 200)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
