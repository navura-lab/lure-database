#!/usr/bin/env npx tsx
/**
 * ランキング説明文 差分検出スクリプト
 *
 * ビルド時に生成されるランキングカテゴリ(魚種×タイプ)のうち、
 * ranking-descriptions.tsに説明文が存在しないものを検出し、
 * JSONで出力する。
 *
 * 説明文の生成自体はClaude Codeセッション内で行う（無料）。
 * pipeline完了後に自動実行し、不足があればログに記録。
 *
 * Usage:
 *   npx tsx scripts/generate-ranking-descriptions.ts          # 差分検出
 *   npx tsx scripts/generate-ranking-descriptions.ts --json   # JSON出力（パイプ用）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { rankingDescriptions } from '../src/data/ranking-descriptions.js';

// ─── Config ───────────────────────────────────────────

const MIN_SERIES = 3;
const JSON_MODE = process.argv.includes('--json');
const OUTPUT_FILE = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'ranking-desc-missing.json');

// ─── スラッグマップ ───────────────────────────────────

const TYPE_SLUG_MAP: Record<string, string> = {
  'ミノー': 'minnow', 'クランクベイト': 'crankbait', 'シャッド': 'shad',
  'バイブレーション': 'vibration', 'メタルバイブレーション': 'metal-vib',
  'ペンシルベイト': 'pencilbait', 'シンキングペンシル': 'sinking-pencil',
  'ダイビングペンシル': 'diving-pencil', 'ポッパー': 'popper',
  'トップウォーター': 'topwater', 'プロップベイト': 'propbait',
  'クローラーベイト': 'crawler-bait', 'i字系': 'i-shape',
  'スイムベイト': 'swimbait', 'ビッグベイト': 'bigbait',
  'ジョイントベイト': 'jointed-bait', 'フロッグ': 'frog',
  'スピナーベイト': 'spinnerbait', 'チャターベイト': 'chatterbait',
  'バズベイト': 'buzzbait', 'スピンテール': 'spintail',
  'ブレードベイト': 'blade-bait', 'メタルジグ': 'metal-jig',
  'スプーン': 'spoon', 'スピナー': 'spinner', 'ワーム': 'worm',
  'ラバージグ': 'rubber-jig', 'ジグヘッド': 'jighead', 'エギ': 'egi',
  'スッテ': 'sutte', 'タイラバ': 'tai-rubber', 'テンヤ': 'tenya',
  'その他': 'other',
};

const FISH_SLUG_MAP: Record<string, string> = {
  'シーバス': 'seabass', 'ブラックバス': 'black-bass', 'ヒラスズキ': 'hirasuzuki',
  'トラウト': 'trout', 'メバル': 'mebaru', 'アジ': 'aji', 'カサゴ': 'kasago',
  'ロックフィッシュ': 'rockfish', 'ヒラメ': 'hirame', 'マゴチ': 'magochi',
  'クロダイ': 'kurodai', 'チヌ': 'chinu', 'マダイ': 'madai',
  'タチウオ': 'tachiuo', 'ブリ': 'yellowtail', 'ヒラマサ': 'hiramasa',
  'カンパチ': 'kampachi', '青物': 'bluerunner', 'GT': 'gt',
  'マグロ': 'tuna', 'サワラ': 'sawara', 'アオリイカ': 'aori-ika',
  'ケンサキイカ': 'kensaki-ika', 'ヤリイカ': 'yari-ika', 'イカ': 'squid',
  'コウイカ': 'cuttlefish', 'シイラ': 'mahi-mahi', 'ハタ': 'hata',
  'アイナメ': 'ainame', 'ナマズ': 'catfish', 'サクラマス': 'sakuramasu',
  'サケ': 'sake', 'アユ': 'ayu', 'ハゼ': 'goby',
};

function getTypeSlug(name: string): string {
  return TYPE_SLUG_MAP[name] || name.toLowerCase().replace(/\s+/g, '-');
}

function getFishSlug(name: string): string {
  return FISH_SLUG_MAP[name] || name.toLowerCase().replace(/\s+/g, '-');
}

function log(msg: string) {
  if (!JSON_MODE) console.log(`[ranking-desc] ${msg}`);
}

// ─── Supabase: ランキングカテゴリ算出 ─────────────────

async function fetchRankingCategories() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  const seriesMap = new Map<string, { type: string; targetFish: string[] }>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug,type,target_fish')
      .range(from, from + pageSize - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data) {
      if (!r.slug || !r.type) continue;
      if (!seriesMap.has(r.slug)) {
        const fish = Array.isArray(r.target_fish) ? r.target_fish as string[] : [];
        seriesMap.set(r.slug, { type: r.type, targetFish: fish });
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const crossMap = new Map<string, { fishName: string; typeName: string; count: number }>();
  for (const [, series] of seriesMap) {
    for (const fish of series.targetFish) {
      const fishSlug = getFishSlug(fish);
      const typeSlug = getTypeSlug(series.type);
      const key = `${fishSlug}-${typeSlug}`;
      const existing = crossMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        crossMap.set(key, { fishName: fish, typeName: series.type, count: 1 });
      }
    }
  }

  return [...crossMap.entries()]
    .filter(([, v]) => v.count >= MIN_SERIES)
    .map(([key, v]) => ({ key, ...v }));
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== Ranking Description Gap Detector ===');

  const categories = await fetchRankingCategories();
  const existingKeys = new Set(Object.keys(rankingDescriptions));
  const missing = categories.filter(c => !existingKeys.has(c.key));

  log(`ランキングカテゴリ: ${categories.length}件`);
  log(`既存説明文: ${existingKeys.size}件`);
  log(`不足: ${missing.length}件`);

  if (missing.length === 0) {
    log('すべてのカテゴリに説明文が存在。');
    if (JSON_MODE) console.log(JSON.stringify({ missing: [], count: 0 }));
    return;
  }

  // 不足分を出力
  const result = missing.map(m => ({
    key: m.key,
    fishName: m.fishName,
    typeName: m.typeName,
    seriesCount: m.count,
  }));

  if (JSON_MODE) {
    console.log(JSON.stringify({ missing: result, count: result.length }));
  } else {
    log('\n不足しているカテゴリ:');
    for (const m of result) {
      log(`  ${m.key} (${m.fishName}×${m.typeName}, ${m.seriesCount}シリーズ)`);
    }
    log('\nClaude Codeセッションで以下を実行して生成:');
    log('  「ranking-descriptions.tsの不足分を生成して追記して」');
  }

  // JSONファイルにも保存（他スクリプトからの参照用）
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ missing: result, count: result.length, date: new Date().toISOString() }, null, 2));
  log(`\n${OUTPUT_FILE} に保存。`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
