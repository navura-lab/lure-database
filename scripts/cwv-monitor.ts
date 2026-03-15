/**
 * Core Web Vitals 日次モニタリング
 *
 * PageSpeed Insights API を使って代表URLのCWVを計測し、
 * logs/seo-data/cwv-YYYY-MM-DD.json に保存する。
 *
 * 使い方:
 *   npx tsx scripts/cwv-monitor.ts
 *
 * APIキーなしでも動作するが、レート制限あり（3req/min）。
 * 環境変数 PSI_API_KEY を設定すると上限緩和。
 */

const BASE_URL = 'https://www.castlog.xyz';

// 計測対象URL（ページ種別ごとの代表URL）
const SAMPLE_URLS = [
  { label: 'トップ', path: '/' },
  { label: 'メーカー詳細', path: '/shimano/' },
  { label: 'ルアー詳細', path: '/shimano/exsence-silent-assassin-99f-99s/' },
  { label: 'ランキング', path: '/ranking/seabass-minnow/' },
  { label: '記事', path: '/article/spring-seabass-lure/' },
];

interface CWVResult {
  url: string;
  label: string;
  timestamp: string;
  strategy: 'mobile' | 'desktop';
  // Lighthouse scores
  performance: number | null;
  // Core Web Vitals
  lcp: number | null;    // Largest Contentful Paint (ms)
  cls: number | null;    // Cumulative Layout Shift
  inp: number | null;    // Interaction to Next Paint (ms)
  ttfb: number | null;   // Time to First Byte (ms)
  fcp: number | null;    // First Contentful Paint (ms)
  si: number | null;     // Speed Index (ms)
  tbt: number | null;    // Total Blocking Time (ms)
  error?: string;
}

async function measureUrl(url: string, label: string, strategy: 'mobile' | 'desktop'): Promise<CWVResult> {
  const apiKey = process.env.PSI_API_KEY || '';
  const apiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  apiUrl.searchParams.set('url', url);
  apiUrl.searchParams.set('strategy', strategy);
  apiUrl.searchParams.set('category', 'performance');
  if (apiKey) apiUrl.searchParams.set('key', apiKey);

  const result: CWVResult = {
    url, label, strategy,
    timestamp: new Date().toISOString(),
    performance: null,
    lcp: null, cls: null, inp: null, ttfb: null, fcp: null, si: null, tbt: null,
  };

  try {
    const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      result.error = `HTTP ${res.status}: ${res.statusText}`;
      return result;
    }
    const data = await res.json() as any;

    // Lighthouse performance score
    result.performance = data.lighthouseResult?.categories?.performance?.score ?? null;
    if (result.performance !== null) result.performance = Math.round(result.performance * 100);

    // Core Web Vitals from Lighthouse audits
    const audits = data.lighthouseResult?.audits || {};
    result.lcp = audits['largest-contentful-paint']?.numericValue ?? null;
    result.cls = audits['cumulative-layout-shift']?.numericValue ?? null;
    result.tbt = audits['total-blocking-time']?.numericValue ?? null;
    result.fcp = audits['first-contentful-paint']?.numericValue ?? null;
    result.si = audits['speed-index']?.numericValue ?? null;
    result.ttfb = audits['server-response-time']?.numericValue ?? null;

    // INP from CrUX field data (if available)
    const cruxMetrics = data.loadingExperience?.metrics || {};
    if (cruxMetrics.INTERACTION_TO_NEXT_PAINT) {
      result.inp = cruxMetrics.INTERACTION_TO_NEXT_PAINT.percentile ?? null;
    }

    // Round numeric values
    if (result.lcp !== null) result.lcp = Math.round(result.lcp);
    if (result.tbt !== null) result.tbt = Math.round(result.tbt);
    if (result.fcp !== null) result.fcp = Math.round(result.fcp);
    if (result.si !== null) result.si = Math.round(result.si);
    if (result.ttfb !== null) result.ttfb = Math.round(result.ttfb);
    if (result.cls !== null) result.cls = Math.round(result.cls * 1000) / 1000;

  } catch (err: any) {
    result.error = err.message || String(err);
  }

  return result;
}

async function main() {
  const fs = await import('fs');
  const path = await import('path');

  const today = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(import.meta.dirname, '..', 'logs', 'seo-data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `cwv-${today}.json`);

  console.log(`[CWV Monitor] ${today} — ${SAMPLE_URLS.length} URLs × 2 strategies`);

  const results: CWVResult[] = [];

  for (const { label, path: urlPath } of SAMPLE_URLS) {
    const url = `${BASE_URL}${urlPath}`;

    // Mobile
    console.log(`  📱 ${label} (mobile)...`);
    const mobile = await measureUrl(url, label, 'mobile');
    results.push(mobile);
    if (mobile.error) {
      console.log(`    ❌ ${mobile.error}`);
    } else {
      console.log(`    Perf: ${mobile.performance} | LCP: ${mobile.lcp}ms | CLS: ${mobile.cls} | TBT: ${mobile.tbt}ms | TTFB: ${mobile.ttfb}ms`);
    }

    // Rate limit: 3 req/min without API key
    if (!process.env.PSI_API_KEY) await new Promise(r => setTimeout(r, 25000));

    // Desktop
    console.log(`  🖥️  ${label} (desktop)...`);
    const desktop = await measureUrl(url, label, 'desktop');
    results.push(desktop);
    if (desktop.error) {
      console.log(`    ❌ ${desktop.error}`);
    } else {
      console.log(`    Perf: ${desktop.performance} | LCP: ${desktop.lcp}ms | CLS: ${desktop.cls} | TBT: ${desktop.tbt}ms | TTFB: ${desktop.ttfb}ms`);
    }

    if (!process.env.PSI_API_KEY) await new Promise(r => setTimeout(r, 25000));
  }

  // Summary
  const mobileResults = results.filter(r => r.strategy === 'mobile' && !r.error);
  const desktopResults = results.filter(r => r.strategy === 'desktop' && !r.error);

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v !== null);
    return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };

  const summary = {
    date: today,
    urlCount: SAMPLE_URLS.length,
    mobile: {
      avgPerformance: avg(mobileResults.map(r => r.performance)),
      avgLCP: avg(mobileResults.map(r => r.lcp)),
      avgCLS: (() => {
        const vals = mobileResults.map(r => r.cls).filter((v): v is number => v !== null);
        return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 1000) / 1000 : null;
      })(),
      avgTBT: avg(mobileResults.map(r => r.tbt)),
      avgTTFB: avg(mobileResults.map(r => r.ttfb)),
    },
    desktop: {
      avgPerformance: avg(desktopResults.map(r => r.performance)),
      avgLCP: avg(desktopResults.map(r => r.lcp)),
      avgCLS: (() => {
        const vals = desktopResults.map(r => r.cls).filter((v): v is number => v !== null);
        return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 1000) / 1000 : null;
      })(),
      avgTBT: avg(desktopResults.map(r => r.tbt)),
      avgTTFB: avg(desktopResults.map(r => r.ttfb)),
    },
    results,
  };

  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n✅ 保存: ${outFile}`);
  console.log(`📊 Mobile avg: Perf=${summary.mobile.avgPerformance} LCP=${summary.mobile.avgLCP}ms CLS=${summary.mobile.avgCLS} TBT=${summary.mobile.avgTBT}ms`);
  console.log(`📊 Desktop avg: Perf=${summary.desktop.avgPerformance} LCP=${summary.desktop.avgLCP}ms CLS=${summary.desktop.avgCLS} TBT=${summary.desktop.avgTBT}ms`);
}

main().catch(console.error);
