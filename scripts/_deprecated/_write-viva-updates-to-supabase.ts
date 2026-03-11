import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  let totalUpdated = 0;

  // 1. リライト結果の書き戻し
  const rewriteData = JSON.parse(fs.readFileSync('/tmp/viva-rewrite-output.json', 'utf-8'));
  console.log(`=== リライト: ${rewriteData.length}件 ===`);

  for (const item of rewriteData) {
    const { error, count } = await sb
      .from('lures')
      .update({ description: item.description })
      .eq('manufacturer_slug', 'viva')
      .eq('slug', item.slug);

    if (error) {
      console.error(`  ❌ ${item.slug}: ${error.message}`);
    } else {
      console.log(`  ✅ ${item.slug} (${item.description.length}文字)`);
      totalUpdated++;
    }
  }

  // 2. 再分類結果の書き戻し
  const reclassifyData = JSON.parse(fs.readFileSync('/tmp/viva-reclassify-output.json', 'utf-8'));
  console.log(`\n=== 再分類: ${reclassifyData.length}件 ===`);

  for (const item of reclassifyData) {
    const { error } = await sb
      .from('lures')
      .update({
        type: item.type,
        target_fish: item.target_fish,
      })
      .eq('manufacturer_slug', 'viva')
      .eq('slug', item.slug);

    if (error) {
      console.error(`  ❌ ${item.slug}: ${error.message}`);
    } else {
      console.log(`  ✅ ${item.slug}: type=${item.type}, fish=[${item.target_fish.join(',')}]`);
      totalUpdated++;
    }
  }

  console.log(`\n完了: ${totalUpdated}件更新`);

  // 3. 250文字超の説明文が残っていないか確認
  let allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from('lures')
      .select('slug, description')
      .eq('manufacturer_slug', 'viva')
      .order('slug')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    offset += data.length;
    if (data.length < 1000) break;
  }

  const unique = new Map<string, any>();
  for (const r of allRows) { if (!unique.has(r.slug)) unique.set(r.slug, r); }
  const longDesc = [...unique.values()].filter(r => r.description && r.description.length > 250);
  console.log(`\n250文字超の説明文: ${longDesc.length}件`);
  if (longDesc.length > 0) {
    for (const r of longDesc.slice(0, 5)) {
      console.log(`  ${r.slug}: ${r.description.length}文字`);
    }
  }

  // 4. type=その他 の件数確認
  const otherType = [...unique.values()].filter(r => {
    const row = allRows.find(a => a.slug === r.slug);
    return false; // この確認は別のクエリが必要
  });

  const { data: typeCheck } = await sb
    .from('lures')
    .select('slug, type')
    .eq('manufacturer_slug', 'viva')
    .eq('type', 'その他');
  const otherSlugs = new Set((typeCheck || []).map(r => r.slug));
  console.log(`type=その他: ${otherSlugs.size}件`);
}

main();
