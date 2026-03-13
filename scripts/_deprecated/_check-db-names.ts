#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  // サンプルで名前パターンを確認
  const { data } = await sb
    .from('lures')
    .select('slug, name, manufacturer')
    .limit(30);

  console.log('=== サンプル名前パターン ===');
  for (const d of data || []) {
    console.log(`${d.manufacturer} | ${d.name} | slug:${d.slug}`);
  }

  // メーカー一覧を取得
  const { data: all } = await sb
    .from('lures')
    .select('manufacturer');
  
  const makers = new Set((all || []).map(d => d.manufacturer));
  console.log('\n=== メーカー一覧 ===');
  for (const m of [...makers].sort()) {
    console.log(m);
  }
}

main();
