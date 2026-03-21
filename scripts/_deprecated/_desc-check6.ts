import 'dotenv/config';
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` };
const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

async function main() {
  // TIEMCO shumari target_fish
  const res = await fetch(`${url}/rest/v1/lures?manufacturer=eq.TIEMCO&slug=eq.shumari-110f&select=name,target_fish,type&limit=3`, { headers: HEADERS });
  const data = await res.json();
  console.log('TIEMCO shumari:', JSON.stringify(data[0]));

  const res2 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.TIEMCO&slug=eq.suterusupeppa-110ssuroshinkingu&select=name,target_fish,type&limit=3`, { headers: HEADERS });
  const data2 = await res2.json();
  console.log('TIEMCO stealth pepper:', JSON.stringify(data2[0]));

  // JACKALLのスクレイプテスト: rekuze
  console.log('\n=== JACKALL rekuze テスト ===');
  const r = await fetch('https://www.jackall.co.jp/timon/products/lure/spoon/rekuze', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await r.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 20 && HAS_JP.test(l));
  console.log('日本語行 (先頭15件):');
  lines.slice(0, 15).forEach(l => console.log(`  "${l.substring(0, 120)}"`));
}

main().catch(console.error);
