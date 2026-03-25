/**
 * ルアー詳細ページ共有パス生成
 *
 * ja/en 両方の [manufacturer_slug]/[slug].astro で使用。
 * getStaticPaths のデータ取得・集計ロジックを共有化。
 */
import { fetchAllLures } from '../fetch-all-lures';
import { groupLuresBySeries } from '../group-lures';
import { computeCanonicalGroups } from '../canonical-groups';
import { getTypeSlug, getFishSlug } from '../category-slugs';
import { computeColorBreakdown, type ColorBreakdownEntry } from '../color-categories';
import { getFieldCompatibility, type FieldCompatibility } from '../field-compatibility';
import { generateWeightStrategy, type WeightStrategyEntry } from '../weight-strategy';
import { findSimilarSeries, buildTypeIndex, type SimilarSeriesEntry } from '../similar-series';
import { contentArticles } from '../../data/articles/_index.js';
import type { ContentArticle } from '../../data/articles/_types.js';
import type { LureSeries } from '../types';

export interface LurePathProps {
  series: LureSeries;
  relatedByType: LureSeries[];
  relatedByMaker: LureSeries[];
  relatedByFish: LureSeries[];
  canonicalPathOverride: string | null;
  categoryRank: number;
  categoryTotal: number;
  categoryFish: string;
  colorBreakdown: ColorBreakdownEntry[];
  relatedContentArticles: ContentArticle[];
  categoryComparisonPeers: LureSeries[];
  specComparison: string[];
  pricePosition: string;
  fieldCompat: FieldCompatibility[];
  weightStrategy: WeightStrategyEntry[];
  similarSeries: SimilarSeriesEntry[];
}

/** カテゴリ平均値との比較テキストを生成 */
function generateSpecComparison(series: LureSeries, peers: LureSeries[]): string[] {
  if (peers.length < 3) return [];
  const lines: string[] = [];
  // カラー展開数
  const avgColors = Math.round(peers.reduce((s, p) => s + p.color_count, 0) / peers.length);
  if (avgColors > 0) {
    const diff = series.color_count - avgColors;
    const pct = Math.round((diff / avgColors) * 100);
    if (Math.abs(pct) >= 15) {
      lines.push(diff > 0
        ? `カラー展開数${series.color_count}色はカテゴリ平均${avgColors}色を${Math.abs(pct)}%上回る`
        : `カラー展開数${series.color_count}色はカテゴリ平均${avgColors}色より${Math.abs(pct)}%少なめ`);
    }
  }
  // 重量比較
  const peerWeights = peers.flatMap(p => [p.weight_range.min, p.weight_range.max]).filter((w): w is number => w != null && w > 0);
  const seriesAvgWeight = ((series.weight_range.min || 0) + (series.weight_range.max || 0)) / 2;
  if (peerWeights.length > 2 && seriesAvgWeight > 0) {
    const avgWeight = +(peerWeights.reduce((s, w) => s + w, 0) / peerWeights.length).toFixed(1);
    const diff = seriesAvgWeight - avgWeight;
    const pct = Math.round((diff / avgWeight) * 100);
    if (Math.abs(pct) >= 15) {
      lines.push(diff > 0
        ? `重量はカテゴリ平均${avgWeight}gより${Math.abs(pct)}%重い設計`
        : `重量はカテゴリ平均${avgWeight}gより${Math.abs(pct)}%軽量`);
    }
  }
  // 価格帯比較
  const peerPrices = peers.flatMap(p => [p.price_range.min, p.price_range.max]).filter(p => p > 0);
  const seriesAvgPrice = ((series.price_range.min || 0) + (series.price_range.max || 0)) / 2;
  if (peerPrices.length > 2 && seriesAvgPrice > 0) {
    const avgPrice = Math.round(peerPrices.reduce((s, p) => s + p, 0) / peerPrices.length);
    const diff = seriesAvgPrice - avgPrice;
    const pct = Math.round((diff / avgPrice) * 100);
    if (Math.abs(pct) >= 20) {
      lines.push(diff > 0
        ? `価格帯はカテゴリ平均¥${avgPrice.toLocaleString()}より${Math.abs(pct)}%高め（プレミアムクラス）`
        : `価格帯はカテゴリ平均¥${avgPrice.toLocaleString()}より${Math.abs(pct)}%お手頃`);
    }
  }
  // メーカー内ポジション
  const sameManufacturer = peers.filter(p => p.manufacturer_slug === series.manufacturer_slug);
  if (sameManufacturer.length >= 2) {
    lines.push(`${series.manufacturer}は同カテゴリに${sameManufacturer.length}シリーズを展開`);
  }
  return lines;
}

/** 英語版カテゴリ平均値比較テキスト */
function generateSpecComparisonEn(series: LureSeries, peers: LureSeries[]): string[] {
  if (peers.length < 3) return [];
  const lines: string[] = [];
  const avgColors = Math.round(peers.reduce((s, p) => s + p.color_count, 0) / peers.length);
  if (avgColors > 0) {
    const diff = series.color_count - avgColors;
    const pct = Math.round((diff / avgColors) * 100);
    if (Math.abs(pct) >= 15) {
      lines.push(diff > 0
        ? `${series.color_count} colors is ${Math.abs(pct)}% above the category average of ${avgColors}`
        : `${series.color_count} colors is ${Math.abs(pct)}% below the category average of ${avgColors}`);
    }
  }
  const peerWeights = peers.flatMap(p => [p.weight_range.min, p.weight_range.max]).filter((w): w is number => w != null && w > 0);
  const seriesAvgWeight = ((series.weight_range.min || 0) + (series.weight_range.max || 0)) / 2;
  if (peerWeights.length > 2 && seriesAvgWeight > 0) {
    const avgWeight = +(peerWeights.reduce((s, w) => s + w, 0) / peerWeights.length).toFixed(1);
    const diff = seriesAvgWeight - avgWeight;
    const pct = Math.round((diff / avgWeight) * 100);
    if (Math.abs(pct) >= 15) {
      lines.push(diff > 0
        ? `Weight is ${Math.abs(pct)}% heavier than the category average of ${avgWeight}g`
        : `Weight is ${Math.abs(pct)}% lighter than the category average of ${avgWeight}g`);
    }
  }
  const peerPrices = peers.flatMap(p => [p.price_range.min, p.price_range.max]).filter(p => p > 0);
  const seriesAvgPrice = ((series.price_range.min || 0) + (series.price_range.max || 0)) / 2;
  if (peerPrices.length > 2 && seriesAvgPrice > 0) {
    const avgPrice = Math.round(peerPrices.reduce((s, p) => s + p, 0) / peerPrices.length);
    const diff = seriesAvgPrice - avgPrice;
    const pct = Math.round((diff / avgPrice) * 100);
    if (Math.abs(pct) >= 20) {
      lines.push(diff > 0
        ? `Price is ${Math.abs(pct)}% above category average (premium tier)`
        : `Price is ${Math.abs(pct)}% below category average (value option)`);
    }
  }
  const sameManufacturer = peers.filter(p => p.manufacturer_slug === series.manufacturer_slug);
  if (sameManufacturer.length >= 2) {
    lines.push(`${series.manufacturer} offers ${sameManufacturer.length} series in this category`);
  }
  return lines;
}

export async function getLurePaths(locale: 'ja' | 'en' = 'ja') {
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);

  // インデックス構築
  const byType = new Map<string, LureSeries[]>();
  const byMaker = new Map<string, LureSeries[]>();
  const byFish = new Map<string, LureSeries[]>();
  for (const s of allSeries) {
    if (s.type) {
      const arr = byType.get(s.type) || [];
      arr.push(s);
      byType.set(s.type, arr);
    }
    const makerArr = byMaker.get(s.manufacturer_slug) || [];
    makerArr.push(s);
    byMaker.set(s.manufacturer_slug, makerArr);
    for (const fish of s.target_fish) {
      const fishArr = byFish.get(fish) || [];
      fishArr.push(s);
      byFish.set(fish, fishArr);
    }
  }

  const similarTypeIndex = buildTypeIndex(allSeries);

  const byFishType = new Map<string, LureSeries[]>();
  for (const s of allSeries) {
    for (const fish of s.target_fish) {
      const key = `${fish}|${s.type}`;
      const arr = byFishType.get(key) || [];
      arr.push(s);
      byFishType.set(key, arr);
    }
  }

  const articlesByLureSlug = new Map<string, ContentArticle[]>();
  for (const article of contentArticles) {
    for (const lureSlug of (article.targetLureSlugs || [])) {
      const arr = articlesByLureSlug.get(lureSlug) || [];
      arr.push(article);
      articlesByLureSlug.set(lureSlug, arr);
    }
  }

  const canonicalGroups = computeCanonicalGroups(allSeries);

  const deterministicSort = (a: LureSeries, b: LureSeries) =>
    b.color_count - a.color_count || a.name.localeCompare(b.name);

  return allSeries.map(series => {
    const relatedByType = (byType.get(series.type) || [])
      .filter(s => !(s.slug === series.slug && s.manufacturer_slug === series.manufacturer_slug))
      .sort(deterministicSort)
      .slice(0, 6);

    const usedSlugs = new Set(relatedByType.map(s => `${s.manufacturer_slug}/${s.slug}`));
    usedSlugs.add(`${series.manufacturer_slug}/${series.slug}`);
    const relatedByMaker = (byMaker.get(series.manufacturer_slug) || [])
      .filter(s => !usedSlugs.has(`${s.manufacturer_slug}/${s.slug}`))
      .sort(deterministicSort)
      .slice(0, 6);

    for (const s of relatedByMaker) usedSlugs.add(`${s.manufacturer_slug}/${s.slug}`);
    const primaryFish = (series.target_fish || [])[0];
    const relatedByFish = primaryFish
      ? (byFish.get(primaryFish) || [])
          .filter(s => !usedSlugs.has(`${s.manufacturer_slug}/${s.slug}`))
          .sort(deterministicSort)
          .slice(0, 6)
      : [];

    const ftKey = primaryFish ? `${primaryFish}|${series.type}` : null;
    const categoryPeers = ftKey ? (byFishType.get(ftKey) || []) : [];
    const sortedPeers = [...categoryPeers].sort(deterministicSort);
    const categoryRank = sortedPeers.findIndex(
      s => s.slug === series.slug && s.manufacturer_slug === series.manufacturer_slug
    ) + 1;

    const colorBreakdown = computeColorBreakdown((series.colors || []).map(c => c.color_name));

    const directArticles = articlesByLureSlug.get(series.slug) || [];
    const topicArticles = contentArticles.filter(a =>
      !directArticles.includes(a) && (
        a.targetFish.some(f => (series.target_fish || []).includes(f)) ||
        a.targetTypes.includes(series.type)
      )
    ).slice(0, 3);
    const relatedContentArticles = [...directArticles, ...topicArticles].slice(0, 5);

    const pageKey = `${series.manufacturer_slug}/${series.slug}`;
    const canonicalPathOverride = canonicalGroups.get(pageKey) || null;

    const categoryComparisonPeers = sortedPeers
      .filter(s => !(s.slug === series.slug && s.manufacturer_slug === series.manufacturer_slug))
      .slice(0, 5);

    const specComparison = locale === 'en'
      ? generateSpecComparisonEn(series, categoryPeers)
      : generateSpecComparison(series, categoryPeers);

    const fieldCompat = getFieldCompatibility(series.type);
    const weightStrategy = generateWeightStrategy(series);
    const similarSeries = findSimilarSeries(series, similarTypeIndex, 3);

    let pricePosition = '';
    if (series.price_range.max > 0 && categoryPeers.length >= 3) {
      const peersWithPrice = categoryPeers.filter(p => p.price_range.max > 0);
      if (peersWithPrice.length >= 3) {
        const prices = peersWithPrice.map(p => (p.price_range.min + p.price_range.max) / 2).sort((a, b) => a - b);
        const seriesAvg = (series.price_range.min + series.price_range.max) / 2;
        const rank = prices.filter(p => p <= seriesAvg).length;
        const percentile = Math.round((rank / prices.length) * 100);
        if (locale === 'en') {
          if (percentile <= 20) pricePosition = 'Entry Level (lower price tier in category)';
          else if (percentile <= 40) pricePosition = 'Value Pick (below category average)';
          else if (percentile <= 60) pricePosition = 'Mid-Range (average price tier)';
          else if (percentile <= 80) pricePosition = 'High-End (above category average)';
          else pricePosition = 'Premium (top price tier in category)';
        } else {
          if (percentile <= 20) pricePosition = 'エントリーモデル（カテゴリ内で価格帯が低め）';
          else if (percentile <= 40) pricePosition = 'コスパ良好（カテゴリ平均以下の価格帯）';
          else if (percentile <= 60) pricePosition = 'スタンダード（カテゴリ平均的な価格帯）';
          else if (percentile <= 80) pricePosition = 'ハイスペック（カテゴリ平均以上の価格帯）';
          else pricePosition = 'プレミアムクラス（カテゴリ最上位の価格帯）';
        }
      }
    }

    return {
      params: { manufacturer_slug: series.manufacturer_slug, slug: series.slug },
      props: {
        series, relatedByType, relatedByMaker, relatedByFish, canonicalPathOverride,
        categoryRank,
        categoryTotal: categoryPeers.length,
        categoryFish: primaryFish || '',
        colorBreakdown,
        relatedContentArticles,
        categoryComparisonPeers,
        specComparison,
        pricePosition,
        fieldCompat,
        weightStrategy,
        similarSeries,
      } as LurePathProps,
    };
  });
}
