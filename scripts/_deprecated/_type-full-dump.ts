import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TYPES = [
  'ルアー', 'プラグ', 'ショアジギング', 'アジング', 'メバリング',
  'トラウトルアー', 'シーバスルアー', 'サーフルアー', 'チニング',
  'ワイヤーベイト', 'エリアトラウトルアー', 'その他', 'ジグ',
  'キャスティングプラグ', 'ナマズルアー',
];

const BATCH_SIZE = 1000;

interface Series {
  manufacturer_slug: string;
  slug: string;
  name: string;
}

async function fetchAllForType(type: string): Promise<Series[]> {
  const seen = new Map<string, Series>();
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug, slug, name')
      .eq('type', type)
      .range(from, from + BATCH_SIZE - 1);

    if (error) {
      console.error(`Error fetching type="${type}" from=${from}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const key = `${row.manufacturer_slug}::${row.slug}`;
      if (!seen.has(key)) {
        seen.set(key, {
          manufacturer_slug: row.manufacturer_slug,
          slug: row.slug,
          name: row.name,
        });
      }
    }

    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return [...seen.values()];
}

async function main() {
  const result: Record<string, Series[]> = {};

  for (const type of TYPES) {
    const series = await fetchAllForType(type);
    result[type] = series;
    console.log(`${type}: ${series.length} unique series`);
  }

  const totalSeries = Object.values(result).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`\nTotal: ${totalSeries} unique series across ${TYPES.length} types`);

  writeFileSync('/tmp/type-ambiguous-series.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log('\nWritten to /tmp/type-ambiguous-series.json');
}

main().catch(console.error);
