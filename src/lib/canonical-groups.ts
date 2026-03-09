import type { LureSeries } from './types';

/**
 * 同一descriptionを持つ複数ルアーシリーズをグループ化し、canonical slugを決定する。
 * Shopifyブランドが1商品×1カラーで別slugを生成する問題への対策。
 * Google「重複ページ - 別のcanonicalを選択」を解消する。
 *
 * @returns Map<"manufacturer_slug/slug", canonicalSlug> — 自分自身がcanonicalでないページのみ含む
 */
export function computeCanonicalGroups(allSeries: LureSeries[]): Map<string, string> {
  // manufacturer_slug + description（先頭200文字）でグルーピング
  const groups = new Map<string, LureSeries[]>();

  for (const series of allSeries) {
    if (!series.description) continue;
    const descNorm = series.description.substring(0, 200).trim();
    if (descNorm.length < 20) continue; // 極端に短い説明文は除外（誤マッチ防止）
    const key = `${series.manufacturer_slug}|${descNorm}`;
    const existing = groups.get(key) || [];
    existing.push(series);
    groups.set(key, existing);
  }

  const canonicalMap = new Map<string, string>();

  for (const [, seriesList] of groups) {
    if (seriesList.length < 2) continue;

    // canonical選出優先度: カラー数多い → slug短い → アルファベット順
    const sorted = [...seriesList].sort((a, b) => {
      if (b.color_count !== a.color_count) return b.color_count - a.color_count;
      if (a.slug.length !== b.slug.length) return a.slug.length - b.slug.length;
      return a.slug.localeCompare(b.slug);
    });

    const canonical = sorted[0];
    const canonicalPath = `/${canonical.manufacturer_slug}/${canonical.slug}/`;

    for (const series of seriesList) {
      if (series.slug !== canonical.slug) {
        const pageKey = `${series.manufacturer_slug}/${series.slug}`;
        canonicalMap.set(pageKey, canonicalPath);
      }
    }
  }

  return canonicalMap;
}
