#!/usr/bin/env npx tsx
/**
 * GSC出現URLのうち、現在のDBにないルアーページを特定
 * → リダイレクト候補として出力
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. GSCデータからルアーページのみ抽出（ranking/, guide/, fish/, type/ は除外）
  const rankFile = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'rankings', '2026-03-10.json');
  const rankData = JSON.parse(fs.readFileSync(rankFile, 'utf-8'));

  const gscEntries = new Map<string, { impressions: number; clicks: number }>();
  for (const r of rankData.rankings) {
    const page: string = r.page;
    if (!gscEntries.has(page)) {
      gscEntries.set(page, { impressions: 0, clicks: 0 });
    }
    const e = gscEntries.get(page)!;
    e.impressions += r.impressions;
    e.clicks += r.clicks;
  }

  // ルアーページのみ（/{mfr}/{slug}/ パターン）
  const lurePages = [...gscEntries.entries()].filter(([p]) => {
    const parts = p.split('/').filter(Boolean);
    return parts.length === 2 && !['ranking', 'guide', 'fish', 'type'].includes(parts[0]);
  });

  console.log(`GSCルアーページ数: ${lurePages.length}`);

  // 2. DB内の全slugをロード（ページネーション必須: 165K+行）
  const data: { manufacturer_slug: string; slug: string; name: string }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error } = await sb.from('lures').select('manufacturer_slug, slug, name').range(offset, offset + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!page || page.length === 0) break;
    data.push(...page);
    offset += page.length;
    if (page.length < PAGE) break;
  }
  console.log(`DB行数: ${data.length}`);

  const dbSlugs = new Map<string, string>(); // path → name
  for (const r of data) {
    const p = `/${r.manufacturer_slug}/${r.slug}/`;
    if (!dbSlugs.has(p)) dbSlugs.set(p, r.name);
  }

  // 3. 照合
  const matched: string[] = [];
  const orphans: { gscPath: string; mfr: string; slug: string; imp: number; clicks: number }[] = [];

  for (const [gscPath, stats] of lurePages) {
    if (dbSlugs.has(gscPath)) {
      matched.push(gscPath);
    } else {
      const parts = gscPath.split('/').filter(Boolean);
      orphans.push({
        gscPath,
        mfr: parts[0],
        slug: decodeURIComponent(parts[1]),
        imp: stats.impressions,
        clicks: stats.clicks,
      });
    }
  }

  console.log(`DB一致: ${matched.length}件`);
  console.log(`孤立（リダイレクト候補）: ${orphans.length}件\n`);

  // 4. 孤立URLごとにDB内の類似slugを探索
  orphans.sort((a, b) => b.imp - a.imp);

  for (const o of orphans) {
    // 同メーカー内のslugを取得
    const sameMfr = data.filter(r => r.manufacturer_slug === o.mfr);
    const uniqueSlugs = [...new Map(sameMfr.map(r => [r.slug, r.name])).entries()];

    // 名前の類似度でマッチ候補を探す
    const candidates: { slug: string; name: string; score: number }[] = [];
    for (const [slug, name] of uniqueSlugs) {
      let score = 0;
      // slug部分一致
      if (slug.includes(o.slug.slice(0, 6)) || o.slug.includes(slug.slice(0, 6))) score += 3;
      // 名前の一部がslugに含まれる
      const nameWords = name.split(/[\s　()（）]+/).filter(w => w.length > 2);
      for (const w of nameWords) {
        if (o.slug.toLowerCase().includes(w.toLowerCase().slice(0, 5))) score += 2;
      }
      if (score > 0) candidates.push({ slug, name, score });
    }
    candidates.sort((a, b) => b.score - a.score);

    console.log(`${o.gscPath}  (imp=${o.imp}, clicks=${o.clicks})`);
    if (candidates.length > 0) {
      const top = candidates[0];
      console.log(`  → /${o.mfr}/${top.slug}/  (${top.name})  score=${top.score}`);
    } else {
      console.log(`  → マッチなし（メーカーページへ: /${o.mfr}/）`);
    }
  }
}

main();
