import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // Fetch all records (we'll filter in JS since target_fish is always null currently)
  const allRecords: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('lures')
      .select('manufacturer_slug, type, source_url')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allRecords.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }

  console.log(`Total records: ${allRecords.length}`);

  // Import the derivation logic
  // (simplified inline version)
  const TYPE_FISH_MAP: Record<string, string[]> = {
    'エギ': ['イカ'], 'スッテ': ['イカ'], 'タイラバ': ['マダイ'],
    'テンヤ': ['マダイ'], 'ひとつテンヤ': ['マダイ'],
    'シーバスルアー': ['シーバス'], 'アジング': ['アジ'],
    'メバリング': ['メバル'], 'チニング': ['クロダイ'],
    'ロックフィッシュ': ['ロックフィッシュ'], 'タチウオルアー': ['タチウオ'],
    'タチウオジギング': ['タチウオ'], 'ショアジギング': ['青物'],
    'ジギング': ['青物'], 'オフショアキャスティング': ['青物'],
    'サーフルアー': ['ヒラメ・マゴチ'], 'ティップラン': ['イカ'],
    'イカメタル': ['イカ'], 'バチコン': ['アジ'],
    'フロート': ['アジ', 'メバル'], 'フグルアー': ['フグ'],
    'ナマズルアー': ['ナマズ'], 'トラウトルアー': ['トラウト'],
    '鮎ルアー': ['鮎'], 'ラバージグ': ['バス'],
    'バズベイト': ['バス'], 'i字系': ['バス'], 'フロッグ': ['バス'],
  };

  const SHIMANO_CAT: Record<string, string[]> = {
    'seabass': ['シーバス'], 'surf': ['ヒラメ・マゴチ'],
    'bream': ['クロダイ'], 'lightgame': ['アジ', 'メバル'],
    'rockyshore_etc': ['青物', 'ロックフィッシュ'],
    'offshorecasting': ['青物'], 'offshorejigging': ['青物'],
    'shoreeging': ['イカ'], 'boateging': ['イカ'],
    'tako': ['タコ'], 'tairubber_etc': ['マダイ'],
    'tachiuo': ['タチウオ'], 'bass': ['バス'],
    'nativetrout': ['トラウト'], 'areatrout': ['トラウト'],
  };

  const MFR_DEFAULT: Record<string, string[]> = {
    'deps': ['バス'], 'ima': ['シーバス'], 'blueblue': ['シーバス', '青物'],
  };

  function hasMatch(r: any): boolean {
    const url = r.source_url || '';
    const mfr = r.manufacturer_slug;

    if (mfr === 'shimano') {
      const m = url.match(/\/product\/lure\/([^/]+)\//);
      if (m && SHIMANO_CAT[m[1]]) return true;
    }
    if (mfr === 'jackall') {
      if (url.includes('/bass/') || url.includes('/timon/') || url.includes('/saltwater/')) return true;
    }
    if (mfr === 'evergreen') {
      if (url.match(/vcts_no=\d+/)) return true;
    }
    if (mfr === 'megabass') {
      if (url.includes('/freshwater/') || url.includes('/bass_lure/')) return true;
    }

    if (TYPE_FISH_MAP[r.type]) return true;
    if (MFR_DEFAULT[mfr]) return true;

    return false;
  }

  // Find unmatched
  const unmatched = allRecords.filter(r => !hasMatch(r));

  console.log(`\nUnmatched: ${unmatched.length}`);

  // Group by manufacturer
  const byMaker = new Map<string, Map<string, number>>();
  for (const r of unmatched) {
    if (!byMaker.has(r.manufacturer_slug)) byMaker.set(r.manufacturer_slug, new Map());
    const types = byMaker.get(r.manufacturer_slug) as Map<string, number>;
    types.set(r.type, (types.get(r.type) || 0) + 1);
  }

  console.log('\n=== Unmatched by manufacturer + type ===');
  for (const [maker, types] of [...byMaker.entries()].sort((a, b) => {
    const sumA = [...a[1].values()].reduce((s, v) => s + v, 0);
    const sumB = [...b[1].values()].reduce((s, v) => s + v, 0);
    return sumB - sumA;
  })) {
    const total = [...types.values()].reduce((s, v) => s + v, 0);
    console.log(`\n${maker}: ${total} unmatched`);
    for (const [type, cnt] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${cnt}`);
    }
  }

  // Sample Daiwa URLs for types with no match
  console.log('\n=== Sample unmatched Daiwa URLs ===');
  const daiwaUnmatched = unmatched.filter(r => r.manufacturer_slug === 'daiwa');
  const daiwaTypes = new Set(daiwaUnmatched.map(r => r.type));
  for (const type of daiwaTypes) {
    const sample = daiwaUnmatched.find(r => r.type === type);
    if (sample) console.log(`  type=${type}, url=${sample.source_url}`);
  }

  // Sample Megabass URLs for unmatched
  console.log('\n=== Sample unmatched Megabass URLs ===');
  const megaUnmatched = unmatched.filter(r => r.manufacturer_slug === 'megabass');
  const megaTypes = new Set(megaUnmatched.map(r => r.type));
  for (const type of megaTypes) {
    const sample = megaUnmatched.find(r => r.type === type);
    if (sample) console.log(`  type=${type}, url=${sample.source_url}`);
  }

  // Sample Shimano URLs for unmatched
  console.log('\n=== Sample unmatched Shimano URLs ===');
  const shimanoUnmatched = unmatched.filter(r => r.manufacturer_slug === 'shimano');
  for (const r of shimanoUnmatched.slice(0, 5)) {
    console.log(`  type=${r.type}, url=${r.source_url}`);
  }

  // Analyze Megabass URL patterns
  console.log('\n=== Megabass URL pattern analysis ===');
  const megaAll = allRecords.filter(r => r.manufacturer_slug === 'megabass');
  const megaUrls = [...new Set(megaAll.map(r => r.source_url).filter(Boolean))];
  const fw = megaUrls.filter(u => u.includes('/freshwater/') || u.includes('/bass_lure/'));
  const sw = megaUrls.filter(u => u.includes('/saltwater/') || u.includes('/sw_lure/'));
  const other = megaUrls.filter(u => {
    return u.indexOf('/freshwater/') === -1
      && u.indexOf('/saltwater/') === -1
      && u.indexOf('/bass_lure/') === -1
      && u.indexOf('/sw_lure/') === -1;
  });
  console.log(`  freshwater/bass_lure: ${fw.length} unique URLs`);
  console.log(`  saltwater/sw_lure: ${sw.length} unique URLs`);
  console.log(`  other: ${other.length} unique URLs`);
  for (const u of other.slice(0, 10)) {
    console.log(`    ${u}`);
  }

  // Analyze Daiwa name patterns for target fish hints
  console.log('\n=== Daiwa lure name analysis (sample) ===');
  const daiwaAll = allRecords.filter(r => r.manufacturer_slug === 'daiwa');
  const daiwaNames = [...new Set(daiwaAll.map(r => r.name))].slice(0, 30);
  for (const n of daiwaNames) {
    console.log(`  ${n}`);
  }

  // Analyze Evergreen name patterns
  console.log('\n=== Evergreen lure name analysis (sample) ===');
  const egAll = allRecords.filter(r => r.manufacturer_slug === 'evergreen');
  const egNames = [...new Set(egAll.map(r => r.name))].slice(0, 30);
  for (const n of egNames) {
    console.log(`  ${n}`);
  }
}

main().catch(console.error);
