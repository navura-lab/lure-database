// 一時調査スクリプト
import 'dotenv/config';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` };
const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

async function main() {
  // Pazdesignのsource_urlサンプル
  const res = await fetch(`${url}/rest/v1/lures?manufacturer=eq.Pazdesign&select=slug,source_url&limit=5`, { headers: HEADERS });
  const data = await res.json();
  console.log('Pazdesign source_urls:', JSON.stringify(data, null, 2));

  // Forest source_url確認
  const res1b = await fetch(`${url}/rest/v1/lures?manufacturer=eq.Forest&select=slug,source_url&limit=5`, { headers: HEADERS });
  const data1b = await res1b.json();
  console.log('\nForest source_urls:', JSON.stringify(data1b, null, 2));

  // JACKALL英語のみのサンプル
  const res2 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.JACKALL&description=not.is.null&select=slug,name,description,source_url,type&limit=100&offset=5000`, { headers: HEADERS });
  const data2: any[] = await res2.json();
  const eng = data2.filter((r: any) => r.description && !HAS_JP.test(r.description));
  console.log('\nJACKALL English-only:', eng.length);
  eng.slice(0, 5).forEach((r: any) => {
    console.log(' ', r.name, '|', r.slug, '|', r.source_url);
    console.log('   desc:', r.description?.substring(0, 100));
  });

  // TIEMCO
  const res3 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.TIEMCO&description=not.is.null&select=slug,name,description,source_url,type&limit=100`, { headers: HEADERS });
  const data3: any[] = await res3.json();
  const eng3 = data3.filter((r: any) => r.description && !HAS_JP.test(r.description));
  console.log('\nTIEMCO English-only:', eng3.length);
  eng3.slice(0, 3).forEach((r: any) => {
    console.log(' ', r.name, '|', r.slug, '|', r.source_url);
    console.log('   desc:', r.description?.substring(0, 100));
  });

  // ValleyHill
  const res4 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.ValleyHill&description=not.is.null&select=slug,name,description,source_url,type&limit=100`, { headers: HEADERS });
  const data4: any[] = await res4.json();
  const eng4 = data4.filter((r: any) => r.description && !HAS_JP.test(r.description));
  console.log('\nValleyHill English-only:', eng4.length);
  eng4.slice(0, 3).forEach((r: any) => {
    console.log(' ', r.name, '|', r.slug, '|', r.source_url);
    console.log('   desc:', r.description?.substring(0, 100));
  });

  // Forest descriptionサンプル詳細
  const res5 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.Forest&description=not.is.null&select=slug,name,description&limit=3`, { headers: HEADERS });
  const data5: any[] = await res5.json();
  console.log('\nForest description samples (full):');
  data5.forEach((r: any) => {
    if (r.description && !HAS_JP.test(r.description)) {
      console.log(`\n[${r.slug}] ${r.name}`);
      console.log(r.description.substring(0, 300));
    }
  });
}

main().catch(console.error);
