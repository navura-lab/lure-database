import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('id, slug, name, color_name').eq('manufacturer_slug', 'spro');
  if (!data) return;

  // shimmy-flat, shimmy-semi-long, tempamon のカラー別slugを検出
  const mergeGroups: Record<string, { targetSlug: string; records: typeof data }> = {};
  
  for (const r of data) {
    // shimmy-flat-XXX → shimmy-flat
    if (/^shimmy-flat-/.test(r.slug) && r.slug !== 'shimmy-flat') {
      const group = mergeGroups['shimmy-flat'] || { targetSlug: 'shimmy-flat', records: [] };
      group.records.push(r);
      mergeGroups['shimmy-flat'] = group;
    }
    // shimmy-semi-long-XXX-unrig* → shimmy-semi-long (ウェイト別は除く)
    if (/^shimmy-semi-long-(?!180g|230g|280g)/.test(r.slug)) {
      // これらはカラー名がslugに入っているパターン
      const group = mergeGroups['shimmy-semi-long-misc'] || { targetSlug: 'shimmy-semi-long-180g-unrigged', records: [] };
      group.records.push(r);
      mergeGroups['shimmy-semi-long-misc'] = group;
    }
    // tempamon-XXX → tempamon
    if (/^tempamon-/.test(r.slug)) {
      const group = mergeGroups['tempamon'] || { targetSlug: 'tempamon', records: [] };
      group.records.push(r);
      mergeGroups['tempamon'] = group;
    }
    // mini-banana-jig-100g-XXX → mini-banana-jig
    if (/^mini-banana-jig-100g-/.test(r.slug)) {
      const group = mergeGroups['mini-banana-fix'] || { targetSlug: 'mini-banana-jig', records: [] };
      group.records.push(r);
      mergeGroups['mini-banana-fix'] = group;
    }
    // power-bucktail-XXX → power-bucktail (各色)
    if (/^power-bucktail-/.test(r.slug)) {
      const group = mergeGroups['power-bucktail'] || { targetSlug: 'power-bucktail', records: [] };
      group.records.push(r);
      mergeGroups['power-bucktail'] = group;
    }
  }

  console.log('=== カラー別slug検出 ===');
  for (const [key, group] of Object.entries(mergeGroups)) {
    console.log(`\n${key} → ${group.targetSlug} (${group.records.length}件)`);
    for (const r of group.records) {
      console.log(`  ${r.slug} | ${r.color_name || '(default)'}`);
    }
  }

  // 実行
  const dryRun = !process.argv.includes('--run');
  if (dryRun) {
    console.log('\n--- DRY RUN. --run で実行 ---');
    return;
  }

  let updated = 0;
  for (const [key, group] of Object.entries(mergeGroups)) {
    for (const r of group.records) {
      // slugを統合先に変更、color_nameが(default)ならslugからカラー名を抽出
      let colorName = r.color_name;
      if (!colorName || colorName === '(default)') {
        // slug末尾からカラー名を推測
        const parts = r.slug.replace(group.targetSlug + '-', '').replace(/-/g, ' ').toUpperCase();
        colorName = parts || r.color_name;
      }
      
      const { error } = await sb.from('lures').update({ 
        slug: group.targetSlug,
        color_name: colorName 
      }).eq('id', r.id);
      
      if (error) {
        console.error(`ERROR: ${r.id}: ${error.message}`);
      } else {
        updated++;
      }
    }
  }
  console.log(`\nUpdated: ${updated}件`);
}
main().catch(console.error);
