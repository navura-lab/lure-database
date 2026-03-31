/**
 * scripts/_fetch-multi-desc.ts
 * 複数メーカーの空descriptionを公式サイトからfetchして補完する
 *
 * 対象: duel / geecrack / berkley-jp / tacklehouse
 *
 * 実行:
 *   npx tsx scripts/_fetch-multi-desc.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---------------------------------------------------------------------------
// 文字数調整（150〜230文字に収める）
// ---------------------------------------------------------------------------

function trimToRange(text: string, min = 150, max = 230): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;

  // max文字で切って、日本語句読点や文末で切り詰める
  let cut = t.substring(0, max);
  // 最後の句点・読点を探す
  const lastPeriod = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('、'), cut.lastIndexOf('．'));
  if (lastPeriod >= min) {
    cut = cut.substring(0, lastPeriod + 1);
  }
  return cut;
}

// ---------------------------------------------------------------------------
// DB: 空description商品をslug単位でユニーク取得
// ---------------------------------------------------------------------------

async function fetchEmptyDescs(manufacturerSlug: string): Promise<Array<{
  slug: string;
  name: string;
  source_url: string;
}>> {
  const { data, error } = await sb.from('lures')
    .select('slug,name,source_url')
    .eq('manufacturer_slug', manufacturerSlug)
    .or('description.is.null,description.eq.')
    .range(0, 999);

  if (error) throw new Error(`DB fetch error: ${error.message}`);

  // slug単位でユニーク化（source_urlはslug内で共通なので最初の1件でOK）
  const seen = new Map<string, { slug: string; name: string; source_url: string }>();
  for (const r of data ?? []) {
    if (!seen.has(r.slug) && r.source_url) {
      seen.set(r.slug, { slug: r.slug, name: r.name, source_url: r.source_url });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// DB: slug単位で全行のdescriptionを更新
// ---------------------------------------------------------------------------

async function writeDesc(manufacturerSlug: string, slug: string, description: string): Promise<void> {
  const { error } = await sb.from('lures')
    .update({ description })
    .eq('manufacturer_slug', manufacturerSlug)
    .eq('slug', slug);
  if (error) throw new Error(`DB write error for ${slug}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// DUEL — Playwright
// セレクタ: .p-product-text, .p-detail-text, .product-description
// ---------------------------------------------------------------------------

async function fetchDuelDesc(url: string, page: any): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const text = await page.evaluate(() => {
      // DUELサイトは商品説明が main p タグに複数分散している。
      // 最初のpタグ（商品コンセプト文）から始まる連続テキストを結合する。
      // カラー説明文（【...】で始まるテキスト）は除外する。

      // まず .p-product-text / .l-hero-detail_text などの専用クラスを試す
      const selectors = ['.p-product-text', '.p-detail-text', '.product-description',
        '.l-product-text', '.p-item-lead', '.l-hero-detail_text'];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) {
          const t = (el as HTMLElement).textContent?.trim() ?? '';
          if (t.length > 50) return t;
        }
      }

      // フォールバック: main/article内のpタグを収集して結合
      // カラー説明（【...】で始まる）は除外
      const paras = document.querySelectorAll('main p, article p, .l-main p');
      const collected: string[] = [];
      for (const p of paras) {
        const t = ((p as HTMLElement).textContent ?? '').trim();
        // カラー説明は除外
        if (t.startsWith('【') || t.length < 15) continue;
        // ナビ・フッター系の短いテキストも除外
        if (/^(戻る|一覧|HOME|PRODUCTS|MENU|ページトップ)/i.test(t)) continue;
        collected.push(t);
        // 50文字以上のものが最初に来たら連続して次も取る（最大3文）
        if (collected.length >= 3) break;
      }
      return collected.length > 0 ? collected.join(' ') : null;
    });
    return text ? trimToRange(text) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GEECRACK — Playwright
// セレクタ: h2.catch + p.read
// ---------------------------------------------------------------------------

async function fetchGeecrackDesc(url: string, page: any): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => {
      const catchEl = document.querySelector('h2.catch');
      const readEl = document.querySelector('p.read');
      const catchText = catchEl ? (catchEl.textContent ?? '').trim() : '';
      const readText = readEl ? (readEl.textContent ?? '').trim() : '';
      const combined = [catchText, readText].filter(Boolean).join('　');
      return combined.length > 10 ? combined : null;
    });
    return text ? trimToRange(text) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BERKLEY JP — fetch-only
// セレクタ: productTextArea > p.contentText
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&yen;/g, '¥')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBerkleyDesc(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // productTextArea 内の contentText を取得
    const areaMatch = html.match(/productTextArea[\s\S]*?<p[^>]*class="contentText"[^>]*>([\s\S]*?)<\/p>/);
    if (areaMatch) {
      const t = stripHtml(areaMatch[1]);
      if (t.length > 20) return trimToRange(t);
    }

    // フォールバック: contentText クラス全体
    const altMatch = html.match(/<p[^>]*class="contentText"[^>]*>([\s\S]*?)<\/p>/);
    if (altMatch) {
      const t = stripHtml(altMatch[1]);
      if (t.length > 20) return trimToRange(t);
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TACKLEHOUSE — Playwright
// セレクタ: 最初の意味のある p タグ（30文字以上）
// ---------------------------------------------------------------------------

async function fetchTacklehouseDesc(url: string, page: any): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const text = await page.evaluate(() => {
      const paras = document.querySelectorAll('p');
      for (const p of paras) {
        const t = (p as HTMLElement).textContent?.trim() ?? '';
        if (t.length > 30 && t.length < 600) return t;
      }
      return null;
    });
    return text ? trimToRange(text) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// メーカー処理
// ---------------------------------------------------------------------------

interface MakerResult {
  maker: string;
  success: number;
  skip: number;
  total: number;
}

async function processMaker(
  maker: string,
  fetchDesc: (url: string) => Promise<string | null>
): Promise<MakerResult> {
  console.log(`\n========== ${maker} ==========`);

  const items = await fetchEmptyDescs(maker);
  console.log(`  空description: ${items.length}件`);

  let success = 0;
  let skip = 0;

  for (const item of items) {
    console.log(`  → ${item.slug} | ${item.source_url}`);
    const desc = await fetchDesc(item.source_url);
    if (!desc || desc.length < 10) {
      console.log(`    スキップ（取得失敗 or 短すぎ）`);
      skip++;
      continue;
    }
    console.log(`    取得: ${desc.length}文字 | ${desc.substring(0, 60)}…`);
    await writeDesc(maker, item.slug, desc);
    success++;
  }

  console.log(`  結果: 成功=${success} スキップ=${skip}`);
  return { maker, success, skip, total: items.length };
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== _fetch-multi-desc.ts 開始 ===\n');

  const results: MakerResult[] = [];

  // --- BERKLEY JP（fetch-only、Playwrightなし）---
  {
    const r = await processMaker('berkley-jp', fetchBerkleyDesc);
    results.push(r);
  }

  // --- Playwright使用メーカー ---
  const browser = await chromium.launch({ headless: true });

  try {
    // --- DUEL ---
    {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      const r = await processMaker('duel', (url) => fetchDuelDesc(url, page));
      results.push(r);
      await context.close();
    }

    // --- GEECRACK ---
    {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      const r = await processMaker('geecrack', (url) => fetchGeecrackDesc(url, page));
      results.push(r);
      await context.close();
    }

    // --- TACKLEHOUSE ---
    {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      const r = await processMaker('tacklehouse', (url) => fetchTacklehouseDesc(url, page));
      results.push(r);
      await context.close();
    }

  } finally {
    await browser.close();
  }

  // サマリー
  console.log('\n========== サマリー ==========');
  console.log('メーカー            | 対象 | 成功 | スキップ');
  console.log('---------------------|------|------|--------');
  for (const r of results) {
    console.log(`${r.maker.padEnd(20)} | ${String(r.total).padStart(4)} | ${String(r.success).padStart(4)} | ${String(r.skip).padStart(6)}`);
  }
  const totalSuccess = results.reduce((a, r) => a + r.success, 0);
  const totalSkip = results.reduce((a, r) => a + r.skip, 0);
  console.log(`${'合計'.padEnd(20)} | ${String(results.reduce((a,r)=>a+r.total,0)).padStart(4)} | ${String(totalSuccess).padStart(4)} | ${String(totalSkip).padStart(6)}`);
  console.log('\n=== 完了 ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
