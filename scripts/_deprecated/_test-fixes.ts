import { scrapeZipbaitsPage } from './scrapers/zipbaits.js';
import { scrapeCoremanPage } from './scrapers/coreman.js';

async function main() {
  console.log('=== ZIPBAITS ?i=90 ===');
  try {
    var zb = await scrapeZipbaitsPage('https://www.zipbaits.com/item/?i=90');
    console.log('Name:', zb.name);
    console.log('Colors:', zb.colors.length);
    zb.colors.forEach(function(c) { console.log('  ', c.name, '-', c.imageUrl.substring(0, 80)); });
    console.log('Weights:', zb.weights);
    console.log('Length:', zb.length);
    console.log('Price:', zb.price);
    console.log('MainImage:', zb.mainImage.substring(0, 80));
  } catch (e: any) { console.error('ZIPBAITS ERROR:', e.message); }

  console.log('\n=== COREMAN booster-system-123 ===');
  try {
    var cm1 = await scrapeCoremanPage('https://www.coreman.jp/product_lure/booster-system-123/');
    console.log('Name:', cm1.name);
    console.log('Colors:', cm1.colors.length);
    cm1.colors.forEach(function(c) { console.log('  ', c.name, '-', c.imageUrl.substring(0, 80)); });
    console.log('Weights:', cm1.weights);
    console.log('Price:', cm1.price);
    console.log('Description:', (cm1.description || '').substring(0, 100));
  } catch (e: any) { console.error('COREMAN1 ERROR:', e.message); }

  console.log('\n=== COREMAN alkali-70 (stub page) ===');
  try {
    var cm2 = await scrapeCoremanPage('https://www.coreman.jp/product_lure/alkali-70%e3%8e%9c/');
    console.log('Name:', cm2.name);
    console.log('Colors:', cm2.colors.length);
    cm2.colors.forEach(function(c) { console.log('  ', c.name, '-', c.imageUrl.substring(0, 80)); });
    console.log('MainImage:', cm2.mainImage);
  } catch (e: any) { console.error('COREMAN2 ERROR:', e.message); }

  process.exit(0);
}
main();
