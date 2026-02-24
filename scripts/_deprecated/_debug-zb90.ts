import { chromium } from 'playwright';

async function main() {
  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage();
  await page.goto('https://www.zipbaits.com/item/?i=90', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  var data = await page.evaluate(function() {
    var colorArea = document.querySelector('#colorArea');
    if (!colorArea) return { error: 'No #colorArea' };

    // Check .color section
    var colorSection = colorArea.querySelector('.color');
    var colorHTML = colorSection ? colorSection.innerHTML.substring(0, 3000) : 'NO .color section';
    
    // Check article elements
    var articles = colorArea.querySelectorAll('.color article');
    
    // Check all child element tags within .color
    var colorChildren: string[] = [];
    if (colorSection) {
      var children = colorSection.children;
      for (var i = 0; i < Math.min(children.length, 20); i++) {
        colorChildren.push(children[i].tagName + '.' + children[i].className + ' (innerHTML: ' + children[i].innerHTML.substring(0, 200) + ')');
      }
    }

    // Check ALL elements that could be color containers
    var allImgs = colorArea.querySelectorAll('img');
    var imgInfo: string[] = [];
    for (var j = 0; j < Math.min(allImgs.length, 20); j++) {
      var src = allImgs[j].getAttribute('src') || '';
      var alt = allImgs[j].getAttribute('alt') || '';
      var parent = allImgs[j].parentElement;
      var parentInfo = parent ? parent.tagName + '.' + parent.className : 'none';
      imgInfo.push('[' + parentInfo + '] src=' + src.substring(0, 100) + ' alt=' + alt);
    }

    // Check if there are div or li elements as color containers instead of article
    var divs = colorArea.querySelectorAll('.color > div, .color > li, .color > a, .color > span');
    var divInfo: string[] = [];
    for (var k = 0; k < Math.min(divs.length, 10); k++) {
      divInfo.push(divs[k].tagName + '.' + divs[k].className + ' inner=' + divs[k].innerHTML.substring(0, 200));
    }

    return {
      colorSectionExists: !!colorSection,
      colorSectionClass: colorSection ? colorSection.className : '',
      articleCount: articles.length,
      colorChildren: colorChildren,
      imgCount: allImgs.length,
      imgInfo: imgInfo,
      altDivs: divInfo,
      colorHTMLPreview: colorHTML.substring(0, 2000),
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}
main();
