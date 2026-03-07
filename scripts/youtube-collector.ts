#!/usr/bin/env npx tsx
/**
 * YouTube動画収集スクリプト
 *
 * ルアー名でYouTube検索し、上位動画の情報を収集してDBに保存する。
 * SEO Opportunity Finderの結果を参照し、高スコアのルアーから優先的に処理。
 *
 * 前提: YouTube Data API v3 を有効化し、APIキーを .env に設定
 *   YOUTUBE_API_KEY=AIza...
 *
 * Google Cloud Console で有効化:
 *   1. https://console.cloud.google.com/apis/library/youtube.googleapis.com
 *   2. 「有効にする」をクリック
 *   3. 認証情報 → APIキーを作成
 *
 * Usage:
 *   npx tsx scripts/youtube-collector.ts --dry-run             # 対象ルアー一覧表示
 *   npx tsx scripts/youtube-collector.ts --limit 50            # 上位50ルアーの動画を収集
 *   npx tsx scripts/youtube-collector.ts --maker daiwa         # 特定メーカーのみ
 *   npx tsx scripts/youtube-collector.ts --lure ハグゴス        # 特定ルアーのみ
 *   npx tsx scripts/youtube-collector.ts --verbose             # 詳細出力
 *
 * クォータ: 10,000ユニット/日、検索1回=100ユニット+詳細5ユニット = ~95ルアー/日
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ─── Config ───────────────────────────────────────────

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'youtube-data');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 50 : 50;
})();
const MAKER_FILTER = (() => {
  const idx = process.argv.indexOf('--maker');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const LURE_FILTER = (() => {
  const idx = process.argv.indexOf('--lure');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const VIDEOS_PER_LURE = 5;

// ─── Helper ───────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function todayStr() { return new Date().toISOString().split('T')[0]; }

// ─── YouTube API ──────────────────────────────────────

interface YouTubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount?: number;
  likeCount?: number;
  duration?: string;
}

interface LureVideos {
  lureName: string;
  slug: string;
  manufacturerSlug: string;
  searchQuery: string;
  videos: YouTubeVideo[];
  collectedAt: string;
}

async function searchYouTube(query: string): Promise<YouTubeVideo[]> {
  if (!YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY not set in .env');

  // Step 1: 検索（100ユニット）
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', String(VIDEOS_PER_LURE));
  searchUrl.searchParams.set('order', 'relevance');
  searchUrl.searchParams.set('relevanceLanguage', 'ja');
  searchUrl.searchParams.set('regionCode', 'JP');
  searchUrl.searchParams.set('key', YOUTUBE_API_KEY);

  const searchRes = await fetch(searchUrl.toString());
  const searchData = await searchRes.json() as any;

  if (searchData.error) {
    throw new Error(`YouTube API error: ${JSON.stringify(searchData.error)}`);
  }

  const items = searchData.items || [];
  if (items.length === 0) return [];

  const videos: YouTubeVideo[] = items.map((item: any) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    publishedAt: item.snippet.publishedAt,
    thumbnailUrl: item.snippet.thumbnails?.medium?.url || '',
  }));

  // Step 2: 動画詳細（viewCount等）を取得（1ユニット×N）
  const videoIds = videos.map(v => v.videoId).join(',');
  const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  detailUrl.searchParams.set('part', 'statistics,contentDetails');
  detailUrl.searchParams.set('id', videoIds);
  detailUrl.searchParams.set('key', YOUTUBE_API_KEY);

  const detailRes = await fetch(detailUrl.toString());
  const detailData = await detailRes.json() as any;

  if (detailData.items) {
    for (const detail of detailData.items) {
      const video = videos.find(v => v.videoId === detail.id);
      if (video) {
        video.viewCount = parseInt(detail.statistics?.viewCount || '0', 10);
        video.likeCount = parseInt(detail.statistics?.likeCount || '0', 10);
        video.duration = detail.contentDetails?.duration || '';
      }
    }
  }

  return videos;
}

// ─── Supabase: ルアー取得 ─────────────────────────────

interface LureTarget {
  name: string;
  slug: string;
  manufacturer_slug: string;
}

async function fetchLureTargets(): Promise<LureTarget[]> {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  const seen = new Map<string, LureTarget>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = sb.from('lures').select('name, slug, manufacturer_slug').range(from, from + pageSize - 1);

    if (MAKER_FILTER) {
      query = query.eq('manufacturer_slug', MAKER_FILTER);
    }

    const { data, error } = await query;
    if (error) { log(`Supabase error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (!r.slug || !r.manufacturer_slug || !r.name) continue;
      const key = `${r.manufacturer_slug}/${r.slug}`;
      if (!seen.has(key)) {
        seen.set(key, {
          name: r.name,
          slug: r.slug,
          manufacturer_slug: r.manufacturer_slug,
        });
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return [...seen.values()];
}

// ─── 優先順位（opportunity scoreベース） ──────────────

function prioritizeLures(lures: LureTarget[]): LureTarget[] {
  // SEO opportunity finderの結果があれば参照
  const today = todayStr();
  const oppFile = path.join(import.meta.dirname, '..', 'logs', 'seo-data', `opportunities-${today}.json`);

  let oppScores = new Map<string, number>();
  if (fs.existsSync(oppFile)) {
    try {
      const oppData = JSON.parse(fs.readFileSync(oppFile, 'utf8'));
      for (const lure of oppData.topLures || []) {
        const key = `${lure.manufacturerSlug}/${lure.slug}`;
        oppScores.set(key, lure.overallScore || 0);
      }
      logV(`SEO opportunity scores loaded: ${oppScores.size} ルアー`);
    } catch {
      logV('SEO opportunity file found but could not parse');
    }
  }

  // スコア順にソート（スコアなしは末尾）
  return lures.sort((a, b) => {
    const scoreA = oppScores.get(`${a.manufacturer_slug}/${a.slug}`) || 0;
    const scoreB = oppScores.get(`${b.manufacturer_slug}/${b.slug}`) || 0;
    return scoreB - scoreA;
  });
}

// ─── 既に収集済みかチェック ───────────────────────────

function loadExistingData(): Map<string, LureVideos> {
  const existing = new Map<string, LureVideos>();
  if (!fs.existsSync(DATA_DIR)) return existing;

  for (const file of fs.readdirSync(DATA_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.slug && entry.manufacturerSlug) {
            existing.set(`${entry.manufacturerSlug}/${entry.slug}`, entry);
          }
        }
      }
    } catch { /* skip */ }
  }

  return existing;
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== YouTube Video Collector ===');

  if (!YOUTUBE_API_KEY) {
    console.error('\n❌ YOUTUBE_API_KEY が .env に設定されていません。');
    console.error('\n設定手順:');
    console.error('  1. https://console.cloud.google.com/apis/library/youtube.googleapis.com');
    console.error('  2. 「YouTube Data API v3」を有効にする');
    console.error('  3. 認証情報 → APIキーを作成');
    console.error('  4. .env に YOUTUBE_API_KEY=AIza... を追加');
    if (!DRY_RUN) process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ルアー取得
  log('ルアーシリーズ取得中...');
  let lures = await fetchLureTargets();

  // 特定ルアーフィルタ
  if (LURE_FILTER) {
    lures = lures.filter(l => l.name.includes(LURE_FILTER));
  }

  log(`  対象ルアー: ${lures.length} シリーズ`);

  // 優先順位付け
  lures = prioritizeLures(lures);

  // 既存データ確認
  const existing = loadExistingData();
  const uncollected = lures.filter(l => !existing.has(`${l.manufacturer_slug}/${l.slug}`));
  log(`  未収集: ${uncollected.length} / 収集済み: ${existing.size}`);

  // 対象を絞る
  const targets = uncollected.slice(0, LIMIT);
  log(`  今回の処理対象: ${targets.length} ルアー`);

  if (DRY_RUN) {
    console.log('\n── 処理対象ルアー（dry-run） ──');
    targets.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.name} (${l.manufacturer_slug})`);
    });
    console.log(`\nクォータ消費予定: ${targets.length * 105} ユニット / 10,000`);
    return;
  }

  if (!YOUTUBE_API_KEY) {
    log('dry-runモードでなく、APIキーもないため終了');
    return;
  }

  // 収集実行
  const results: LureVideos[] = [];
  let unitCount = 0;
  let errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const lure = targets[i];
    const searchQuery = `${lure.name} ルアー`;

    try {
      log(`[${i + 1}/${targets.length}] 検索: 「${searchQuery}」`);
      const videos = await searchYouTube(searchQuery);
      unitCount += 105; // 検索100 + 詳細5

      const entry: LureVideos = {
        lureName: lure.name,
        slug: lure.slug,
        manufacturerSlug: lure.manufacturer_slug,
        searchQuery,
        videos,
        collectedAt: new Date().toISOString(),
      };
      results.push(entry);

      logV(`  → ${videos.length}件の動画取得`);
      if (VERBOSE && videos.length > 0) {
        videos.forEach(v => {
          logV(`    📹 ${v.title} (${v.channelTitle}) - ${v.viewCount?.toLocaleString() || '?'}回再生`);
        });
      }

      // レート制限対策（1秒待機）
      await sleep(1000);

    } catch (e: any) {
      errors++;
      log(`  ❌ エラー: ${e.message}`);

      // クォータ超過なら即終了
      if (e.message.includes('quotaExceeded') || e.message.includes('rateLimitExceeded')) {
        log('⚠️ APIクォータ超過。明日再実行してください。');
        break;
      }

      await sleep(2000);
    }
  }

  // 結果を保存
  const today = todayStr();
  const outputPath = path.join(DATA_DIR, `youtube-${today}.json`);

  // 既存の当日データがあればマージ
  let allResults = results;
  if (fs.existsSync(outputPath)) {
    const existingToday = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    if (Array.isArray(existingToday)) {
      // 重複排除
      const newKeys = new Set(results.map(r => `${r.manufacturerSlug}/${r.slug}`));
      const merged = existingToday.filter((r: any) => !newKeys.has(`${r.manufacturerSlug}/${r.slug}`));
      allResults = [...merged, ...results];
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));

  // サマリー
  console.log('\n' + '='.repeat(50));
  console.log('YOUTUBE COLLECTION SUMMARY');
  console.log('='.repeat(50));
  console.log(`処理: ${results.length} ルアー`);
  console.log(`取得動画数: ${results.reduce((s, r) => s + r.videos.length, 0)}`);
  console.log(`エラー: ${errors}`);
  console.log(`APIクォータ消費: ~${unitCount} / 10,000 ユニット`);
  console.log(`出力: ${outputPath}`);

  // 人気動画トップ10
  const allVideos = results.flatMap(r => r.videos.map(v => ({ ...v, lureName: r.lureName })));
  const topVideos = allVideos
    .filter(v => v.viewCount != null)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
    .slice(0, 10);

  if (topVideos.length > 0) {
    console.log('\n── 人気動画 Top 10 ──');
    topVideos.forEach((v, i) => {
      console.log(`  ${i + 1}. 「${v.title}」 (${v.lureName})`);
      console.log(`     ${v.channelTitle} - ${v.viewCount?.toLocaleString()}回再生`);
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
