// scripts/_detect-description-fish-mismatch.ts
// descriptionとtarget_fishの矛盾を検出し、矛盾するdescriptionを空化する
//
// Usage:
//   npx tsx scripts/_detect-description-fish-mismatch.ts --dry-run
//   npx tsx scripts/_detect-description-fish-mismatch.ts --apply
//
// 対象: ima, dreemup, palms, bozles（今日target_fishを変更したメーカー）
// + 全メーカーで広く検出

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const DRY_RUN = !process.argv.includes('--apply');

// ----- 魚種名の正規化マップ（description内の表現 → target_fishの正規名） -----
const FISH_PATTERNS: Array<{
  regex: RegExp;
  fishName: string; // target_fishに含まれるべき名前
  isMainOnly: boolean; // trueなら「メインターゲット」表現のみマッチ
}> = [
  // シーバス
  { regex: /シーバス/, fishName: 'シーバス', isMainOnly: false },
  { regex: /スズキ/, fishName: 'シーバス', isMainOnly: false },
  // ブラックバス
  { regex: /ブラックバス/, fishName: 'ブラックバス', isMainOnly: false },
  { regex: /バスフィッシング/, fishName: 'ブラックバス', isMainOnly: false },
  { regex: /バス釣り/, fishName: 'ブラックバス', isMainOnly: false },
  { regex: /バスゲーム/, fishName: 'ブラックバス', isMainOnly: false },
  // トラウト
  { regex: /トラウト/, fishName: 'トラウト', isMainOnly: false },
  { regex: /(?:ニジ|ヤマ|イワ|アマゴ|サクラ)マス/, fishName: 'トラウト', isMainOnly: false },
  { regex: /渓流/, fishName: 'トラウト', isMainOnly: false },
  { regex: /エリアトラウト/, fishName: 'トラウト', isMainOnly: false },
  { regex: /管釣り|管理釣り場/, fishName: 'トラウト', isMainOnly: false },
  // メバル
  { regex: /メバル/, fishName: 'メバル', isMainOnly: false },
  { regex: /メバリング/, fishName: 'メバル', isMainOnly: false },
  // アジ（「オフショアジギング」「アジャスト」「アジト」等の偽陽性を除外）
  { regex: /(?<!ショ|オフショ)アジ(?!ャスト|ト[^ン]|ング以外|ギング|ュール|ア)/, fishName: 'アジ', isMainOnly: false },
  { regex: /アジング/, fishName: 'アジ', isMainOnly: false },
  // ヒラメ
  { regex: /ヒラメ/, fishName: 'ヒラメ', isMainOnly: false },
  { regex: /フラットフィッシュ/, fishName: 'ヒラメ', isMainOnly: false },
  // マゴチ
  { regex: /マゴチ/, fishName: 'マゴチ', isMainOnly: false },
  // 青物
  { regex: /青物/, fishName: '青物', isMainOnly: false },
  { regex: /ショアジギ/, fishName: '青物', isMainOnly: false },
  { regex: /ブリ/, fishName: '青物', isMainOnly: false },
  { regex: /ワラサ/, fishName: '青物', isMainOnly: false },
  // チヌ/クロダイ
  { regex: /チヌ/, fishName: 'チヌ', isMainOnly: false },
  { regex: /クロダイ/, fishName: 'チヌ', isMainOnly: false },
  // タチウオ
  { regex: /タチウオ/, fishName: 'タチウオ', isMainOnly: false },
  // イカ（「イカリ」「イカす」「イカした」等の偽陽性を除外）
  { regex: /イカ(?!ン|リ|す|し[たて])/, fishName: 'イカ', isMainOnly: false },
  { regex: /エギング/, fishName: 'イカ', isMainOnly: false },
  { regex: /アオリ/, fishName: 'イカ', isMainOnly: false },
  // カサゴ/ロックフィッシュ
  { regex: /カサゴ/, fishName: 'カサゴ', isMainOnly: false },
  { regex: /ロックフィッシュ/, fishName: 'ロックフィッシュ', isMainOnly: false },
  { regex: /根魚/, fishName: 'ロックフィッシュ', isMainOnly: false },
];

// 「メインターゲット」として言及しているかを判定する表現
const MAIN_TARGET_INDICATORS = [
  /専用/,
  /特化/,
  /ゲームの[定鉄]番/,
  /に最適/,
  /のための/,
  /向け(?:に|の)?(?:開発|設計|チューン)/,
  /をターゲット/,
  /を狙[うい]/,
  /に効[くき]/,
  /攻略/,
];

// 「サブターゲット」として言及しているかを判定する表現
const SUB_TARGET_INDICATORS = [
  /も狙える/,
  /にも(?:対応|有効|効果)/,
  /はもちろん/,
  /から.*まで/,
  /をはじめ/,
  /など(?:の|にも|様々)/,
  /多魚種/,
  /万能/,
  /汎用/,
  /オールラウンド/,
];

interface Mismatch {
  id: string;
  name: string;
  slug: string;
  manufacturer_slug: string;
  target_fish: string[];
  description: string;
  mentioned_fish: string[];  // descriptionで言及された魚種
  missing_fish: string[];    // target_fishに含まれない魚種
  is_main_mention: boolean;  // メインターゲットとしての言及か
  reason: string;
  severity: 'complete' | 'partial'; // complete=完全矛盾、partial=部分矛盾
}

// target_fishに含まれるかチェック（部分一致も考慮）
function fishInTargets(fishName: string, targets: string[]): boolean {
  if (!targets || targets.length === 0) return false;
  return targets.some(t => {
    const tNorm = t.trim();
    // 完全一致
    if (tNorm === fishName) return true;
    // 部分一致（「シーバス」が「シーバス、ヒラメ」の中にある等）
    if (tNorm.includes(fishName)) return true;
    if (fishName.includes(tNorm)) return true;
    // 青物系の特殊マッチ
    if (fishName === '青物' && (tNorm === 'ブリ' || tNorm === 'ワラサ' || tNorm === 'ハマチ' || tNorm === 'カンパチ')) return true;
    if ((fishName === 'ブリ' || fishName === 'ワラサ') && tNorm === '青物') return true;
    // チヌ/クロダイ
    if (fishName === 'チヌ' && tNorm === 'クロダイ') return true;
    if (fishName === 'クロダイ' && tNorm === 'チヌ') return true;
    // ロックフィッシュ/カサゴ
    if (fishName === 'ロックフィッシュ' && (tNorm === 'カサゴ' || tNorm === 'ソイ' || tNorm === 'ハタ' || tNorm === 'アイナメ')) return true;
    if (fishName === 'カサゴ' && tNorm === 'ロックフィッシュ') return true;
    // ヒラメ/マゴチ → フラットフィッシュ
    if (fishName === 'ヒラメ' && tNorm === 'フラットフィッシュ') return true;
    if (fishName === 'マゴチ' && tNorm === 'フラットフィッシュ') return true;
    if (fishName === 'フラットフィッシュ' && (tNorm === 'ヒラメ' || tNorm === 'マゴチ')) return true;
    return false;
  });
}

function analyzeDescription(desc: string, targetFish: string[]): {
  mentionedFish: string[];
  missingFish: string[];
  isMainMention: boolean;
  reason: string;
  severity: 'complete' | 'partial';
} | null {
  if (!desc || desc.trim().length === 0) return null;

  const mentionedFish: Set<string> = new Set();
  const missingFish: Set<string> = new Set();

  // descriptionに言及されている魚種を検出
  for (const pattern of FISH_PATTERNS) {
    if (pattern.regex.test(desc)) {
      mentionedFish.add(pattern.fishName);
      if (!fishInTargets(pattern.fishName, targetFish)) {
        missingFish.add(pattern.fishName);
      }
    }
  }

  if (missingFish.size === 0) return null;

  // メインターゲットとしての言及かサブターゲットかを判定
  // 各missing fishについて、その前後の文脈をチェック
  let isMainMention = false;
  const reasons: string[] = [];

  for (const fish of missingFish) {
    // fishの前後の文をチェック
    const fishRegex = new RegExp(`[^。]*${fish}[^。]*`, 'g');
    const sentences = desc.match(fishRegex) || [];

    for (const sentence of sentences) {
      // サブターゲット表現があるかチェック
      const isSub = SUB_TARGET_INDICATORS.some(r => r.test(sentence));
      if (isSub) {
        // サブターゲットなら許容
        continue;
      }

      // メインターゲット表現があるかチェック
      const isMain = MAIN_TARGET_INDICATORS.some(r => r.test(sentence));
      if (isMain) {
        isMainMention = true;
        reasons.push(`「${sentence.trim().substring(0, 60)}」で${fish}をメインターゲットとして言及`);
      }
    }
  }

  // メインターゲット表現がなくても、target_fishにない魚種が
  // descriptionの主語・冒頭で使われている場合はメインとみなす
  if (!isMainMention) {
    for (const fish of missingFish) {
      // 冒頭30文字以内に魚種名がある場合
      const first30 = desc.substring(0, 30);
      const fishPattern = FISH_PATTERNS.find(p => p.fishName === fish);
      if (fishPattern && fishPattern.regex.test(first30)) {
        // ただしサブターゲット表現でないか再確認
        const isSub = SUB_TARGET_INDICATORS.some(r => r.test(first30));
        if (!isSub) {
          isMainMention = true;
          reasons.push(`冒頭で${fish}に言及（target_fishに含まれない）`);
        }
      }
    }
  }

  // target_fishが空の場合はスキップ（descriptionが正しくてtarget_fishが未設定の可能性が高い）
  if (!targetFish || targetFish.length === 0) {
    return null;
  }

  if (!isMainMention) return null;

  // 矛盾の深刻度を判定:
  // - 完全矛盾: descriptionのメインターゲットがtarget_fishと一切重ならない
  //   例: desc=「トラウト専用」 target_fish=[シーバス]
  // - 部分矛盾: target_fishの魚種も言及されているが、追加魚種もある
  //   例: desc=「シーバス・ヒラメ・青物を攻略」 target_fish=[シーバス]
  const matchedFish = [...mentionedFish].filter(f => fishInTargets(f, targetFish));
  const severity = matchedFish.length === 0 ? 'complete' : 'partial';

  return {
    mentionedFish: [...mentionedFish],
    missingFish: [...missingFish],
    isMainMention,
    reason: reasons.join('; '),
    severity,
  };
}

async function fetchAllLures(): Promise<any[]> {
  const allRows: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('id, name, slug, manufacturer_slug, target_fish, description')
      .not('description', 'is', null)
      .neq('description', '')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // slug単位でユニーク化（同一商品の異カラーは1回だけチェック）
  const seen = new Map<string, any>();
  for (const row of allRows) {
    const key = `${row.manufacturer_slug}/${row.slug}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY（DB書き込みあり）'}\n`);

  // 全ルアー取得（description非空のもの）
  console.log('全ルアー取得中...');
  const lures = await fetchAllLures();
  console.log(`取得: ${lures.length}件（slug単位ユニーク）\n`);

  // 優先チェック対象メーカー
  const priorityMakers = ['ima', 'dreemup', 'palms', 'bozles'];

  const mismatches: Mismatch[] = [];
  let checked = 0;

  for (const lure of lures) {
    checked++;
    if (!lure.description || lure.description.trim().length === 0) continue;

    const result = analyzeDescription(lure.description, lure.target_fish || []);
    if (result) {
      mismatches.push({
        id: lure.id,
        name: lure.name,
        slug: lure.slug,
        manufacturer_slug: lure.manufacturer_slug,
        target_fish: lure.target_fish || [],
        description: lure.description,
        mentioned_fish: result.mentionedFish,
        missing_fish: result.missingFish,
        is_main_mention: result.isMainMention,
        reason: result.reason,
        severity: result.severity,
      });
    }
  }

  const completeMismatches = mismatches.filter(m => m.severity === 'complete');
  const partialMismatches = mismatches.filter(m => m.severity === 'partial');

  console.log(`チェック完了: ${checked}件中 ${mismatches.length}件で矛盾検出`);
  console.log(`  完全矛盾（空化対象）: ${completeMismatches.length}件`);
  console.log(`  部分矛盾（報告のみ）: ${partialMismatches.length}件\n`);

  // 完全矛盾を表示
  if (completeMismatches.length > 0) {
    console.log(`=== 完全矛盾（descriptionのメインターゲットがtarget_fishと不一致）===`);
    // 優先メーカー
    const priorityComplete = completeMismatches.filter(m => priorityMakers.includes(m.manufacturer_slug));
    const otherComplete = completeMismatches.filter(m => !priorityMakers.includes(m.manufacturer_slug));

    if (priorityComplete.length > 0) {
      console.log(`\n--- 優先メーカー: ${priorityComplete.length}件 ---`);
      for (const m of priorityComplete) {
        console.log(`  ${m.manufacturer_slug}/${m.slug}`);
        console.log(`    target_fish: [${m.target_fish.join(', ')}]`);
        console.log(`    mentioned: [${m.mentioned_fish.join(', ')}]`);
        console.log(`    missing: [${m.missing_fish.join(', ')}]`);
        console.log(`    reason: ${m.reason}`);
        console.log(`    desc: ${m.description.substring(0, 100)}...`);
        console.log();
      }
    }

    if (otherComplete.length > 0) {
      console.log(`\n--- その他メーカー: ${otherComplete.length}件 ---`);
      const byMaker = new Map<string, Mismatch[]>();
      for (const m of otherComplete) {
        const arr = byMaker.get(m.manufacturer_slug) || [];
        arr.push(m);
        byMaker.set(m.manufacturer_slug, arr);
      }
      for (const [maker, items] of [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  [${maker}] ${items.length}件`);
        for (const m of items) {
          console.log(`    ${m.slug}: target=[${m.target_fish.join(',')}] missing=[${m.missing_fish.join(',')}]`);
          console.log(`      ${m.reason}`);
        }
      }
    }
  }

  // 部分矛盾を簡易表示
  if (partialMismatches.length > 0) {
    console.log(`\n=== 部分矛盾（target_fishの魚種も言及あり、追加魚種も記載）===`);
    console.log(`（空化しない。target_fishの追加を検討すべきケース）`);
    const byMaker = new Map<string, Mismatch[]>();
    for (const m of partialMismatches) {
      const arr = byMaker.get(m.manufacturer_slug) || [];
      arr.push(m);
      byMaker.set(m.manufacturer_slug, arr);
    }
    for (const [maker, items] of [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  [${maker}] ${items.length}件`);
      for (const m of items.slice(0, 3)) {
        console.log(`    ${m.slug}: target=[${m.target_fish.join(',')}] missing=[${m.missing_fish.join(',')}]`);
      }
      if (items.length > 3) console.log(`    ... +${items.length - 3}件`);
    }
  }

  // JSONに保存
  const output = {
    timestamp: new Date().toISOString(),
    total_checked: checked,
    total_mismatches: mismatches.length,
    complete_mismatches: completeMismatches.length,
    partial_mismatches: partialMismatches.length,
    applied: !DRY_RUN,
    complete: completeMismatches.map(m => ({
      manufacturer_slug: m.manufacturer_slug,
      slug: m.slug,
      name: m.name,
      target_fish: m.target_fish,
      missing_fish: m.missing_fish,
      reason: m.reason,
      severity: m.severity,
      description_preview: m.description.substring(0, 100),
    })),
    partial: partialMismatches.map(m => ({
      manufacturer_slug: m.manufacturer_slug,
      slug: m.slug,
      name: m.name,
      target_fish: m.target_fish,
      missing_fish: m.missing_fish,
      reason: m.reason,
      severity: m.severity,
      description_preview: m.description.substring(0, 100),
    })),
  };
  fs.writeFileSync('/tmp/description-fish-mismatches.json', JSON.stringify(output, null, 2));
  console.log(`\n結果保存: /tmp/description-fish-mismatches.json`);

  // DB書き込み（完全矛盾のみ空化）
  if (!DRY_RUN && completeMismatches.length > 0) {
    console.log(`\n=== description空化実行: ${completeMismatches.length}件（完全矛盾のみ）===`);

    let updated = 0;
    for (const m of completeMismatches) {
      const { error } = await sb
        .from('lures')
        .update({ description: null })
        .eq('manufacturer_slug', m.manufacturer_slug)
        .eq('slug', m.slug);

      if (error) {
        console.error(`  ERROR: ${m.manufacturer_slug}/${m.slug}: ${error.message}`);
      } else {
        updated++;
        console.log(`  空化: ${m.manufacturer_slug}/${m.slug} (target=[${m.target_fish.join(',')}] desc言及=[${m.missing_fish.join(',')}])`);
      }
    }
    console.log(`\n更新完了: ${updated}/${completeMismatches.length}件`);
  } else if (!DRY_RUN) {
    console.log('\n完全矛盾0件のため空化なし');
  }
}

main().catch(console.error);
