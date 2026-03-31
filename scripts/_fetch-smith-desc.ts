import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function log(msg: string) { console.log(`[${new Date().toISOString().substring(11,19)}] ${msg}`); }

async function fetchSmithDesc(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Shift-JIS デコード
    const decoder = new TextDecoder('shift-jis');
    const html = decoder.decode(buf);
    
    // <p>タグからテキスト抽出（メニューや著作権テキストを除外）
    const skipPatterns = ['copyright','©','SMITH','トップ','menu','フィールド','コラム','お問い合わせ','ナビ','注目','新着','このページ'];
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    
    for (const p of pMatches) {
      const clean = p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length < 80) continue;
      if (skipPatterns.some(k => clean.includes(k))) continue;
      // 日本語比率チェック（商品説明らしい）
      const jpChars = (clean.match(/[\u3000-\u9fff]/g) || []).length;
      if (jpChars / clean.length < 0.2) continue;
      
      return clean.substring(0, 230);
    }
    return null;
  } catch { return null; }
}

async function main() {
  // smith の空description商品を全件取得
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,name,description,source_url,type,target_fish')
      .eq('manufacturer_slug', 'smith').range(offset, offset+999);
    if (!data?.length) break;
    all.push(...data); offset += data.length;
    if (data.length < 1000) break;
  }
  
  // slug単位でユニーク、空descriptionのみ
  const seen = new Map<string,any>();
  for (const r of all) {
    if (!seen.has(r.slug)) seen.set(r.slug, r);
  }
  const targets = [...seen.values()].filter(r => !r.description || r.description.trim() === '');
  log(`対象: ${targets.length}件`);
  
  // 非ルアーと思われるもの除外
  const SKIP_SLUGS = new Set(['quick-lure-changer','quick-rod-holder']);
  
  let ok = 0, skip = 0;
  for (const r of targets) {
    if (SKIP_SLUGS.has(r.slug)) { log(`  スキップ(非ルアー): ${r.slug}`); skip++; continue; }
    if (!r.source_url) { log(`  スキップ(URL無): ${r.slug}`); skip++; continue; }
    
    const desc = await fetchSmithDesc(r.source_url);
    if (!desc) { log(`  ⚠️ 取得失敗: ${r.slug}`); skip++; continue; }
    
    const { error } = await sb.from('lures').update({ description: desc })
      .eq('manufacturer_slug', 'smith').eq('slug', r.slug);
    if (error) { log(`  ❌ DB更新失敗: ${r.slug}`); skip++; }
    else { log(`  ✅ ${r.slug}: ${desc.length}文字`); ok++; }
    await sleep(300);
  }
  log(`\n完了: 成功${ok}件, スキップ/エラー${skip}件`);
}

main().catch(e => { console.error(e); process.exit(1); });
