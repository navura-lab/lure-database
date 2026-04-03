/**
 * GA4直帰率データからエディトリアル生成の優先順位を決定
 *
 * GA4で直帰率が高い＋セッション数が多いページを特定し、
 * エディトリアル未作成のものを /tmp/editorial-priority.json に出力。
 * editorial-writerがこのファイルを参照して優先生成する。
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const GA4_DIR = path.join(import.meta.dirname, '..', 'logs', 'ga4-data');
const EDITORIALS_DIR = path.join(import.meta.dirname, '..', 'src', 'data', 'seo', 'editorials');
const OUTPUT = '/tmp/editorial-priority.json';

function log(msg: string) { console.log(`[${new Date().toISOString()}] [ga4-priority] ${msg}`); }

async function main() {
  // GA4からページ別データを取得
  log('GA4ページ別データ取得中...');
  let ga4Pages: any[] = [];
  try {
    const result = execSync('python3 scripts/ga4-daily-report.py --json 2>/dev/null', {
      cwd: path.join(import.meta.dirname, '..'),
      encoding: 'utf8',
      timeout: 30000,
    });
    const data = JSON.parse(result);
    ga4Pages = data.topPages || [];
  } catch {
    // GA4データなければ最新ファイルから読む
    const files = fs.readdirSync(GA4_DIR).filter(f => f.startsWith('ga4-')).sort();
    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(path.join(GA4_DIR, files[files.length - 1]), 'utf8'));
      ga4Pages = data.topPages || [];
    }
  }

  if (ga4Pages.length === 0) {
    log('GA4データなし。スキップ。');
    return;
  }

  // エディトリアル既存slugを取得
  const existing = new Set(
    fs.readdirSync(EDITORIALS_DIR)
      .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
      .map(f => f.replace('.ts', ''))
  );

  // ページパスからslugを抽出（/manufacturer/slug/ 形式のみ）
  const priorities: { slug: string; ms: string; path: string; pageviews: number; bounceRate: number; score: number }[] = [];

  for (const page of ga4Pages) {
    const parts = (page.path || '').replace(/^\/|\/$/g, '').split('/');
    if (parts.length !== 2) continue; // 商品ページのみ
    const [ms, slug] = parts;
    if (existing.has(slug)) continue; // エディトリアル済みはスキップ

    const pv = page.pageviews || 0;
    const dur = page.avgDuration || 0;
    // スコア: PV多い×滞在短い = エディトリアルが最も効くページ
    const score = pv * (dur < 30 ? 3 : dur < 60 ? 2 : 1);

    if (score > 0) {
      priorities.push({ slug, ms, path: page.path, pageviews: pv, bounceRate: 0, score });
    }
  }

  priorities.sort((a, b) => b.score - a.score);

  log(`GA4優先度付きページ: ${priorities.length}件（エディトリアル未作成）`);
  priorities.slice(0, 10).forEach((p, i) => {
    log(`  ${i + 1}. ${p.path} (PV=${p.pageviews}, score=${p.score})`);
  });

  fs.writeFileSync(OUTPUT, JSON.stringify(priorities.slice(0, 50), null, 2));
  log(`優先リスト保存: ${OUTPUT}`);
}

main().catch(console.error);
