#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  // 春の釣り：シーバス（バチパターン、マイクロベイト）、エギング（春イカ）、メバリング
  const springTargets = [
    { fish: 'シーバス', types: ['ミノー', 'シンキングペンシル', 'バイブレーション', 'ワーム'] },
    { fish: 'アオリイカ', types: ['エギ'] },
    { fish: 'メバル', types: ['ワーム', 'ミノー', 'メタルジグ'] },
  ];

  for (const target of springTargets) {
    for (const type of target.types) {
      const { data } = await sb
        .from('lures')
        .select('slug, name, manufacturer')
        .contains('target_fish', [target.fish])
        .eq('type', type);
      
      if (!data) continue;
      const slugs = new Set(data.map(d => d.slug));
      console.log(`${target.fish} × ${type}: ${slugs.size}シリーズ`);
    }
  }

  // 春シーバス向けルアータイプ別シリーズ数
  console.log('\n=== 春シーバス向け 全タイプ別 ===');
  const { data: seabassAll } = await sb
    .from('lures')
    .select('slug, type')
    .contains('target_fish', ['シーバス']);
  
  if (seabassAll) {
    const typeMap = new Map<string, Set<string>>();
    for (const d of seabassAll) {
      if (!typeMap.has(d.type)) typeMap.set(d.type, new Set());
      typeMap.get(d.type)!.add(d.slug);
    }
    for (const [type, slugs] of [...typeMap.entries()].sort((a, b) => b[1].size - a[1].size)) {
      console.log(`  ${type}: ${slugs.size}シリーズ`);
    }
  }
}

main();
