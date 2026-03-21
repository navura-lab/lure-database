import 'dotenv/config';
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` };
const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

async function main() {
  // Pazdesign akane88fの全テキスト構造を確認
  console.log('=== Pazdesign akane88f HTML構造 ===');
  const r = await fetch('https://pazdesign.co.jp/products/reed/akane88f/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await r.text();

  // div.product_detail や article, main 内を探す
  for (const selector of ['product_detail', 'product-detail', 'product_content', 'single-content', 'main-content']) {
    const match = html.match(new RegExp(`class="[^"]*${selector}[^"]*"`, 'i'));
    if (match) console.log(`Found class containing: ${selector}`);
  }

  // 日本語テキストを含むdiv/td/span/li要素を調査
  const elemRegex = /<(div|td|span|li|dd|dt)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  const jpElements: string[] = [];
  while ((m = elemRegex.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (text.length > 50 && HAS_JP.test(text) &&
        !text.includes('Copyright') && !text.includes('PRODUCTS') &&
        !/^(length|weight|hook|type|range|price)/i.test(text)) {
      jpElements.push(`<${m[1]}> "${text.substring(0, 150)}"`);
    }
  }
  console.log(`日本語要素 (${jpElements.length}件):`);
  jpElements.slice(0, 10).forEach(e => console.log(`  ${e}`));

  // JACKALL: ページ分割して英語のみを探す
  console.log('\n\n=== JACKALL 英語のみ探索 ===');
  for (let offset = 5000; offset <= 7000; offset += 500) {
    const res = await fetch(`${url}/rest/v1/lures?manufacturer=eq.JACKALL&select=slug,name,description,source_url,type,weight&order=id.asc&limit=500&offset=${offset}`, { headers: HEADERS });
    const data: any[] = await res.json();
    const eng = data.filter((r: any) => r.description && r.description.trim() !== '' && !HAS_JP.test(r.description));
    if (eng.length > 0) {
      console.log(`offset=${offset}: ${eng.length}件`);
      const slugs = [...new Set(eng.map((r: any) => r.slug))];
      slugs.forEach(s => {
        const sample = eng.find((r: any) => r.slug === s);
        console.log(`  ${s}: "${sample?.description?.substring(0, 60)}" type=${sample?.type} src=${sample?.source_url}`);
      });
    }
  }

  // TIEMCO
  console.log('\n\n=== TIEMCO 英語のみ ===');
  const res3 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.TIEMCO&select=slug,name,description,source_url,type,weight&limit=500`, { headers: HEADERS });
  const data3: any[] = await res3.json();
  const eng3 = data3.filter((r: any) => r.description && r.description.trim() !== '' && !HAS_JP.test(r.description));
  const slugs3 = [...new Set(eng3.map((r: any) => r.slug))];
  console.log(`TIEMCO: ${eng3.length}件, ユニーク: ${slugs3.length}`);
  slugs3.forEach(s => {
    const sample = eng3.find((r: any) => r.slug === s);
    console.log(`  ${s}: "${sample?.description?.substring(0, 80)}" type=${sample?.type} src=${sample?.source_url}`);
  });
}

main().catch(console.error);
