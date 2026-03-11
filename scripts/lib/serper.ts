/**
 * Serper.dev API ヘルパー
 *
 * Google Custom Search API の代替（CSE APIは新規受付停止済み）。
 * 無料枠: 2,500クエリ/月（クレカ不要）。
 *
 * 使用スクリプト:
 *   - blog-impression-collector.ts
 *   - seo-competitor-analyzer.ts
 */

import 'dotenv/config';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
  date?: string;
  domain: string;
}

/**
 * Serper.dev でGoogle検索を実行
 */
export async function searchWithSerper(
  query: string,
  options: { num?: number; gl?: string; hl?: string } = {}
): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY が .env に設定されていません');
  }

  const { num = 10, gl = 'jp', hl = 'ja' } = options;

  const res = await fetch(SERPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl, hl, num }),
  });

  if (!res.ok) {
    throw new Error(`Serper API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as any;
  const organic = data.organic || [];

  return organic.map((item: any) => ({
    title: item.title || '',
    link: item.link || '',
    snippet: item.snippet || '',
    position: item.position || 0,
    date: item.date || undefined,
    domain: (() => {
      try { return new URL(item.link || 'https://unknown').hostname; }
      catch { return 'unknown'; }
    })(),
  }));
}

/**
 * Serper APIキーが設定されてるか確認
 */
export function isSerperConfigured(): boolean {
  return !!SERPER_API_KEY;
}
