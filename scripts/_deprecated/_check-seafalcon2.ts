import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

const { data: d1 } = await sb.from('lures').select('manufacturer_slug').ilike('manufacturer_slug', '%falcon%');
const { data: d2 } = await sb.from('lures').select('manufacturer_slug').ilike('manufacturer_slug', '%sea%');
const slugs1 = [...new Set(d1?.map(r => r.manufacturer_slug))];
const slugs2 = [...new Set(d2?.map(r => r.manufacturer_slug))];
console.log('Slugs matching "falcon":', slugs1);
console.log('Slugs matching "sea":', slugs2);
