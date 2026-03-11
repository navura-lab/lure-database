// scripts/_cleanup-non-lures.ts
// 非ルアー商品の削除 + 誤分類ルアーのtype修正
// /tmp/cleanup-categories.json + uncertain判定結果を統合実行

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DRY_RUN = process.argv.includes('--dry-run');

interface DeleteItem {
  manufacturer_slug: string;
  slug: string;
  reason: string;
}

interface ReclassifyItem {
  manufacturer_slug: string;
  slug: string;
  new_type: string;
  reason: string;
}

async function main() {
  // /tmp/cleanup-categories.json を読み込み
  const raw = JSON.parse(fs.readFileSync('/tmp/cleanup-categories.json', 'utf-8'));

  // uncertain判定結果を統合
  const deleteItems: DeleteItem[] = [
    ...raw.delete,
    // uncertain → delete
    { manufacturer_slug: '6th-sense', slug: 'my-boy-blue-youth-kids', reason: 'apparel (kids cap) - confirmed by description' },
  ];

  const reclassifyItems: ReclassifyItem[] = [
    ...raw.reclassify,
    // uncertain → reclassify
    { manufacturer_slug: 'lunkerhunt', slug: 'hive-typhon', new_type: 'ワーム', reason: 'tube worm - confirmed by description' },
    { manufacturer_slug: 'lunkerhunt', slug: 'link', new_type: 'トップウォーター', reason: 'jointed topwater - confirmed by description' },
    { manufacturer_slug: 'lunkerhunt', slug: 'nose-down-straight-up', new_type: 'ラバージグ', reason: 'jig - confirmed by description' },
    // bmc は DB に存在しないのでスキップ
  ];

  console.log(`\n=== 非ルアー削除: ${deleteItems.length}件 ===`);
  console.log(`=== ルアー再分類: ${reclassifyItems.length}件 ===`);
  console.log(`=== モード: ${DRY_RUN ? 'DRY RUN' : '本番実行'} ===\n`);

  // --- 削除 ---
  let deleteSuccess = 0;
  let deleteError = 0;

  for (const item of deleteItems) {
    if (DRY_RUN) {
      console.log(`[DRY] DELETE ${item.manufacturer_slug}/${item.slug} (${item.reason})`);
      deleteSuccess++;
      continue;
    }

    const { error, count } = await sb
      .from('lures')
      .delete({ count: 'exact' })
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug);

    if (error) {
      console.error(`❌ DELETE FAILED: ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      deleteError++;
    } else {
      console.log(`✅ DELETE ${item.manufacturer_slug}/${item.slug} (${count}行, ${item.reason})`);
      deleteSuccess++;
    }
  }

  // --- 再分類 ---
  let reclassifySuccess = 0;
  let reclassifyError = 0;

  for (const item of reclassifyItems) {
    if (DRY_RUN) {
      console.log(`[DRY] RECLASSIFY ${item.manufacturer_slug}/${item.slug} → ${item.new_type} (${item.reason})`);
      reclassifySuccess++;
      continue;
    }

    const { error, count } = await sb
      .from('lures')
      .update({ type: item.new_type })
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug);

    if (error) {
      console.error(`❌ RECLASSIFY FAILED: ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      reclassifyError++;
    } else {
      console.log(`✅ RECLASSIFY ${item.manufacturer_slug}/${item.slug} → ${item.new_type} (${item.reason})`);
      reclassifySuccess++;
    }
  }

  // --- サマリー ---
  console.log('\n=== サマリー ===');
  console.log(`削除: ${deleteSuccess}/${deleteItems.length} 成功, ${deleteError} エラー`);
  console.log(`再分類: ${reclassifySuccess}/${reclassifyItems.length} 成功, ${reclassifyError} エラー`);

  if (DRY_RUN) {
    console.log('\n⚠️ DRY RUNモード: 実際のDB変更は行われていません');
    console.log('本番実行: npx tsx scripts/_cleanup-non-lures.ts');
  }
}

main().catch(console.error);
