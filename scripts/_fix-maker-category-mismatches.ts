/**
 * メーカー公式カテゴリ検証で発見された target_fish 不一致を修正するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/_fix-maker-category-mismatches.ts           # ドライラン
 *   npx tsx scripts/_fix-maker-category-mismatches.ts --apply   # 実行
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

interface Fix {
  maker: string;
  slug: string;
  field: 'target_fish' | 'type';
  old_value: any;
  new_value: any;
  reason: string;
}

const FIXES: Fix[] = [
  // === palms ===
  // Thumbshad: FW（渓流トラウト用）なのに[青物,シーバス]になっている
  {
    maker: 'palms', slug: 'thumbshad',
    field: 'target_fish', old_value: ['青物', 'シーバス'], new_value: ['トラウト'],
    reason: '公式FWカテゴリ。渓流用ルアー',
  },
  // Jabami系: SW（シーバス等）なのに[トラウト]になっている
  {
    maker: 'palms', slug: 'jabami',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。シーバス用プラグ',
  },
  {
    maker: 'palms', slug: 'jabami-flat',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ',
  },
  {
    maker: 'palms', slug: 'jabami-lipless-175f',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。175mmのビッグベイト',
  },
  {
    maker: 'palms', slug: 'jabami-90cd',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ',
  },
  {
    maker: 'palms', slug: 'jabami-lipless',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ',
  },
  // SBC Lake Shore Slow: FWカテゴリ（湖岸スロージギング）なのに[トラウト]は正しい
  // → 修正不要（パターンマッチの誤検出）

  // === OSP ===
  // RUDRA/VARUNA SW版: シーバス用なのに[ブラックバス]
  {
    maker: 'osp', slug: 'asura-o-s-p-rudra-130-s',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。RUDRA 130 Sはシーバス用シンキングモデル',
  },
  {
    maker: 'osp', slug: 'asura-o-s-p-rudra-130-sp',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。RUDRA SW版',
  },
  {
    maker: 'osp', slug: 'asura-o-s-p-varuna-110-sp',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。VARUNA SW版',
  },
  {
    maker: 'osp', slug: 'asura-o-s-p-varuna-110-s',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。VARUNA Sはシーバス用',
  },
  {
    maker: 'osp', slug: 'louder50salt',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス', 'クロダイ'],
    reason: '公式SWカテゴリ。LOUDER50 SALTCOLORはソルト用',
  },

  // === Jackson ===
  // SW製品なのにトラウトになっている
  {
    maker: 'jackson', slug: 'nyoro-nyoro-85-105-125',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス', 'メバル'],
    reason: '公式SWカテゴリ。バチパターンの代表ルアー',
  },
  {
    maker: 'jackson', slug: 'tobisugi-daniel-14g-20g-30g-40g',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['青物', 'シーバス', 'ヒラメ'],
    reason: '公式SWカテゴリ。飛び過ぎダニエルはショアジギング用メタルジグ',
  },
  {
    maker: 'jackson', slug: 'shallow-swimmer125',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。125mmのシーバス用ミノー',
  },
  {
    maker: 'jackson', slug: 'athlete-12ss-14ss',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。Athlete SSはシーバス用ミノー',
  },
  {
    maker: 'jackson', slug: 'finesse-head',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['アジ', 'メバル'],
    reason: '公式SWカテゴリ。ライトゲーム用ジグヘッド',
  },
  {
    maker: 'jackson', slug: 'quick-head',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['アジ', 'メバル'],
    reason: '公式SWカテゴリ。ライトゲーム用ジグヘッド',
  },
  // athlete-55s-fh: 55mmでFHはトラウト/ライトゲーム両用。公式はSWだがトラウトページにも掲載
  // → トラウト/アジ/メバルの両方をつける
  {
    maker: 'jackson', slug: 'athlete-55s-fh',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['トラウト', 'アジ', 'メバル'],
    reason: '公式SW+Trout両カテゴリ。55mmサイズはトラウト/ライトゲーム両用',
  },
  // athlete-9jm: SW（メタルジグ）だがトラウトページにも掲載
  {
    maker: 'jackson', slug: 'athlete-9jm',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['トラウト', 'シーバス'],
    reason: '公式SW+Trout両カテゴリ',
  },

  // === Megabass ===
  // SW製品なのにバスになっている
  {
    maker: 'megabass', slug: 'makippa',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス', 'ヒラメ', '青物'],
    reason: '公式SWカテゴリ。キャスティングブレードジグ',
  },
  {
    maker: 'megabass', slug: 'makippa-50g-60g',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['青物', 'シーバス', 'ヒラメ'],
    reason: '公式SWカテゴリ。大型MAKIPPA',
  },
  {
    maker: 'megabass', slug: 'makippa-ffs',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス', 'ヒラメ', '青物'],
    reason: '公式SWカテゴリ',
  },
  {
    maker: 'megabass', slug: 'makippa-spinner',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス', 'ヒラメ', '青物'],
    reason: '公式SWカテゴリ',
  },
  {
    maker: 'megabass', slug: 'metal-x',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['青物', 'シーバス', 'ヒラメ'],
    reason: '公式SWカテゴリ。ソルト用メタルジグ',
  },
  {
    maker: 'megabass', slug: 'kagelou-md-125f',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。KAGELOUはシーバス用ミノーの代表格',
  },
  {
    maker: 'megabass', slug: 'x-nanahan',
    field: 'target_fish', old_value: ['トラウト'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ。X-NANAHANはシーバス用ミノー',
  },
  {
    maker: 'megabass', slug: 'x-nanahanplus1',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ',
  },
  {
    maker: 'megabass', slug: 'x-nanahanplus2',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['シーバス'],
    reason: '公式SWカテゴリ',
  },

  // === Evergreen ===
  {
    maker: 'evergreen', slug: 'capriceneo',
    field: 'target_fish', old_value: ['ブラックバス'], new_value: ['青物', 'シーバス'],
    reason: '公式SWカテゴリ。カプリスネオはソルト用メタルジグ',
  },

  // === 6th-sense SW版 ===
  // 6th-senseはバス専門だがSW版も出している → target_fishは正しい、specialtyチェックの誤検出
  // → 修正不要（maker-domains.jsonのtype修正で対応）

  // === Dranckrazy ===
  // dranckrazyはバスルアーも作る → target_fishは正しい
  // → maker-domains.jsonのtype修正で対応

  // === Gary Yamamoto SW版 ===
  // SW版にSW魚種 → 正しい
  // → maker-domains.jsonのtype修正で対応
];

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log(`=== メーカー公式カテゴリ検証 target_fish修正 ===`);
  console.log(`モード: ${APPLY ? '実行' : 'ドライラン'}`);
  console.log(`修正対象: ${FIXES.length}件\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const fix of FIXES) {
    console.log(`${fix.maker}/${fix.slug}: ${JSON.stringify(fix.old_value)} → ${JSON.stringify(fix.new_value)}`);
    console.log(`  理由: ${fix.reason}`);

    if (APPLY) {
      // 全行を更新（同じslugの全カラーバリエーション）
      const { data, error } = await sb.from('lures')
        .update({ [fix.field]: fix.new_value })
        .eq('manufacturer_slug', fix.maker)
        .eq('slug', fix.slug)
        .select('id');

      if (error) {
        console.error(`  ❌ エラー: ${error.message}`);
        errorCount++;
      } else {
        console.log(`  ✅ ${data?.length || 0}行更新`);
        successCount++;
      }
    }
  }

  if (APPLY) {
    console.log(`\n=== 結果 ===`);
    console.log(`成功: ${successCount}件`);
    console.log(`エラー: ${errorCount}件`);
  } else {
    console.log(`\n--apply フラグをつけて再実行すると修正が適用されます`);
  }
}

main().catch(console.error);
