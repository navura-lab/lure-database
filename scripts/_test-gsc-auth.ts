import 'dotenv/config';
const r = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: 'refresh_token' })
});
const { access_token: token } = await r.json() as any;
const SITE = 'https://www.lure-db.com/';

const q = async (start: string, end: string) => {
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, rowLimit: 1 })
  });
  const d = await res.json() as any;
  return d.rows?.[0] ?? { clicks: 0, impressions: 0, position: 0 };
};

console.log('=== 週別推移 (lure-db.com) ===');
const weeks = [
  ['3/1-7',   '2026-03-01', '2026-03-07'],
  ['3/8-14',  '2026-03-08', '2026-03-14'],
  ['3/15-21', '2026-03-15', '2026-03-21'],
  ['3/22-28', '2026-03-22', '2026-03-28'],
  ['3/29-30', '2026-03-29', '2026-03-30'],
];
for (const [label, start, end] of weeks) {
  const d = await q(start, end);
  console.log(`${label}: clicks:${d.clicks} imp:${d.impressions} pos:${d.position?.toFixed(1)}`);
}
