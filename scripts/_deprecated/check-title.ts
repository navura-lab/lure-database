import { chromium } from 'playwright';

async function checkTitle(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const title = await page.title();
  console.log(url, '->', title.split('|')[0].trim());
  await browser.close();
}

const urls = process.argv.slice(2);
(async () => {
  for (const url of urls) {
    await checkTitle(url);
  }
})();
