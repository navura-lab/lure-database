// Quick test for the improved Maria scraper
import { scrapeMariaPage } from './scrapers/maria.js';

var testPages = [
  { url: 'https://www.yamaria.co.jp/maria/product/detail/166', desc: 'Standard layout (ボアーSS195)' },
  { url: 'https://www.yamaria.co.jp/maria/product/detail/138', desc: 'Legacy wh-tbl (デュプレックス)' },
  { url: 'https://www.yamaria.co.jp/maria/product/detail/136', desc: 'Legacy unstyled (ポップクイーンF50)' },
  { url: 'https://www.yamaria.co.jp/maria/product/detail/223', desc: 'No _main img (レガートF140)' },
  { url: 'https://www.yamaria.co.jp/maria/product/detail/135', desc: 'No spec table (ローデッドF140)' },
  { url: 'https://www.yamaria.co.jp/maria/product/detail/1', desc: 'ブルースコード C60 (ID=1)' },
];

(async () => {
  for (var tp of testPages) {
    console.log('\n=== ' + tp.desc + ' ===');
    console.log('URL:', tp.url);
    try {
      var r = await scrapeMariaPage(tp.url);
      console.log('Name:', r.name);
      console.log('Type:', r.type);
      console.log('Target:', r.target_fish.join(', '));
      console.log('Length:', r.length, '| Weights:', r.weights.join(', '));
      console.log('Colors:', r.colors.length);
      if (r.colors.length > 0) {
        console.log('  Sample:', r.colors.slice(0, 3).map(function(c) { return c.name; }).join(' | '));
      }
      console.log('MainImage:', r.mainImage ? 'YES (' + r.mainImage.split('/').pop() + ')' : 'NONE');

      var issues: string[] = [];
      if (r.name === '' || r.name === 'Unknown') issues.push('NO_NAME');
      if (r.mainImage === '') issues.push('NO_IMG');
      if (r.weights.length === 0) issues.push('NO_WT');
      if (r.colors.length === 0) issues.push('NO_CLR');
      if (r.length === null) issues.push('NO_LEN');
      console.log(issues.length > 0 ? 'ISSUES: ' + issues.join(', ') : 'RESULT: ALL OK');
    } catch (e: any) {
      console.log('ERROR:', e.message);
    }
  }
  console.log('\n=== DONE ===');
})();
