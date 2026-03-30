import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const TARGETS = [
  {
    slug: 'shumari-110f',
    name: 'シュマリ 110F',
    type: 'ミノー',
    fish: 'トラウト',
    url: 'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=310502196&bid=lurefishing&cat=002002004001'
  },
  {
    slug: 'suterusupeppa-110ssuroshinkingu',
    name: 'ステルスペッパー110S(スローシンキング)',
    type: 'プロップベイト',
    fish: 'ブラックバス',
    url: 'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=300901699&bid=lurefishing&cat=002001003010'
  },
];

async function fetchDescription(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });
  const html = await res.text();
  const match = html.match(/<div class="tabContent tab1">([\s\S]*?)<\/div>\s*<div class="tabContent/);
  if (!match) throw new Error('descriptionセクション未発見');
  let text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const cssStart = text.indexOf('{');
  if (cssStart > 50) text = text.substring(0, cssStart).trim();
  return text;
}

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(`Claude API error: ${JSON.stringify(data.error)}`);
  return data.content[0].text.trim();
}

async function main() {
  for (const target of TARGETS) {
    console.log(`\n処理中: ${target.slug}`);
    const rawDesc = await fetchDescription(target.url);
    console.log(`  取得(${rawDesc.length}文字): ${rawDesc.substring(0, 80)}...`);

    const newDesc = await callClaude(`以下のルアーの説明文を日本語でリライトしてください。

ルアー名: ${target.name}
type: ${target.type}
対象魚: ${target.fish}

元の説明:
${rawDesc.substring(0, 800)}

条件:
- 150〜230文字
- 根拠のない評価（最強・最高・おすすめ等）禁止
- メーカー公式の特徴を正確に含める
- 自然な日本語

リライト後のテキストのみ出力してください。`);

    console.log(`  リライト(${newDesc.length}文字): ${newDesc}`);
    const { error } = await sb.from('lures')
      .update({ description: newDesc })
      .eq('manufacturer_slug', 'tiemco')
      .eq('slug', target.slug);
    if (error) throw error;
    console.log(`  ✅ DB更新完了`);
  }
  console.log('\n完了');
}

main().catch(e => { console.error(e); process.exit(1); });
