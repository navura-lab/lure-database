#!/usr/bin/env npx tsx
import 'dotenv/config';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const SITE_URL = 'https://castlog.xyz/';

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

const SITEMAPS = [
  'sitemap-products.xml',
  'sitemap-makers.xml',
  'sitemap-categories.xml',
  'sitemap-articles.xml',
  'sitemap-misc.xml',
  'sitemap-images.xml',
];

const token = await getAccessToken();
console.log('✅ access_token取得成功');

for (const file of SITEMAPS) {
  const feedpath = `${SITE_URL}${file}`;
  const encodedSite = encodeURIComponent(SITE_URL);
  const encodedFeed = encodeURIComponent(feedpath);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedFeed}`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );
  if (res.ok) {
    console.log('✅', feedpath);
  } else {
    const err = await res.text();
    console.log('❌', feedpath, res.status, err.slice(0, 100));
  }
}
