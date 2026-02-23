// Quick test for Bassday scraper — 4 product pages
import { scrapeBassdayPage } from './scrapers/bassday.js';

var testPages = [
  { url: 'https://www.bassday.co.jp/item/?i=97', desc: 'ハーデス75F (ソルト, 単一サイズ)' },
  { url: 'https://www.bassday.co.jp/item/?i=29', desc: 'レンジバイブ (マルチサイズ6種)' },
  { url: 'https://www.bassday.co.jp/item/?i=83', desc: 'Mononofu 35S (トラウト)' },
  { url: 'https://www.bassday.co.jp/item/?i=64', desc: 'バス商品' },
];

(async () => {
  for (var tp of testPages) {
    console.log('\n=== ' + tp.desc + ' ===');
    console.log('URL:', tp.url);
    try {
      var r = await scrapeBassdayPage(tp.url);
      console.log('Name:', r.name);
      console.log('Type:', r.type);
      console.log('Target:', r.target_fish.join(', '));
      console.log('Price:', r.price, 'yen');
      console.log('Length:', r.length, 'mm | Weights:', r.weights.join(', '), 'g');
      console.log('Colors:', r.colors.length);
      if (r.colors.length > 0) {
        console.log('  First 3:', r.colors.slice(0, 3).map(function(c) { return c.name + (c.imageUrl ? ' [img]' : ' [no-img]'); }).join(' | '));
      }
      console.log('MainImage:', r.mainImage ? 'YES (' + r.mainImage.split('/').pop() + ')' : 'NONE');
      console.log('Desc:', r.description.substring(0, 80) + (r.description.length > 80 ? '...' : ''));

      var issues: string[] = [];
      if (r.name === '' || r.name === 'Unknown') issues.push('NO_NAME');
      if (r.mainImage === '') issues.push('NO_IMG');
      if (r.weights.length === 0) issues.push('NO_WT');
      if (r.colors.length === 0) issues.push('NO_CLR');
      if (r.length === null) issues.push('NO_LEN');
      if (r.price === 0) issues.push('NO_PRICE');
      console.log(issues.length > 0 ? 'ISSUES: ' + issues.join(', ') : 'RESULT: ALL OK');
    } catch (e: any) {
      console.log('ERROR:', e.message);
    }
  }
  console.log('\n=== DONE ===');
})();
