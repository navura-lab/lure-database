// scripts/_test-littlejack.ts
// Test the Little Jack scraper against known product pages.
//
// Usage: npx tsx scripts/_test-littlejack.ts

import { scrapeLittleJackPage } from './scrapers/littlejack.js';

interface TestCase {
  url: string;
  name: string;
  checks: {
    minColors: number;
    expectType?: string;
    expectWeights?: boolean;
    expectLength?: boolean;
    expectPrice?: boolean;
    expectMainImage?: boolean;
  };
}

var TEST_CASES: TestCase[] = [
  {
    url: 'https://www.little-jack-lure.com/?page_id=3151',
    name: 'METAL ADICT type03 (メタルジグ、複数ウエイト、カラーチャート2セット)',
    checks: {
      minColors: 8,
      expectType: 'メタルジグ',
      expectWeights: true,
      expectLength: true,
      expectPrice: true,
      expectMainImage: true,
    },
  },
  {
    url: 'https://www.little-jack-lure.com/?page_id=3127',
    name: 'SAYORIS-Z (シンキングペンシル、2サイズ)',
    checks: {
      minColors: 5,
      expectWeights: true,
      expectLength: true,
      expectPrice: true,
      expectMainImage: true,
    },
  },
  {
    url: 'https://www.little-jack-lure.com/?page_id=2810',
    name: 'EBINEM (エビ型ジグ、キャプションなしカラー → JAN CODE フォールバック)',
    checks: {
      minColors: 5,
      expectWeights: true,
      expectPrice: true,
      expectMainImage: true,
    },
  },
  {
    url: 'https://www.little-jack-lure.com/?page_id=4373',
    name: 'Gillary-01 (最新商品)',
    checks: {
      minColors: 3,
      expectMainImage: true,
    },
  },
];

async function runTests() {
  var passed = 0;
  var failed = 0;

  for (var i = 0; i < TEST_CASES.length; i++) {
    var tc = TEST_CASES[i];
    console.log('\n========================================');
    console.log('TEST ' + (i + 1) + '/' + TEST_CASES.length + ': ' + tc.name);
    console.log('URL: ' + tc.url);
    console.log('========================================');

    try {
      var result = await scrapeLittleJackPage(tc.url);
      var errors: string[] = [];

      // Check name
      if (!result.name || result.name === 'Unknown') {
        errors.push('名前が取得できていない: ' + result.name);
      }

      // Check colors
      if (result.colors.length < tc.checks.minColors) {
        errors.push('カラー数不足: ' + result.colors.length + ' < ' + tc.checks.minColors);
      }

      // Check color images
      var emptyImages = result.colors.filter(function(c) { return !c.imageUrl; }).length;
      if (emptyImages > 0) {
        errors.push('画像なしカラー: ' + emptyImages + '/' + result.colors.length);
      }

      // Check color names
      var emptyNames = result.colors.filter(function(c) { return !c.name; }).length;
      if (emptyNames > 0) {
        errors.push('名前なしカラー: ' + emptyNames + '/' + result.colors.length);
      }

      // Check type
      if (tc.checks.expectType && result.type !== tc.checks.expectType) {
        errors.push('タイプ不一致: "' + result.type + '" !== "' + tc.checks.expectType + '"');
      }

      // Check weights
      if (tc.checks.expectWeights && result.weights.length === 0) {
        errors.push('ウエイトが取得できていない');
      }

      // Check length
      if (tc.checks.expectLength && result.length === null) {
        errors.push('全長が取得できていない');
      }

      // Check price
      if (tc.checks.expectPrice && result.price === 0) {
        errors.push('価格が取得できていない');
      }

      // Check main image
      if (tc.checks.expectMainImage && !result.mainImage) {
        errors.push('メイン画像が取得できていない');
      }

      // Print results
      console.log('  名前: ' + result.name);
      console.log('  Slug: ' + result.slug);
      console.log('  タイプ: ' + result.type);
      console.log('  カラー: ' + result.colors.length + '色');
      if (result.colors.length > 0) {
        console.log('    最初: ' + result.colors[0].name + ' → ' + result.colors[0].imageUrl.substring(0, 80));
        console.log('    最後: ' + result.colors[result.colors.length - 1].name);
      }
      console.log('  画像取得率: ' + result.colors.filter(function(c) { return !!c.imageUrl; }).length + '/' + result.colors.length + ' (' + (result.colors.length > 0 ? Math.round(result.colors.filter(function(c) { return !!c.imageUrl; }).length / result.colors.length * 100) : 0) + '%)');
      console.log('  ウエイト: ' + (result.weights.length > 0 ? result.weights.join(', ') + 'g' : 'なし'));
      console.log('  全長: ' + (result.length !== null ? result.length + 'mm' : 'なし'));
      console.log('  価格: ' + (result.price > 0 ? '¥' + result.price : 'なし'));
      console.log('  メイン画像: ' + (result.mainImage ? result.mainImage.substring(0, 80) + '...' : 'なし'));
      console.log('  対象魚: ' + (result.target_fish.length > 0 ? result.target_fish.join(', ') : 'なし'));

      if (errors.length > 0) {
        console.log('\n  ❌ FAILED:');
        errors.forEach(function(e) { console.log('    - ' + e); });
        failed++;
      } else {
        console.log('\n  ✅ PASSED');
        passed++;
      }
    } catch (err: any) {
      console.log('  ❌ FAILED: ' + err.message);
      failed++;
    }

    // Rate limit
    if (i < TEST_CASES.length - 1) {
      await new Promise(function(resolve) { setTimeout(resolve, 1500); });
    }
  }

  console.log('\n========================================');
  console.log('RESULTS: ' + passed + '/' + TEST_CASES.length + ' passed, ' + failed + ' failed');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
