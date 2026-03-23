/**
 * zero-dragon全商品をスクレイプしてSupabaseに新規登録するスクリプト
 * DB上のzero-dragon行は全て削除済みの前提で、フルスクレイプ→INSERT
 *
 * Usage: npx tsx scripts/_register-zero-dragon.ts [--dry-run]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { scrapeZeroDragonPage } from './scrapers/zero-dragon.js';

const MANUFACTURER_NAME = 'ZERO DRAGON';
const MANUFACTURER_SLUG = 'zero-dragon';
const DELAY_BETWEEN_MS = 2_000;
const SCRAPE_TIMEOUT_MS = 60_000;

// ロッド型番パターン（非ルアー）
// EJ=電動ジギングロッド, ESJ=スロージギングロッド, SH=スーパーライト,
// UMV=ウルトラメタルバイブロッド, ZL=ゼロリミテッド
const ROD_PATTERNS = /^(EJ|ESJ|SH|UMV|ZL)\d/i;

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scrapeWithTimeout(url: string, timeoutMs: number) {
  return Promise.race([
    scrapeZeroDragonPage(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// 商品一覧ページから全商品URLを取得（スクレイパー内部のfetchAllProductsと同等）
// ---------------------------------------------------------------------------
const SITE_BASE = 'https://zero-dragon.com';
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'ja,en;q=0.9',
};

interface ProductEntry {
  pid: string;
  name: string;
  url: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseBaseName(fullName: string): { baseName: string; colorName: string } {
  const normalized = fullName.replace(/\u3000/g, ' ').trim();
  const weightColorMatch = normalized.match(/^(.+?\s+\d+(?:\.\d+)?\s*g)\s+(.+)$/i);
  if (weightColorMatch) {
    return { baseName: weightColorMatch[1].trim(), colorName: weightColorMatch[2].trim() };
  }
  const trailingParenMatch = normalized.match(/^(.+?)\s+([^\s]+[（(][^）)]+[）)])\s*$/);
  if (trailingParenMatch) {
    return { baseName: trailingParenMatch[1].trim(), colorName: trailingParenMatch[2].trim() };
  }
  return { baseName: normalized, colorName: '' };
}

async function fetchAllProducts(): Promise<ProductEntry[]> {
  const products: ProductEntry[] = [];
  const seenPids = new Set<string>();

  for (let pageNum = 1; pageNum <= 10; pageNum++) {
    const listUrl = `${SITE_BASE}/?mode=srh&sort=n&page=${pageNum}`;
    let html: string;
    try {
      const res = await fetch(listUrl, { headers: FETCH_HEADERS });
      if (!res.ok) break;
      const rawBytes = await res.arrayBuffer();
      html = new TextDecoder('euc-jp').decode(rawBytes);
    } catch {
      break;
    }

    const linkRegex = /<a\s+[^>]*href="(?:https?:\/\/zero-dragon\.com)?\/?[?&]pid=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    let foundOnPage = 0;

    while ((match = linkRegex.exec(html)) !== null) {
      const pid = match[1];
      if (seenPids.has(pid)) continue;
      seenPids.add(pid);

      const linkText = stripHtml(match[2]).trim();
      if (!linkText) continue;

      products.push({ pid, name: linkText, url: `${SITE_BASE}/?pid=${pid}` });
      foundOnPage++;
    }

    if (foundOnPage === 0) break;
    if (pageNum < 10) await sleep(300);
  }

  return products;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== zero-dragon DB再登録 ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // 1. 商品一覧から全URLを取得
  console.log('商品一覧を取得中...');
  const allProducts = await fetchAllProducts();
  console.log(`全商品数: ${allProducts.length} (個別カラーページ含む)\n`);

  // 2. ベース名でグルーピング → 1ベース名につき1回だけスクレイプ
  const baseNameToUrl = new Map<string, string>();
  let skippedRods = 0;
  for (const p of allProducts) {
    const { baseName } = parseBaseName(p.name);
    // ロッド型番を除外
    if (ROD_PATTERNS.test(baseName)) {
      if (!baseNameToUrl.has('__rod__' + baseName)) {
        baseNameToUrl.set('__rod__' + baseName, '');
        skippedRods++;
        console.log(`  ロッド除外: ${baseName}`);
      }
      continue;
    }
    if (!baseNameToUrl.has(baseName)) {
      baseNameToUrl.set(baseName, p.url);
    }
  }

  // ロッドマーカーを除去
  for (const key of [...baseNameToUrl.keys()]) {
    if (key.startsWith('__rod__')) baseNameToUrl.delete(key);
  }

  console.log(`ユニーク商品数: ${baseNameToUrl.size} (ロッド${skippedRods}件除外)\n`);

  // 3. 各商品をスクレイプしてDB登録
  let registered = 0;
  let rowsInserted = 0;
  let errors = 0;
  let count = 0;
  const now = new Date().toISOString();

  for (const [baseName, url] of baseNameToUrl) {
    count++;
    try {
      const lure = await scrapeWithTimeout(url, SCRAPE_TIMEOUT_MS);

      if (!lure || !lure.slug) {
        console.log(`[${count}/${baseNameToUrl.size}] SKIP "${baseName}": スクレイプ結果なし`);
        errors++;
        continue;
      }

      // サイト共通メタdescriptionは無意味なので除去
      let desc = lure.description || '';
      if (desc.startsWith('電動ジギングならゼロドラゴン')) {
        desc = '';
      }

      // ウェイトから年号等の異常値を除去（2026等）
      const cleanWeights = lure.weights.filter(w => w < 1000);

      // カラー展開: 1カラー=1行
      const rows: any[] = [];

      if (lure.colors.length === 0) {
        // カラーなしの場合は1行だけ登録
        for (const w of (cleanWeights.length > 0 ? cleanWeights : [null])) {
          rows.push({
            name: lure.name,
            name_kana: lure.name,
            manufacturer: MANUFACTURER_NAME,
            manufacturer_slug: MANUFACTURER_SLUG,
            slug: lure.slug,
            type: lure.type,
            description: desc,
            target_fish: lure.target_fish,
            color_name: '',
            images: lure.mainImage ? [lure.mainImage] : [],
            source_url: lure.sourceUrl,
            weight: w,
            length: lure.length,
            price: lure.price || null,
            created_at: now,
            updated_at: now,
          });
        }
      } else {
        // カラー×ウェイト展開
        const weights = cleanWeights.length > 0 ? cleanWeights : [null];
        for (const color of lure.colors) {
          for (const w of weights) {
            rows.push({
              name: lure.name,
              name_kana: lure.name,
              manufacturer: MANUFACTURER_NAME,
              manufacturer_slug: MANUFACTURER_SLUG,
              slug: lure.slug,
              type: lure.type,
              description: desc,
              target_fish: lure.target_fish,
              color_name: color.name,
              images: color.imageUrl ? [color.imageUrl] : (lure.mainImage ? [lure.mainImage] : []),
              source_url: lure.sourceUrl,
              weight: w,
              length: lure.length,
              price: lure.price || null,
              created_at: now,
              updated_at: now,
            });
          }
        }
      }

      if (dryRun) {
        console.log(`[${count}/${baseNameToUrl.size}] OK "${lure.name}" → ${rows.length}行 (${lure.colors.length}色×${lure.weights.length || 1}ウェイト) type=${lure.type}`);
      } else {
        // バッチINSERT
        const { error } = await sb.from('lures').insert(rows);
        if (error) {
          console.log(`[${count}/${baseNameToUrl.size}] DB ERROR "${lure.name}": ${error.message}`);
          errors++;
          continue;
        }
        console.log(`[${count}/${baseNameToUrl.size}] OK "${lure.name}" → ${rows.length}行 INSERT成功`);
      }

      registered++;
      rowsInserted += rows.length;

    } catch (e: any) {
      console.log(`[${count}/${baseNameToUrl.size}] ERR "${baseName}": ${e.message?.slice(0, 100)}`);
      errors++;
    }

    // サイトに優しく待つ
    if (count < baseNameToUrl.size) {
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  console.log(`\n=== 完了 ===`);
  console.log(`登録商品: ${registered}/${baseNameToUrl.size}`);
  console.log(`挿入行数: ${rowsInserted}`);
  console.log(`エラー: ${errors}`);
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
