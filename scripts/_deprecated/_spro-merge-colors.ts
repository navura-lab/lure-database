// scripts/_spro-merge-colors.ts
// SPRO カラー別slug統合スクリプト
//
// 問題: Shopifyで各カラーが独立商品として登録されており、
//       CAST/LOGのDBでもカラーごとに別slugで登録されている
//
// 修正: 共通プレフィックス（シリーズ名）でグループ化し、
//       メインslugに統合。color_nameにカラー名を設定。
//
// 使い方: npx tsx scripts/_spro-merge-colors.ts [--dry-run]

import 'dotenv/config';
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} from './config.js';

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');
const MANUFACTURER_SLUG = 'spro';

// シリーズ名 → メインslug のマッピング
// 長い方から先にマッチさせるためソート済み
const SERIES_MAP: Array<{ series: string; mainSlug: string; mainName: string }> = [
  // 4語以上（先にマッチさせる）
  { series: 'AIYA SEMI LONG JIG', mainSlug: 'aiya-semi-long-jig', mainName: 'AIYA SEMI LONG JIG' },
  { series: 'AIYA SLENDER REAL', mainSlug: 'aiya-slender-real', mainName: 'AIYA SLENDER REAL' },
  { series: 'AIYA BALL FULL', mainSlug: 'aiya-ball-full', mainName: 'AIYA BALL FULL' },
  { series: 'AIYA LONG JIG', mainSlug: 'aiya-long-jig', mainName: 'AIYA LONG JIG' },
  { series: 'AIYA LONG UV', mainSlug: 'aiya-long-uv', mainName: 'AIYA LONG UV' },
  { series: 'AIYA JIG MINI', mainSlug: 'aiya-jig-mini', mainName: 'AIYA JIG MINI' },
  { series: 'BANANA JIG REAL', mainSlug: 'banana-jig-real', mainName: 'BANANA JIG REAL' },
  { series: 'MINI BANANA JIG', mainSlug: 'mini-banana-jig', mainName: 'MINI BANANA JIG' },
  { series: 'BUCKTAIL TEASER', mainSlug: 'bucktail-teaser', mainName: 'BUCKTAIL TEASER' },
  { series: 'BUCKTAIL JIG', mainSlug: 'bucktail-jig', mainName: 'BUCKTAIL JIG' },
  // 3語
  { series: 'ABABAI LONG', mainSlug: 'ababai-long', mainName: 'ABABAI LONG' },
  { series: 'ABABAI JIG', mainSlug: 'ababai-jig', mainName: 'ABABAI JIG' },
  { series: 'AIYA POCCHARI', mainSlug: 'aiya-pocchari', mainName: 'AIYA POCCHARI' },
  { series: 'AIYA POCHARRI', mainSlug: 'aiya-pocchari', mainName: 'AIYA POCCHARI' }, // typo統合
  // 2語
  { series: 'AIYA BALL', mainSlug: 'aiya-ball', mainName: 'AIYA BALL' },
  { series: 'AIYA JIG', mainSlug: 'aiya-jig', mainName: 'AIYA JIG' },
  { series: 'AIYA SLENDER', mainSlug: 'aiya-slender', mainName: 'AIYA SLENDER' },
  { series: 'BANANA JIG', mainSlug: 'banana-jig', mainName: 'BANANA JIG' },
];

// 特殊ケース: slug名が商品名と一致しない場合の個別マッピング
const SLUG_OVERRIDES: Record<string, { mainSlug: string; colorName: string }> = {
  'aya-slender-long-jig-orange-glowing-belly': {
    mainSlug: 'aiya-slender',
    colorName: 'ORANGE GLOWING BELLY',
  },
  'aiya-pocharri-glow-head-sliver': {
    mainSlug: 'aiya-pocchari',
    colorName: 'GLOW HEAD SILVER',
  },
};

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

function ts(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${ts()}] ${msg}`); }
function logError(msg: string): void { console.error(`[${ts()}] ERROR: ${msg}`); }

// ---------------------------------------------------------------------------
// Supabase ヘルパー
// ---------------------------------------------------------------------------

async function supabaseRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${body}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

interface LureRow {
  id: number;
  slug: string;
  name: string;
  color_name: string;
  weight: number | null;
  images: string[] | null;
  source_url: string | null;
  type: string;
  price: number | null;
  length: number | null;
  description: string | null;
  target_fish: string[] | null;
}

interface MergeGroup {
  mainSlug: string;
  mainName: string;
  items: Array<{
    row: LureRow;
    colorName: string;
  }>;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

async function main() {
  log('=== SPRO カラー別slug統合開始 ===');
  if (DRY_RUN) log('⚠️ DRY RUN モード（DB変更なし）');

  // Step 1: 全SPRO レコード取得（ページネーション対応）
  log('\n--- Step 1: SPRO レコード取得 ---');
  const allRows: LureRow[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const res = await supabaseRequest(
      `/lures?manufacturer_slug=eq.${MANUFACTURER_SLUG}&select=id,slug,name,color_name,weight,images,source_url,type,price,length,description,target_fish&order=slug&limit=${PAGE_SIZE}&offset=${offset}`,
    );
    const rows = await res.json() as LureRow[];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  log(`全 ${allRows.length} レコード取得`);

  // Step 2: slug別グループ化
  const bySlug = new Map<string, LureRow[]>();
  for (const r of allRows) {
    const list = bySlug.get(r.slug) || [];
    list.push(r);
    bySlug.set(r.slug, list);
  }
  log(`${bySlug.size} ユニークslug`);

  // 既にマルチカラーのslug（正常）を特定
  const alreadyMultiColor = new Set<string>();
  for (const [slug, rows] of bySlug) {
    const uniqueColors = new Set(rows.map(r => r.color_name));
    if (uniqueColors.size > 1) {
      alreadyMultiColor.add(slug);
    }
  }
  log(`既にマルチカラー: ${alreadyMultiColor.size} slug（スキップ）`);

  // Step 3: 統合グループ構築
  log('\n--- Step 2: 統合グループ構築 ---');
  const mergeGroups = new Map<string, MergeGroup>();
  const skipped: string[] = [];

  for (const [slug, rows] of bySlug) {
    // 既にマルチカラーならスキップ
    if (alreadyMultiColor.has(slug)) continue;

    // 全行が (default) カラーであることを確認
    const allDefault = rows.every(r => r.color_name === '(default)');
    if (!allDefault) continue;

    const nameUpper = rows[0].name.toUpperCase().trim();

    // 特殊ケースチェック
    if (SLUG_OVERRIDES[slug]) {
      const override = SLUG_OVERRIDES[slug];
      const group = mergeGroups.get(override.mainSlug) || {
        mainSlug: override.mainSlug,
        mainName: SERIES_MAP.find(s => s.mainSlug === override.mainSlug)?.mainName || override.mainSlug.toUpperCase(),
        items: [],
      };
      for (const row of rows) {
        group.items.push({ row, colorName: override.colorName });
      }
      mergeGroups.set(override.mainSlug, group);
      continue;
    }

    // シリーズパターンマッチ
    let matched = false;
    for (const { series, mainSlug, mainName } of SERIES_MAP) {
      if (nameUpper.startsWith(series + ' ') || nameUpper === series) {
        const colorPart = nameUpper === series
          ? '(default)'
          : rows[0].name.substring(series.length + 1).trim();

        const group = mergeGroups.get(mainSlug) || {
          mainSlug,
          mainName,
          items: [],
        };
        for (const row of rows) {
          group.items.push({ row, colorName: colorPart || '(default)' });
        }
        mergeGroups.set(mainSlug, group);
        matched = true;
        break;
      }
    }

    if (!matched) {
      skipped.push(slug);
    }
  }

  // 1件のみのグループは統合不要、除外
  const singleGroups: string[] = [];
  for (const [mainSlug, group] of mergeGroups) {
    // ユニークカラー数で判定（同一カラーのweight違いは1カラー扱い）
    const uniqueColors = new Set(group.items.map(i => i.colorName));
    if (uniqueColors.size <= 1) {
      singleGroups.push(mainSlug);
    }
  }
  for (const slug of singleGroups) {
    const group = mergeGroups.get(slug)!;
    skipped.push(...group.items.map(i => i.row.slug));
    mergeGroups.delete(slug);
  }

  // Step 4: 統合計画表示
  log('\n--- Step 3: 統合計画 ---');
  let totalUpdates = 0;
  let totalDeletes = 0;

  for (const [mainSlug, group] of [...mergeGroups.entries()].sort((a, b) => b[1].items.length - a[1].items.length)) {
    const uniqueColors = [...new Set(group.items.map(i => i.colorName))];
    const uniqueOldSlugs = [...new Set(group.items.map(i => i.row.slug))];

    log(`\n  ${mainSlug} (${group.mainName}): ${uniqueColors.length}色, ${group.items.length}行`);
    for (const color of uniqueColors.slice(0, 5)) {
      const colorRows = group.items.filter(i => i.colorName === color);
      const oldSlug = colorRows[0].row.slug;
      const weights = colorRows.map(r => r.row.weight).filter(w => w !== null);
      log(`    "${color}" ← ${oldSlug}${weights.length > 0 ? ` (${weights.length} weights)` : ''}`);
    }
    if (uniqueColors.length > 5) {
      log(`    ... +${uniqueColors.length - 5}色`);
    }

    totalUpdates += group.items.length;
  }

  log(`\nスキップ: ${skipped.length} slug`);
  if (skipped.length > 0 && skipped.length <= 10) {
    for (const s of skipped) log(`  ${s}`);
  }

  log(`\n合計: ${mergeGroups.size} グループ, ${totalUpdates} 行を更新予定`);

  if (DRY_RUN) {
    log('\n⚠️ DRY RUN 完了。--dry-run を外して再実行してください。');
    return;
  }

  // Step 5: 実行
  log('\n--- Step 4: Supabase 更新 ---');

  let updated = 0;
  let deleted = 0;
  let errors = 0;

  for (const [mainSlug, group] of mergeGroups) {
    log(`\n${mainSlug}:`);

    // 同じslug + color_name + weight の重複を検出
    const seen = new Map<string, number>(); // "color|weight" → row.id
    const toDelete: number[] = [];
    const toUpdate: Array<{ id: number; slug: string; name: string; color_name: string }> = [];

    for (const item of group.items) {
      const key = `${item.colorName}|${item.row.weight ?? 'null'}`;
      if (seen.has(key)) {
        // 重複 → 削除
        toDelete.push(item.row.id);
      } else {
        seen.set(key, item.row.id);
        toUpdate.push({
          id: item.row.id,
          slug: mainSlug,
          name: group.mainName,
          color_name: item.colorName,
        });
      }
    }

    // 更新実行
    for (const upd of toUpdate) {
      try {
        await supabaseRequest(
          `/lures?id=eq.${upd.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              slug: upd.slug,
              name: upd.name,
              name_kana: upd.name,
              color_name: upd.color_name,
            }),
            headers: { 'Prefer': 'return=minimal' } as any,
          },
        );
        updated++;
      } catch (err) {
        errors++;
        logError(`  更新失敗 id=${upd.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 重複削除
    for (const id of toDelete) {
      try {
        await supabaseRequest(
          `/lures?id=eq.${id}`,
          {
            method: 'DELETE',
            headers: { 'Prefer': 'return=minimal' } as any,
          },
        );
        deleted++;
      } catch (err) {
        errors++;
        logError(`  削除失敗 id=${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    log(`  更新: ${toUpdate.length}, 重複削除: ${toDelete.length}`);
  }

  // サマリー
  log('\n=== 完了 ===');
  log(`  更新: ${updated} 行`);
  log(`  重複削除: ${deleted} 行`);
  log(`  エラー: ${errors} 件`);
}

main().catch(err => {
  logError(`致命的エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
