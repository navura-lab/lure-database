import { scrapeCoremanPage } from './scrapers/coreman.js';

async function main() {
  console.log('=== COREMAN booster-system-123 ===');
  var cm1 = await scrapeCoremanPage('https://www.coreman.jp/product_lure/booster-system-123/');
  console.log('Name:', cm1.name);
  console.log('Type:', cm1.type);
  console.log('Colors:', cm1.colors.length);
  cm1.colors.forEach(function(c) { console.log('  ', c.name, '-', c.imageUrl.substring(0, 80)); });
  console.log('MainImage:', (cm1.mainImage || '').substring(0, 80));
  console.log('Description:', (cm1.description || '').substring(0, 100));
  process.exit(0);
}
main();
