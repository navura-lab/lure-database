#!/usr/bin/env npx tsx
/**
 * 品質スコアリングエンジン
 *
 * 全ルアーページに 0-100 のスコアを付与し、SQLite + JSON に保存。
 * テンプレートは生成されたJSONを読んで noindex 判定の上書きに使う。
 *
 * スコア指標（合計100点）:
 *   - description品質       (10点) - null/英語/短すぎ
 *   - エディトリアル品質    (15点) - 旧フォーマット/欠落
 *   - 画像の質              (10点) - no-image比率
 *   - 内部リンク被数        (10点) - 同タイプ・同メーカーから被リンク
 *   - GSC 30日実績          (15点) - imp/click
 *   - GA4 30日実績          (10点) - PV
 *   - スペック充実度        (10点) - color_count, price
 *   - 分類完備              (10点) - type, target_fish
 *   - 直帰率                (10点) - GA4 bounce_rate
 *
 * バンド分け:
 *   - score >= 70: ok      (何もしない)
 *   - 50-69      : improve (改善キュー)
 *   - 30-49      : noindex (Googleから除外)
 *   - < 30       : delete  (削除候補、承認待ち)
 *
 * Usage:
 *   npx tsx scripts/quality-score.ts                # 全件スコアリング
 *   npx tsx scripts/quality-score.ts --dry-run      # SQLite/JSON書き込みなし
 *   npx tsx scripts/quality-score.ts --limit 100    # 100件のみ
 *   npx tsx scripts/quality-score.ts --verbose      # 詳細ログ
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
// Node.js v22+ ビルトイン SQLite（experimental）
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';

// ─── Config ───────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'ops', 'db', 'agents.db');
const OVERRIDES_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'seo', 'quality-overrides.json');
const REPORT_DIR = path.join(PROJECT_ROOT, 'logs', 'quality');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit'));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1] || process.argv[process.argv.indexOf(LIMIT_ARG) + 1] || '0') : 0;

const TODAY = new Date().toISOString().slice(0, 10);

// ─── Types ────────────────────────────────────────────

interface LureRow {
  manufacturer_slug: string;
  slug: string;
  manufacturer: string;
  name: string;
  description: string | null;
  type: string | null;
  target_fish: string[] | null;
  color_count: number | null;
  price_range: { min: number; max: number } | null;
  has_image: boolean;
}

interface ScoreBreakdown {
  description: number;
  editorial: number;
  images: number;
  internal_links: number;
  gsc: number;
  ga4: number;
  specs: number;
  classification: number;
  bounce: number;
  reasons: string[];
}

interface QualityScore {
  manufacturer_slug: string;
  slug: string;
  name: string;
  total: number;
  band: 'ok' | 'improve' | 'noindex' | 'delete';
  breakdown: ScoreBreakdown;
}

// ─── Helpers ──────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [quality-score] ${msg}`);
}

function vlog(msg: string) {
  if (VERBOSE) log(msg);
}

function isEnglishOnly(text: string): boolean {
  return !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
}

function bandFromScore(score: number): 'ok' | 'improve' | 'noindex' | 'delete' {
  if (score >= 70) return 'ok';
  if (score >= 50) return 'improve';
  if (score >= 30) return 'noindex';
  return 'delete';
}

// ─── データ収集 ───────────────────────────────────────

/**
 * lures テーブルは「ルアー × カラー × ウェイト」単位の行構造のため、
 * slug 単位で集約してシリーズ単位の品質情報を作る
 */
async function fetchAllLures(supabase: any): Promise<Map<string, LureRow>> {
  // 集約用の中間データ
  type Aggregator = {
    manufacturer_slug: string;
    slug: string;
    manufacturer: string;
    name: string;
    description: string | null;
    type: string | null;
    target_fish: string[] | null;
    colors: Set<string>;
    prices: number[];
    hasAnyImage: boolean;
  };
  const aggMap = new Map<string, Aggregator>();
  let offset = 0;
  const step = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('lures')
      .select('manufacturer_slug, slug, manufacturer, name, description, type, target_fish, color_name, price, images')
      .range(offset, offset + step - 1);
    if (error) throw new Error(`Supabase error: ${JSON.stringify(error)}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const key = `${r.manufacturer_slug}/${r.slug}`;
      if (!aggMap.has(key)) {
        aggMap.set(key, {
          manufacturer_slug: r.manufacturer_slug,
          slug: r.slug,
          manufacturer: r.manufacturer,
          name: r.name,
          description: r.description,
          type: r.type,
          target_fish: r.target_fish,
          colors: new Set(),
          prices: [],
          hasAnyImage: false,
        });
      }
      const agg = aggMap.get(key)!;
      if (r.color_name) agg.colors.add(r.color_name);
      if (typeof r.price === 'number' && r.price > 0) agg.prices.push(r.price);
      if (Array.isArray(r.images) && r.images.length > 0) agg.hasAnyImage = true;
    }
    if (data.length < step) break;
    offset += step;
  }

  // 集約 → LureRow
  const lureMap = new Map<string, LureRow>();
  for (const [key, agg] of aggMap) {
    lureMap.set(key, {
      manufacturer_slug: agg.manufacturer_slug,
      slug: agg.slug,
      manufacturer: agg.manufacturer,
      name: agg.name,
      description: agg.description,
      type: agg.type,
      target_fish: agg.target_fish,
      color_count: agg.colors.size,
      price_range: agg.prices.length > 0
        ? { min: Math.min(...agg.prices), max: Math.max(...agg.prices) }
        : null,
      has_image: agg.hasAnyImage,
    });
  }
  return lureMap;
}

function loadEditorialIndex(): Set<string> {
  // 新フォーマット完備のスラグ集合（slugベース）
  const dir = path.join(PROJECT_ROOT, 'src', 'data', 'seo', 'editorials');
  if (!fs.existsSync(dir)) return new Set();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.startsWith('_'));
  const completeSet = new Set<string>();
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const hasOverview = /\boverview\s*:/.test(content);
    const hasFaq = /\bfaq\s*:/.test(content);
    const hasStrengths = /\bstrengths\s*:/.test(content);
    const hasUsage = /\busage\s*:/.test(content);
    if (hasOverview && hasFaq && hasStrengths && hasUsage) {
      completeSet.add(f.replace('.ts', ''));
    }
  }
  return completeSet;
}

function loadGscData(): Map<string, { imp: number; click: number }> {
  // logs/seo-data/rankings/*.json から page→{imp,click} を集計
  const dir = path.join(PROJECT_ROOT, 'logs', 'seo-data', 'rankings');
  const map = new Map<string, { imp: number; click: number }>();
  if (!fs.existsSync(dir)) return map;

  // 過去30日分
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'trends.json') continue;
    const filePath = path.join(dir, f);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) continue;

    try {
      const j = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const r of (j.rankings || [])) {
        if (!r.page) continue;
        // /manufacturer/slug/ → manufacturer/slug
        const key = r.page.replace(/^\/|\/$/g, '');
        const cur = map.get(key) || { imp: 0, click: 0 };
        cur.imp += r.impressions || 0;
        cur.click += r.clicks || 0;
        map.set(key, cur);
      }
    } catch (e) {
      vlog(`GSC parse error for ${f}: ${e}`);
    }
  }
  return map;
}

function loadGa4Data(): Map<string, { pv: number; users: number; bounce: number }> {
  const dir = path.join(PROJECT_ROOT, 'logs', 'ga4-data');
  const map = new Map<string, { pv: number; users: number; bounce: number }>();
  if (!fs.existsSync(dir)) return map;

  // 最新のga4-*.jsonからtopPagesを取得
  const files = fs.readdirSync(dir).filter(f => f.startsWith('ga4-') && f.endsWith('.json')).sort().reverse();
  if (files.length === 0) return map;

  // 直近7日分のtopPagesを集計
  for (const f of files.slice(0, 7)) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const p of (j.topPages || [])) {
        if (!p.path) continue;
        const key = p.path.replace(/^\/|\/$/g, '');
        const cur = map.get(key) || { pv: 0, users: 0, bounce: 0 };
        cur.pv += p.pageviews || 0;
        cur.users += p.users || 0;
        // bounceRateは平均化が難しいのでskip（top全体集計値で代用）
        map.set(key, cur);
      }
    } catch (e) {
      vlog(`GA4 parse error for ${f}: ${e}`);
    }
  }
  return map;
}

// ─── スコアリング ─────────────────────────────────────

function scoreLure(
  lure: LureRow,
  editorials: Set<string>,
  gscMap: Map<string, { imp: number; click: number }>,
  ga4Map: Map<string, { pv: number; users: number; bounce: number }>,
  internalLinkCount: number,
): ScoreBreakdown {
  const reasons: string[] = [];
  const key = `${lure.manufacturer_slug}/${lure.slug}`;

  // 1. description品質 (10点)
  let s_description = 10;
  if (!lure.description) {
    s_description = 0;
    reasons.push('description: NULL');
  } else if (lure.description.length < 30) {
    s_description = 2;
    reasons.push(`description: 短すぎ(${lure.description.length}字)`);
  } else if (lure.description.length < 80) {
    s_description = 5;
    reasons.push(`description: やや短い(${lure.description.length}字)`);
  } else if (isEnglishOnly(lure.description)) {
    s_description = 3;
    reasons.push('description: 英語のみ');
  }

  // 2. エディトリアル品質 (15点)
  let s_editorial = 0;
  if (editorials.has(lure.slug)) {
    s_editorial = 15;
  } else {
    // 旧フォーマット or なし
    const dir = path.join(PROJECT_ROOT, 'src', 'data', 'seo', 'editorials');
    if (fs.existsSync(path.join(dir, `${lure.slug}.ts`))) {
      s_editorial = 5;
      reasons.push('editorial: 旧フォーマット');
    } else {
      s_editorial = 0;
      reasons.push('editorial: なし');
    }
  }

  // 3. 画像の質 (10点)
  let s_images = lure.has_image ? 10 : 0;
  if (!lure.has_image) reasons.push('image: なし');

  // 4. 内部リンク被数 (10点)
  let s_internal_links = 10;
  if (internalLinkCount === 0) {
    s_internal_links = 0;
    reasons.push('internal_links: 0');
  } else if (internalLinkCount < 3) {
    s_internal_links = 5;
  }

  // 5. GSC 30日実績 (15点)
  let s_gsc = 0;
  const gsc = gscMap.get(key);
  if (gsc) {
    if (gsc.click >= 5) s_gsc = 15;
    else if (gsc.click >= 1) s_gsc = 12;
    else if (gsc.imp >= 30) s_gsc = 10;
    else if (gsc.imp >= 10) s_gsc = 6;
    else if (gsc.imp > 0) s_gsc = 3;
    else { s_gsc = 0; reasons.push('gsc: imp=0'); }
  } else {
    reasons.push('gsc: データなし');
  }

  // 6. GA4 30日実績 (10点)
  let s_ga4 = 0;
  const ga4 = ga4Map.get(key);
  if (ga4) {
    if (ga4.pv >= 10) s_ga4 = 10;
    else if (ga4.pv >= 3) s_ga4 = 7;
    else if (ga4.pv >= 1) s_ga4 = 4;
    else { s_ga4 = 0; reasons.push('ga4: pv=0'); }
  } else {
    // データなしは中立スコア（GA4は計測サンプル少のため）
    s_ga4 = 5;
  }

  // 7. スペック充実度 (10点)
  let s_specs = 0;
  if ((lure.color_count || 0) >= 3 && lure.price_range) s_specs = 10;
  else if ((lure.color_count || 0) >= 2) s_specs = 6;
  else if ((lure.color_count || 0) >= 1) s_specs = 3;
  else { s_specs = 0; reasons.push('specs: カラー0'); }
  if (!lure.price_range) {
    s_specs = Math.max(0, s_specs - 3);
    reasons.push('specs: 価格不明');
  }

  // 8. 分類完備 (10点)
  let s_classification = 0;
  if (lure.type && lure.type !== 'その他' && (lure.target_fish || []).length > 0) s_classification = 10;
  else if (lure.type) s_classification = 5;
  else { s_classification = 0; reasons.push('classification: type未設定'); }

  // 9. 直帰率 (10点) — GA4データがあれば、なければ中立
  let s_bounce = 5;
  // 直帰率は個別ページ単位で取得困難なのでpv実績で代用
  if (ga4 && ga4.pv >= 5) s_bounce = 10;

  return {
    description: s_description,
    editorial: s_editorial,
    images: s_images,
    internal_links: s_internal_links,
    gsc: s_gsc,
    ga4: s_ga4,
    specs: s_specs,
    classification: s_classification,
    bounce: s_bounce,
    reasons,
  };
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log(`=== Quality Score Engine ===`);
  log(`DRY_RUN=${DRY_RUN} VERBOSE=${VERBOSE} LIMIT=${LIMIT || 'all'}`);

  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. データ収集
  log('Fetching all lures from Supabase...');
  const lureMap = await fetchAllLures(sb);
  log(`Total lures: ${lureMap.size}`);

  log('Loading editorials index...');
  const editorials = loadEditorialIndex();
  log(`Editorials with complete format: ${editorials.size}`);

  log('Loading GSC ranking data...');
  const gscMap = loadGscData();
  log(`GSC pages with data: ${gscMap.size}`);

  log('Loading GA4 page data...');
  const ga4Map = loadGa4Data();
  log(`GA4 pages with data: ${ga4Map.size}`);

  // 2. スコアリング
  log('Scoring all lures...');
  const scores: QualityScore[] = [];
  let i = 0;
  for (const [key, lure] of lureMap) {
    if (LIMIT && i >= LIMIT) break;
    i++;

    // 内部リンク被数（簡易: GSCに登場しているか + has_image だけで代用、本格実装は別途）
    const internalLinkCount = gscMap.has(key) ? 5 : (editorials.has(lure.slug) ? 3 : 1);

    const breakdown = scoreLure(lure, editorials, gscMap, ga4Map, internalLinkCount);
    const total =
      breakdown.description +
      breakdown.editorial +
      breakdown.images +
      breakdown.internal_links +
      breakdown.gsc +
      breakdown.ga4 +
      breakdown.specs +
      breakdown.classification +
      breakdown.bounce;
    const band = bandFromScore(total);

    scores.push({
      manufacturer_slug: lure.manufacturer_slug,
      slug: lure.slug,
      name: lure.name,
      total,
      band,
      breakdown,
    });

    if (i % 1000 === 0) log(`Scored ${i}/${lureMap.size}`);
  }
  log(`Scoring complete. Total: ${scores.length}`);

  // 3. バンド集計
  const bandCount = { ok: 0, improve: 0, noindex: 0, delete: 0 };
  for (const s of scores) bandCount[s.band]++;
  log(`バンド分布: ok=${bandCount.ok} improve=${bandCount.improve} noindex=${bandCount.noindex} delete=${bandCount.delete}`);

  // スコア分布
  const buckets = { '90-100': 0, '70-89': 0, '50-69': 0, '30-49': 0, '0-29': 0 };
  for (const s of scores) {
    if (s.total >= 90) buckets['90-100']++;
    else if (s.total >= 70) buckets['70-89']++;
    else if (s.total >= 50) buckets['50-69']++;
    else if (s.total >= 30) buckets['30-49']++;
    else buckets['0-29']++;
  }
  log(`スコア分布: ${JSON.stringify(buckets)}`);

  if (DRY_RUN) {
    log('DRY_RUN: SQLite/JSON書き込みスキップ');
    // 低スコアサンプル
    const lowScores = scores.filter(s => s.band !== 'ok').sort((a, b) => a.total - b.total).slice(0, 10);
    log('低スコアサンプル:');
    for (const s of lowScores) {
      log(`  ${s.total} [${s.band}] ${s.manufacturer_slug}/${s.slug} | ${s.name} | ${s.breakdown.reasons.slice(0, 3).join(', ')}`);
    }
    return;
  }

  // 4. SQLite書き込み（node:sqlite ビルトイン版）
  log('Writing to SQLite...');
  const db = new DatabaseSync(DB_PATH);
  db.exec('BEGIN');
  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO quality_scores
      (date, manufacturer_slug, slug, score, band,
       s_description, s_editorial, s_images, s_internal_links,
       s_gsc, s_ga4, s_specs, s_classification, s_bounce, reasons)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of scores) {
      insert.run(
        TODAY,
        s.manufacturer_slug,
        s.slug,
        s.total,
        s.band,
        s.breakdown.description,
        s.breakdown.editorial,
        s.breakdown.images,
        s.breakdown.internal_links,
        s.breakdown.gsc,
        s.breakdown.ga4,
        s.breakdown.specs,
        s.breakdown.classification,
        s.breakdown.bounce,
        s.breakdown.reasons.join('|'),
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  db.close();
  log('SQLite write complete');

  // 5. JSON書き込み（テンプレートが読む）
  log('Writing quality-overrides.json...');
  fs.mkdirSync(path.dirname(OVERRIDES_JSON), { recursive: true });
  const overrideMap: Record<string, { score: number; band: string; noindex: boolean }> = {};
  for (const s of scores) {
    overrideMap[`${s.manufacturer_slug}/${s.slug}`] = {
      score: s.total,
      band: s.band,
      noindex: s.band === 'noindex' || s.band === 'delete',
    };
  }
  fs.writeFileSync(OVERRIDES_JSON, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: scores.length,
    bands: bandCount,
    overrides: overrideMap,
  }, null, 2));
  log(`Wrote ${OVERRIDES_JSON}`);

  // 6. レポート生成
  log('Generating report...');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `quality-${TODAY}.md`);
  const lines: string[] = [];
  lines.push(`# 品質スコアレポート ${TODAY}`);
  lines.push('');
  lines.push(`生成: ${new Date().toISOString()}`);
  lines.push(`総ページ数: ${scores.length}`);
  lines.push('');
  lines.push('## バンド分布');
  lines.push('');
  lines.push('| バンド | 件数 | 比率 | 対処 |');
  lines.push('|---|---:|---:|---|');
  lines.push(`| ok (≥70) | ${bandCount.ok} | ${(bandCount.ok / scores.length * 100).toFixed(1)}% | 何もしない |`);
  lines.push(`| improve (50-69) | ${bandCount.improve} | ${(bandCount.improve / scores.length * 100).toFixed(1)}% | 自動改善キュー |`);
  lines.push(`| noindex (30-49) | ${bandCount.noindex} | ${(bandCount.noindex / scores.length * 100).toFixed(1)}% | 自動noindex |`);
  lines.push(`| delete (<30) | ${bandCount.delete} | ${(bandCount.delete / scores.length * 100).toFixed(1)}% | 削除候補(承認待ち) |`);
  lines.push('');
  lines.push('## スコア分布');
  lines.push('');
  lines.push('| 帯 | 件数 |');
  lines.push('|---|---:|');
  for (const [band, count] of Object.entries(buckets)) {
    lines.push(`| ${band} | ${count} |`);
  }
  lines.push('');
  lines.push('## 削除候補TOP20（要確認）');
  lines.push('');
  const deleteCand = scores.filter(s => s.band === 'delete').sort((a, b) => a.total - b.total).slice(0, 20);
  if (deleteCand.length === 0) {
    lines.push('_削除候補なし_');
  } else {
    lines.push('| score | ページ | 名前 | 主な問題 |');
    lines.push('|---:|---|---|---|');
    for (const s of deleteCand) {
      lines.push(`| ${s.total} | \`${s.manufacturer_slug}/${s.slug}\` | ${s.name} | ${s.breakdown.reasons.slice(0, 3).join(', ')} |`);
    }
  }
  lines.push('');
  lines.push('## noindex候補TOP20');
  lines.push('');
  const noindexCand = scores.filter(s => s.band === 'noindex').sort((a, b) => a.total - b.total).slice(0, 20);
  if (noindexCand.length === 0) {
    lines.push('_noindex候補なし_');
  } else {
    lines.push('| score | ページ | 名前 | 主な問題 |');
    lines.push('|---:|---|---|---|');
    for (const s of noindexCand) {
      lines.push(`| ${s.total} | \`${s.manufacturer_slug}/${s.slug}\` | ${s.name} | ${s.breakdown.reasons.slice(0, 3).join(', ')} |`);
    }
  }
  lines.push('');
  lines.push('## 改善キューTOP20');
  lines.push('');
  const improveCand = scores.filter(s => s.band === 'improve').sort((a, b) => a.total - b.total).slice(0, 20);
  if (improveCand.length === 0) {
    lines.push('_improve候補なし_');
  } else {
    lines.push('| score | ページ | 名前 | 主な問題 |');
    lines.push('|---:|---|---|---|');
    for (const s of improveCand) {
      lines.push(`| ${s.total} | \`${s.manufacturer_slug}/${s.slug}\` | ${s.name} | ${s.breakdown.reasons.slice(0, 3).join(', ')} |`);
    }
  }
  fs.writeFileSync(reportPath, lines.join('\n'));
  log(`Report saved: ${reportPath}`);
  log('=== Complete ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
