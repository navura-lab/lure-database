/**
 * インデックスされていないメーカーページをIndexing APIに再送信
 * コンテンツ改善後に再クロールをリクエスト
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const SITE = 'https://castlog.xyz';

// OAuth2 access token 取得
async function getAccessToken(): Promise<string> {
  const creds = JSON.parse(readFileSync('/Users/user/ウェブサイト/lure-database/google-indexing-credentials.json', 'utf-8'));
  const refreshToken = process.env.GOOGLE_INDEXING_REFRESH_TOKEN;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.installed.client_id,
      client_secret: creds.installed.client_secret,
      refresh_token: refreshToken!,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// 未インデックスのメーカーページURL一覧
const unindexedMakers = [
  '/apia/', '/beat/', '/blueblue/', '/boreas/', '/bottomup/',
  '/coreman/', '/d-claw/', '/daiwa/', '/dstyle/', '/duel/',
  '/duo/', '/ecogear/', '/evergreen/', '/gancraft/', '/gary-yamamoto/',
  '/geecrack/', '/hmkl/', '/ima/', '/imakatsu/', '/issei/',
  '/jackall/', '/jackson/', '/keitech/', '/luckycraft/', '/majorcraft/',
  '/megabass/', '/mukai/', '/nature-boys/', '/nories/', '/north-craft/',
  '/pazdesign/', '/rapala/',
  // Unknown to Google
  '/carpenter/', '/fisharrow/', '/hots/', '/reins/',
  // Not checked (remaining 20 from inspection)
  '/sawamura/', '/seafloor-control/', '/shimano/', '/smith/',
  '/tacklehouse/', '/thirtyfour/', '/tict/', '/tiemco/',
  '/valleyhill/', '/yamashita/', '/xesta/', '/zeake/',
  '/zipbaits/',
];

async function main() {
  const isDryRun = !process.argv.includes('--submit');

  console.log(`=== Re-submit unindexed maker pages ===`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'SUBMIT'}`);
  console.log(`Pages to submit: ${unindexedMakers.length}`);

  if (isDryRun) {
    for (const path of unindexedMakers) {
      console.log(`  ${SITE}${path}`);
    }
    console.log(`\nRun with --submit to actually send to Indexing API`);
    return;
  }

  const token = await getAccessToken();
  console.log(`Access token obtained`);

  let success = 0;
  let failed = 0;
  let consecutiveQuotaErrors = 0;

  for (let i = 0; i < unindexedMakers.length; i++) {
    const url = `${SITE}${unindexedMakers[i]}`;
    try {
      const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      });

      const data = await res.json() as any;

      if (res.ok) {
        console.log(`  [${i+1}/${unindexedMakers.length}] ${unindexedMakers[i]} ... ✅`);
        success++;
        consecutiveQuotaErrors = 0;
      } else {
        const errMsg = data?.error?.message || 'Unknown error';
        console.log(`  [${i+1}/${unindexedMakers.length}] ${unindexedMakers[i]} ... ❌ ${errMsg}`);
        failed++;

        if (errMsg.includes('Quota exceeded')) {
          consecutiveQuotaErrors++;
          if (consecutiveQuotaErrors >= 3) {
            console.log(`\n⚠️ Quota exceeded 3 times — stopping`);
            break;
          }
        }
      }
    } catch (err) {
      console.log(`  [${i+1}/${unindexedMakers.length}] ${unindexedMakers[i]} ... ❌ ${err}`);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ✅ Submitted: ${success}`);
  console.log(`  ❌ Failed: ${failed}`);
}

main().catch(console.error);
