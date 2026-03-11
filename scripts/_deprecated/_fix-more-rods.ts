import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  // ロッド削除
  const rods = [
    { manufacturer_slug: '6th-sense', slug: 'team-6-73-medium-heavy-moderate-casting' },
  ];
  for (const rod of rods) {
    const { error, count } = await sb.from('lures').delete({ count: 'exact' })
      .eq('slug', rod.slug).eq('manufacturer_slug', rod.manufacturer_slug);
    if (error) console.error(`❌ ${rod.slug}: ${error.message}`);
    else console.log(`✅ DELETE ${rod.manufacturer_slug}/${rod.slug} (${count}行 - ロッド)`);
  }

  // SPRO修正: cannon-ball系はタイラバ、banana-jigはメタルジグ
  const typeFixes = [
    { manufacturer_slug: 'spro', slug: 'cannon-ball-bloody-mary', new_type: 'タイラバ', target_fish: ['マダイ'] },
    { manufacturer_slug: 'spro', slug: 'cannon-ball-blue', new_type: 'タイラバ', target_fish: ['マダイ'] },
    { manufacturer_slug: 'spro', slug: 'banana-jig-real-mackerel', new_type: 'メタルジグ', target_fish: ['ブリ', 'カンパチ'] },
  ];
  for (const fix of typeFixes) {
    const { error } = await sb.from('lures')
      .update({ type: fix.new_type, target_fish: fix.target_fish })
      .eq('slug', fix.slug).eq('manufacturer_slug', fix.manufacturer_slug);
    if (error) console.error(`❌ ${fix.slug}: ${error.message}`);
    else console.log(`✅ TYPE+FISH ${fix.manufacturer_slug}/${fix.slug} → ${fix.new_type} (${fix.target_fish.join(', ')})`);
  }
}
main();
