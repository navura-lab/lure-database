// scripts/lib/regions.ts
// JP/USメーカーの地域定義。pipeline / discover / rewrite で共有。

/** USメーカーのslugセット。新USブランド追加時はここに追記する */
export const US_MAKERS: ReadonlySet<string> = new Set([
  'strike-king',
  'z-man',
  'zoom',
]);

export type Region = 'jp' | 'us' | 'all';

export function isUSMaker(slug: string): boolean {
  return US_MAKERS.has(slug);
}

export function isJPMaker(slug: string): boolean {
  return !US_MAKERS.has(slug);
}

/** CLI引数から --region を解析する */
export function parseRegionArg(): Region {
  const idx = process.argv.indexOf('--region');
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = process.argv[idx + 1].toLowerCase();
    if (val === 'jp' || val === 'us') return val;
  }
  return 'all';
}

/** region に応じたメーカーslugフィルタ関数を返す */
export function makeRegionFilter(region: Region): (slug: string) => boolean {
  if (region === 'jp') return isJPMaker;
  if (region === 'us') return isUSMaker;
  return () => true;
}
