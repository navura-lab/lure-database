/**
 * GSC API 共通クライアント
 *
 * 全SEOスクリプトで共有する認証・クエリ関数
 */

import 'dotenv/config';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';

export const SITE_URL = process.env.GSC_SITE_URL || 'https://castlog.xyz/';

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as any;
  if (!data.access_token) throw new Error(`GSC token error: ${JSON.stringify(data)}`);
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 60秒のマージン
  return cachedToken;
}

function gscHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'x-goog-user-project': QUOTA_PROJECT,
    'Content-Type': 'application/json',
  };
}

export interface AnalyticsFilter {
  dimension: string;
  operator: 'equals' | 'contains' | 'notContains';
  expression: string;
}

export async function getSearchAnalytics(
  startDate: string,
  endDate: string,
  dimensions: string[] = ['query'],
  rowLimit = 50,
  filters?: AnalyticsFilter[],
): Promise<SearchAnalyticsRow[]> {
  const token = await getAccessToken();
  const body: any = { startDate, endDate, dimensions, rowLimit };
  if (filters && filters.length > 0) {
    body.dimensionFilterGroups = [{ filters }];
  }
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: gscHeaders(token),
      body: JSON.stringify(body),
    },
  );
  const data = await res.json() as any;
  if (data.error) throw new Error(`GSC API error: ${JSON.stringify(data.error)}`);
  return data.rows || [];
}

// 日付ヘルパー
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
