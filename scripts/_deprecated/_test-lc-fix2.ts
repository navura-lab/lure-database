// Test remaining missing LC pages
import { scrapeLuckyCraftPage } from './scrapers/luckycraft.js';

var TEST_URLS = [
  'https://www.luckycraft.co.jp/product/swlightgame/Chinu/gunnish.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Chinu/Sammy.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Chinu/bfreeze.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Chinu/CCube.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Chinu/BevyPopper.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Jack/Areas.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Jack/BladeParts.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Haze/crapeamax.html',
  'https://www.luckycraft.co.jp/product/native/flashminnow.html',
  'https://www.luckycraft.co.jp/product/native/TwoTwicher.html',
  'https://www.luckycraft.co.jp/product/native/bfreezeayu.html',
  'https://www.luckycraft.co.jp/product/native/Kirari.html',
  'https://www.luckycraft.co.jp/product/bass/BFreeze.html',
];

async function main() {
  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    var shortUrl = url.split('/product/')[1];
    try {
      var result = await scrapeLuckyCraftPage(url);
      var imgCount = result.colors.filter(function (c) { return c.imageUrl; }).length;
      console.log(
        (result.colors.length > 0 ? 'OK' : 'FAIL') +
        ' | ' + result.colors.length + ' colors (' + imgCount + ' imgs)' +
        ' | main=' + (result.mainImage ? 'YES' : 'NO') +
        ' | ' + result.name +
        ' | ' + shortUrl
      );
    } catch (e: any) {
      console.log('ERROR | ' + (e.message || '').substring(0, 60) + ' | ' + shortUrl);
    }
  }
}

main();
