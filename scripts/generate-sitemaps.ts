/**
 * ビルド後サイトマップ生成スクリプト
 *
 * @astrojs/sitemapが生成した単一サイトマップを種別分割し、画像サイトマップを追加する。
 *
 * 生成ファイル:
 *   sitemap-products.xml  — ルアー詳細ページ (/{maker}/{slug}/)
 *   sitemap-makers.xml    — メーカーページ (/{maker}/)
 *   sitemap-categories.xml — ランキング/タイプ/魚種/比較等
 *   sitemap-articles.xml  — 記事ページ
 *   sitemap-images.xml    — 画像サイトマップ（全カラー画像）
 *   sitemap-misc.xml      — その他（トップ、about、privacy等）
 *   sitemap-index.xml     — 上記を束ねるインデックス
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const DIST_DIR = join(process.cwd(), 'dist', 'client');
const CACHE_FILE = join(process.cwd(), '.cache', 'lures.json');
const SITE = 'https://www.castlog.xyz';

// カテゴリ判定用パス
const CATEGORY_PREFIXES = ['type', 'fish', 'ranking', 'compare', 'method', 'season', 'guide', 'new', 'maker'];
const STATIC_PAGES = ['about', 'privacy', 'disclaimer', 'search'];

interface LureRecord {
  name: string;
  slug: string;
  manufacturer_slug: string;
  color_name: string | null;
  images: string[] | null;
}

// URLからパス部分を取得
function getPath(url: string): string {
  return url.replace(SITE, '').replace(/\/$/, '') || '/';
}

// URLの種別を判定
function classifyUrl(url: string): 'product' | 'maker' | 'category' | 'article' | 'misc' {
  const path = getPath(url);

  // トップページ
  if (path === '/') return 'misc';

  const parts = path.split('/').filter(Boolean);

  // /en/ ページは除外（filterで弾かれているはずだが念のため）
  if (parts[0] === 'en') return 'misc';

  // 記事
  if (parts[0] === 'article') return 'article';

  // カテゴリ系（一覧＋詳細）
  if (CATEGORY_PREFIXES.includes(parts[0])) return 'category';

  // 静的ページ
  if (STATIC_PAGES.includes(parts[0])) return 'misc';

  // /{maker}/{slug}/ → 商品詳細
  if (parts.length >= 2) return 'product';

  // /{maker}/ → メーカーページ
  if (parts.length === 1) return 'maker';

  return 'misc';
}

// XMLからURL要素をパース（軽量パーサー）
function parseUrlEntries(xml: string): Array<{ raw: string; loc: string }> {
  const entries: Array<{ raw: string; loc: string }> = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;
  let match;
  while ((match = urlRegex.exec(xml)) !== null) {
    const raw = match[0];
    const locMatch = raw.match(/<loc>(.*?)<\/loc>/);
    if (locMatch) {
      entries.push({ raw, loc: locMatch[1] });
    }
  }
  return entries;
}

// サイトマップXMLを生成
function buildSitemap(entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries.join('\n')}
</urlset>`;
}

// 画像サイトマップを生成
function buildImageSitemap(lures: LureRecord[]): string {
  // slug単位でグルーピング
  const groups = new Map<string, Map<string, { name: string; colorName: string }>>();

  for (const lure of lures) {
    if (!lure.images || lure.images.length === 0) continue;

    const pageKey = `${lure.manufacturer_slug}/${lure.slug}`;

    for (const imgUrl of lure.images) {
      if (!groups.has(pageKey)) {
        groups.set(pageKey, new Map());
      }
      const imgMap = groups.get(pageKey)!;
      if (!imgMap.has(imgUrl)) {
        imgMap.set(imgUrl, {
          name: lure.name,
          colorName: lure.color_name || '',
        });
      }
    }
  }

  const entries: string[] = [];

  for (const [pageKey, imgMap] of groups) {
    const imageElements: string[] = [];
    for (const [imgUrl, info] of imgMap) {
      const title = info.colorName
        ? `${info.name} ${info.colorName}`
        : info.name;
      // XMLエスケープ
      const escapedTitle = title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
      const escapedUrl = imgUrl
        .replace(/&/g, '&amp;');

      imageElements.push(`    <image:image>
      <image:loc>${escapedUrl}</image:loc>
      <image:title>${escapedTitle}</image:title>
    </image:image>`);
    }

    entries.push(`  <url>
    <loc>${SITE}/${pageKey}/</loc>
${imageElements.join('\n')}
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`;
}

// サイトマップインデックスを生成
function buildSitemapIndex(files: string[], lastmod: string): string {
  const entries = files.map(f => `  <sitemap>
    <loc>${SITE}/${f}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</sitemapindex>`;
}

// メイン
function main() {
  console.log('[sitemap-split] サイトマップ種別分割＋画像サイトマップ生成を開始...');

  // 1. 既存のastro生成サイトマップを読み込む
  const sitemapFiles = readdirSync(DIST_DIR)
    .filter(f => f.match(/^sitemap-\d+\.xml$/))
    .sort();

  if (sitemapFiles.length === 0) {
    console.error('[sitemap-split] ERROR: dist/client/に astroサイトマップが見つかりません');
    process.exit(1);
  }

  // 全URL要素を収集
  const allEntries: Array<{ raw: string; loc: string }> = [];
  for (const file of sitemapFiles) {
    const xml = readFileSync(join(DIST_DIR, file), 'utf-8');
    allEntries.push(...parseUrlEntries(xml));
  }
  console.log(`[sitemap-split] 既存サイトマップから ${allEntries.length} URL を読み込み`);

  // 2. 種別分類
  const classified: Record<string, string[]> = {
    product: [],
    maker: [],
    category: [],
    article: [],
    misc: [],
  };

  for (const entry of allEntries) {
    const type = classifyUrl(entry.loc);
    classified[type].push(entry.raw);
  }

  for (const [type, entries] of Object.entries(classified)) {
    console.log(`[sitemap-split]   ${type}: ${entries.length} URL`);
  }

  // 3. 画像サイトマップ生成
  let imageXml = '';
  if (existsSync(CACHE_FILE)) {
    console.log('[sitemap-split] .cache/lures.json から画像データを読み込み中...');
    const lures: LureRecord[] = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    imageXml = buildImageSitemap(lures);

    // 画像数カウント
    const imageCount = (imageXml.match(/<image:image>/g) || []).length;
    const pageCount = (imageXml.match(/<url>/g) || []).length;
    console.log(`[sitemap-split]   images: ${pageCount} ページ, ${imageCount} 画像`);
  } else {
    console.warn('[sitemap-split] WARN: .cache/lures.json が見つかりません。画像サイトマップをスキップ');
  }

  // 4. 既存サイトマップファイルを削除
  for (const file of sitemapFiles) {
    unlinkSync(join(DIST_DIR, file));
  }
  // 既存のsitemap-index.xmlも削除
  const indexFile = join(DIST_DIR, 'sitemap-index.xml');
  if (existsSync(indexFile)) {
    unlinkSync(indexFile);
  }

  // 5. 種別サイトマップを書き出し
  const lastmod = new Date().toISOString();
  const outputFiles: string[] = [];

  const typeMap: Record<string, string> = {
    product: 'sitemap-products.xml',
    maker: 'sitemap-makers.xml',
    category: 'sitemap-categories.xml',
    article: 'sitemap-articles.xml',
    misc: 'sitemap-misc.xml',
  };

  for (const [type, filename] of Object.entries(typeMap)) {
    if (classified[type].length > 0) {
      writeFileSync(join(DIST_DIR, filename), buildSitemap(classified[type]));
      outputFiles.push(filename);
      console.log(`[sitemap-split] ✓ ${filename} (${classified[type].length} URL)`);
    }
  }

  // 画像サイトマップ
  if (imageXml) {
    writeFileSync(join(DIST_DIR, 'sitemap-images.xml'), imageXml);
    outputFiles.push('sitemap-images.xml');
    console.log(`[sitemap-split] ✓ sitemap-images.xml`);
  }

  // 6. サイトマップインデックス
  writeFileSync(join(DIST_DIR, 'sitemap-index.xml'), buildSitemapIndex(outputFiles, lastmod));
  console.log(`[sitemap-split] ✓ sitemap-index.xml (${outputFiles.length} サイトマップ)`);

  console.log('[sitemap-split] 完了');
}

main();
