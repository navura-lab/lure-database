import 'dotenv/config';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = process.env.GSC_SITE_URL || 'https://www.lure-db.com/';

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

async function main() {
  const token = await getAccessToken();
  console.log('Access token obtained');

  // 1. 現在のサイトマップ一覧
  console.log('\n--- Current Sitemaps ---');
  const listRes = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/sitemaps`,
    { headers: headers(token) },
  );
  const listData = await listRes.json() as any;
  console.log(JSON.stringify(listData, null, 2));

  // 2. サイトマップ再送信
  const sitemapUrl = `${SITE_URL}sitemap-index.xml`;
  console.log(`\n--- Resubmitting: ${sitemapUrl} ---`);

  const submitRes = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    {
      method: 'PUT',
      headers: headers(token),
    },
  );

  if (submitRes.ok) {
    console.log('✅ Sitemap resubmitted successfully');
  } else {
    const errText = await submitRes.text();
    console.log(`❌ Failed: ${submitRes.status} ${errText}`);
  }

  // 3. 個別サイトマップも送信（sitemap-0.xml）
  const sitemap0Url = `${SITE_URL}sitemap-0.xml`;
  console.log(`\n--- Resubmitting: ${sitemap0Url} ---`);

  const submit0Res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/sitemaps/${encodeURIComponent(sitemap0Url)}`,
    {
      method: 'PUT',
      headers: headers(token),
    },
  );

  if (submit0Res.ok) {
    console.log('✅ sitemap-0.xml resubmitted successfully');
  } else {
    const errText = await submit0Res.text();
    console.log(`❌ Failed: ${submit0Res.status} ${errText}`);
  }

  // 4. 再送信後の状態確認
  console.log('\n--- Sitemaps After Resubmit ---');
  const afterRes = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/sitemaps`,
    { headers: headers(token) },
  );
  const afterData = await afterRes.json() as any;
  if (afterData.sitemap) {
    for (const sm of afterData.sitemap) {
      console.log(`  ${sm.path} — submitted:${sm.lastSubmitted} errors:${sm.errors} warnings:${sm.warnings}`);
    }
  }

  console.log('\nDone');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
