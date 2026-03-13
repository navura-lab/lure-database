#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

const slugs = ['hardcore-monster-shots', 'onimaru', 'jpmsl', 'metalmaru', 'flick-shake-2'];

async function main() {
  for (const slug of slugs) {
    const { data } = await sb.from('lures').select('slug,name,manufacturer,type,target_fish,color_name,price,weight,length').eq('slug', slug);
    if (!data || data.length === 0) { console.log(`=== ${slug} → データなし ===\n`); continue; }
    console.log(`=== ${slug} (${data.length}色) ===`);
    console.log(`Name: ${data[0].name}`);
    console.log(`Maker: ${data[0].manufacturer}`);
    console.log(`Type: ${data[0].type}`);
    console.log(`Fish: ${JSON.stringify(data[0].target_fish)}`);
    
    // ウェイト・レングスのバリエーション
    const weights = [...new Set(data.map(d => d.weight).filter(Boolean))].sort((a, b) => a - b);
    const lengths = [...new Set(data.map(d => d.length).filter(Boolean))].sort((a, b) => a - b);
    const prices = [...new Set(data.map(d => d.price).filter(Boolean))].sort((a, b) => a - b);
    console.log(`Weight: ${weights.join(', ')}g`);
    console.log(`Length: ${lengths.join(', ')}mm`);
    console.log(`Price: ¥${prices[0]}〜¥${prices[prices.length - 1]}`);

    // カラーカテゴリ分析
    const colors = data.map(d => d.color_name);
    const cats: Record<string, string[]> = {};
    for (const c of colors) {
      const cl = (c || '').toLowerCase();
      let cat = 'その他';
      if (cl.includes('chart') || cl.includes('チャート')) cat = 'チャート系';
      else if (cl.includes('iwashi') || cl.includes('イワシ') || cl.includes('katakuchi') || cl.includes('サバ') || cl.includes('natural') || cl.includes('ナチュラル') || cl.includes('リアル') || cl.includes('キビナゴ')) cat = 'ナチュラル系';
      else if (cl.includes('glow') || cl.includes('グロー') || cl.includes('夜光') || cl.includes('ケイムラ')) cat = 'グロー/ケイムラ系';
      else if (cl.includes('red') || cl.includes('赤') || cl.includes('レッド') || cl.includes('アカ')) cat = 'レッド系';
      else if (cl.includes('silver') || cl.includes('シルバー') || cl.includes('銀')) cat = 'シルバー系';
      else if (cl.includes('gold') || cl.includes('ゴールド') || cl.includes('金')) cat = 'ゴールド系';
      else if (cl.includes('pink') || cl.includes('ピンク')) cat = 'ピンク系';
      else if (cl.includes('purple') || cl.includes('パープル') || cl.includes('紫')) cat = 'パープル系';
      else if (cl.includes('blue') || cl.includes('ブルー') || cl.includes('青')) cat = 'ブルー系';
      else if (cl.includes('green') || cl.includes('グリーン') || cl.includes('緑')) cat = 'グリーン系';
      else if (cl.includes('orange') || cl.includes('オレンジ')) cat = 'オレンジ系';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(c);
    }
    for (const [cat, names] of Object.entries(cats).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${cat}: ${names.length}色 (例: ${names.slice(0, 3).join(', ')})`);
    }
    console.log('');
  }

  // 同カテゴリ比較用: 各ルアーと同タイプの製品数
  console.log('=== 同カテゴリ製品数 ===');
  const types = ['シンキングペンシル', 'メタルバイブ', 'メタルジグ', 'スピンテール', 'ワーム'];
  for (const type of types) {
    const { count } = await sb.from('lures').select('slug', { count: 'exact', head: true }).eq('type', type);
    const { data: slugData } = await sb.from('lures').select('slug').eq('type', type);
    const uniqueSlugs = new Set((slugData || []).map(d => d.slug));
    console.log(`${type}: ${uniqueSlugs.size}シリーズ (${count}色バリエーション)`);
  }
}

main();
