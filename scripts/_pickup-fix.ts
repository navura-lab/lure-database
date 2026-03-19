// scripts/_pickup-fix.ts
// Pickup / God Hands / Grassroots データ品質修復スクリプト
//
// 問題:
//   Pickup: 商品名にカラー名が含まれているのに color_name が (default)。
//           同一商品の連番slug重複（-2, -3...）が大量発生。
//   God Hands: 全9レコードが同一商品「GOD HANDS」の重複
//   Grassroots: 全6レコードが同一商品「BASS LURE」の重複
//
// 修正:
//   1. Pickup: 商品名を「ベースモデル名 + サイズ」でグルーピングし、
//      カラー名を抽出してcolor_nameに設定。重複は削除。
//   2. God Hands: 1 slugに統合、残り8件削除
//   3. Grassroots: 1 slugに統合、残り5件削除
//
// 使い方: npx tsx scripts/_pickup-fix.ts [--dry-run]

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.js';
import { slugify } from '../src/lib/slugify.js';

const DRY_RUN = process.argv.includes('--dry-run');
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function ts(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${ts()}] ${msg}`); }

// ---------------------------------------------------------------------------
// Pickup: 商品名からベースモデル名・カラー名を分離
// ---------------------------------------------------------------------------

interface ParsedName {
  baseName: string;  // 例: "ワスプスラローム50S"
  colorPart: string; // 例: "クリア チャートバック"
}

// Pickupのベースモデル名パターン（サイズ込み）
// 注: parsePickupNameで全角→半角変換済みなので、パターンは半角で記述
const PICKUP_BASE_PATTERNS: Array<{ regex: RegExp; baseName: string }> = [
  // ワスプスラローム系 — サイズ＋素材別（クリア/ボーンはサブモデル扱い）
  { regex: /^ワスプスラローム\s*50S\s*クリア/i, baseName: 'ワスプスラローム50Sクリア' },
  { regex: /^ワスプスラローム\s*50S\s*ボーン/i, baseName: 'ワスプスラローム50Sボーン' },
  { regex: /^ワスプスラローム\s*50S/i, baseName: 'ワスプスラローム50S' },
  { regex: /^ワスプスラローム\s*68S\s*クリア/i, baseName: 'ワスプスラローム68Sクリア' },
  { regex: /^ワスプスラローム\s*68S\s*ボーン/i, baseName: 'ワスプスラローム68Sボーン' },
  { regex: /^ワスプスラローム\s*68S/i, baseName: 'ワスプスラローム68S' },
  { regex: /^ワスプスラローム\s*80S\s*クリア/i, baseName: 'ワスプスラローム80Sクリア' },
  { regex: /^ワスプスラローム\s*80S\s*ボーン/i, baseName: 'ワスプスラローム80Sボーン' },
  { regex: /^ワスプスラローム\s*80S/i, baseName: 'ワスプスラローム80S' },
  // ノガレ — サイズ別
  { regex: /^ノガレ\s*120F/i, baseName: 'ノガレ120F' },
  { regex: /^ノガレ\s*160F/i, baseName: 'ノガレ160F' },
  // ツムジ
  { regex: /^ツムジ\s*110F/i, baseName: 'ツムジ110F' },
  // サイドプレス
  { regex: /^サイドプレス\s*160F/i, baseName: 'サイドプレス160F' },
  // トラップ系
  { regex: /^トラップシャッド/, baseName: 'トラップシャッド' },
  { regex: /^ツイントラップ/, baseName: 'ツイントラップ' },
  { regex: /^スリートラップ\s*ワッパー/, baseName: 'スリートラップワッパー' },
  { regex: /^スリートラップ\s*#8/i, baseName: 'スリートラップ#8' },
  { regex: /^スリートラップ/, baseName: 'スリートラップ' },
  // スモールトラップ（ウェイト別）
  { regex: /^スモールトラップ/, baseName: 'スモールトラップ' },
  // アンダーアップ キプロ68（ウェイト別）
  { regex: /^アンダーアップ\s*キプロ[ー\-]?\s*68/i, baseName: 'アンダーアップキプロ68' },
];

function parsePickupName(name: string): ParsedName {
  // 正規化: 全角英数字→半角、全角スペース→半角、連続スペース→1つ
  let n = name
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, ' ')
    .trim();

  for (const { regex, baseName } of PICKUP_BASE_PATTERNS) {
    if (regex.test(n)) {
      // ベース名マッチ部分を除いた残りがカラー名
      const match = n.match(regex);
      if (match) {
        let colorPart = n.slice(match[0].length).trim();
        // 先頭の区切り文字除去
        colorPart = colorPart.replace(/^[　\s:：・\-]+/, '').trim();
        return { baseName, colorPart: colorPart || '' };
      }
    }
  }

  // パターンに一致しない場合はそのまま
  return { baseName: n, colorPart: '' };
}

// ---------------------------------------------------------------------------
// レコード型
// ---------------------------------------------------------------------------

interface LureRecord {
  id: string;
  slug: string;
  name: string;
  color_name: string;
  type: string;
  price: number;
  weight: number | null;
  length: number | null;
  images: string[] | null;
  description: string | null;
  source_url: string | null;
}

// ---------------------------------------------------------------------------
// グループ → 代表レコード選択 + 残りを削除対象に
// ---------------------------------------------------------------------------

interface MergeAction {
  keepId: string;
  keepSlug: string;
  newColorName: string | null; // null = 変更不要
  deleteIds: string[];
  groupName: string;
  memberCount: number;
}

function pickBestRecord(records: LureRecord[]): LureRecord {
  // 優先度: 画像あり > price > 0 > weight/length情報あり > description長い
  return records.sort((a, b) => {
    const aImg = (a.images?.length || 0) > 0 ? 1 : 0;
    const bImg = (b.images?.length || 0) > 0 ? 1 : 0;
    if (aImg !== bImg) return bImg - aImg;
    const aPrice = a.price > 0 ? 1 : 0;
    const bPrice = b.price > 0 ? 1 : 0;
    if (aPrice !== bPrice) return bPrice - aPrice;
    if ((a.weight || 0) !== (b.weight || 0)) return (b.weight || 0) - (a.weight || 0);
    return (b.description?.length || 0) - (a.description?.length || 0);
  })[0];
}

// ---------------------------------------------------------------------------
// Pickup 修正計画を作成
// ---------------------------------------------------------------------------

async function planPickupFix(): Promise<MergeAction[]> {
  const { data, error } = await sb.from('lures')
    .select('id, slug, name, color_name, type, price, weight, length, images, description, source_url')
    .eq('manufacturer_slug', 'pickup');
  if (error) throw error;
  if (!data) return [];

  log(`Pickup: ${data.length}件取得`);

  // Step 1: ベースモデル名でグルーピング
  const groups = new Map<string, LureRecord[]>();
  for (const r of data as LureRecord[]) {
    const parsed = parsePickupName(r.name);
    const key = parsed.baseName;
    const g = groups.get(key) || [];
    g.push(r);
    groups.set(key, g);
  }

  log(`Pickup: ${groups.size}グループに分類`);

  const actions: MergeAction[] = [];

  for (const [baseName, records] of groups) {
    if (records.length === 1) {
      // 1件のみ — カラー名抽出のみ
      const parsed = parsePickupName(records[0].name);
      if (parsed.colorPart && records[0].color_name === '(default)') {
        actions.push({
          keepId: records[0].id,
          keepSlug: records[0].slug,
          newColorName: parsed.colorPart,
          deleteIds: [],
          groupName: baseName,
          memberCount: 1,
        });
      }
      continue;
    }

    // 複数レコード — カラー名が異なるものは別商品として扱う
    const colorGroups = new Map<string, LureRecord[]>();
    for (const r of records) {
      const parsed = parsePickupName(r.name);
      // スモールトラップ/アンダーアップキプロ68はウェイト別にもグルーピング
      let subKey = parsed.colorPart || '(no-color)';
      if (baseName === 'スモールトラップ' || baseName === 'アンダーアップキプロ68') {
        subKey += `_${r.weight || 'null'}g`;
      }
      const g = colorGroups.get(subKey) || [];
      g.push(r);
      colorGroups.set(subKey, g);
    }

    for (const [colorKey, colorRecords] of colorGroups) {
      if (colorRecords.length === 1) {
        // 1件のみ — カラー名抽出のみ
        const parsed = parsePickupName(colorRecords[0].name);
        const colorName = parsed.colorPart || null;
        if (colorName && colorRecords[0].color_name === '(default)') {
          actions.push({
            keepId: colorRecords[0].id,
            keepSlug: colorRecords[0].slug,
            newColorName: colorName,
            deleteIds: [],
            groupName: `${baseName} [${colorKey}]`,
            memberCount: 1,
          });
        }
        continue;
      }

      // 重複あり — 最良レコードを残し、残りを削除
      const best = pickBestRecord(colorRecords);
      const deleteIds = colorRecords.filter(r => r.id !== best.id).map(r => r.id);
      const parsed = parsePickupName(best.name);
      const colorName = parsed.colorPart || null;

      actions.push({
        keepId: best.id,
        keepSlug: best.slug,
        newColorName: colorName && best.color_name === '(default)' ? colorName : null,
        deleteIds,
        groupName: `${baseName} [${colorKey}]`,
        memberCount: colorRecords.length,
      });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// God Hands / Grassroots 修正計画
// ---------------------------------------------------------------------------

async function planSimpleMerge(
  manufacturerSlug: string,
  newSlug: string,
  newName: string,
): Promise<MergeAction | null> {
  const { data, error } = await sb.from('lures')
    .select('id, slug, name, color_name, type, price, weight, length, images, description, source_url')
    .eq('manufacturer_slug', manufacturerSlug);
  if (error) throw error;
  if (!data || data.length === 0) return null;

  log(`${manufacturerSlug}: ${data.length}件取得`);

  const best = pickBestRecord(data as LureRecord[]);
  const deleteIds = (data as LureRecord[]).filter(r => r.id !== best.id).map(r => r.id);

  return {
    keepId: best.id,
    keepSlug: newSlug,
    newColorName: null,
    deleteIds,
    groupName: `${manufacturerSlug} → ${newName}`,
    memberCount: data.length,
  };
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

async function execute(actions: MergeAction[]): Promise<void> {
  let totalDeleted = 0;
  let totalUpdated = 0;

  for (const action of actions) {
    // 1. slug/color_name更新（必要な場合）
    const updates: Record<string, any> = {};
    if (action.newColorName) {
      updates.color_name = action.newColorName;
    }

    if (Object.keys(updates).length > 0) {
      if (DRY_RUN) {
        log(`  [DRY] UPDATE ${action.keepId} SET ${JSON.stringify(updates)}`);
      } else {
        const { error } = await sb.from('lures').update(updates).eq('id', action.keepId);
        if (error) {
          log(`  ERROR updating ${action.keepId}: ${error.message}`);
          continue;
        }
      }
      totalUpdated++;
    }

    // 2. 重複削除
    if (action.deleteIds.length > 0) {
      if (DRY_RUN) {
        log(`  [DRY] DELETE ${action.deleteIds.length}件 from "${action.groupName}"`);
      } else {
        const { error } = await sb.from('lures').delete().in('id', action.deleteIds);
        if (error) {
          log(`  ERROR deleting from "${action.groupName}": ${error.message}`);
          continue;
        }
      }
      totalDeleted += action.deleteIds.length;
    }
  }

  log(`\n=== 結果 ===`);
  log(`更新: ${totalUpdated}件`);
  log(`削除: ${totalDeleted}件`);
  if (DRY_RUN) log('(dry-run: 実際の変更なし)');
}

async function main() {
  log(`=== Pickup / God Hands / Grassroots データ品質修復 ===`);
  log(`モード: ${DRY_RUN ? 'DRY RUN' : '本番'}`);

  // --- Pickup ---
  log('\n--- Pickup ---');
  const pickupActions = await planPickupFix();

  // サマリー
  const pickupDeletes = pickupActions.reduce((sum, a) => sum + a.deleteIds.length, 0);
  const pickupColorUpdates = pickupActions.filter(a => a.newColorName).length;
  const multiGroups = pickupActions.filter(a => a.memberCount > 1);

  log(`\nPickup サマリー:`);
  log(`  グループ数: ${pickupActions.length}`);
  log(`  重複グループ: ${multiGroups.length}`);
  log(`  削除予定: ${pickupDeletes}件`);
  log(`  カラー名更新: ${pickupColorUpdates}件`);

  // 詳細表示
  log('\n--- Pickup 詳細 ---');
  for (const a of pickupActions) {
    const ops: string[] = [];
    if (a.newColorName) ops.push(`color→"${a.newColorName}"`);
    if (a.deleteIds.length > 0) ops.push(`del ${a.deleteIds.length}件`);
    if (ops.length > 0) {
      log(`  ${a.groupName}: keep=${a.keepSlug} | ${ops.join(', ')}`);
    }
  }

  // --- God Hands ---
  log('\n--- God Hands ---');
  const godHandsAction = await planSimpleMerge('god-hands', 'god-hands', 'GOD HANDS');
  if (godHandsAction) {
    log(`  keep=${godHandsAction.keepId} | del ${godHandsAction.deleteIds.length}件`);
  }

  // --- Grassroots ---
  log('\n--- Grassroots ---');
  const grassrootsAction = await planSimpleMerge('grassroots', 'basslure', 'BASS LURE');
  if (grassrootsAction) {
    log(`  keep=${grassrootsAction.keepId} | del ${grassrootsAction.deleteIds.length}件`);
  }

  // 全アクション集約
  const allActions: MergeAction[] = [...pickupActions];
  if (godHandsAction) allActions.push(godHandsAction);
  if (grassrootsAction) allActions.push(grassrootsAction);

  const totalDeletes = allActions.reduce((sum, a) => sum + a.deleteIds.length, 0);
  const totalUpdates = allActions.filter(a => a.newColorName || Object.keys(a).length > 0).length;

  log(`\n=== 全体サマリー ===`);
  log(`削除予定: ${totalDeletes}件`);
  log(`更新予定: ${pickupColorUpdates}件 (カラー名)`);

  // 実行
  await execute(allActions);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
