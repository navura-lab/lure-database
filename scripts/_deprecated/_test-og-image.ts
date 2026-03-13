/**
 * OGP画像生成の単体テスト
 * npx tsx scripts/_test-og-image.ts
 */
import { generateOgImage } from '../src/lib/og-image';
import { writeFileSync } from 'fs';
import type { LureSeries } from '../src/lib/types';

// テスト用のダミーデータ
const testSeries: LureSeries = {
  slug: 'sasuke-120-reppa',
  name: 'サスケ 120 裂波',
  manufacturer: 'アイマ',
  manufacturer_slug: 'ima',
  type: 'ミノー',
  description: 'シーバスゲームの定番ミノー',
  target_fish: ['シーバス', 'ヒラスズキ', 'チヌ'],
  diving_depth: '30〜80cm',
  action_type: 'ウォブンロール',
  official_video_url: null,
  release_year: 2005,
  representative_image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/tacklehouse/ssv/12.webp',
  price_range: { min: 1870, max: 1870 },
  color_count: 24,
  colors: [],
  weight_range: { min: 17, max: 17 },
  length_range: { min: 120, max: 120 },
  created_at: '2024-01-01',
};

// 画像なしのテストケース
const testSeriesNoImage: LureSeries = {
  ...testSeries,
  slug: 'no-image-test',
  name: 'テスト ルアー 画像なし',
  representative_image: null,
};

async function main() {
  console.time('画像あり');
  const png1 = await generateOgImage(testSeries);
  writeFileSync('/tmp/og-test-with-image.png', png1);
  console.timeEnd('画像あり');
  console.log(`生成完了: /tmp/og-test-with-image.png (${(png1.length / 1024).toFixed(1)}KB)`);

  console.time('画像なし');
  const png2 = await generateOgImage(testSeriesNoImage);
  writeFileSync('/tmp/og-test-no-image.png', png2);
  console.timeEnd('画像なし');
  console.log(`生成完了: /tmp/og-test-no-image.png (${(png2.length / 1024).toFixed(1)}KB)`);
}

main().catch(console.error);
