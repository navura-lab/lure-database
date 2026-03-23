/**
 * dreemup target_fish修正スクリプト
 *
 * 公式サイト（dreem-up.com）の各商品ページおよびdescriptionから
 * 対象魚を確認し、全商品target_fish=["シーバス"]を正しい値に修正する。
 *
 * ソース根拠:
 * - peaky-head: 公式「アジング用にピーキーチューン」→ アジ
 * - maccam: 公式「アジングワームの定番」→ アジ, メバル
 * - glilin: 公式「尺メバル」「ギガアジ」→ メバル, アジ
 * - petit-ducker: 公式「アジやメバル…回遊魚からヒラメやマゴチ」
 * - dreem-shad: 公式「ヒラメやマゴチ…ハタ系…青物」
 * - kodou-vib: 公式「様々な魚種」desc「ギガアジ」「ヒラメ」
 * - fenlly: 公式「すべてのフィッシュイーター」アジ/メバル/ロックフィッシュ/シーバス/青物/ヒラメ
 * - dart8: 公式「ハタ系…カサゴ…クロダイ…アジ…シーバス」
 * - pixy-shad: 公式「アジ、メバルなどライトゲーム」
 * - petit-shad: 公式「小型回遊魚、カサゴ、メバル」desc「ヒラスズキ」
 * - lean-shad: desc「イワシなどの小魚をベイトに偏食したターゲット」→ 汎用ワーム
 * - deka-maccam: 公式「尺アジ、尺メバル」
 * - dorizarie: 公式「小型根魚…クロダイ…中大型ロックフィッシュ」
 * - petit-ducker-slim: desc「ライトショアジギング」→ 回遊魚, ヒラメ, マゴチ
 * - buriburi-head: 公式「タチウオ…大型カマス」desc「ドリームシャッド系」
 * - mosa-head-pro: 公式「尺メバル、ギガアジ」
 * - masa-head-dart: 公式「尺メバル、ギガアジ」desc「DD8専用」
 * - dd-head25: desc「小型回遊魚、カサゴ、メバル」
 * - ds-head30: desc「ハタ類…マゴチ、シーバス」
 * - ds-haed35: desc「ハタ類…青物」
 * - ds-head-deep: desc「大物」→ 青物, ハタ
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 公式サイト + description から確定した target_fish マッピング
const TARGET_FISH_MAP: Record<string, string[]> = {
  // ジグヘッド
  'peaky-head':      ['アジ'],                                    // 公式: アジング専用
  'mosa-head-pro':   ['メバル', 'アジ'],                          // 公式: 尺メバル、ギガアジ
  'masa-head-dart':  ['メバル', 'アジ'],                          // 公式: 尺メバル、ギガアジ
  'dd-head25':       ['メバル', 'カサゴ'],                        // desc: 小型回遊魚、カサゴ、メバル
  'ds-head30':       ['ハタ', 'マゴチ', 'シーバス'],              // desc: ハタ類、マゴチ、シーバス
  'ds-haed35':       ['ハタ', '青物'],                            // desc: ハタ類、青物
  'ds-head-deep':    ['青物', 'ハタ'],                            // desc: 大物向けヘビー級
  'buriburi-head':   ['タチウオ', 'カマス'],                      // 公式: タチウオ、大型カマス

  // ワーム
  'maccam':          ['アジ', 'メバル'],                          // 公式: アジングワームの定番
  'deka-maccam':     ['アジ', 'メバル'],                          // 公式: 尺アジ、尺メバル
  'glilin':          ['メバル', 'アジ'],                          // 公式: 尺メバル、ギガアジ
  'dart8':           ['ハタ', 'カサゴ', 'クロダイ', 'アジ', 'シーバス'], // 公式: ハタ、カサゴ、クロダイ、アジ、シーバス
  'pixy-shad':       ['アジ', 'メバル', 'カサゴ'],                // 公式: ライトゲーム全般
  'petit-shad':      ['メバル', 'カサゴ', 'シーバス'],            // 公式: 小型回遊魚、カサゴ、メバル + desc: ヒラスズキ
  'lean-shad':       ['シーバス', 'ヒラメ', 'マゴチ'],            // desc: ボトムサーチ、小魚偏食ターゲット
  'dreem-shad':      ['ヒラメ', 'マゴチ', 'ハタ', '青物'],       // 公式: ヒラメ、マゴチ、ハタ系、青物
  'dorizarie':       ['カサゴ', 'クロダイ', 'ハタ'],              // 公式: 小型根魚、クロダイ、中大型ロックフィッシュ

  // ハードルアー
  'kodou-vib':       ['アジ', 'メバル', 'シーバス', 'ヒラメ'],    // 公式: 様々な魚種、desc: ギガアジ、ヒラメ
  'fenlly':          ['アジ', 'メバル', 'シーバス', '青物', 'ヒラメ'], // 公式: 全フィッシュイーター
  'petit-ducker':    ['アジ', 'メバル', 'ヒラメ', 'マゴチ'],      // 公式: アジ、メバル、回遊魚、ヒラメ、マゴチ
  'petit-ducker-slim': ['青物', 'ヒラメ', 'マゴチ'],              // desc: ライトショアジギング
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`dreemup target_fish修正 (${dryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log('='.repeat(60));

  let totalRows = 0;
  let totalSlugs = 0;

  for (const [slug, newTargetFish] of Object.entries(TARGET_FISH_MAP)) {
    // 現在の値を確認
    const { data: current, error: fetchErr } = await sb
      .from('lures')
      .select('id, slug, target_fish')
      .eq('manufacturer_slug', 'dreemup')
      .eq('slug', slug);

    if (fetchErr) {
      console.error(`  ERROR fetching ${slug}:`, fetchErr.message);
      continue;
    }

    if (!current || current.length === 0) {
      console.warn(`  WARN: ${slug} not found in DB`);
      continue;
    }

    const oldTF = current[0].target_fish;
    const unchanged = JSON.stringify(oldTF) === JSON.stringify(newTargetFish);

    if (unchanged) {
      console.log(`  SKIP ${slug} (already correct: ${JSON.stringify(newTargetFish)})`);
      continue;
    }

    console.log(`  ${slug}: ${JSON.stringify(oldTF)} → ${JSON.stringify(newTargetFish)} (${current.length} rows)`);

    if (!dryRun) {
      const { error: updateErr, count } = await sb
        .from('lures')
        .update({ target_fish: newTargetFish })
        .eq('manufacturer_slug', 'dreemup')
        .eq('slug', slug);

      if (updateErr) {
        console.error(`    ERROR updating ${slug}:`, updateErr.message);
      } else {
        totalRows += current.length;
        totalSlugs++;
      }
    } else {
      totalRows += current.length;
      totalSlugs++;
    }
  }

  console.log('='.repeat(60));
  console.log(`完了: ${totalSlugs} slugs / ${totalRows} rows 更新${dryRun ? '（予定）' : ''}`);
}

main().catch(console.error);
