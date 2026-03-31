// scripts/_fetch-smith-descriptions.ts
// smith.jp の description空商品をfetchしてSonnetでリライトしDBに書き込む
// 実行: npx tsx scripts/_fetch-smith-descriptions.ts

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as iconv from 'iconv-lite';
import * as https from 'https';
import * as http from 'http';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaude(prompt: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 未設定');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`Claude API error: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text?.trim() || '';
}

// ---------------------------------------------------------------------------
// HTTP fetch with iconv (Shift_JIS)
// ---------------------------------------------------------------------------

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    };
    const req = lib.get(url, options as any, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) return fetchHtml(loc).then(resolve).catch(reject);
        return reject(new Error(`Redirect without Location from ${url}`));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let html: string;
        try {
          html = iconv.decode(buf, 'shift_jis');
        } catch {
          html = buf.toString('utf8');
        }
        resolve(html);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// ---------------------------------------------------------------------------
// HTML解析: キャッチコピー + 説明文を抽出
// ---------------------------------------------------------------------------

function extractDescription(html: string): string {
  // <br /> や <br> をスペースに変換してからタグ除去
  const cleanTags = (s: string) =>
    s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();

  // キャッチコピー: .pro_toptext_komidashi > span.tx12
  const catchMatch = html.match(
    /class="pro_toptext_komidashi"[\s\S]*?<span[^>]*class="tx12"[^>]*>([\s\S]*?)<\/span>/
  );
  const catchCopy = catchMatch ? cleanTags(catchMatch[1]) : '';

  // 説明文: .pro_toptext p.mb20
  const descMatch = html.match(
    /class="pro_toptext"[\s\S]*?<p[^>]*class="mb20"[^>]*>([\s\S]*?)<\/p>/
  );
  let desc = descMatch ? cleanTags(descMatch[1]) : '';

  // フォールバック: .pro_toptext 内の最初の <p>
  if (!desc) {
    const altMatch = html.match(/class="pro_toptext"[\s\S]*?<p>([\s\S]*?)<\/p>/);
    desc = altMatch ? cleanTags(altMatch[1]) : '';
  }

  const parts: string[] = [];
  if (catchCopy) parts.push(catchCopy);
  if (desc) parts.push(desc);
  return parts.join('\n').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sonnetリライト
// ---------------------------------------------------------------------------

async function rewriteWithSonnet(
  raw: string,
  name: string,
  type: string,
  targetFish: string[]
): Promise<string> {
  const prompt = `あなたは釣りルアーの説明文ライターです。

## 商品情報
- 商品名: ${name}
- タイプ: ${type}
- 対象魚: ${targetFish.join(', ')}
- 公式説明文（原文）:
${raw}

## ルール（厳守）
- 必ず150〜230文字
- 釣り人目線、常体（だ・である調）
- 「このルアーは〜」「本製品は〜」等の説明調は禁止。いきなり特徴から入る
- メーカー説明の核心情報（素材・構造・アクション・用途）を維持
- SEOキーワード（ルアー種別、対象魚、釣り方）を自然に含める
- 根拠のないおすすめ・ランキング表現は禁止
- 絵文字禁止

## 出力
リライトした説明文のみ出力すること（前置き・コメント不要）。`;

  return callClaude(prompt);
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  console.log('[smith] description空商品を取得中...');

  const { data: rows, error } = await sb
    .from('lures')
    .select('slug,manufacturer_slug,name,description,source_url,type,target_fish')
    .eq('manufacturer_slug', 'smith')
    .or('description.is.null,description.eq.')
    .range(0, 999);

  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }

  // slug単位でユニーク化
  const seen = new Set<string>();
  const targets: typeof rows = [];
  for (const r of rows!) {
    if (!seen.has(r.slug)) {
      seen.add(r.slug);
      targets.push(r);
    }
  }

  console.log(`対象: ${targets.length}件`);

  const results: { slug: string; description: string; status: string }[] = [];
  let successCount = 0;
  let skipCount = 0;

  for (const row of targets) {
    console.log(`\n[${row.slug}] ${row.name} - ${row.source_url}`);

    // --- fetch ---
    let html: string;
    try {
      html = await fetchHtml(row.source_url!);
    } catch (e: any) {
      console.log(`  SKIP: fetch失敗 - ${e.message}`);
      skipCount++;
      results.push({ slug: row.slug, description: '', status: `skip:fetch:${e.message}` });
      continue;
    }

    // --- extract ---
    const rawDesc = extractDescription(html);
    if (!rawDesc) {
      console.log(`  SKIP: テキスト抽出失敗`);
      skipCount++;
      results.push({ slug: row.slug, description: '', status: 'skip:no_text' });
      continue;
    }
    console.log(`  原文(${rawDesc.length}文字): ${rawDesc.slice(0, 80)}...`);

    // --- rewrite ---
    let rewritten: string;
    try {
      rewritten = await rewriteWithSonnet(
        rawDesc,
        row.name,
        row.type || 'ルアー',
        row.target_fish || ['シーバス']
      );
    } catch (e: any) {
      console.log(`  SKIP: Sonnetエラー - ${e.message}`);
      skipCount++;
      results.push({ slug: row.slug, description: '', status: `skip:sonnet:${e.message}` });
      continue;
    }
    console.log(`  リライト(${rewritten.length}文字): ${rewritten.slice(0, 80)}...`);

    // 文字数チェック
    if (rewritten.length < 100 || rewritten.length > 300) {
      console.log(`  WARNING: 文字数異常 (${rewritten.length}文字)`);
    }

    // --- DB書き込み ---
    const { error: upErr } = await sb
      .from('lures')
      .update({ description: rewritten })
      .eq('manufacturer_slug', 'smith')
      .eq('slug', row.slug);

    if (upErr) {
      console.log(`  SKIP: DB書き込みエラー - ${upErr.message}`);
      skipCount++;
      results.push({ slug: row.slug, description: rewritten, status: `skip:db:${upErr.message}` });
    } else {
      console.log(`  OK: DB更新成功`);
      successCount++;
      results.push({ slug: row.slug, description: rewritten, status: 'ok' });
    }

    // レートリミット対策
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n========================================');
  console.log(`完了: 成功=${successCount}件, スキップ=${skipCount}件`);
  console.log('========================================');

  // バックアップ保存
  const date = new Date().toISOString().split('T')[0];
  const backupPath = `/tmp/smith-descriptions-${date}.json`;
  const fs = await import('fs');
  fs.writeFileSync(backupPath, JSON.stringify(results, null, 2));
  console.log(`バックアップ: ${backupPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
