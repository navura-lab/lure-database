// scripts/_6thsense-cleanup.ts
// 6th Sense 非ルアー製品（シンカー、ロッド、フック、アパレル等）の一括削除
//
// 使い方:
//   npx tsx scripts/_6thsense-cleanup.ts          # dry-run（デフォルト）
//   npx tsx scripts/_6thsense-cleanup.ts --exec   # 実行

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EXEC = process.argv.includes('--exec');

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// 非ルアー判定パターン
// ---------------------------------------------------------------------------

// ロッド: フィート/インチ + パワー/アクション + Casting/Spinning
const ROD_PATTERN =
  /\d+['′]\d*["″]?\s*(Ultra[\s-]?Light|Light|Medium[\s-]?Light|Medium[\s-]?Heavy|Medium|Heavy|X[\s-]?Heavy|Extra[\s-]?Heavy|Fast|Moderate|Slow|Casting|Spinning)/i;

// シンカー/ウェイト
const SINKER_PATTERN =
  /\b(sinker|drop\s*shot\s*weight|nail\s*weight|punch\s*weight|flipping\s*weight|worm\s*weight|bullet\s*weight|cylindrical\s*weight|pegged\s*weight|mushroom\s*weight|free\s*rig\s*weight|tear\s*drop.*weight|casting.*weight)\b|tungsten.*weight|weight.*tungsten/i;

// フック（ジグヘッド系は除外）
const HOOK_PATTERN = /\b(hook|treble(?!\s*head)|ewg|trailer\s*treble|treble\s*wire|tusk\s*treble)\b/i;
const JIG_HEAD_EXCLUDE =
  /\b(jig\s*head|harness\s*head|treble\s*head|underspin.*head|saltwater\s*treble\s*head)\b/i;

// アパレル・雑貨
const APPAREL_PATTERN =
  /\b(beanie|shirt|hat|cap|hoodie|apparel|jersey|gaiter|glove|sock|jacket|shorts|pants|towel|decal|sticker|patch|lanyard|koozie|sunglasses)\b/i;

// パーツ（交換用ブレード・ラトル）
const PARTS_PATTERN =
  /\b(replacement\s*blade|extra\s*blade|blade\s*kit|glass\s*rattle|rattle\s*kit|rattle\s*pack)\b/i;

function isNonLure(name: string): string | null {
  if (ROD_PATTERN.test(name)) return 'rod';
  if (SINKER_PATTERN.test(name)) return 'sinker';
  if (HOOK_PATTERN.test(name) && !JIG_HEAD_EXCLUDE.test(name)) return 'hook';
  if (APPAREL_PATTERN.test(name)) return 'apparel';
  if (PARTS_PATTERN.test(name)) return 'parts';
  return null;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function fetchAll(): Promise<{ id: string; name: string; type: string }[]> {
  const all: { id: string; name: string; type: string }[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lures?manufacturer_slug=eq.6th-sense&select=id,name,type&order=name&offset=${offset}&limit=${limit}`,
      { headers },
    );
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    all.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function deleteByIds(ids: string[]): Promise<number> {
  // Supabase REST APIは in フィルタで一括削除可能だが、URLが長すぎるので分割
  const BATCH = 100;
  let deleted = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const filter = `(${batch.join(',')})`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lures?id=in.${filter}`,
      {
        method: 'DELETE',
        headers: { ...headers, Prefer: 'return=minimal' },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Delete failed at batch ${i}: ${res.status} ${text}`);
    }
    deleted += batch.length;
    process.stdout.write(`\r  削除中... ${deleted}/${ids.length}`);
  }
  console.log();
  return deleted;
}

async function main() {
  console.log(`6th Sense 非ルアー製品クリーンアップ [${EXEC ? '実行モード' : 'DRY-RUN'}]`);
  console.log('---');

  // 全レコード取得
  const all = await fetchAll();
  console.log(`全レコード数: ${all.length}`);

  // 非ルアー分類
  const toDelete: { id: string; name: string; type: string; category: string }[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const r of all) {
    const cat = isNonLure(r.name);
    if (cat) {
      toDelete.push({ ...r, category: cat });
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }

  console.log(`\n削除対象: ${toDelete.length}件`);
  for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}件`);
  }

  // カテゴリ別ユニーク名をサンプル表示
  for (const cat of Object.keys(categoryCounts)) {
    const names = [...new Set(toDelete.filter((r) => r.category === cat).map((r) => r.name))];
    console.log(`\n[${cat}] ユニーク名 (${names.length}件):`);
    names.slice(0, 5).forEach((n) => console.log(`  - ${n}`));
    if (names.length > 5) console.log(`  ... 他${names.length - 5}件`);
  }

  console.log(`\n残るレコード数: ${all.length - toDelete.length}`);

  if (!EXEC) {
    console.log('\n[DRY-RUN] 実行するには --exec を付けてください');
    return;
  }

  // 実行
  console.log('\n削除実行...');
  const ids = toDelete.map((r) => r.id);
  const deleted = await deleteByIds(ids);
  console.log(`\n完了: ${deleted}件削除`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
