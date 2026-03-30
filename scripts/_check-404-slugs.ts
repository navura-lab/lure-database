import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

// 6th-senseの削除済みslugの正しいリダイレクト先を探す
const deleted = [
  'flush-5-2-wakasagi',       // flush-5-2の色variant?
  'snatch-70x-shad-burst',    // snatch-70xの色variant?
  'gyro-tail-spinner-4k-shad',// gyro-tail-spinnerの色variant?
  'crush-dd-series-wild-shad',// crush-dd-seriesの色variant?
  'judo-freshwater-series-shad-fetch', // judo-freshwater-seriesの色variant?
  'scramble-80-matte-black',  // scramble-80の色variant?
];

for (const slug of deleted) {
  // ベース名を推測
  const base = slug.replace(/-[^-]*$/, '').replace(/-[^-]*$/, '');
  const {data} = await sb.from('lures').select('slug').eq('manufacturer_slug', '6th-sense').ilike('slug', `%${base.split('-').slice(0, 3).join('-')}%`).limit(3);
  const unique = [...new Set(data?.map(r => r.slug))].slice(0, 3);
  console.log(`${slug} → ${unique.join(', ') || 'NOT FOUND'}`);
}
