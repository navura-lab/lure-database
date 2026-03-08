// scripts/_test-global-scrapers.ts
// Strike King / Z-Man / Zoom スクレイパーの統合テスト

import { scrapeStrikeKingPage } from './scrapers/strike-king.js';
import { scrapeZManPage } from './scrapers/z-man.js';
import { scrapeZoomPage } from './scrapers/zoom.js';
import type { ScrapedLure } from './scrapers/types.js';

function printResult(label: string, url: string, result: ScrapedLure) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`[${label}] ${url}`);
  console.log('─'.repeat(70));
  console.log(`  名前: ${result.name}`);
  console.log(`  Slug: ${result.slug}`);
  console.log(`  メーカー: ${result.manufacturer} (${result.manufacturer_slug})`);
  console.log(`  タイプ: ${result.type}`);
  console.log(`  ターゲット: ${result.target_fish.join(', ')}`);
  console.log(`  価格: ¥${result.price}`);
  console.log(`  カラー数: ${result.colors.length}`);
  console.log(`  ウェイト: ${result.weights.length > 0 ? result.weights.map(w => w + 'g').join(', ') : 'なし'}`);
  console.log(`  長さ: ${result.length ? result.length + 'mm' : 'なし'}`);
  console.log(`  説明文: ${result.description.substring(0, 80)}...`);
  console.log(`  メイン画像: ${result.mainImage ? '✅' : '❌'}`);
  if (result.colors.length > 0) {
    console.log(`  カラー例: ${result.colors.slice(0, 3).map(c => c.name).join(', ')}`);
  }
}

async function testScraper(
  label: string,
  url: string,
  scraper: (url: string) => Promise<ScrapedLure>,
) {
  try {
    const result = await scraper(url);
    printResult(label, url, result);
    console.log(`  ✅ 成功`);
    return true;
  } catch (err) {
    console.log(`\n[${label}] ${url}`);
    console.log(`  ❌ エラー: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function main() {
  let pass = 0;
  let fail = 0;

  const tests: [string, string, (url: string) => Promise<ScrapedLure>][] = [
    // Strike King
    ['SK: クランク', 'https://www.strikeking.com/en/shop/hard-baits/hc4', scrapeStrikeKingPage],
    ['SK: ソフト', 'https://www.strikeking.com/en/shop/soft-baits/rgbug', scrapeStrikeKingPage],
    ['SK: バズ', 'https://www.strikeking.com/en/shop/wire-baits/tgbz38', scrapeStrikeKingPage],
    // Z-Man
    ['ZM: ChatterBait', 'https://zmanfishing.com/products/chatterbait-r-jackhammer', scrapeZManPage],
    ['ZM: Finesse TRD', 'https://zmanfishing.com/products/finesse-trd', scrapeZManPage],
    // Zoom
    ['ZO: Trick Worm', 'https://order.zoombait.com/tackle/trick-worm/', scrapeZoomPage],
    ['ZO: Fluke', 'https://order.zoombait.com/tackle/fluke/', scrapeZoomPage],
  ];

  for (const [label, url, scraper] of tests) {
    const ok = await testScraper(label, url, scraper);
    if (ok) pass++; else fail++;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`結果: ${pass} 成功, ${fail} 失敗 / ${tests.length} テスト`);
  console.log('='.repeat(70));
}

main().catch(console.error);
