import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function trimToRange(text: string, max = 230): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let cut = t.substring(0, max);
  const lastPeriod = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('、'), cut.lastIndexOf('．'));
  if (lastPeriod >= 100) cut = cut.substring(0, lastPeriod + 1);
  return cut;
}

async function fetchDuelDesc(url: string, page: any): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const text = await page.evaluate(() => {
      const selectors = ['.p-product-text', '.p-detail-text', '.product-description',
        '.l-product-text', '.p-item-lead', '.l-hero-detail_text'];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) {
          const t = (el as HTMLElement).textContent?.trim() ?? '';
          if (t.length > 50) return t;
        }
      }
      const paras = document.querySelectorAll('main p, article p, .l-main p');
      const collected: string[] = [];
      for (const p of paras) {
        const t = ((p as HTMLElement).textContent ?? '').trim();
        if (t.startsWith('【') || t.length < 15) continue;
        if (/^(戻る|一覧|HOME|PRODUCTS|MENU|ページトップ)/i.test(t)) continue;
        collected.push(t);
        if (collected.length >= 3) break;
      }
      return collected.length > 0 ? collected.join(' ') : null;
    });
    return text ? trimToRange(text) : null;
  } catch {
    return null;
  }
}

async function main() {
  // 今回書き込んだduelの7件を再取得
  const targets = [
    { slug: 'saltyrubber-slidehead', url: 'https://www.duel.co.jp/products/detail.php?pid=234' },
    { slug: 'saltyrubber-slide', url: 'https://www.duel.co.jp/products/detail.php?pid=233' },
    { slug: 'sliderubber', url: 'https://www.duel.co.jp/products/detail.php?pid=229' },
    { slug: 'sliderubber-curly', url: 'https://www.duel.co.jp/products/detail.php?pid=228' },
    { slug: 'hardcore-r7r9r11r13r15f70mm90mm110mm130mm150mm', url: 'https://www.duel.co.jp/products/detail.php?pid=1655' },
    { slug: 'saltybait-wave', url: 'https://www.duel.co.jp/products/detail.php?pid=1652' },
    { slug: 'sonicboom-sb-wake-165f', url: 'https://www.duel.co.jp/products/detail.php?pid=1654' },
  ];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let success = 0, skip = 0;

  for (const t of targets) {
    const desc = await fetchDuelDesc(t.url, page);
    if (!desc || desc.length < 20) {
      console.log(`  スキップ: ${t.slug}`);
      skip++;
      continue;
    }
    console.log(`  ${t.slug}: ${desc.length}文字 | ${desc.substring(0, 80)}`);
    const { error } = await sb.from('lures').update({ description: desc })
      .eq('manufacturer_slug', 'duel').eq('slug', t.slug);
    if (error) console.error(`  DB書き込みエラー: ${error.message}`);
    else success++;
  }

  await browser.close();
  console.log(`\n結果: 成功=${success} スキップ=${skip}`);
}

main().catch(console.error);
