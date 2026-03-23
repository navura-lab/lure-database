/**
 * ルールベース全件スキャン — データ品質監査
 *
 * .cache/lures.json を読み込み、5つのルールで矛盾を検出。
 * 結果を data/audit/flagged-lures.json に保存する。
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "../..");
const CACHE_PATH = resolve(ROOT, ".cache/lures.json");
const OUT_DIR = resolve(ROOT, "data/audit");
const OUT_PATH = resolve(OUT_DIR, "flagged-lures.json");

// ── 型 ───────────────────────────────────────────────
interface LureRow {
  slug: string;
  manufacturer_slug: string;
  name: string;
  type: string | null;
  target_fish: string[] | null;
  weight: number | null;
  length: number | null;
  price: number | null;
}

interface Flag {
  slug: string; // "maker/slug"
  name: string;
  rules: string[];
  details: string[];
  target_fish: string[];
  type: string;
  weight: string;
  length: string;
  price: string;
}

// ── メーカー専門領域（ルール3） ───────────────────────
const BASS_MAKERS = new Set([
  "raid", "bottomup", "dstyle", "obasslive", "flash-union",
  "engine", "noike", "reins", "sawamura", "deps", "imakatsu",
  "hideup", "gancraft",
]);
const SALT_MAKERS = new Set([
  "blueblue", "coreman", "jumprize", "apia",
  "pozidrive-garage", "longin",
]);
const TROUT_MAKERS = new Set(["forest", "valkein", "mukai"]);
const LIGHTGAME_MAKERS = new Set(["tict", "thirtyfour", "jazz"]);
const EGI_MAKERS = new Set(["yamashita"]);

// ── 対象魚マッチヘルパー ────────────────────────────
function hasFish(tf: string[], ...keywords: string[]): boolean {
  return tf.some((f) =>
    keywords.some((kw) => f.includes(kw))
  );
}

const isBass = (tf: string[]) => hasFish(tf, "バス", "ブラックバス");
const isSalt = (tf: string[]) =>
  hasFish(tf, "シーバス", "ヒラメ", "マゴチ", "青物", "マダイ", "サワラ",
    "タチウオ", "ヒラマサ", "ブリ", "カンパチ", "マグロ", "GT", "ソルト");
const isMebal = (tf: string[]) => hasFish(tf, "メバル", "ロックフィッシュ", "根魚");
const isAjing = (tf: string[]) => hasFish(tf, "アジ");
const isTrout = (tf: string[]) => hasFish(tf, "トラウト", "サクラマス", "サーモン");

// ── メイン ──────────────────────────────────────────
function main() {
  console.log("📖 .cache/lures.json を読み込み中...");
  const raw: LureRow[] = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  console.log(`  全行数: ${raw.length}`);

  // slug単位でユニーク化（最初の行を代表にする）
  const seen = new Map<string, LureRow>();
  for (const r of raw) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  const lures = [...seen.values()];
  console.log(`  ユニークslug: ${lures.length}`);

  const flags: Flag[] = [];
  const ruleCount: Record<string, number> = {
    rule1: 0, rule2: 0, rule3: 0, rule4: 0, rule5: 0,
  };

  for (const lure of lures) {
    const tf = lure.target_fish ?? [];
    const type = lure.type ?? "";
    const w = lure.weight;
    const l = lure.length;
    const p = lure.price;
    const ms = lure.manufacturer_slug;
    const fullSlug = `${ms}/${lure.slug}`;

    const hitRules: string[] = [];
    const hitDetails: string[] = [];

    // ── ルール1: 重量による検出 ──
    if (w !== null) {
      // バス用ワームなのに100g以上
      if (type === "ワーム" && isBass(tf) && w >= 100) {
        hitRules.push("rule1");
        hitDetails.push(`バス用ワームで重量${w}g（≥100g）`);
      }
      // メバル用なのに50g以上
      if (isMebal(tf) && w >= 50) {
        hitRules.push("rule1");
        hitDetails.push(`メバル用で重量${w}g（≥50g）`);
      }
      // アジング用なのに30g以上
      if (isAjing(tf) && w >= 30) {
        hitRules.push("rule1");
        hitDetails.push(`アジング用で重量${w}g（≥30g）`);
      }
    }

    // ── ルール2: サイズによる検出 ──
    if (l !== null) {
      // トラウト用（エリア）なのに200mm以上
      if (isTrout(tf) && l >= 200) {
        hitRules.push("rule2");
        hitDetails.push(`トラウト用で全長${l}mm（≥200mm）`);
      }
      // アジング用なのに150mm以上
      if (isAjing(tf) && l >= 150) {
        hitRules.push("rule2");
        hitDetails.push(`アジング用で全長${l}mm（≥150mm）`);
      }
    }

    // ── ルール3: メーカー専門領域との矛盾 ──
    if (BASS_MAKERS.has(ms) && isSalt(tf) && !isBass(tf)) {
      hitRules.push("rule3");
      hitDetails.push(`バス専門メーカー(${ms})だがソルト分類`);
    }
    if (SALT_MAKERS.has(ms) && isBass(tf) && !isSalt(tf)) {
      hitRules.push("rule3");
      hitDetails.push(`ソルト専門メーカー(${ms})だがバス分類`);
    }
    if (TROUT_MAKERS.has(ms) && !isTrout(tf) && tf.length > 0) {
      hitRules.push("rule3");
      hitDetails.push(`トラウト専門メーカー(${ms})だが対象魚に${tf.join(",")}`);
    }
    if (LIGHTGAME_MAKERS.has(ms) && isBass(tf) && !isAjing(tf) && !isMebal(tf)) {
      hitRules.push("rule3");
      hitDetails.push(`ライトゲーム専門メーカー(${ms})だがバス分類`);
    }
    if (EGI_MAKERS.has(ms) && type !== "エギ" && type !== "スッテ" && !hasFish(tf, "イカ", "アオリイカ")) {
      hitRules.push("rule3");
      hitDetails.push(`エギ専門メーカー(${ms})だがtype=${type}`);
    }

    // ── ルール4: タイプと対象魚の矛盾 ──
    if (type === "エギ" && isBass(tf)) {
      hitRules.push("rule4");
      hitDetails.push("エギがバス用");
    }
    if (type === "タイラバ" && isBass(tf)) {
      hitRules.push("rule4");
      hitDetails.push("タイラバがバス用");
    }
    if (type === "スピナーベイト" && hasFish(tf, "シーバス") && !isBass(tf)) {
      hitRules.push("rule4");
      hitDetails.push("スピナーベイトがシーバス用（バスなし）");
    }
    if (type === "フロッグ" && hasFish(tf, "シーバス") && !isBass(tf) && !hasFish(tf, "ナマズ", "雷魚")) {
      hitRules.push("rule4");
      hitDetails.push("フロッグがシーバス用");
    }

    // ── ルール5: 価格帯による検出 ──
    if (type === "スプーン" && isTrout(tf) && p !== null && p >= 5000) {
      hitRules.push("rule5");
      hitDetails.push(`トラウトスプーンで価格${p}円（≥5,000円）`);
    }

    // 重複排除（同一ルールが複数条件でヒットした場合）
    const uniqueRules = [...new Set(hitRules)];
    if (uniqueRules.length > 0) {
      for (const r of uniqueRules) ruleCount[r]++;
      flags.push({
        slug: fullSlug,
        name: lure.name,
        rules: uniqueRules,
        details: hitDetails,
        target_fish: tf,
        type: type || "(なし)",
        weight: w !== null ? `${w}g` : "(なし)",
        length: l !== null ? `${l}mm` : "(なし)",
        price: p !== null ? `${p}円` : "(なし)",
      });
    }
  }

  const result = {
    scan_date: new Date().toISOString().slice(0, 10),
    total_scanned: lures.length,
    flagged: flags.length,
    by_rule: ruleCount,
    flags,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), "utf-8");

  console.log("\n=== スキャン結果 ===");
  console.log(`スキャン: ${result.total_scanned} slug`);
  console.log(`フラグ数: ${result.flagged}`);
  console.log(`ルール別:`);
  for (const [k, v] of Object.entries(ruleCount)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\n出力: ${OUT_PATH}`);

  // ルール別の上位サンプルを表示
  for (const rule of ["rule1", "rule2", "rule3", "rule4", "rule5"]) {
    const hits = flags.filter((f) => f.rules.includes(rule));
    if (hits.length > 0) {
      console.log(`\n── ${rule} サンプル（最大5件）──`);
      for (const h of hits.slice(0, 5)) {
        console.log(`  ${h.slug} (${h.name}) — ${h.details.filter(d => d.includes(rule.replace("rule",""))).length > 0 ? h.details.join("; ") : h.details.join("; ")}`);
      }
      if (hits.length > 5) console.log(`  ... 他${hits.length - 5}件`);
    }
  }
}

main();
