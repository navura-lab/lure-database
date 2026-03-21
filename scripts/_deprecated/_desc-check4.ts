// Pazdesign公式ページの日本語description抽出テスト
import 'dotenv/config';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` };
const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

async function main() {
  // PazdesignのユニークURLを取得
  const res = await fetch(`${url}/rest/v1/lures?manufacturer=eq.Pazdesign&select=slug,name,description,source_url&order=slug.asc&limit=1000`, { headers: HEADERS });
  const data: any[] = await res.json();
  const engOnly = data.filter((r: any) => r.description && r.description.trim() !== '' && !HAS_JP.test(r.description));

  const urlMap = new Map<string, string>();
  engOnly.forEach((r: any) => {
    if (r.source_url && !urlMap.has(r.slug)) urlMap.set(r.slug, r.source_url);
  });
  console.log(`Pazdesign英語のみ: ${engOnly.length}件, ユニークURL: ${urlMap.size}`);
  console.log('サンプルURL:');
  [...urlMap.entries()].slice(0, 5).forEach(([slug, u]) => console.log(`  ${slug}: ${u}`));

  // 実際にスクレイプテスト
  console.log('\n--- スクレイプテスト ---');
  const testUrls = [...urlMap.entries()].slice(0, 3);
  for (const [slug, sourceUrl] of testUrls) {
    console.log(`\n[${slug}] ${sourceUrl}`);
    try {
      const r = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) { console.log(`  HTTP ${r.status}`); continue; }
      const html = await r.text();

      // p要素から日本語テキスト
      const pTexts: string[] = [];
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let match;
      while ((match = pRegex.exec(html)) !== null) {
        const text = match[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        if (text.length > 30 && HAS_JP.test(text) &&
            !text.includes('length：') && !text.includes('weight：') &&
            !text.includes('¥') && !text.includes('Copyright')) {
          pTexts.push(text);
        }
      }
      if (pTexts.length > 0) {
        console.log(`  JP p text: "${pTexts[0].substring(0, 150)}"`);
      } else {
        console.log('  NO JP p text found');
        // meta description
        const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
        if (metaMatch && HAS_JP.test(metaMatch[1])) {
          console.log(`  meta desc: "${metaMatch[1].substring(0, 150)}"`);
        }
        // 全テキストから探す
        const allText = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ');
        const jpLines = allText.split('\n').filter(l => l.trim().length > 30 && HAS_JP.test(l));
        if (jpLines.length > 0) {
          console.log(`  全テキストJP行: "${jpLines[0].trim().substring(0, 150)}"`);
        }
      }

      // 現在のdescription
      const current = engOnly.find((r: any) => r.slug === slug);
      if (current) console.log(`  current desc: "${current.description.substring(0, 100)}"`);

    } catch (e: any) {
      console.log(`  ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // JACKALL
  console.log('\n\n=== JACKALL ===');
  const res2 = await fetch(`${url}/rest/v1/lures?manufacturer=eq.JACKALL&select=slug,name,description,source_url,type,target_fish,weight&order=slug.asc&limit=10000`, { headers: HEADERS });
  const data2: any[] = await res2.json();
  const eng2 = data2.filter((r: any) => r.description && r.description.trim() !== '' && !HAS_JP.test(r.description));
  const slugs2 = [...new Set(eng2.map((r: any) => r.slug))];
  console.log(`JACKALL英語のみ: ${eng2.length}件, ユニーク商品: ${slugs2.length}`);
  slugs2.forEach(s => {
    const sample = eng2.find((r: any) => r.slug === s);
    console.log(`  ${s}: "${sample?.description?.substring(0, 50)}" type=${sample?.type} source=${sample?.source_url}`);
  });
}

main().catch(console.error);
