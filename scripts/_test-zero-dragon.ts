// scripts/_test-zero-dragon.ts
// zero-dragonスクレイパーのカラー統合テスト
// 使い方: npx tsx scripts/_test-zero-dragon.ts

import { scrapeZeroDragonPage } from './scrapers/zero-dragon.js';

async function main() {
  console.log('=== zero-dragon スクレイパー カラー統合テスト ===\n');

  // テスト1: Valgo 60g（5カラーあるはず）
  // pid=131412206 = "Valgo 60g イワシ（IW）"
  console.log('--- テスト1: Valgo 60g ---');
  const valgo60 = await scrapeZeroDragonPage('https://zero-dragon.com/?pid=131412206');
  console.log(`\n結果:`);
  console.log(`  name: ${valgo60.name}`);
  console.log(`  slug: ${valgo60.slug}`);
  console.log(`  weights: [${valgo60.weights.join(', ')}]`);
  console.log(`  price: ${valgo60.price}`);
  console.log(`  type: ${valgo60.type}`);
  console.log(`  colors (${valgo60.colors.length}):`);
  for (const c of valgo60.colors) {
    console.log(`    - ${c.name} → ${c.imageUrl.substring(0, 60)}...`);
  }

  // 検証
  const pass1 = valgo60.slug === 'valgo-60g';
  const pass2 = valgo60.colors.length >= 4; // 最低4カラー期待
  const pass3 = valgo60.name === 'Valgo 60g';
  console.log(`\n  ✅ slug = "valgo-60g": ${pass1 ? 'PASS' : 'FAIL (' + valgo60.slug + ')'}`);
  console.log(`  ✅ colors >= 4: ${pass2 ? 'PASS' : 'FAIL (' + valgo60.colors.length + ')'}`);
  console.log(`  ✅ name = "Valgo 60g": ${pass3 ? 'PASS' : 'FAIL (' + valgo60.name + ')'}`);

  console.log('\n--- テスト2: DENJIG MIMIC 230g ---');
  // pid=88985141 = "DENJIG MIMIC 230g シルバー背腹グロー（SGCW)"
  const mimic230 = await scrapeZeroDragonPage('https://zero-dragon.com/?pid=88985141');
  console.log(`\n結果:`);
  console.log(`  name: ${mimic230.name}`);
  console.log(`  slug: ${mimic230.slug}`);
  console.log(`  weights: [${mimic230.weights.join(', ')}]`);
  console.log(`  price: ${mimic230.price}`);
  console.log(`  type: ${mimic230.type}`);
  console.log(`  colors (${mimic230.colors.length}):`);
  for (const c of mimic230.colors) {
    console.log(`    - ${c.name} → ${c.imageUrl.substring(0, 60)}...`);
  }

  const pass4 = mimic230.slug === 'denjig-mimic-230g';
  const pass5 = mimic230.colors.length >= 4;
  const pass6 = mimic230.name === 'DENJIG MIMIC 230g';
  const pass7 = mimic230.type === 'メタルジグ';
  console.log(`\n  ✅ slug = "denjig-mimic-230g": ${pass4 ? 'PASS' : 'FAIL (' + mimic230.slug + ')'}`);
  console.log(`  ✅ colors >= 4: ${pass5 ? 'PASS' : 'FAIL (' + mimic230.colors.length + ')'}`);
  console.log(`  ✅ name = "DENJIG MIMIC 230g": ${pass6 ? 'PASS' : 'FAIL (' + mimic230.name + ')'}`);
  console.log(`  ✅ type = "メタルジグ": ${pass7 ? 'PASS' : 'FAIL (' + mimic230.type + ')'}`);

  console.log('\n=== テスト完了 ===');
  const allPass = pass1 && pass2 && pass3 && pass4 && pass5 && pass6 && pass7;
  console.log(allPass ? '✅ 全テストPASS' : '❌ 一部テストFAIL');
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('テストエラー:', err);
  process.exit(1);
});
