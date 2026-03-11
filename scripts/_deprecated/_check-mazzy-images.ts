import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

(async () => {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const {data, error} = await sb.from('lures').select('images').eq('slug', 'mazzy-vib-dash').eq('manufacturer_slug', 'viva').limit(1);
  if (error) { console.error('ERROR:', error); process.exit(1); }
  if (!data || !data[0]) { console.log('No data found'); process.exit(1); }
  console.log('FIRST_3:', JSON.stringify(data[0].images?.slice(0, 3)));
  const url = data[0].images?.[0];
  if (url) {
    const base = url.replace(/\/[^\/]+$/, '');
    console.log('BASE:' + base);
  }
  console.log('TOTAL_IMAGES:' + (data[0].images?.length || 0));
})();
