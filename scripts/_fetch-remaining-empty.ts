// scripts/_fetch-remaining-empty.ts
// viva/jackson/maria/gamakatsu/apia の空description補完

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function ogDesc(html: string): string | null {
  const m = html.match(/property="og:description"[^>]*content="([^"]+)"/);
  return m ? m[1].trim() : null;
}

// vivianet.co.jp - pタグから本文
async function fetchViva(url: string): Promise<string | null> {
  const html = await fetchText(url);
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]{50,600}?)<\/p>/g)];
  for (const m of paras) {
    // タグ除去（改行は保持）
    let raw = m[1].replace(/<[^>]+>/g, '').trim();
    // 最初の行がスペック行（mm/g/円）なら除去
    const lines = raw.split('\n');
    if (lines.length > 0 && /mm|g\s*[/／]|￥|¥|税別/.test(lines[0])) {
      raw = lines.slice(1).join('\n').trim();
    }
    // 残りの空白を正規化
    const clean = raw.replace(/\s+/g, ' ').trim();
    if (clean.length > 50 && /[\u4e00-\u9fff\u3040-\u309f]/.test(clean)) {
      return clean.substring(0, 250);
    }
  }
  return null;
}

// jackson.jp - entry-contentのpタグ
async function fetchJackson(url: string): Promise<string | null> {
  const html = await fetchText(url);
  // entry-contentブロック内の最初のpタグ
  const block = html.match(/class="entry-content"[^>]*>([\s\S]+?)<\/div>/);
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]{50,600}?)<\/p>/g)];
  for (const m of paras) {
    const clean = stripTags(m[1]);
    if (clean.length > 60 && /[\u3040-\u9fff]/.test(clean) && !/CATEGORY|KEYWORD|ALL/.test(clean)) {
      return clean.substring(0, 250);
    }
  }
  return null;
}

// yamaria.co.jp - og:description
async function fetchMaria(url: string): Promise<string | null> {
  const html = await fetchText(url);
  const desc = ogDesc(html);
  if (desc && desc.length > 20 && /[\u3040-\u9fff]/.test(desc)) {
    return desc.substring(0, 250);
  }
  return null;
}

// gamakatsu.co.jp - og:description（長い）
async function fetchGamakatsu(url: string): Promise<string | null> {
  const html = await fetchText(url);
  const desc = ogDesc(html);
  if (desc && desc.length > 20 && /[\u3040-\u9fff]/.test(desc)) {
    return desc.substring(0, 250);
  }
  return null;
}

// apiajapan.com - og:description
async function fetchApia(url: string): Promise<string | null> {
  const html = await fetchText(url);
  const desc = ogDesc(html);
  if (desc && desc.length > 20 && /[\u3040-\u9fff]/.test(desc)) {
    return desc.substring(0, 250);
  }
  return null;
}

type FetchFn = (url: string) => Promise<string | null>;

const MAKERS: Array<{ slug: string; fn: FetchFn }> = [
  { slug: 'viva', fn: fetchViva },
  { slug: 'jackson', fn: fetchJackson },
  { slug: 'maria', fn: fetchMaria },
  { slug: 'gamakatsu', fn: fetchGamakatsu },
  { slug: 'apia', fn: fetchApia },
];

async function main() {
  let totalSuccess = 0;
  let totalSkip = 0;

  for (const { slug, fn } of MAKERS) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, name, source_url')
      .eq('manufacturer_slug', slug)
      .or('description.is.null,description.eq.')
      .range(0, 99);

    if (error) { console.error(`❌ ${slug}:`, error.message); continue; }

    const seen = new Map<string, any>();
    for (const r of data ?? []) {
      if (!seen.has(r.slug)) seen.set(r.slug, r);
    }

    console.log(`\n=== ${slug} (${seen.size}件) ===`);

    for (const item of seen.values()) {
      if (!item.source_url) {
        console.log(`  スキップ: ${item.slug} (source_url なし)`);
        totalSkip++;
        continue;
      }

      try {
        const desc = await fn(item.source_url);
        if (!desc) {
          console.log(`  スキップ: ${item.slug} (テキストなし)`);
          totalSkip++;
          continue;
        }

        const { error: upErr } = await sb
          .from('lures')
          .update({ description: desc })
          .eq('manufacturer_slug', slug)
          .eq('slug', item.slug);

        if (upErr) {
          console.error(`  ❌ ${item.slug}:`, upErr.message);
        } else {
          console.log(`  ✅ ${item.slug}: ${desc.substring(0, 60)}...`);
          totalSuccess++;
        }
      } catch (e: any) {
        console.error(`  ❌ ${item.slug}: ${e.message}`);
        totalSkip++;
      }

      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n完了: ${totalSuccess}成功, ${totalSkip}スキップ`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
