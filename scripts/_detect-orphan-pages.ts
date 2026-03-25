/**
 * 孤立ページ検出スクリプト
 *
 * サイトマップのURLと実際の内部リンク構造を照合し、
 * どのカテゴリページからもリンクされていないルアーページを検出する。
 *
 * リンク元カテゴリ:
 * - メーカーページ (/[manufacturer_slug]/)
 * - タイプページ (/type/[slug]/)
 * - ランキングページ (/ranking/[slug]/)
 * - 対象魚ページ (/fish/[slug]/)
 * - 新着ページ (/new/)
 * - ホームページ (/)
 */

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// ─── 1. サイトマップからURL抽出 ───
function extractUrlsFromSitemap(filePath: string): string[] {
  const xml = readFileSync(filePath, 'utf-8');
  const urls: string[] = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

const BASE = 'https://www.castlog.xyz';
const sitemapUrls: string[] = [];
for (const file of ['sitemap-0.xml', 'sitemap-1.xml']) {
  const path = join(ROOT, 'dist', 'client', file);
  try {
    sitemapUrls.push(...extractUrlsFromSitemap(path));
  } catch (e) {
    console.warn(`⚠️ ${file} が見つかりません。ビルドを先に実行してください。`);
  }
}

// パスに変換
const sitemapPaths = sitemapUrls.map(u => u.replace(BASE, '').replace(/\/$/, '') || '/');

// ルアー詳細ページ: /manufacturer/slug の2セグメント構造
const NON_LURE_PREFIXES = ['type', 'ranking', 'fish', 'article', 'en', 'guide', 'season', 'method', 'compare', 'maker', 'new', 'guide'];
const STATIC_PAGES = ['/', '/search', '/about', '/privacy', '/disclaimer'];

const lureDetailPaths = new Set<string>();
const otherPaths: string[] = [];

for (const p of sitemapPaths) {
  const segments = p.replace(/^\//, '').split('/').filter(Boolean);
  if (segments.length === 2 && !NON_LURE_PREFIXES.includes(segments[0])) {
    lureDetailPaths.add(p);
  } else {
    otherPaths.push(p);
  }
}

console.log(`サイトマップ全URL: ${sitemapPaths.length}`);
console.log(`ルアー詳細ページ: ${lureDetailPaths.size}`);
console.log(`その他ページ: ${otherPaths.length}`);

// ─── 2. キャッシュからルアーデータ取得 ───
const CACHE_FILE = join(ROOT, '.cache', 'lures.json');
const lures = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
console.log(`キャッシュ: ${lures.length} 行`);

// group-lures.ts と同じロジックで集約
interface GroupedLure {
  slug: string;
  manufacturer_slug: string;
  manufacturer: string;
  name: string;
  type: string | null;
  target_fish: string[];
  color_count: number;
  created_at: string;
  has_image: boolean;
}

// EXCLUDED_TYPES / isNonLureProduct の簡易版
const EXCLUDED_TYPES = new Set(['ルアーアクセサリー']);
const NON_LURE_PATTERNS = [
  /シンカー/i, /ウェイト(?!レス)/i, /フック(?!セット)/i, /ロッド/i, /リール/i,
  /ライン(?!スルー)/i, /リーダー/i, /スナップ/i, /リング$/i,
  /replacement/i, /spare/i, /hook\s*set/i, /rod\s*(?:blank|tip|butt)/i,
];

const seriesMap = new Map<string, any[]>();
for (const lure of lures) {
  if (!lure.slug || !lure.manufacturer_slug) continue;
  if (EXCLUDED_TYPES.has(lure.type)) continue;
  const existing = seriesMap.get(lure.slug) || [];
  existing.push(lure);
  seriesMap.set(lure.slug, existing);
}

const allSeries: GroupedLure[] = [];
for (const [slug, records] of seriesMap) {
  const rep = records[0];
  const targetFish = [...new Set(records.map(r => r.target_fish).filter(Boolean))];
  allSeries.push({
    slug,
    manufacturer_slug: rep.manufacturer_slug,
    manufacturer: rep.manufacturer,
    name: rep.name,
    type: rep.type || null,
    target_fish: targetFish,
    color_count: records.length,
    created_at: rep.created_at || '',
    has_image: !!rep.image_url,
  });
}

console.log(`グルーピング後: ${allSeries.length} シリーズ`);

// ─── 3. 各カテゴリからのリンク先を算出 ───

// 3a. メーカーページ → 全ルアーにリンク（必ずリンクされる）
const linkedByManufacturer = new Set<string>();
for (const s of allSeries) {
  linkedByManufacturer.add(`/${s.manufacturer_slug}/${s.slug}`);
}

// 3b. タイプページ → type があるルアーにリンク
const linkedByType = new Set<string>();
for (const s of allSeries) {
  if (s.type) {
    linkedByType.add(`/${s.manufacturer_slug}/${s.slug}`);
  }
}

// 3c. 対象魚ページ → target_fish があるルアーにリンク
const linkedByFish = new Set<string>();
for (const s of allSeries) {
  if (s.target_fish.length > 0) {
    linkedByFish.add(`/${s.manufacturer_slug}/${s.slug}`);
  }
}

// 3d. ランキングページ → 魚種×タイプで3件以上のルアーにリンク
const linkedByRanking = new Set<string>();
const crossMap = new Map<string, Set<string>>();
for (const s of allSeries) {
  if (!s.type) continue;
  for (const fish of s.target_fish) {
    const key = `${fish}-${s.type}`;
    if (!crossMap.has(key)) crossMap.set(key, new Set());
    crossMap.get(key)!.add(`/${s.manufacturer_slug}/${s.slug}`);
  }
}
for (const [_, paths] of crossMap) {
  if (paths.size >= 3) {
    for (const p of paths) linkedByRanking.add(p);
  }
}

// 3e. 新着ページ → 30日以内のルアー
const linkedByNew = new Set<string>();
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
for (const s of allSeries) {
  if (s.created_at && new Date(s.created_at) >= thirtyDaysAgo) {
    linkedByNew.add(`/${s.manufacturer_slug}/${s.slug}`);
  }
}

// ─── 4. 孤立判定 ───
// 定義: メーカーページ以外のどのカテゴリページからもリンクされていないルアー

interface OrphanPage {
  path: string;
  manufacturer: string;
  name: string;
  type: string | null;
  target_fish: string[];
  color_count: number;
  reason: string[];
}

const orphans: OrphanPage[] = [];
const seriesByPath = new Map<string, GroupedLure>();
for (const s of allSeries) {
  seriesByPath.set(`/${s.manufacturer_slug}/${s.slug}`, s);
}

for (const path of lureDetailPaths) {
  const s = seriesByPath.get(path);
  if (!s) {
    // サイトマップにはあるがDBにないページ（削除済み等）
    orphans.push({
      path,
      manufacturer: path.split('/')[1],
      name: '(DBに存在しない)',
      type: null,
      target_fish: [],
      color_count: 0,
      reason: ['DBに存在しない'],
    });
    continue;
  }

  const reasons: string[] = [];

  if (!linkedByType.has(path)) reasons.push('typeなし');
  if (!linkedByFish.has(path)) reasons.push('target_fishなし');
  if (!linkedByRanking.has(path)) reasons.push('ランキング対象外');
  if (!linkedByNew.has(path)) reasons.push('新着対象外');

  // メーカーページ以外からリンクされていない = 孤立
  const linkedFromNonManufacturer = linkedByType.has(path) || linkedByFish.has(path) || linkedByRanking.has(path) || linkedByNew.has(path);

  if (!linkedFromNonManufacturer) {
    orphans.push({
      path,
      manufacturer: s.manufacturer,
      name: s.name,
      type: s.type,
      target_fish: s.target_fish,
      color_count: s.color_count,
      reason: reasons,
    });
  }
}

// ─── 5. 結果出力 ───
orphans.sort((a, b) => a.path.localeCompare(b.path));

const result = {
  generated_at: new Date().toISOString(),
  summary: {
    total_sitemap_urls: sitemapPaths.length,
    total_lure_pages: lureDetailPaths.size,
    total_orphan_pages: orphans.length,
    linked_by_type: linkedByType.size,
    linked_by_fish: linkedByFish.size,
    linked_by_ranking: linkedByRanking.size,
    linked_by_new: linkedByNew.size,
  },
  orphan_breakdown: {
    no_type: orphans.filter(o => o.reason.includes('typeなし')).length,
    no_target_fish: orphans.filter(o => o.reason.includes('target_fishなし')).length,
    not_in_db: orphans.filter(o => o.reason.includes('DBに存在しない')).length,
  },
  orphans,
};

writeFileSync('/tmp/orphan-pages.json', JSON.stringify(result, null, 2));

console.log('\n─── 孤立ページ検出結果 ───');
console.log(`全ルアーページ: ${lureDetailPaths.size}`);
console.log(`孤立ページ: ${orphans.length}`);
console.log(`  typeなし: ${result.orphan_breakdown.no_type}`);
console.log(`  target_fishなし: ${result.orphan_breakdown.no_target_fish}`);
console.log(`  DBに存在しない: ${result.orphan_breakdown.not_in_db}`);
console.log(`\nタイプページからリンク: ${linkedByType.size}`);
console.log(`対象魚ページからリンク: ${linkedByFish.size}`);
console.log(`ランキングページからリンク: ${linkedByRanking.size}`);
console.log(`新着ページからリンク: ${linkedByNew.size}`);
console.log(`\n結果保存: /tmp/orphan-pages.json`);

// 上位10件を表示
if (orphans.length > 0) {
  console.log(`\n─── 孤立ページ（先頭20件）───`);
  for (const o of orphans.slice(0, 20)) {
    console.log(`  ${o.path} | ${o.name} | type=${o.type || 'null'} | fish=${o.target_fish.join(',')||'なし'} | ${o.reason.join(', ')}`);
  }
  if (orphans.length > 20) console.log(`  ... 他 ${orphans.length - 20} 件`);
}
