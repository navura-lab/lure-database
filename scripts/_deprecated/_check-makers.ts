import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  // ページネーションで全件取得
  const all: any[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data } = await sb.from('lures')
      .select('manufacturer, manufacturer_slug')
      .range(from, from + batchSize - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const unique = [...new Map(all.map(r => [r.manufacturer_slug, r.manufacturer])).entries()];
  unique.sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  unique.forEach(([slug, name]) => console.log(slug + ' | ' + name));
  console.log('Total:', unique.length);
}

main();
