import 'dotenv/config';

async function main() {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const { access_token } = await tokenRes.json() as any;

  // サイト一覧取得
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'x-goog-user-project': 'plucky-mile-486802-j6',
    },
  });
  const data = await res.json() as any;
  console.log('=== GSC Sites ===');
  if (data.siteEntry) {
    for (const site of data.siteEntry) {
      console.log(`  ${site.siteUrl} — ${site.permissionLevel}`);
    }
  } else {
    console.log('No sites found');
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
