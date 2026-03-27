/**
 * 釣果検証に基づくtarget_fish修正スクリプト
 * data/audit/target-fish-verify-2026-03-23.json の34件分析結果から
 * 確実なもの12件のみ修正
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Fix {
  slug: string;
  manufacturer_slug: string;
  old_target_fish: string;
  new_target_fish: string[];
  reason: string;
}

const fixes: Fix[] = [
  {
    slug: 'saltybait',
    manufacturer_slug: 'duel',
    old_target_fish: 'シーバス',
    new_target_fish: ['青物', 'マダイ', 'ロックフィッシュ'],
    reason: '公式サイト/釣果でブリ/ヒラマサ/カンパチ/サワラ/シイラ/マダイ/ハタがhigh確度。シーバスは1件のみ',
  },
  {
    slug: 'hanto',
    manufacturer_slug: 'pazdesign',
    old_target_fish: 'トラウト',
    new_target_fish: ['青物'],
    reason: '海晴ハントはショアジギング用メタルジグ。ブリ/ヒラマサ/カンパチ/サワラ/シイラ全てhigh。トラウトは完全誤分類',
  },
  {
    slug: 'tg-keiji',
    manufacturer_slug: 'bozles',
    old_target_fish: '青物,マダイ,根魚',
    new_target_fish: ['青物', 'マダイ', '根魚', 'タチウオ'],
    reason: 'タチウオhigh(4件/3ソース)。既存は維持',
  },
  {
    slug: 'pila-pila-pilarin',
    manufacturer_slug: 'viva',
    old_target_fish: 'メバル',
    new_target_fish: ['メバル', 'アジ'],
    reason: 'アジhigh(6件/2ソース)。ライトゲームワームでアジは主要ターゲット',
  },
  {
    slug: 'cathymersey',
    manufacturer_slug: 'breaden',
    old_target_fish: 'メバル,アジ,カサゴ',
    new_target_fish: ['シーバス', '青物'],
    reason: '13gバイブレーション。ブリ9件high/シーバス6件high。メバル/アジ/カサゴは釣果確認なし',
  },
  {
    slug: 'bluegrass',
    manufacturer_slug: 'jazz',
    old_target_fish: '青物,シーバス',
    new_target_fish: ['青物', 'シーバス', 'アオリイカ'],
    reason: 'アオリイカhigh(3件/3ソース)。既存は維持',
  },
  {
    slug: 'taco-le-soft',
    manufacturer_slug: 'megabass',
    old_target_fish: 'ブラックバス',
    new_target_fish: ['タコ'],
    reason: 'TACO-LE Softはタコ釣り専用ルアー。タコ9件high。ブラックバスは完全誤分類',
  },
  {
    slug: 'gf-80',
    manufacturer_slug: 'jazz',
    old_target_fish: 'シーバス',
    new_target_fish: ['シーバス', 'ヒラメ'],
    reason: 'ヒラメmedium(2件/2ソース: alphatackle, jazz公式)。GF-暴君80はサーフ対応',
  },
  {
    slug: 'rapala-fxsk22',
    manufacturer_slug: 'rapala',
    old_target_fish: 'シーバス,トラウト',
    new_target_fish: ['青物', 'シイラ'],
    reason: '22cmペンシルベイト=オフショア/ショアキャスティング用。シイラhigh(3件3ソース)。シーバス/トラウトはlow(各1件)',
  },
  {
    slug: 'saltybait-wave',
    manufacturer_slug: 'duel',
    old_target_fish: 'シーバス',
    new_target_fish: ['青物', 'マダイ'],
    reason: '船釣り用ワーム。マダイhigh(4件3ソース)/ブリhigh(3件3ソース)。シーバスは1件low',
  },
  {
    slug: 'riraizu-s130',
    manufacturer_slug: 'maria',
    old_target_fish: 'アジ',
    new_target_fish: ['青物'],
    reason: 'リライズS130は130mmシンペン=ショアジギング/キャスティング用。ブリ/ヒラマサ/カンパチ/サワラ/シイラ全てhigh。アジは完全誤分類',
  },
  {
    slug: 'ebeech48',
    manufacturer_slug: 'madness',
    old_target_fish: 'アオリイカ',
    new_target_fish: ['メバル', 'アジ'],
    reason: 'shiriten EBEECH 48はライトゲーム用エビ型ルアー。メバルmedium(2件2ソース)。アオリイカは釣果確認なし',
  },
];

const dryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`=== target_fish釣果検証修正 (${dryRun ? 'DRY RUN' : 'APPLY'}) ===\n`);

  let totalRows = 0;

  for (const fix of fixes) {
    const { data: rows, error: countErr } = await sb
      .from('lures')
      .select('id, slug, manufacturer_slug, target_fish')
      .eq('manufacturer_slug', fix.manufacturer_slug)
      .eq('slug', fix.slug);

    if (countErr) {
      console.error(`ERROR: ${fix.manufacturer_slug}/${fix.slug}: ${countErr.message}`);
      continue;
    }

    if (!rows || rows.length === 0) {
      console.warn(`SKIP: ${fix.manufacturer_slug}/${fix.slug} - 該当行なし`);
      continue;
    }

    const currentFish = JSON.stringify(rows[0].target_fish);
    console.log(`${fix.manufacturer_slug}/${fix.slug} (${rows.length}行)`);
    console.log(`  現在: ${currentFish}`);
    console.log(`  修正: ${JSON.stringify(fix.new_target_fish)}`);
    console.log(`  理由: ${fix.reason}`);

    if (!dryRun) {
      const { error: updateErr } = await sb
        .from('lures')
        .update({ target_fish: fix.new_target_fish })
        .eq('manufacturer_slug', fix.manufacturer_slug)
        .eq('slug', fix.slug);

      if (updateErr) {
        console.error(`  UPDATE ERROR: ${updateErr.message}`);
      } else {
        console.log(`  OK ${rows.length}行更新`);
        totalRows += rows.length;
      }
    } else {
      totalRows += rows.length;
    }
    console.log();
  }

  console.log(`\n合計: ${fixes.length}商品, ${totalRows}行 ${dryRun ? '(dry run)' : '更新完了'}`);
}

main().catch(console.error);
