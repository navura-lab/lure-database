#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

// 日本で「インプレ」検索される人気ルアー名
const popularNames = [
  'VJ', 'セットアッパー', 'エメラルダス', 'ジグパラ ショート', 'ジグパラ',
  'サイレントアサシン', 'カゲロウ', 'ワンダー', 'エクスセンス',
  'コアマン', 'IP-26', 'ガンクラフト', 'ジョインテッドクロー',
  'レベルバイブ', 'レベルミノー', 'ジャッカル', 'ダイワ',
  'ブルーブルー', 'ブローウィン', 'メガバス', 'カットバイブ',
  'ビーフリーズ', 'コモモ', 'マリア', 'ショアジギ',
  'メタルマル', 'ムーチョルチア', 'ジグパラTG',
  'モアザン', 'ガルバ', 'スカジットデザインズ',
  'SASUKE', 'サスケ', 'ima', 'DUO',
  'タイドミノー', 'テリアバイツ',
  'OSP', 'ドライブシャッド', 'ハイピッチャー',
  'ゲーリーヤマモト', 'ヤマセンコー',
  'O.S.P', 'JACKALL', 'Megabass',
];

async function main() {
  // 全ルアーのslug・名前・メーカーを取得してカラー数集計
  const { data, error } = await sb
    .from('lures')
    .select('slug, name, manufacturer, type, target_fish, weight, length, price');

  if (error) { console.error(error); return; }
  if (!data) return;

  // slugごとに集約
  const seriesMap = new Map<string, {
    name: string;
    manufacturer: string;
    type: string;
    targetFish: string[];
    colorCount: number;
    weight: number | null;
    length: number | null;
    price: number | null;
  }>();

  for (const row of data) {
    const existing = seriesMap.get(row.slug);
    if (!existing) {
      seriesMap.set(row.slug, {
        name: row.name,
        manufacturer: row.manufacturer,
        type: row.type,
        targetFish: row.target_fish || [],
        colorCount: 1,
        weight: row.weight,
        length: row.length,
        price: row.price,
      });
    } else {
      existing.colorCount++;
    }
  }

  // カラーガイドで使用済み
  const usedSlugs = new Set(['jpv', 'kontakuto-fyido-poppa', 'rollingbait', 'jz4hubt', 'bguc4bu']);

  // 人気ルアー名でフィルタ
  const results: Array<{slug: string; name: string; manufacturer: string; type: string; targetFish: string[]; colorCount: number; weight: number|null; length: number|null; price: number|null; matchedKey: string}> = [];

  for (const [slug, s] of seriesMap) {
    if (usedSlugs.has(slug)) continue;
    for (const key of popularNames) {
      if (s.name.includes(key) || s.manufacturer.includes(key)) {
        results.push({ slug, ...s, matchedKey: key });
        break;
      }
    }
  }

  // カラー数でソート
  results.sort((a, b) => b.colorCount - a.colorCount);

  console.log('=== 人気ルアー検索結果 ===\n');
  for (const r of results.slice(0, 80)) {
    console.log(`${r.colorCount}色 | ${r.manufacturer} | ${r.name} | ${r.type} | ${r.targetFish.join(',')} | ${r.weight}g ${r.length}mm ¥${r.price} | slug:${r.slug}`);
  }

  // 特に有名な製品を個別検索
  console.log('\n=== 特定の有名ルアー ===');
  const famous = ['サイレントアサシン', 'セットアッパー', 'VJ', 'エメラルダス', 'ジョインテッドクロー', 'ブローウィン', 'レベルバイブ'];
  for (const name of famous) {
    const matches = results.filter(r => r.name.includes(name));
    if (matches.length > 0) {
      console.log(`\n[${name}]`);
      for (const m of matches.slice(0, 5)) {
        console.log(`  ${m.colorCount}色 | ${m.name} | ${m.type} | slug:${m.slug}`);
      }
    } else {
      console.log(`\n[${name}] → 該当なし`);
    }
  }
}

main();
