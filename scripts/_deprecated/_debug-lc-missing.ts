// Quick debug script for LC missing pages
import { chromium } from 'playwright';

var URLS = [
  'https://www.luckycraft.co.jp/product/swlightgame/MLG/malas.html',
  'https://www.luckycraft.co.jp/product/namazu/KerollMax.html',
  'https://www.luckycraft.co.jp/product/namazu/Sammybug.html',
  'https://www.luckycraft.co.jp/product/area/bevyvib.html',
  'https://www.luckycraft.co.jp/product/bass/BFreeze.html',
  'https://www.luckycraft.co.jp/product/native/Raiou.html',
  'https://www.luckycraft.co.jp/product/swlightgame/Ika/EgiTribe.html',
  'https://www.luckycraft.co.jp/product/native/Kirari.html',
  'https://www.luckycraft.co.jp/product/bass/WakeTail.html',
];

async function main() {
  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage();

  for (var i = 0; i < URLS.length; i++) {
    var url = URLS[i];
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    var info = await page.evaluate(function () {
      var dn = document.querySelector('.text-name');
      var isNew = dn ? true : false;
      var headerAll = document.querySelector('[class*=header]');
      var headerClass = headerAll ? headerAll.className : 'none';
      var sel = '.headerArea, .headerSalt, .headerBass, .headerNative, .headerSW, .headerNamazu';
      var isOldFixed = document.querySelector(sel) ? true : false;
      var colorImgs = document.querySelectorAll('.tableColorImage img');
      var colorNames = document.querySelectorAll('.tableColorName');
      var itemlistRows = document.querySelectorAll('table.itemlist tbody tr');
      var details = document.querySelectorAll('details');

      return {
        isNew: isNew,
        headerClass: headerClass,
        isOldFixed: isOldFixed,
        oldColorImgs: colorImgs.length,
        oldColorNames: colorNames.length,
        newTableRows: itemlistRows.length,
        detailsCount: details.length,
      };
    });

    var shortUrl = url.split('/product/')[1];
    var hasColors = info.oldColorImgs > 0 || info.newTableRows > 0;
    console.log(
      (hasColors ? 'HAS_COLORS' : 'NO_COLORS') +
        ' | ' +
        (info.isNew ? 'NEW' : info.isOldFixed ? 'OLD' : 'UNK') +
        ' | header=' +
        info.headerClass +
        ' | oldImgs=' +
        info.oldColorImgs +
        ' | newRows=' +
        info.newTableRows +
        ' | details=' +
        info.detailsCount +
        ' | ' +
        shortUrl,
    );
  }

  await browser.close();
}

main();
