import { scrapeCoremanPage } from './scrapers/coreman.js';

async function main() {
  var urls = [
    'https://www.coreman.jp/product_lure/pb-20-powerblade/',
    'https://www.coreman.jp/product_lure/vj-36-vibration-jighead/',
    'https://www.coreman.jp/product_lure/booster-system-123/',
  ];
  for (var i = 0; i < urls.length; i++) {
    console.log('\n=== ' + urls[i].split('/product_lure/')[1] + ' ===');
    try {
      var r = await scrapeCoremanPage(urls[i]);
      console.log('Name:', r.name, '| Type:', r.type);
      console.log('Colors:', r.colors.length);
      r.colors.forEach(function(c) { console.log('  ', c.name, '|', c.imageUrl.substring(0, 60)); });
      console.log('Weights:', r.weights, '| Length:', r.length, '| Price:', r.price);
      console.log('MainImage:', (r.mainImage || '').substring(0, 60));
    } catch (e: any) { console.error('ERROR:', e.message); }
  }
  process.exit(0);
}
main();
