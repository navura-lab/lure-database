import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('slug,manufacturer_slug,description,name')
    .eq('slug','denny-brauer-structure-casting-jig-3-4oz').limit(1);
  const r = data?.[0];
  if (r) {
    console.log('name:', r.name);
    console.log('文字数:', r.description?.length);
    console.log('description:', r.description);
  }
}
main();
