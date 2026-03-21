// Forest公式サイトのURL構造を確認
import 'dotenv/config';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` };
const HAS_JP = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

async function main() {
  // Forestのユニークslugを取得
  const res = await fetch(`${url}/rest/v1/lures?manufacturer=eq.Forest&select=slug,name,description&order=slug.asc&limit=1000`, { headers: HEADERS });
  const data: any[] = await res.json();
  console.log(`Forest total rows fetched: ${data.length}`);
  console.log(`Sample descriptions:`);
  data.slice(0, 3).forEach((r: any) => console.log(`  [${r.slug}] desc="${r.description?.substring(0,60)}"`));
  const engOnly = data.filter((r: any) => r.description && r.description.trim() !== '' && !HAS_JP.test(r.description));

  const slugs = [...new Set(engOnly.map((r: any) => r.slug))];
  console.log(`Forest英語のみの商品slug一覧 (${slugs.length}件):`);
  slugs.forEach(s => console.log(`  ${s}`));

  // 3つのslugで実際のURLを試す
  console.log('\n--- URL推測テスト ---');
  for (const slug of slugs.slice(0, 5)) {
    for (const cat of ['area-lure', 'native-lure']) {
      const testUrl = `https://forestjp.com/products/${cat}/${encodeURIComponent(slug)}/`;
      try {
        const r = await fetch(testUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'manual',
        });
        if (r.status === 200) {
          console.log(`  OK: ${testUrl}`);
        } else if (r.status === 301 || r.status === 302) {
          console.log(`  REDIRECT ${r.status}: ${testUrl} -> ${r.headers.get('location')}`);
        }
        // 404は表示しない
      } catch (e: any) {
        console.log(`  ERROR: ${testUrl} ${e.message}`);
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 実際にページを取得して日本語descriptionを抽出テスト
  console.log('\n--- 日本語description抽出テスト ---');
  const testSlug = slugs[0]; // bells
  for (const cat of ['area-lure', 'native-lure']) {
    const testUrl = `https://forestjp.com/products/${cat}/${encodeURIComponent(testSlug)}/`;
    try {
      const r = await fetch(testUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (r.ok) {
        const html = await r.text();
        // entry-contentブロック
        const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (contentMatch) {
          const text = contentMatch[1]
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
          const lines = text.split('\n').filter(l => l.trim().length > 15);
          console.log(`\n[${cat}/${testSlug}] 最初の5行:`);
          lines.slice(0, 5).forEach(l => console.log(`  "${l.trim().substring(0, 100)}"`));
          const jpLine = lines.find(l => HAS_JP.test(l) && !/^(カラー|ウエイト|価格|サイズ|フック|リング|全\d+色)/.test(l.trim()));
          if (jpLine) console.log(`  → 日本語desc候補: "${jpLine.trim().substring(0, 100)}"`);
        }
      }
    } catch (e: any) {
      // skip
    }
  }
}

main().catch(console.error);
