#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

const slugs = ['jpv', 'kontakuto-fyido-poppa', 'rollingbait', 'jz4hubt', 'bguc4bu'];

async function main() {
  for (const slug of slugs) {
    const { data } = await sb.from('lures').select('slug,name,manufacturer,type,target_fish,color_name,price,weight,length').eq('slug', slug);
    if (!data || data.length === 0) continue;
    console.log(`=== ${slug} (${data.length}色) ===`);
    console.log(`Name: ${data[0].name}`);
    console.log(`Maker: ${data[0].manufacturer}`);
    console.log(`Type: ${data[0].type}`);
    console.log(`Fish: ${JSON.stringify(data[0].target_fish)}`);
    console.log(`Price: ${data[0].price}`);
    console.log(`Weight: ${data[0].weight}g, Length: ${data[0].length}mm`);

    // カラーカテゴリ分析
    const colors = data.map(d => d.color_name);
    const cats: Record<string, string[]> = {};
    for (const c of colors) {
      const cl = (c || '').toLowerCase();
      let cat = 'その他';
      if (cl.includes('chart') || cl.includes('チャート')) cat = 'チャート系';
      else if (cl.includes('iwashi') || cl.includes('イワシ') || cl.includes('katakuchi') || cl.includes('サバ') || cl.includes('natural') || cl.includes('ナチュラル') || cl.includes('リアル')) cat = 'ナチュラル系';
      else if (cl.includes('glow') || cl.includes('グロー') || cl.includes('夜光') || cl.includes('ケイムラ')) cat = 'グロー/ケイムラ系';
      else if (cl.includes('red') || cl.includes('赤') || cl.includes('レッド') || cl.includes('アカ')) cat = 'レッド系';
      else if (cl.includes('silver') || cl.includes('シルバー') || cl.includes('銀')) cat = 'シルバー系';
      else if (cl.includes('gold') || cl.includes('ゴールド') || cl.includes('金')) cat = 'ゴールド系';
      else if (cl.includes('pink') || cl.includes('ピンク')) cat = 'ピンク系';
      else if (cl.includes('purple') || cl.includes('パープル') || cl.includes('紫')) cat = 'パープル系';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(c);
    }
    for (const [cat, names] of Object.entries(cats).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${cat}: ${names.length}色 (例: ${names.slice(0, 3).join(', ')})`);
    }
    console.log('');
  }
}

main();
