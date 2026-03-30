import 'dotenv/config';

const TARGETS = [
  { slug: 'shumari-110f', url: 'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=310502196&bid=lurefishing&cat=002002004001' },
  { slug: 'suterusupeppa-110ssuroshinkingu', url: 'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=300901699&bid=lurefishing&cat=002001003010' },
];

async function fetchDesc(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh)' } });
  const html = await res.text();
  const match = html.match(/<div class="tabContent tab1">([\s\S]*?)<\/div>\s*<div class="tabContent/);
  if (!match) return '';
  let text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const cssStart = text.indexOf('{');
  if (cssStart > 50) text = text.substring(0, cssStart).trim();
  return text;
}

for (const t of TARGETS) {
  const desc = await fetchDesc(t.url);
  console.log(`=== ${t.slug} ===`);
  console.log(desc);
  console.log();
}
