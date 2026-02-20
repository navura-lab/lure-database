// Test description rewriting with Claude API
// Compares original vs rewritten descriptions for a few sample products

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `あなたは釣りルアーのレビューライターです。
メーカーの公式商品説明文を元に、以下の条件でリライトしてください。

【条件】
- 釣り人目線で、実際に使いたくなるような臨場感のある文章にする
- メーカーの説明の核心的な情報（スペック、特徴、用途）は必ず含める
- 文章構造や表現は完全に変える（コピーコンテンツにならないように）
- 「このルアーは〜」「本製品は〜」のような説明調ではなく、釣り場の情景が浮かぶような書き方
- 150〜250文字程度に収める（簡潔に）
- SEOを意識し、ルアーの種別（ミノー、ジグ、ペンシル等）や対象魚、釣り方のキーワードを自然に含める
- 絵文字は使わない
- 敬体（です・ます調）は使わず、常体（だ・である調）で書く`;

const TEST_PRODUCTS = [
  { url: 'https://www.daiwa.com/jp/product/huz2stf', name: 'TGベイト' },      // メタルジグ
  { url: 'https://www.daiwa.com/jp/product/tghykxg', name: 'モアザン モンスタースライダー' }, // ペンシル
  { url: 'https://www.daiwa.com/jp/product/pj6atca', name: '紅牙ブレードブレーカー' },  // タイラバ系
];

async function extractDescription(page: any, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const descTexts = await page.evaluate(() => {
    const texts: string[] = [];
    const headline = document.querySelector('div.area h2.font_Midashi');
    if (headline && headline.textContent) {
      texts.push(headline.textContent.trim());
    }
    const bodyEls = document.querySelectorAll('div.containerText div.text');
    bodyEls.forEach((el: Element) => {
      const t = (el.textContent || '').trim();
      if (t.length > 20) texts.push(t);
    });
    return texts;
  });

  return descTexts.join('\n').substring(0, 800);
}

async function rewriteDescription(productName: string, originalDesc: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-20250414',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `商品名: ${productName}\n\n元の説明文:\n${originalDesc}\n\nリライトしてください。`,
    }],
  });

  const textBlock = msg.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const product of TEST_PRODUCTS) {
    console.log('\n' + '='.repeat(80));
    console.log(`【${product.name}】 ${product.url}`);
    console.log('='.repeat(80));

    const original = await extractDescription(page, product.url);
    console.log('\n--- 元テキスト ---');
    console.log(original);
    console.log(`(${original.length}文字)`);

    const rewritten = await rewriteDescription(product.name, original);
    console.log('\n--- リライト案 ---');
    console.log(rewritten);
    console.log(`(${rewritten.length}文字)`);
  }

  await browser.close();
}

main().catch(console.error);
