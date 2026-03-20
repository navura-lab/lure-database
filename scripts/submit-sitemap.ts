#!/usr/bin/env npx tsx
/**
 * GSC サイトマップ再送信スクリプト
 *
 * Google Search Console API を使って sitemap-index.xml を再送信する。
 * 個別のサブサイトマップも送信可能。
 *
 * Usage:
 *   npx tsx scripts/submit-sitemap.ts              # sitemap-index.xml を再送信
 *   npx tsx scripts/submit-sitemap.ts --all        # index + 全サブサイトマップを送信
 *   npx tsx scripts/submit-sitemap.ts --status     # 現在のサイトマップ状況を確認
 */

import 'dotenv/config';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = process.env.GSC_SITE_URL || 'https://www.castlog.xyz/';

const SUBMIT_ALL = process.argv.includes('--all');
const STATUS_ONLY = process.argv.includes('--status');

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [submit-sitemap] ${msg}`);
}

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

function headers(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'x-goog-user-project': QUOTA_PROJECT,
    'Content-Type': 'application/json',
  };
}

// サイトマップ一覧を取得
async function listSitemaps(token: string) {
  const encodedSite = encodeURIComponent(SITE_URL);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps`,
    { headers: headers(token) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List sitemaps failed: HTTP ${res.status} ${text}`);
  }
  return await res.json() as any;
}

// サイトマップを送信
async function submitSitemap(token: string, sitemapUrl: string) {
  const encodedSite = encodeURIComponent(SITE_URL);
  const encodedSitemap = encodeURIComponent(sitemapUrl);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedSitemap}`,
    { method: 'PUT', headers: headers(token) },
  );
  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${text}` };
  }
  return { success: true };
}

async function main() {
  log('=== GSC Sitemap Submission ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found in .env');
    process.exit(1);
  }

  const token = await getAccessToken();
  log('Access token obtained');

  // 現在のサイトマップ状況を表示
  log('--- Current Sitemaps in GSC ---');
  try {
    const data = await listSitemaps(token);
    if (data.sitemap && data.sitemap.length > 0) {
      for (const sm of data.sitemap) {
        const submitted = sm.lastSubmitted || 'N/A';
        const warnings = sm.warnings || 0;
        const errors = sm.errors || 0;
        const indexed = sm.contents?.[0]?.indexed || 'N/A';
        const total = sm.contents?.[0]?.submitted || 'N/A';
        log(`  ${sm.path}`);
        log(`    Last submitted: ${submitted}`);
        log(`    URLs: ${total} submitted, ${indexed} indexed`);
        log(`    Warnings: ${warnings}, Errors: ${errors}`);
      }
    } else {
      log('  No sitemaps registered');
    }
  } catch (e: any) {
    log(`  Failed to list sitemaps: ${e.message}`);
  }

  if (STATUS_ONLY) {
    log('=== Done (status only) ===');
    return;
  }

  // サイトマップを送信
  const sitemaps: string[] = [
    `${SITE_URL}sitemap-index.xml`,
  ];

  if (SUBMIT_ALL) {
    sitemaps.push(
      `${SITE_URL}sitemap-0.xml`,
      `${SITE_URL}sitemap-1.xml`,
      `${SITE_URL}sitemap-2.xml`,
      `${SITE_URL}sitemap-3.xml`,
    );
  }

  log('');
  log(`--- Submitting ${sitemaps.length} sitemap(s) ---`);

  for (const sm of sitemaps) {
    process.stdout.write(`  ${sm} ... `);
    const result = await submitSitemap(token, sm);
    if (result.success) {
      console.log('OK');
    } else {
      console.log(`FAILED: ${result.error}`);
    }
  }

  log('');
  log('=== Sitemap Submission Complete ===');
  log('GSCに反映されるまで数分〜数時間かかる場合があります。');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
