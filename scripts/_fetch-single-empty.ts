// scripts/_fetch-single-empty.ts
// 少数件数の空description補完（og:descriptionベース）

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchOgDesc(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/property="og:description"[^>]*content="([^"]+)"/);
  if (m && m[1].length > 20) return m[1].trim().substring(0, 250);
  return null;
}

// 手動設定リスト（source_url → (maker_slug, lure_slug) のマッピング）
const TARGETS: Array<{ maker: string; slug: string; url: string }> = [
  // thirtyfour
  { maker: 'thirtyfour', slug: 'jr', url: 'https://34net.jp/products/worm/jr/' },
  // breaden
  { maker: 'breaden', slug: 'metalegi', url: 'https://breaden.net/product/EGI/metalegi.html' },
  // pickup
  { maker: 'pickup', slug: 'sumorutorappu', url: 'https://pickup-m.jp/product/1791/' },
];

async function main() {
  let success = 0, skip = 0;

  for (const target of TARGETS) {
    try {
      const desc = await fetchOgDesc(target.url);
      if (!desc) {
        console.log(`スキップ: ${target.maker}/${target.slug}`);
        skip++;
        continue;
      }

      const { error } = await sb
        .from('lures')
        .update({ description: desc })
        .eq('manufacturer_slug', target.maker)
        .eq('slug', target.slug);

      if (error) {
        console.error(`❌ ${target.maker}/${target.slug}: ${error.message}`);
      } else {
        console.log(`✅ ${target.maker}/${target.slug}: ${desc.substring(0, 80)}...`);
        success++;
      }
    } catch (e: any) {
      console.error(`❌ ${target.maker}/${target.slug}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n完了: ${success}成功, ${skip}スキップ`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
