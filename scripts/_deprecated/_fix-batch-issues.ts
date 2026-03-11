// リライトバッチ内で発見された問題を修正
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. ロッド削除（非ルアー）
  const rods = [
    { manufacturer_slug: '6th-sense', slug: 'response-76-medium-heavy-moderate-fast-spinning' },
    { manufacturer_slug: '6th-sense', slug: 'team-6-76-medium-light-moderate-spinning' },
  ];
  for (const rod of rods) {
    const { error, count } = await sb.from('lures').delete({ count: 'exact' })
      .eq('slug', rod.slug).eq('manufacturer_slug', rod.manufacturer_slug);
    if (error) console.error(`❌ DELETE ${rod.slug}: ${error.message}`);
    else console.log(`✅ DELETE ${rod.manufacturer_slug}/${rod.slug} (${count}行 - ロッド)`);
  }

  // 2. タイプ修正
  const typeFixes: { manufacturer_slug: string; slug: string; new_type: string; reason: string }[] = [
    // 6th-sense
    { manufacturer_slug: '6th-sense', slug: 'divine-swimbait-flash-gill', new_type: 'ワーム', reason: 'soft plastic swimbait' },
    // SPRO: ラバージグ→メタルジグ（キャスティングジグ・スローピッチジグ系）
    { manufacturer_slug: 'spro', slug: 'aiya-slender-real-slender-sprat', new_type: 'メタルジグ', reason: 'casting jig' },
    { manufacturer_slug: 'spro', slug: 'banana-jig-blue-glow-back', new_type: 'メタルジグ', reason: 'high speed jig' },
    { manufacturer_slug: 'spro', slug: 'ababai-jig-purple-gold-glow-belly-tail-orange-glow', new_type: 'メタルジグ', reason: 'slow pitch jig' },
    { manufacturer_slug: 'spro', slug: 'aiya-pocchari-full-blue-glow', new_type: 'メタルジグ', reason: 'micro jig' },
  ];
  for (const fix of typeFixes) {
    const { error } = await sb.from('lures').update({ type: fix.new_type })
      .eq('slug', fix.slug).eq('manufacturer_slug', fix.manufacturer_slug);
    if (error) console.error(`❌ TYPE ${fix.slug}: ${error.message}`);
    else console.log(`✅ TYPE ${fix.manufacturer_slug}/${fix.slug} → ${fix.new_type} (${fix.reason})`);
  }

  // 3. target_fish修正（SPROソルト系）
  const fishFixes: { manufacturer_slug: string; slug: string; target_fish: string[] }[] = [
    { manufacturer_slug: 'spro', slug: 'aiya-slender-real-slender-sprat', target_fish: ['ストライパー', 'ブルーフィッシュ'] },
    { manufacturer_slug: 'spro', slug: 'banana-jig-blue-glow-back', target_fish: ['ブリ', 'カンパチ'] },
    { manufacturer_slug: 'spro', slug: 'bucktail-teaser-pink', target_fish: ['ヒラメ', 'ストライパー'] },
    { manufacturer_slug: 'spro', slug: 'ababai-jig-purple-gold-glow-belly-tail-orange-glow', target_fish: ['ハタ', 'マダイ'] },
    { manufacturer_slug: 'spro', slug: 'aiya-pocchari-full-blue-glow', target_fish: ['マグロ'] },
    { manufacturer_slug: 'spro', slug: 'bucktail-jig-bunker', target_fish: ['ストライパー', 'ヒラメ'] },
  ];
  for (const fix of fishFixes) {
    const { error } = await sb.from('lures').update({ target_fish: fix.target_fish })
      .eq('slug', fix.slug).eq('manufacturer_slug', fix.manufacturer_slug);
    if (error) console.error(`❌ FISH ${fix.slug}: ${error.message}`);
    else console.log(`✅ FISH ${fix.manufacturer_slug}/${fix.slug} → ${fix.target_fish.join(', ')}`);
  }

  console.log('\n完了');
}
main();
