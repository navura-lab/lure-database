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

  // 旧ドメインでクエリデータ取得
  const property = 'https://www.lure-db.com/';
  console.log(`=== ${property} ===`);
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        startDate: '2026-02-16',
        endDate: '2026-03-16',
        dimensions: ['query'],
        rowLimit: 25,
      }),
    }
  );
  const data = await res.json() as any;
  console.log(`Rows: ${data.rows?.length || 0}`);
  if (data.rows) {
    for (const r of data.rows.slice(0, 25)) {
      console.log(`  ${r.keys[0].padEnd(45)} imp:${String(r.impressions).padStart(5)} clicks:${String(r.clicks).padStart(3)} pos:${r.position.toFixed(1)}`);
    }
  }

  // sc-domain:castlog.xyz でも確認（期間を広げて）
  console.log(`\n=== sc-domain:castlog.xyz (90日間) ===`);
  const res2 = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent('sc-domain:castlog.xyz')}/searchAnalytics/query`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        startDate: '2025-12-18',
        endDate: '2026-03-16',
        dimensions: ['query'],
        rowLimit: 25,
      }),
    }
  );
  const data2 = await res2.json() as any;
  console.log(`Rows: ${data2.rows?.length || 0}`);
  if (data2.rows) {
    for (const r of data2.rows.slice(0, 25)) {
      console.log(`  ${r.keys[0].padEnd(45)} imp:${String(r.impressions).padStart(5)} clicks:${String(r.clicks).padStart(3)} pos:${r.position.toFixed(1)}`);
    }
  }
}

main().catch(console.error);
