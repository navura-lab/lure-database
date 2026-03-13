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
import { google } from 'googleapis';

const SITE_URL = 'https://www.lure-db.com';
const DRY_RUN = !process.argv.includes('--submit');

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

  // Google Auth
  const keyPath = path.join(import.meta.dirname, '..', 'config', 'service-account.json');
  if (!fs.existsSync(keyPath)) {
    console.error(`❌ サービスアカウントキーが見つかりません: ${keyPath}`);
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });
  const client = await auth.getClient();
  const indexing = google.indexing({ version: 'v3', auth: client as any });

  let success = 0;
  let failed = 0;

  for (const urlPath of PRIORITY_URLS) {
    const fullUrl = `${SITE_URL}${urlPath}`;
    try {
      await indexing.urlNotifications.publish({
        requestBody: { url: fullUrl, type: 'URL_UPDATED' },
      });
      console.log(`  ✅ ${urlPath}`);
      success++;
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message || err.message || 'unknown';
      console.log(`  ❌ ${urlPath} — ${msg}`);
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
