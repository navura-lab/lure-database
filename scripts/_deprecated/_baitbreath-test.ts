import { scrapeBaitBreathPage } from './scrapers/baitbreath.js';

async function main() {
  // Test: UTF-8 page
  console.log('=== UTF-8 page (byscarlytail) ===');
  const r1 = await scrapeBaitBreathPage('http://www.baitbreath.net/byscarlytail.html');
  console.log(`Name: ${r1.name}`);
  console.log(`Colors(${r1.colors.length}): ${r1.colors.slice(0,3).map(c => c.name).join(', ')}`);
  console.log(`Image: ${r1.mainImage?.substring(0, 60)}`);
  console.log(`Color img: ${r1.colors[0]?.imageUrl?.substring(0, 60)}`);
  
  // Test: Shift-JIS page (wonderbaitspop)
  console.log('\n=== Shift-JIS page (wonderbaitspop) ===');
  const r2 = await scrapeBaitBreathPage('http://www.baitbreath.net/wonderbaitspop.html');
  console.log(`Name: ${r2.name}`);
  console.log(`Colors(${r2.colors.length}): ${r2.colors.slice(0,5).map(c => c.name).join(', ')}`);
  console.log(`Image: ${r2.mainImage?.substring(0, 60)}`);
}
main().catch(console.error);
