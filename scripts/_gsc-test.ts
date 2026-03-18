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

  const headers = {
    Authorization: `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    'x-goog-user-project': 'plucky-mile-486802-j6',
  };

  // 両方のプロパティ形式を試す
  const properties = ['sc-domain:castlog.xyz', 'https://www.castlog.xyz/'];

  for (const property of properties) {
    console.log(`\n=== Property: ${property} ===`);
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          startDate: '2026-02-16',
          endDate: '2026-03-16',
          dimensions: ['query'],
          rowLimit: 20,
        }),
      }
    );
    const data = await res.json() as any;
    if (data.error) {
      console.log('Error:', data.error.message || JSON.stringify(data.error));
      continue;
    }
    console.log(`Rows: ${data.rows?.length || 0}`);
    if (data.rows) {
      for (const r of data.rows.slice(0, 15)) {
        console.log(`  ${r.keys[0].padEnd(40)} imp:${String(r.impressions).padStart(5)} clicks:${String(r.clicks).padStart(3)} pos:${r.position.toFixed(1)}`);
      }
    }
  }
}

main().catch(console.error);
