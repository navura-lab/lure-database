// scripts/_test-strike-king.ts
// Strike King スクレイパーのテスト

import { scrapeStrikeKingPage } from './scrapers/strike-king.js';

async function main() {
  const testUrls = [
    // ハードベイト: クランクベイト
    'https://www.strikeking.com/en/shop/hard-baits/hc4',
    // ソフトベイト: サイズバリアント付き
    'https://www.strikeking.com/en/shop/soft-baits/rgbug',
    // ワイヤーベイト: スピナーベイト
    'https://www.strikeking.com/en/shop/wire-baits/tgbz38',
  ];

  for (const url of testUrls) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`URL: ${url}`);
    console.log('='.repeat(70));

    try {
      const result = await scrapeStrikeKingPage(url);
      console.log(`名前: ${result.name}`);
      console.log(`Slug: ${result.slug}`);
      console.log(`タイプ: ${result.type}`);
      console.log(`ターゲット: ${result.target_fish.join(', ')}`);
      console.log(`価格: ¥${result.price} (USD → JPY概算)`);
      console.log(`カラー数: ${result.colors.length}`);
      console.log(`ウェイト: ${result.weights.length > 0 ? result.weights.map(w => w + 'g').join(', ') : 'なし'}`);
      console.log(`長さ: ${result.length ? result.length + 'mm' : 'なし'}`);
      console.log(`メイン画像: ${result.mainImage.substring(0, 80)}...`);
      console.log(`説明文: ${result.description.substring(0, 100)}...`);
      console.log(`カラー先頭3件:`);
      result.colors.slice(0, 3).forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.name} → ${c.imageUrl.substring(0, 80)}...`);
      });
      console.log(`✅ 成功`);
    } catch (err) {
      console.error(`❌ エラー: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch(console.error);
