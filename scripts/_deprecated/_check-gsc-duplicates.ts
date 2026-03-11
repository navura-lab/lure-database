#!/usr/bin/env npx tsx
/**
 * GSCに出現する問題URL vs DB内の正規slugを照合
 * 重複ページ・旧URLの特定
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. GSCランキングデータから全ページパスを取得
  const rankFile = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'rankings', '2026-03-10.json');
  const rankData = JSON.parse(fs.readFileSync(rankFile, 'utf-8'));
  const gscPages = new Set<string>(rankData.rankings.map((r: any) => r.page));

  console.log('=== GSC出現ページ vs DB slug照合 ===');
  console.log(`GSCユニークページ数: ${gscPages.size}`);

  // 2. DB内の全ユニークslugを取得
  const { data, error } = await sb.from('lures').select('manufacturer_slug, slug, name');
  if (error) { console.error(error); process.exit(1); }

  const dbPaths = new Set<string>();
  const slugToName = new Map<string, string>();
  for (const r of data!) {
    const p = `/${r.manufacturer_slug}/${r.slug}/`;
    dbPaths.add(p);
    if (!slugToName.has(p)) slugToName.set(p, r.name);
  }

  // メーカー一覧ページ
  const mfrSlugs = new Set(data!.map((r: any) => r.manufacturer_slug));
  for (const ms of mfrSlugs) dbPaths.add(`/${ms}/`);

  console.log(`DBユニークページ数: ${dbPaths.size}`);

  // 3. GSCにあるがDBにないページ（旧URL、ranking、guide、fish、type等）
  const orphanGsc: string[] = [];
  const matchedGsc: string[] = [];
  for (const gp of gscPages) {
    if (dbPaths.has(gp)) {
      matchedGsc.push(gp);
    } else {
      orphanGsc.push(gp);
    }
  }

  console.log(`\nDB一致: ${matchedGsc.length}件`);
  console.log(`DB不一致（孤立URL）: ${orphanGsc.length}件`);

  // 孤立URLを分類
  const categories: Record<string, string[]> = {
    'ranking/': [],
    'guide/': [],
    'fish/': [],
    'type/': [],
    'URLエンコード': [],
    '大文字slug': [],
    'アンダースコア': [],
    'その他': [],
  };

  for (const p of orphanGsc.sort()) {
    if (p.startsWith('/ranking/')) categories['ranking/'].push(p);
    else if (p.startsWith('/guide/')) categories['guide/'].push(p);
    else if (p.startsWith('/fish/')) categories['fish/'].push(p);
    else if (p.startsWith('/type/')) categories['type/'].push(p);
    else if (/%[0-9A-Fa-f]{2}/.test(p)) categories['URLエンコード'].push(p);
    else if (/[A-Z]/.test(p.split('/').pop()!)) categories['大文字slug'].push(p);
    else if (/_/.test(p.split('/').pop()!)) categories['アンダースコア'].push(p);
    else categories['その他'].push(p);
  }

  for (const [cat, urls] of Object.entries(categories)) {
    if (urls.length === 0) continue;
    console.log(`\n--- ${cat} (${urls.length}件) ---`);
    for (const u of urls) {
      // 同じメーカー内で似たslugがあるか検索
      const parts = u.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const mfr = parts[0];
        const slug = decodeURIComponent(parts[1]);
        // DB内で同メーカーの全slugと比較
        const sameMfr = data!.filter((r: any) => r.manufacturer_slug === mfr);
        const similar = sameMfr.filter((r: any) =>
          r.name.includes(slug.slice(0, 4)) || slug.includes(r.slug.slice(0, 8))
        );
        const uniqueSimilar = [...new Set(similar.map((r: any) => `${r.slug} (${r.name})`))].slice(0, 3);
        console.log(`  ${u}`);
        if (uniqueSimilar.length > 0) {
          console.log(`    → DB候補: ${uniqueSimilar.join(', ')}`);
        }
      } else {
        console.log(`  ${u}`);
      }
    }
  }

  // 4. 重複疑い検出（同メーカー内で同名ルアーが複数slug持つケース）
  console.log('\n=== 重複slug疑い（同名ルアー・複数slug） ===');
  const nameToSlugs = new Map<string, Set<string>>();
  for (const r of data!) {
    const key = `${r.manufacturer_slug}|||${r.name.split(/[\s　]/)[0]}`; // 名前の最初のワード
    if (!nameToSlugs.has(key)) nameToSlugs.set(key, new Set());
    nameToSlugs.get(key)!.add(r.slug);
  }
  let dupeCount = 0;
  for (const [key, slugs] of nameToSlugs) {
    if (slugs.size > 1) {
      const [mfr, name] = key.split('|||');
      console.log(`  ${mfr}/${name}: ${[...slugs].join(', ')}`);
      dupeCount++;
    }
  }
  if (dupeCount === 0) console.log('  なし');
}

main();
