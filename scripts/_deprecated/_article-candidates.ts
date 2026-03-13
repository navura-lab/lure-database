/**
 * 記事未作成の fish × type テーマ候補を洗い出すスクリプト
 *
 * 手順:
 * 1. .cache/lures.json の全ルアーから target_fish × type の組み合わせ別シリーズ数をカウント
 * 2. 既存記事テーマ（targetFish × targetTypes）を除外
 * 3. シリーズ数10以上を降順でTSV出力
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── ローマ字変換マップ ──
const romajiMap: Record<string, string> = {
  // 魚種
  'シーバス': 'seabass',
  'ブラックバス': 'bass',
  'バス': 'bass',
  'トラウト': 'trout',
  'メバル': 'mebaru',
  'アジ': 'aji',
  'カサゴ': 'kasago',
  'ヒラメ': 'hirame',
  'マゴチ': 'magochi',
  'タチウオ': 'tachiuo',
  '青物': 'aomono',
  'クロダイ': 'kurodai',
  'チヌ': 'chinu',
  'マダイ': 'madai',
  'アオリイカ': 'aoriika',
  'イカ': 'ika',
  'タコ': 'tako',
  'マダコ': 'madako',
  'ハタ': 'hata',
  'ヒラマサ': 'hiramasa',
  'キジハタ': 'kijihata',
  'カマス': 'kamasu',
  'サワラ': 'sawara',
  'ロックフィッシュ': 'rockfish',
  'フラットフィッシュ': 'flatfish',
  'キス': 'kisu',
  'カレイ': 'karei',
  'アイナメ': 'ainame',
  'ソイ': 'soi',
  'ブリ': 'buri',
  'カンパチ': 'kanpachi',
  'サバ': 'saba',
  'イナダ': 'inada',
  'ニジマス': 'nijimasu',
  'ヤマメ': 'yamame',
  'イワナ': 'iwana',
  'マグロ': 'maguro',
  'GT': 'gt',
  'クラッピー': 'crappie',
  'パンフィッシュ': 'panfish',
  'ウォールアイ': 'walleye',
  'レッドフィッシュ': 'redfish',
  'スヌーク': 'snook',
  'パイク': 'pike',
  'ストライパー': 'striper',
  'シートラウト': 'seatrout',
  'ソルト': 'salt',
  'オフショア': 'offshore',
  'ヒラメ・マゴチ': 'hirame-magochi',
  '青物（ブリ、ヒラマサ、カンパチ等）': 'aomono',
  'トラウト（管理釣り場・ネイティブ含む）': 'trout',
  // ルアータイプ
  'ミノー': 'minnow',
  'バイブレーション': 'vibration',
  'シンキングペンシル': 'sinkingpencil',
  'ペンシルベイト': 'pencilbait',
  'ポッパー': 'popper',
  'メタルジグ': 'metaljig',
  'メタルバイブ': 'metalvibe',
  'ワーム': 'worm',
  'クランクベイト': 'crankbait',
  'スプーン': 'spoon',
  'スピナーベイト': 'spinnerbait',
  'スイムベイト': 'swimbait',
  'エギ': 'egi',
  'タイラバ': 'tairaba',
  'ジグヘッド': 'jighead',
  'ラバージグ': 'rubberjig',
  'フロッグ': 'frog',
  'バズベイト': 'buzzbait',
  'スピンテール': 'spintail',
  'テキサスリグ': 'texasrig',
  'ダイビングペンシル': 'divingpencil',
  'スッテ': 'sutte',
  'テンヤ': 'tenya',
  'インチク': 'inchiku',
  'ビッグベイト': 'bigbait',
  'チャターベイト': 'chatterbait',
  'その他': 'other',
  'トップウォーター': 'topwater',
  'シャッド': 'shad',
  'ジョイントベイト': 'jointedbait',
  'プロップベイト': 'propbait',
  'クローラーベイト': 'crawlerbait',
  'i字系': 'ikei',
  'ブレードベイト': 'bladebait',
  'スピナー': 'spinner',
};

function toRomaji(jp: string): string {
  return romajiMap[jp] ?? jp.toLowerCase().replace(/\s+/g, '');
}

// ── lures.json 読み込み ──
interface LureEntry {
  slug: string;
  name: string;
  type: string;
  target_fish: string[];
}

const root = resolve(import.meta.dirname!, '..');
const luresPath = resolve(root, '.cache/lures.json');
const lures: LureEntry[] = JSON.parse(readFileSync(luresPath, 'utf-8'));

// ── シリーズ（slug）単位でユニーク化 ──
// 同一 slug は同一シリーズ（カラー違い）なので重複排除
const seriesMap = new Map<string, { type: string; target_fish: string[] }>();
for (const lure of lures) {
  if (!seriesMap.has(lure.slug)) {
    seriesMap.set(lure.slug, { type: lure.type, target_fish: lure.target_fish });
  }
}

// ── fish × type カウント ──
const counter = new Map<string, number>();
for (const [, series] of seriesMap) {
  if (!series.type || !series.target_fish?.length) continue;
  for (const fish of series.target_fish) {
    const key = `${fish}\t${series.type}`;
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }
}

// ── 既存記事テーマの fish × type ペアを収集 ──
// _index.ts の import 先ファイルから targetFish × targetTypes を抽出
const existingPairs = new Set<string>();

// 手動定義: Grep結果に基づく既存記事の fish × type ペア
const existingArticles: Array<{ fish: string[]; types: string[] }> = [
  // カラーガイド（特定商品のためfish×type汎用テーマとして扱う）
  { fish: ['シーバス'], types: ['バイブレーション'] },       // rolling-bait-color → その他だがバイブ記事
  { fish: ['シーバス'], types: ['シンキングペンシル'] },     // switch-hitter-color
  { fish: ['シーバス'], types: ['ポッパー'] },               // feed-popper-color
  { fish: ['マダイ'], types: ['タイラバ'] },                 // kohga-bay-rubber-color
  { fish: ['タチウオ'], types: ['メタルジグ'] },             // jigpara-vertical-short-color
  // レビュー分析
  { fish: ['青物'], types: ['シンキングペンシル'] },         // monster-shot-review
  { fish: ['シーバス', '青物', 'クロダイ'], types: ['メタルバイブ'] }, // onimaru-review
  { fish: ['アジ', 'メバル'], types: ['メタルジグ'] },       // jigpara-micro-slim-review
  { fish: ['メバル', 'アジ', 'カサゴ'], types: ['スピンテール'] }, // metalmaru-review
  { fish: ['ブラックバス'], types: ['ワーム'] },             // flick-shake-review
  // 季節コンテンツ（複合タイプ）
  { fish: ['シーバス'], types: ['シンキングペンシル', 'ミノー', 'バイブレーション', 'ワーム'] }, // spring-seabass
  { fish: ['メバル'], types: ['ワーム', 'ミノー', 'メタルジグ'] }, // spring-mebaring
  { fish: ['アオリイカ'], types: ['エギ'] },                 // spring-eging-egi
  // GSC駆動記事
  { fish: ['マゴチ'], types: ['ワーム'] },
  { fish: ['シーバス'], types: ['ポッパー'] },
  { fish: ['ブラックバス'], types: ['スイムベイト'] },
  { fish: ['メバル'], types: ['ミノー'] },
  { fish: ['青物'], types: ['ワーム'] },
  { fish: ['青物', 'ヒラマサ'], types: ['ダイビングペンシル'] },
  { fish: ['ヒラメ'], types: ['バイブレーション'] },
  { fish: ['ハタ'], types: ['ワーム'] },
  { fish: ['青物'], types: ['ポッパー'] },
  { fish: ['チヌ', 'クロダイ'], types: [] },                // chining-lure（タイプなし、汎用）
  { fish: ['シーバス'], types: ['ペンシルベイト'] },
  { fish: ['シーバス'], types: ['メタルジグ'] },
  { fish: ['ヒラメ'], types: ['ワーム'] },
  { fish: ['タコ', 'マダコ'], types: ['エギ'] },
  { fish: ['バス'], types: ['スピナーベイト'] },
  { fish: ['シーバス'], types: ['ミノー'] },
  { fish: ['トラウト'], types: ['スプーン'] },
  { fish: ['シーバス'], types: ['シンキングペンシル'] },
  { fish: ['青物'], types: ['メタルジグ'] },
  { fish: ['マダイ'], types: ['タイラバ'] },
];

for (const article of existingArticles) {
  for (const fish of article.fish) {
    for (const type of article.types) {
      existingPairs.add(`${fish}\t${type}`);
    }
  }
}

// ── フィルタ & ソート ──
const candidates: Array<{ fish: string; type: string; count: number; slug: string }> = [];

for (const [key, count] of counter) {
  if (count < 10) continue;
  if (existingPairs.has(key)) continue;
  const [fish, type] = key.split('\t');
  const slug = `${toRomaji(fish)}-${toRomaji(type)}`;
  candidates.push({ fish, type, count, slug });
}

candidates.sort((a, b) => b.count - a.count);

// ── TSV出力 ──
console.log('fish\ttype\tseries_count\tslug_candidate');
for (const c of candidates) {
  console.log(`${c.fish}\t${c.type}\t${c.count}\t${c.slug}`);
}

console.error(`\n--- 合計: ${candidates.length} テーマ候補（既存記事${existingPairs.size}ペア除外済み、シリーズ数10以上）---`);
