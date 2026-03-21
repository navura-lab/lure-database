import type { EditorialReview } from './huggos';
export type { EditorialReview };

// import.meta.glob で全.tsファイルを自動読み込み（_で始まるファイルは除外）
const modules = import.meta.glob('./*.ts', { eager: true });
const editorialReviews: Record<string, EditorialReview> = {};

for (const [path, mod] of Object.entries(modules)) {
  const filename = path.replace('./', '').replace('.ts', '');
  if (filename.startsWith('_')) continue; // _index.ts, _tracker.ts 除外
  if (filename === 'huggos') continue; // 型定義元は除外（でもhuggosもエディトリアルなので含める）

  const exports = mod as Record<string, any>;
  const editorial = Object.values(exports).find(v => v && typeof v === 'object' && 'slug' in v && 'catchcopy' in v) as EditorialReview | undefined;
  if (editorial) {
    editorialReviews[editorial.slug] = editorial;
  }
}

// huggosも含める
import { huggosEditorial } from './huggos';
editorialReviews['huggos'] = huggosEditorial;

export { editorialReviews };
