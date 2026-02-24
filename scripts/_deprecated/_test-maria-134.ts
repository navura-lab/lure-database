import { scrapeMariaPage } from './scrapers/maria.js';

async function main() {
  // The one page with missing images
  var url = 'https://www.yamaria.co.jp/maria/product/detail/134';
  console.log('Testing: ' + url);

  try {
    var result = await scrapeMariaPage(url);
    console.log('Name: ' + result.name);
    console.log('Colors: ' + result.colors.length);

    for (var i = 0; i < result.colors.length; i++) {
      var c = result.colors[i];
      console.log('  [' + (i+1) + '] ' + c.name + ' → ' + (c.imageUrl ? 'IMG: ' + c.imageUrl.substring(0, 80) : '⚠️ NO IMG'));
    }

    console.log('Main image: ' + (result.mainImage ? result.mainImage.substring(0, 80) : 'NONE'));
    console.log('Weights: ' + result.weights.join(', '));
    console.log('Length: ' + result.length);
  } catch (e: any) {
    console.error('ERROR: ' + e.message);
  }
}
main();
