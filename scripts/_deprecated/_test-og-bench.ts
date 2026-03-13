/**
 * OGP画像生成のスループットベンチマーク
 */
import { generateOgImage } from '../src/lib/og-image';
import type { LureSeries } from '../src/lib/types';

const testSeries: LureSeries = {
  slug: 'test',
  name: 'サスケ 120 裂波',
  manufacturer: 'アイマ',
  manufacturer_slug: 'ima',
  type: 'ミノー',
  description: null,
  target_fish: ['シーバス', 'ヒラスズキ'],
  diving_depth: null,
  action_type: null,
  official_video_url: null,
  release_year: null,
  representative_image: null, // 画像なし
  price_range: { min: 1870, max: 1870 },
  color_count: 24,
  colors: [],
  weight_range: { min: 17, max: 17 },
  length_range: { min: 120, max: 120 },
  created_at: '2024-01-01',
};

async function main() {
  const N = 50;

  // ウォームアップ
  await generateOgImage(testSeries);

  const start = Date.now();
  for (let i = 0; i < N; i++) {
    await generateOgImage({ ...testSeries, name: `テストルアー ${i}` });
  }
  const elapsed = Date.now() - start;

  console.log(`${N}枚: ${elapsed}ms (${(elapsed / N).toFixed(1)}ms/枚)`);
  console.log(`6160枚の推定: ${((elapsed / N) * 6160 / 1000 / 60).toFixed(1)}分`);
}

main().catch(console.error);
