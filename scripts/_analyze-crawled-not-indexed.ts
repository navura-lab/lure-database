/**
 * GSC「クロール済み - インデックス未登録」ページのパターン分析
 * JPページのみ（/en/ 除外）
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { join } from 'path';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!
);

// 分析対象URL（JPのみ）
const TARGET_URLS = [
  '/ranking/madai-jighead/',
  '/yamashita/',
  '/megabass/cokai-slim-140/',
  '/raid/foot-master/',
  '/imakatsu/anklegoby-highfloat/',
  '/jackall/binbinwamunekutai-tsuinteru/',
  '/luckycraft/wander/',
  '/luckycraft/wanderslimlite-salt/',
  '/tiemco/harinezumi-mini-eco/',
  '/jazz/hirabazz/',
  '/nories/shallow-roll/',
  '/raid/osakana-slide-170/',
  '/dstyle/d2-hog/',
  '/viva/spin-bias/',
  '/rapala/rapala-sdd/',
  '/obasslive/mtpencil/',
  '/baitbreath/u30fishtail/',
  '/jackall/cian-metal-vib/',
  '/zoom/fluke-stick-jr/',
  '/osp/louder50salt/',
  '/imakatsu/dumbbell-crab/',
  '/daiwa/0w4ilk8/',
  '/imakatsu/super-killer-bill/',
  '/strike-king/denny-brauer-structure-casting-jig-3-4oz/',
  '/geecrack/yokodori-sutte/',
  '/imakatsu/skinny-eel-crawler/',
  '/jazz/semilong/',
  '/6th-sense/divine-scrape-grass-jig/',
  '/jackall/speed-vib/',
  '/daiwa/ke3oy13/',
];

const EDITORIAL_DIR = join('/Users/user/ウェブサイト/lure-database/src/data/seo/editorials');

// URLからmaker_slug/slugを解析
function parseUrl(url: string): { type: 'ranking' | 'maker' | 'lure'; makerSlug?: string; lureSlug?: string } {
  const parts = url.replace(/^\//, '').replace(/\/$/, '').split('/');
  if (parts[0] === 'ranking') return { type: 'ranking' };
  if (parts.length === 1) return { type: 'maker', makerSlug: parts[0] };
  return { type: 'lure', makerSlug: parts[0], lureSlug: parts[1] };
}

async function main() {
  const results: Array<{
    url: string;
    pageType: string;
    makerSlug?: string;
    lureSlug?: string;
    hasEditorial: boolean;
    colorCount: number;
    descriptionLengths: number[];
    maxDescLen: number;
    isUnrewritten: boolean;
    types: string[];
    targetFish: string[];
    title?: string;
  }> = [];

  // ルアーページの一括クエリ
  const lurePages = TARGET_URLS
    .map(url => ({ url, parsed: parseUrl(url) }))
    .filter(x => x.parsed.type === 'lure');

  // slugセットを収集
  const slugPairs = lurePages.map(x => ({ makerSlug: x.parsed.makerSlug!, lureSlug: x.parsed.lureSlug! }));

  // Supabaseから取得（orフィルタで一括）
  const slugList = slugPairs.map(p => `(manufacturer_slug.eq.${p.makerSlug},slug.eq.${p.lureSlug})`);

  // 各ルアーを個別にクエリ（or複合条件はSupabase JSでは難しいため）
  const lureDataMap = new Map<string, any[]>();

  for (const { makerSlug, lureSlug } of slugPairs) {
    const { data, error } = await sb
      .from('lures')
      .select('name, slug, manufacturer_slug, description, type, target_fish, color_name')
      .eq('manufacturer_slug', makerSlug)
      .eq('slug', lureSlug);

    if (error) {
      console.error(`Error fetching ${makerSlug}/${lureSlug}:`, error.message);
      continue;
    }
    lureDataMap.set(`${makerSlug}/${lureSlug}`, data || []);
  }

  for (const { url, parsed } of TARGET_URLS.map(u => ({ url: u, parsed: parseUrl(u) }))) {
    const editorialPath = join(EDITORIAL_DIR, `${parsed.lureSlug || parsed.makerSlug || 'unknown'}.ts`);
    const hasEditorial = existsSync(editorialPath);

    if (parsed.type === 'ranking') {
      results.push({
        url,
        pageType: 'ランキングページ',
        hasEditorial: false,
        colorCount: 0,
        descriptionLengths: [],
        maxDescLen: 0,
        isUnrewritten: false,
        types: [],
        targetFish: [],
      });
      continue;
    }

    if (parsed.type === 'maker') {
      results.push({
        url,
        pageType: 'メーカーページ',
        makerSlug: parsed.makerSlug,
        hasEditorial: false,
        colorCount: 0,
        descriptionLengths: [],
        maxDescLen: 0,
        isUnrewritten: false,
        types: [],
        targetFish: [],
      });
      continue;
    }

    // ルアーページ
    const key = `${parsed.makerSlug}/${parsed.lureSlug}`;
    const rows = lureDataMap.get(key) || [];

    const colorCount = rows.length;
    const descLengths = rows.map(r => (r.description || '').length);
    const maxDescLen = descLengths.length > 0 ? Math.max(...descLengths) : 0;
    const types = [...new Set(rows.map(r => r.type).filter(Boolean))];
    const targetFishAll: string[] = [];
    for (const r of rows) {
      if (r.target_fish) targetFishAll.push(...r.target_fish);
    }
    const targetFish = [...new Set(targetFishAll)];
    const title = rows[0]?.name || '';

    results.push({
      url,
      pageType: 'ルアーページ',
      makerSlug: parsed.makerSlug,
      lureSlug: parsed.lureSlug,
      hasEditorial,
      colorCount,
      descriptionLengths: descLengths,
      maxDescLen,
      isUnrewritten: maxDescLen > 250,
      types,
      targetFish,
      title,
    });
  }

  // 結果出力
  console.log('\n===== クロール済み - インデックス未登録 パターン分析 =====\n');

  // サマリー集計
  const lureResults = results.filter(r => r.pageType === 'ルアーページ');
  const withEditorial = lureResults.filter(r => r.hasEditorial).length;
  const unrewritten = lureResults.filter(r => r.isUnrewritten).length;
  const fewColors = lureResults.filter(r => r.colorCount > 0 && r.colorCount <= 3).length;
  const notFound = lureResults.filter(r => r.colorCount === 0).length;

  console.log(`【サマリー】`);
  console.log(`  総URL数: ${results.length}`);
  console.log(`  ルアーページ: ${lureResults.length}`);
  console.log(`  メーカーページ: ${results.filter(r => r.pageType === 'メーカーページ').length}`);
  console.log(`  ランキングページ: ${results.filter(r => r.pageType === 'ランキングページ').length}`);
  console.log(`  DB未登録（0件）: ${notFound}`);
  console.log('');
  console.log(`【エディトリアル】`);
  console.log(`  あり: ${withEditorial} / ${lureResults.length}`);
  console.log(`  なし: ${lureResults.length - withEditorial} / ${lureResults.length}`);
  console.log('');
  console.log(`【description（リライト状況）】`);
  console.log(`  未リライト（250文字超）: ${unrewritten} / ${lureResults.filter(r => r.colorCount > 0).length}`);
  console.log('');
  console.log(`【カラー数】`);
  console.log(`  1〜3色（薄い）: ${fewColors} / ${lureResults.filter(r => r.colorCount > 0).length}`);

  // type分布
  const typeCounts = new Map<string, number>();
  for (const r of lureResults) {
    for (const t of r.types) {
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }
  }
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n【type分布】`);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type}: ${count}件`);
  }

  // 個別詳細
  console.log('\n===== 個別詳細 =====\n');
  for (const r of results) {
    const editorial = r.hasEditorial ? '✅ あり' : '❌ なし';
    const desc = r.isUnrewritten ? `⚠️ 未リライト(${r.maxDescLen}文字)` : `✅ ${r.maxDescLen}文字`;
    const colors = r.colorCount === 0 ? '❓ DB未登録' : `${r.colorCount}色`;
    const types = r.types.length > 0 ? r.types.join(', ') : '-';
    const fish = r.targetFish.length > 0 ? r.targetFish.join(', ') : '-';

    console.log(`${r.url}`);
    console.log(`  種別: ${r.pageType}${r.title ? ` | ${r.title}` : ''}`);
    if (r.pageType === 'ルアーページ') {
      console.log(`  エディトリアル: ${editorial}`);
      console.log(`  description: ${desc}`);
      console.log(`  カラー数: ${colors}`);
      console.log(`  type: ${types}`);
      console.log(`  対象魚: ${fish}`);
    }
    console.log('');
  }

  // 問題パターンまとめ
  console.log('===== 問題パターンまとめ =====\n');

  const p1 = lureResults.filter(r => r.colorCount === 0);
  if (p1.length > 0) {
    console.log(`【A】DB未登録（Googleはクロール済みだがDBに存在しない）: ${p1.length}件`);
    p1.forEach(r => console.log(`  - ${r.url}`));
    console.log('');
  }

  const p2 = lureResults.filter(r => r.colorCount > 0 && !r.hasEditorial && r.colorCount <= 3);
  if (p2.length > 0) {
    console.log(`【B】エディトリアルなし + カラー少ない（コンテンツ薄い）: ${p2.length}件`);
    p2.forEach(r => console.log(`  - ${r.url} (${r.colorCount}色, type: ${r.types.join(',')})`));
    console.log('');
  }

  const p3 = lureResults.filter(r => r.colorCount > 0 && r.isUnrewritten);
  if (p3.length > 0) {
    console.log(`【C】未リライト（description 250文字超）: ${p3.length}件`);
    p3.forEach(r => console.log(`  - ${r.url} (${r.maxDescLen}文字)`));
    console.log('');
  }

  const p4 = lureResults.filter(r => r.colorCount > 3 && !r.hasEditorial && !r.isUnrewritten);
  if (p4.length > 0) {
    console.log(`【D】カラー多い + エディトリアルなし + リライト済み（コンテンツはあるが評価低い?）: ${p4.length}件`);
    p4.forEach(r => console.log(`  - ${r.url} (${r.colorCount}色, type: ${r.types.join(',')})`));
    console.log('');
  }
}

main().catch(console.error);
