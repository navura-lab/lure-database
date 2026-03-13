#!/usr/bin/env npx tsx
/**
 * 優先再インデックス — Low-hanging fruit + CTR改善候補ページ
 *
 * GSC分析で特定したポジション8-20位（Low-hanging fruit）と
 * 高表示・低CTRページを優先的にIndexing APIに再送信する。
 *
 * 施策1-4のリッチ化コンテンツが反映された最新ビルドを
 * Googleに早期クロールさせることで、順位向上・CTR改善を狙う。
 *
 * Usage:
 *   npx tsx scripts/_reindex-priority.ts              # dry-run
 *   npx tsx scripts/_reindex-priority.ts --submit      # 実行
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://castlog.xyz';
const DRY_RUN = !process.argv.includes('--submit');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';

// GSC 2026-03-11/12 データから特定した優先ページ
// Low-hanging fruit（ポジション8-20、コンテンツ改善で1ページ目狙い）
// + CTR改善候補（高ポジション、低CTR）
const PRIORITY_URLS = [
  // === Low-hanging fruit: ルアー詳細ページ ===
  '/littlejack/huggos/',                        // ハグゴス: pos9.6, 57imp
  '/littlejack/gillary-01--01/',                // ギラリー01: pos8.4, 41imp
  '/dstyle/virola-hard_50/',                    // ヴィローラハード50: 14click, pos4
  '/dstyle/virola-hard_60/',                    // ヴィローラハード60: 11click, pos5.2
  '/valkein/raxma-55s/',                        // ラクスマ55S: 5click
  '/jackson/clear-s-popper/',                   // クリアSポッパー: 4click
  '/osp/nichika167f/',                          // ニチカ167F: 2click
  '/ima/sobat-100/',                            // ソバット100: 2click
  '/bassday/hadesu-75f/',                       // ハーデス75F: 2click, pos7.4
  '/attic/usahuwa/',                            // ウサフワ: 2click

  // === CTR改善候補: 高ポジション×低CTR ===
  '/engine/bosogaeru/',                         // 霞の蛙: pos2.0, 0%CTR

  // === Low-hanging fruit: ランキングページ ===
  '/ranking/hiramasa-diving-pencil/',           // ヒラマサDP: 3click
  '/ranking/mebaru-spintail/',                  // メバルスピンテール: 3click, pos2.75
  '/ranking/gt-popper/',                        // GTポッパー: 2click

  // === Low-hanging fruit: 記事・ガイドページ ===
  '/guide/eging-egi-osusume/',                  // エギングエギおすすめ: 3click

  // === メーカーページ（CTR改善候補） ===
  '/drt/',                                      // DRT: 2click
  '/raidjapan/',                                // レイドジャパン: pos3.3, 0%CTR
  '/jado/',                                     // 邪道: pos6.4, 0%CTR

  // === 比較ページ（新FAQ構造化データ付き、再インデックス必要） ===
  '/compare/seabass-minnow/',
  '/compare/seabass-sinking-pencil/',
  '/compare/bass-crankbait/',
  '/compare/bass-worm/',
  '/compare/bluerunner-metal-jig/',

  // === 新記事（第8弾、初回インデックス必要） ===
  '/article/seabass-vibration/',
  '/article/mebaru-worm/',
  '/article/aji-jighead/',
  '/article/rockfish-worm/',
  '/article/bass-bigbait/',
  '/article/tachiuo-metaljig/',
  '/article/hirame-metaljig/',
  '/article/bass-metal-vib/',
  '/article/mebaru-jighead/',
  '/article/seabass-worm/',
];

// ─── Helper ───────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as any;
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

function apiHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'x-goog-user-project': QUOTA_PROJECT,
    'Content-Type': 'application/json',
  };
}

async function main() {
  console.log(`=== 優先再インデックス（${DRY_RUN ? 'DRY RUN' : 'LIVE'}）===`);
  console.log(`対象: ${PRIORITY_URLS.length} URLs\n`);

  if (DRY_RUN) {
    for (const url of PRIORITY_URLS) {
      console.log(`  [DRY] ${SITE_URL}${url}`);
    }
    console.log(`\n→ 実行するには --submit を付けてください`);
    return;
  }

  const token = await getAccessToken();
  let success = 0;
  let failed = 0;

  for (const urlPath of PRIORITY_URLS) {
    const fullUrl = `${SITE_URL}${urlPath}`;
    try {
      const res = await fetch(
        'https://indexing.googleapis.com/v3/urlNotifications:publish',
        {
          method: 'POST',
          headers: apiHeaders(token),
          body: JSON.stringify({ url: fullUrl, type: 'URL_UPDATED' }),
        },
      );
      const data = await res.json() as any;
      if (!res.ok) {
        console.log(`  ❌ ${urlPath} — ${data.error?.message || res.statusText}`);
        failed++;
      } else {
        console.log(`  ✅ ${urlPath}`);
        success++;
      }
    } catch (err: any) {
      console.log(`  ❌ ${urlPath} — ${err.message || 'unknown'}`);
      failed++;
    }
    // レート制限対策: 100ms間隔
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n完了: ✅${success} / ❌${failed} / 計${PRIORITY_URLS.length}`);

  // ログ保存
  const logDir = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `reindex-priority-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    date: new Date().toISOString(),
    total: PRIORITY_URLS.length,
    success,
    failed,
    urls: PRIORITY_URLS.map(u => `${SITE_URL}${u}`),
  }, null, 2));
  console.log(`ログ: ${logFile}`);
}

main().catch(console.error);
