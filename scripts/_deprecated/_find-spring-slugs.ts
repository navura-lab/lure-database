import { fetchAllLures } from '../src/lib/fetch-all-lures';
import { groupLuresBySeries } from '../src/lib/group-lures';

async function main() {
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);
  
  console.log(`全${allSeries.length}シリーズ\n`);

  // 春シーバス: シンペン・ミノー・バイブレーション
  console.log('=== 春シーバス ===');
  for (const type of ['シンキングペンシル', 'ミノー', 'バイブレーション', 'ワーム']) {
    const matches = allSeries
      .filter(s => s.type === type && s.target_fish.includes('シーバス'))
      .sort((a, b) => b.color_count - a.color_count)
      .slice(0, 3);
    console.log(`\n${type}:`);
    for (const s of matches) {
      console.log(`  ${s.slug} (${s.manufacturer} ${s.name}, ${s.color_count}色)`);
    }
  }

  // 春エギング
  console.log('\n=== 春エギング ===');
  const egis = allSeries
    .filter(s => s.type === 'エギ' && s.target_fish.includes('アオリイカ'))
    .sort((a, b) => b.color_count - a.color_count)
    .slice(0, 5);
  for (const s of egis) {
    console.log(`  ${s.slug} (${s.manufacturer} ${s.name}, ${s.color_count}色)`);
  }

  // 春メバリング
  console.log('\n=== 春メバリング ===');
  for (const type of ['ワーム', 'ミノー', 'メタルジグ', 'スピンテール']) {
    const matches = allSeries
      .filter(s => s.type === type && s.target_fish.includes('メバル'))
      .sort((a, b) => b.color_count - a.color_count)
      .slice(0, 3);
    if (matches.length === 0) continue;
    console.log(`\n${type}:`);
    for (const s of matches) {
      console.log(`  ${s.slug} (${s.manufacturer} ${s.name}, ${s.color_count}色)`);
    }
  }
}

main();
