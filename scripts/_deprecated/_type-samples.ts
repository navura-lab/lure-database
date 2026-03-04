import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const targetTypes = [
    'ルアー', 'プラグ', 'ショアジギング', 'アジング', 'メバリング',
    'トラウトルアー', 'ロックフィッシュ', 'シーバスルアー', 'サーフルアー',
    'タチウオルアー', 'ナマズルアー', 'チニング', 'ワイヤーベイト',
    'エリアトラウトルアー', 'その他', 'ジグ', 'キャスティングプラグ',
    'ブレードジグ', '鮎ルアー'
  ];

  for (const type of targetTypes) {
    // Get distinct series (slug + name) for this type, 15 samples
    const { data } = await sb.from('lures')
      .select('name,slug,manufacturer_slug,type')
      .eq('type', type)
      .limit(500);
    
    if (!data || data.length === 0) {
      console.log(`\n=== ${type}: 0 rows ===`);
      continue;
    }

    // Deduplicate by slug
    const seen = new Set<string>();
    const unique: typeof data = [];
    for (const r of data) {
      const key = `${r.manufacturer_slug}/${r.slug}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
    }

    console.log(`\n=== ${type}: ${unique.length} unique series ===`);
    for (const r of unique.slice(0, 20)) {
      console.log(`  ${r.manufacturer_slug}/${r.slug} → ${r.name}`);
    }
    if (unique.length > 20) {
      console.log(`  ... and ${unique.length - 20} more`);
    }
  }
}

main();
