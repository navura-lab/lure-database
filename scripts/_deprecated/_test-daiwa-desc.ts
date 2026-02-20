import { chromium } from 'playwright';
import { scrapeDaiwaPage } from './scrapers/daiwa.js';

async function main() {
  const urls = [
    'https://www.daiwa.com/jp/product/huz2stf',  // TGベイト
    'https://www.daiwa.com/jp/product/tghykxg',  // モアザン モンスタースライダー
  ];

  for (const url of urls) {
    console.log('\n============================');
    console.log('Testing: ' + url);
    console.log('============================');
    const result = await scrapeDaiwaPage(url);
    console.log('\nDescription result:');
    console.log(result.description);
    console.log('\nDescription length: ' + result.description.length);
  }
}

main().catch(console.error);
