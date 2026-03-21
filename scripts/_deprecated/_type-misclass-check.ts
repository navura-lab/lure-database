import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

  // Juggle Minnow
  const { data: d1 } = await sb.from('lures').select('slug, name, type, description').ilike('name', '%juggle%').eq('manufacturer_slug', '6th-sense').limit(3);
  console.log('=== Juggle Minnow (6th Sense) ===');
  for (const r of d1 || []) {
    console.log(`  slug: ${r.slug}`);
    console.log(`  name: ${r.name}`);
    console.log(`  type: ${r.type}`);
    console.log(`  desc: ${(r.description || '').slice(0, 200)}`);
  }

  // ThinFisher
  const { data: d2 } = await sb.from('lures').select('slug, name, type, description').ilike('name', '%thinfisher%').eq('manufacturer_slug', 'berkley-us').limit(3);
  console.log('\n=== ThinFisher (Berkley) ===');
  for (const r of d2 || []) {
    console.log(`  slug: ${r.slug}`);
    console.log(`  name: ${r.name}`);
    console.log(`  type: ${r.type}`);
    console.log(`  desc: ${(r.description || '').slice(0, 200)}`);
  }

  // auto-editorialが嘘を書いているか確認
  // typeが間違っていると、auto-editorial.tsがそのtypeに基づいて嘘の説明を生成する
  console.log('\n=== 問題の本質 ===');
  console.log('DBのtypeが間違っている → auto-editorial.tsがそのtypeで説明を生成 → 嘘になる');
  console.log('対策: type分類の精度向上 or auto-editorialの無効化（既に無効化予定）');
}
main().catch(console.error);
