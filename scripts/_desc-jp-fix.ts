// scripts/_desc-jp-fix.ts
// 英語のみdescriptionを日本語に変換するスクリプト
// 対象: 日本メーカー（Forest, Pazdesign, JACKALL, TIEMCO）
//
// Usage:
//   npx tsx scripts/_desc-jp-fix.ts --audit       # 状況調査
//   npx tsx scripts/_desc-jp-fix.ts --dry-run     # dry-run（変更内容を表示）
//   npx tsx scripts/_desc-jp-fix.ts --execute     # 本番実行

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// 日本語文字を含むか判定
const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

// 対象: 日本メーカーのみ（海外メーカーは英語descriptionで正しい）
const JP_MAKERS = ['Forest', 'Pazdesign', 'JACKALL', 'TIEMCO'];

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

interface LureRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  source_url: string | null;
  type: string | null;
  target_fish: string[] | null;
  weight: number | null;
  length: number | null;
  manufacturer: string;
  manufacturer_slug: string;
  color_name: string | null;
  price: number | null;
}

async function fetchEnglishOnlyLures(): Promise<LureRow[]> {
  const allRows: LureRow[] = [];

  for (const maker of JP_MAKERS) {
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const params = new URLSearchParams({
        select: 'id,slug,name,description,source_url,type,target_fish,weight,length,manufacturer,manufacturer_slug,color_name,price',
        manufacturer: `eq.${maker}`,
        order: 'slug.asc,id.asc',
        limit: String(pageSize),
        offset: String(offset),
      });

      const res = await fetch(`${SUPABASE_URL}/rest/v1/lures?${params}`, {
        headers: HEADERS,
      });

      if (!res.ok) throw new Error(`Supabase error for ${maker}: ${res.status} ${await res.text()}`);

      const rows: LureRow[] = await res.json();

      // 日本語を含まないdescriptionのみフィルタ
      const englishOnly = rows.filter(
        (r) => r.description && r.description.trim() !== '' && !HAS_JP.test(r.description)
      );
      allRows.push(...englishOnly);

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  console.log(`  日本メーカー英語のみ: ${allRows.length} 件`);
  return allRows;
}

async function updateDescription(id: number, newDesc: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ description: newDesc }),
  });
  if (!res.ok) throw new Error(`Update failed for id=${id}: ${res.status}`);
}

// ---------------------------------------------------------------------------
// 公式サイト再スクレイプ
// ---------------------------------------------------------------------------

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Forest: SiteOrigin page builderのHTML構造。
// entry-content > panel-layout 内のテキスト要素から日本語説明を抽出
function extractForestDescription(html: string): string | null {
  // script/styleを除去
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // entry-content内を取得（全体をパース）
  const contentMatch = cleaned.match(
    /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*)/i
  );
  const content = contentMatch ? contentMatch[1] : cleaned;

  // HTMLタグをテキスト化
  const text = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\n{2,}/g, '\n');

  // 日本語テキストの説明文を探す（スペック行はスキップ）
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 15);
  const descLines: string[] = [];

  for (const line of lines) {
    if (!HAS_JP.test(line)) continue;

    // スキップパターン
    if (/^(カラー|ウエイト|ウェイト|サイズ|全長|フック|リング|価格|税込|新価格|※|Color|Weight|Price|Home|Products|HOOK)/i.test(line)) continue;
    if (/^\d+\.\s*[^\d]/.test(line)) continue; // 番号付きカラーリスト
    if (/^¥|^\d{3,}円|^￥/.test(line)) continue;
    if (/フォレストオンラインショップ/.test(line)) continue;
    if (/\d{4}年\d{1,2}月\d{1,2}日/.test(line)) continue; // 日付
    if (line.includes(' - Forest')) continue; // title
    if (/Cookie|このウェブサイトは|このサイトでは/.test(line)) continue; // Cookie同意バナー
    if (/ソーシャルメディアや広告配信/.test(line)) continue;

    descLines.push(line);
    // 2行まで連結（1行が短い場合）
    if (descLines.join('').length > 60) break;
  }

  if (descLines.length > 0) {
    return descLines.join('').substring(0, 500);
  }

  return null;
}

// Pazdesign: HTMLの全テキストから説明文を抽出（<p>タグではなく他の要素に入っている）
function extractPazdesignDescription(html: string): string | null {
  // script/styleを除去
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // 全テキスト抽出
  const text = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\n{2,}/g, '\n');

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 30);
  const descLines: string[] = [];

  for (const line of lines) {
    if (!HAS_JP.test(line)) continue;

    // スキップパターン
    if (/^(Pazdesign|PRODUCTS|reed|VEST|WEAR|ACCESSORY|BAG|CAP|Copyright)/i.test(line)) continue;
    if (/length[：:]|weight[：:]|hook[：:]|type[：:]|range[：:]/i.test(line)) continue;
    if (/¥\d|税込|JANコード/.test(line)) continue;
    if (/It wants to be partner/.test(line)) continue; // サイトスローガン

    descLines.push(line);
    if (descLines.join('').length > 60) break;
  }

  if (descLines.length > 0) {
    return descLines.join('').substring(0, 500);
  }

  return null;
}

// TIEMCO: source_urlからの再スクレイプ
function extractTiemcoDescription(html: string): string | null {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const text = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\n{2,}/g, '\n');

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 20);

  for (const line of lines) {
    if (!HAS_JP.test(line)) continue;
    if (/^(TIEMCO|ティムコ|商品コード|サイズ|ウェイト|カラー|価格|タイプ|LENGTH|WEIGHT|TYPE|JAN)/i.test(line)) continue;
    if (/¥|税込/.test(line)) continue;
    if (/Cookie|プライバシー/.test(line)) continue;
    if (/トップページ|お問い合わせ/.test(line)) continue;
    if (/TIEMCO.*公式サイト|Lure Fishing/i.test(line)) continue; // ページタイトル
    if (/ルアーフィッシング公式/.test(line)) continue;
    return line.substring(0, 500);
  }

  return null;
}

// JACKALL: source_urlからの再スクレイプ
function extractJackallDescription(html: string): string | null {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // .product_txt_box や .product_desc 内のテキストを探す
  const text = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\n{2,}/g, '\n');

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 20);

  const descLines: string[] = [];
  for (const line of lines) {
    if (!HAS_JP.test(line)) continue;
    if (/^(JACKALL|SPEC|サイズ|ウェイト|カラー|価格|タイプ|LENGTH|WEIGHT|TYPE)/i.test(line)) continue;
    if (/¥|税込/.test(line)) continue;
    // ページタイトルやナビゲーション要素をスキップ
    if (/JACKALL.*ジャッカル.*ルアー/i.test(line)) continue;
    if (/TIMON|FRESH WATER|SALT WATER/i.test(line)) continue;
    if (/トップページ|商品一覧|お問い合わせ/.test(line)) continue;
    if (/Cookie|プライバシー/.test(line)) continue;
    if (/PRODUCTS.*>.*>/.test(line)) continue; // パンくずリスト
    if (/^\d+\s+\S+\d+(\.\d+)?g\s+JAN/.test(line)) continue; // カラーリスト+JAN
    if (/メッキ系カラーと|カラーラインナップ/.test(line) && line.length < 30) continue;
    descLines.push(line);
    if (descLines.join('').length > 60) break;
  }

  if (descLines.length > 0) {
    return descLines.join('').substring(0, 500);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Forest: slugから公式URL推測
// ---------------------------------------------------------------------------

async function resolveForestUrl(slug: string): Promise<string | null> {
  for (const cat of ['area-lure', 'native-lure']) {
    const testUrl = `https://forestjp.com/products/${cat}/${encodeURIComponent(slug)}/`;
    try {
      const res = await fetch(testUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return res.url; // リダイレクト後の最終URL
    } catch {
      // skip
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// テンプレート生成（スクレイプ失敗時のfallback）
// ---------------------------------------------------------------------------

// メーカー→デフォルト対象魚・コンテキスト
const MAKER_DEFAULTS: Record<string, { targetFish: string; context: string }> = {
  Forest: { targetFish: 'トラウト', context: '管理釣り場やネイティブフィールドのトラウト' },
  Pazdesign: { targetFish: '', context: '' },
  JACKALL: { targetFish: 'バス', context: 'バスフィッシング' },
  TIEMCO: { targetFish: '', context: '' },
};

function generateTemplateDescription(row: LureRow): string {
  const maker = row.manufacturer;
  const typeName = row.type || 'ルアー';
  const defaults = MAKER_DEFAULTS[maker] || { targetFish: '', context: '' };

  // 対象魚
  let targetFish =
    row.target_fish && row.target_fish.length > 0
      ? row.target_fish.join('・')
      : defaults.targetFish;

  // JACKALL/TIEMCOのトラウト商品を判定
  if ((maker === 'JACKALL' || maker === 'TIEMCO') &&
      (row.type === 'スプーン' || row.type === 'クランクベイト') &&
      (row.source_url?.includes('/timon/') || row.target_fish?.includes('トラウト'))) {
    targetFish = 'トラウト';
  }

  // スペック情報
  const specs: string[] = [];
  if (row.weight) specs.push(`${row.weight}g`);
  if (row.length) specs.push(`${row.length}mm`);
  const specStr = specs.length > 0 ? specs.join('、') : '';

  // テンプレート組み立て
  let desc = `${maker}の${targetFish ? targetFish + '用' : ''}${typeName}。`;

  if (specStr) {
    desc += `${specStr}のモデル。`;
  }

  return desc;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

async function audit(): Promise<void> {
  console.log('=== 英語のみ description 調査（日本メーカーのみ） ===\n');
  const rows = await fetchEnglishOnlyLures();
  console.log(`\n合計: ${rows.length} 件\n`);

  // メーカー別集計
  const byMaker = new Map<string, number>();
  const slugsByMaker = new Map<string, Set<string>>();
  for (const r of rows) {
    byMaker.set(r.manufacturer, (byMaker.get(r.manufacturer) || 0) + 1);
    if (!slugsByMaker.has(r.manufacturer)) slugsByMaker.set(r.manufacturer, new Set());
    slugsByMaker.get(r.manufacturer)!.add(r.slug);
  }

  console.log('メーカー別内訳:');
  for (const [maker, count] of [...byMaker.entries()].sort((a, b) => b[1] - a[1])) {
    const slugCount = slugsByMaker.get(maker)!.size;
    console.log(`  ${maker}: ${count} 件 (${slugCount} 商品)`);
  }

  // サンプル表示
  console.log('\n--- サンプル ---');
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.manufacturer}/${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 15) break;
    console.log(`\n[${r.manufacturer}] ${r.name} (${r.slug})`);
    console.log(`  source_url: ${r.source_url || 'null'}`);
    console.log(`  type: ${r.type}, target_fish: ${r.target_fish?.join(',')}, weight: ${r.weight}g`);
    console.log(`  desc: "${r.description?.substring(0, 80)}"`);
    console.log(`  → template: "${generateTemplateDescription(r)}"`);
  }
}

async function dryRunOrExecute(execute: boolean): Promise<void> {
  const mode = execute ? '本番実行' : 'DRY-RUN';
  console.log(`=== ${mode} ===\n`);

  const rows = await fetchEnglishOnlyLures();
  console.log(`\n対象: ${rows.length} 件\n`);

  // slug単位でグループ化
  const slugGroups = new Map<string, LureRow[]>();
  for (const r of rows) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)!.push(r);
  }

  console.log(`ユニーク商品数: ${slugGroups.size}\n`);

  let scrapedCount = 0;
  let templatedCount = 0;
  let failedCount = 0;
  let updatedCount = 0;

  // URL解決キャッシュ
  const descCache = new Map<string, string>();

  for (const [key, group] of slugGroups) {
    const rep = group[0];
    const maker = rep.manufacturer;
    let newDesc: string | null = null;
    let method = 'TEMPLATE';

    // 1. 再スクレイプ試行
    if (maker === 'Forest') {
      // source_urlがnullなのでslugからURL推測
      const cacheKey = `forest/${rep.slug}`;
      if (descCache.has(cacheKey)) {
        newDesc = descCache.get(cacheKey)!;
        method = 'CACHE';
      } else {
        const pageUrl = await resolveForestUrl(rep.slug);
        if (pageUrl) {
          const html = await fetchPageHtml(pageUrl);
          if (html) {
            newDesc = extractForestDescription(html);
          }
        }
        if (newDesc) {
          descCache.set(cacheKey, newDesc);
          method = 'SCRAPE';
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } else if (maker === 'Pazdesign' && rep.source_url) {
      const cacheKey = rep.source_url;
      if (descCache.has(cacheKey)) {
        newDesc = descCache.get(cacheKey)!;
        method = 'CACHE';
      } else {
        const html = await fetchPageHtml(rep.source_url);
        if (html) {
          newDesc = extractPazdesignDescription(html);
        }
        if (newDesc) {
          descCache.set(cacheKey, newDesc);
          method = 'SCRAPE';
        }
        await new Promise((r) => setTimeout(r, 500)); // Pazdesignは少し遅め
      }
    // TIEMCOは公式サイトから説明文を抽出しにくいためスクレイプしない
    } else if (maker === 'JACKALL' && rep.source_url) {
      const cacheKey = rep.source_url;
      if (descCache.has(cacheKey)) {
        newDesc = descCache.get(cacheKey)!;
        method = 'CACHE';
      } else {
        const html = await fetchPageHtml(rep.source_url);
        if (html) {
          newDesc = extractJackallDescription(html);
        }
        if (newDesc) {
          descCache.set(cacheKey, newDesc);
          method = 'SCRAPE';
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (newDesc) {
      scrapedCount++;
    } else {
      // 2. テンプレート生成（fallback）
      newDesc = generateTemplateDescription(rep);
      method = 'TEMPLATE';
      templatedCount++;
    }

    // 表示
    console.log(`[${method}] ${key} (${group.length}件)`);
    console.log(`  旧: "${rep.description?.substring(0, 80)}"`);
    console.log(`  新: "${newDesc.substring(0, 120)}"`);

    // 3. 更新
    if (execute && newDesc) {
      for (const row of group) {
        try {
          await updateDescription(row.id, newDesc);
          updatedCount++;
        } catch (err) {
          console.error(`  ERROR id=${row.id}: ${err}`);
          failedCount++;
        }
      }

      if (updatedCount % 200 === 0 && updatedCount > 0) {
        console.log(`  ... ${updatedCount}/${rows.length} 更新完了`);
      }
    }
  }

  console.log('\n=== 結果 ===');
  console.log(`  スクレイプ成功: ${scrapedCount} 商品`);
  console.log(`  テンプレート生成: ${templatedCount} 商品`);
  if (execute) {
    console.log(`  更新レコード: ${updatedCount} 件`);
    console.log(`  失敗: ${failedCount} 件`);
  } else {
    console.log(`  (dry-runのため更新なし。--execute で本番実行)`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const arg = process.argv[2];
if (arg === '--audit') {
  audit().catch(console.error);
} else if (arg === '--dry-run') {
  dryRunOrExecute(false).catch(console.error);
} else if (arg === '--execute') {
  dryRunOrExecute(true).catch(console.error);
} else {
  console.log('Usage:');
  console.log('  npx tsx scripts/_desc-jp-fix.ts --audit       # 状況調査');
  console.log('  npx tsx scripts/_desc-jp-fix.ts --dry-run     # dry-run');
  console.log('  npx tsx scripts/_desc-jp-fix.ts --execute     # 本番実行');
}
