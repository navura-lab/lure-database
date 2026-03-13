// scripts/_generate-url-list.ts
// Generate a complete list of all indexable URLs on lure-db.com.
//
// Usage:
//   npx tsx scripts/_generate-url-list.ts > /tmp/lure-db-urls.txt

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://castlog.xyz';
const PAGE_SIZE = 1000;

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  // ── 1. Fetch all rows (paginated) ──
  const allRows: { manufacturer_slug: string; slug: string; type: string | null; target_fish: string[] | null }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug, slug, type, target_fish')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error('Supabase error:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.error(`Fetched ${allRows.length} total rows from lures table.`);

  // ── 2. Product pages: unique manufacturer_slug + slug combos ──
  const productSet = new Set<string>();
  const manufacturerSet = new Set<string>();
  const typeSet = new Set<string>();
  const fishSet = new Set<string>();

  for (const row of allRows) {
    const key = `${row.manufacturer_slug}/${row.slug}`;
    productSet.add(key);
    manufacturerSet.add(row.manufacturer_slug);
    if (row.type) typeSet.add(row.type);
    if (row.target_fish) {
      for (const fish of row.target_fish) {
        fishSet.add(fish);
      }
    }
  }

  // ── 3. Category slug mappings (same as src/lib/category-slugs.ts) ──
  const TYPE_SLUG_MAP: Record<string, string> = {
    'ミノー': 'minnow',
    'クランクベイト': 'crankbait',
    'シャッド': 'shad',
    'バイブレーション': 'vibration',
    'メタルバイブ': 'metal-vib',
    'ペンシルベイト': 'pencilbait',
    'シンキングペンシル': 'sinking-pencil',
    'ダイビングペンシル': 'diving-pencil',
    'ポッパー': 'popper',
    'トップウォーター': 'topwater',
    'プロップベイト': 'propbait',
    'クローラーベイト': 'crawler-bait',
    'i字系': 'i-shape',
    'スイムベイト': 'swimbait',
    'ビッグベイト': 'bigbait',
    'ジョイントベイト': 'jointed-bait',
    'フロッグ': 'frog',
    'スピナーベイト': 'spinnerbait',
    'チャターベイト': 'chatterbait',
    'バズベイト': 'buzzbait',
    'スピンテール': 'spintail',
    'ブレードベイト': 'blade-bait',
    'メタルジグ': 'metal-jig',
    'スプーン': 'spoon',
    'スピナー': 'spinner',
    'ワーム': 'worm',
    'ラバージグ': 'rubber-jig',
    'ジグヘッド': 'jighead',
    'エギ': 'egi',
    'スッテ': 'sutte',
    'タイラバ': 'tai-rubber',
    'テンヤ': 'tenya',
    'その他': 'other',
  };

  const FISH_SLUG_MAP: Record<string, string> = {
    'ブラックバス': 'black-bass',
    'シーバス': 'seabass',
    '青物': 'bluerunner',
    'トラウト': 'trout',
    'バス': 'bass',
    'ヒラマサ': 'hiramasa',
    'カンパチ': 'kampachi',
    'ブリ': 'yellowtail',
    'マダイ': 'madai',
    'ヒラメ': 'hirame',
    'ロックフィッシュ': 'rockfish',
    'マグロ': 'tuna',
    'アジ': 'aji',
    'メバル': 'mebaru',
    'イカ': 'squid',
    'オフショア': 'offshore',
    'アオリイカ': 'aori-ika',
    'マゴチ': 'magochi',
    'クロダイ': 'kurodai',
    'ヒラメ・マゴチ': 'hirame-magochi',
    'タチウオ': 'tachiuo',
    'タコ': 'octopus',
    'GT': 'gt',
    'カサゴ': 'kasago',
    'ソルト': 'saltwater',
    'ナマズ': 'catfish',
    '鮎': 'ayu',
    'アユ': 'sweetfish',
    'シイラ': 'mahi-mahi',
    'ケンサキイカ': 'kensaki-ika',
    'ヤリイカ': 'yari-ika',
    'チヌ': 'chinu',
    'サワラ': 'sawara',
    'ハゼ': 'goby',
    'サクラマス': 'sakuramasu',
    'コウイカ': 'cuttlefish',
    'サーモン': 'salmon',
    '雷魚': 'snakehead',
    'サケ': 'sake',
    'アイナメ': 'ainame',
    'タラ': 'cod',
  };

  // ── 4. Build URL list ──
  const urls: string[] = [];

  // Static index pages
  urls.push(`${BASE_URL}/`);
  urls.push(`${BASE_URL}/type/`);
  urls.push(`${BASE_URL}/fish/`);
  urls.push(`${BASE_URL}/search/`);

  // Manufacturer index pages
  for (const ms of [...manufacturerSet].sort()) {
    urls.push(`${BASE_URL}/${ms}/`);
  }

  // Product pages
  for (const key of [...productSet].sort()) {
    urls.push(`${BASE_URL}/${key}/`);
  }

  // Type category pages
  for (const typeName of [...typeSet].sort()) {
    const slug = TYPE_SLUG_MAP[typeName] ?? encodeURIComponent(typeName);
    urls.push(`${BASE_URL}/type/${slug}/`);
  }

  // Fish category pages
  for (const fishName of [...fishSet].sort()) {
    const slug = FISH_SLUG_MAP[fishName] ?? encodeURIComponent(fishName);
    urls.push(`${BASE_URL}/fish/${slug}/`);
  }

  // ── 5. Output ──
  for (const url of urls) {
    console.log(url);
  }

  // Summary to stderr so it doesn't pollute the URL list
  console.error(`\n=== URL Summary ===`);
  console.error(`  Static pages:      4`);
  console.error(`  Manufacturer pages: ${manufacturerSet.size}`);
  console.error(`  Product pages:     ${productSet.size}`);
  console.error(`  Type pages:        ${typeSet.size}`);
  console.error(`  Fish pages:        ${fishSet.size}`);
  console.error(`  ─────────────────────`);
  console.error(`  Total URLs:        ${urls.length}`);
}

main().catch(console.error);
