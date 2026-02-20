// src/middleware.ts
// Anti-scraping Edge Middleware — Bot detection + Rate limiting + Honeypot blocking
//
// Runs on every request before static files or API routes are served.
// Uses in-memory Maps for rate limiting (effective per-instance, not global,
// but sufficient against casual scraping).

import { defineMiddleware } from 'astro:middleware';

// ---------------------------------------------------------------------------
// Known bot User-Agent patterns (blocked)
// ---------------------------------------------------------------------------

const BLOCKED_UA_PATTERNS = [
  /python-requests/i,
  /python-urllib/i,
  /scrapy/i,
  /curl\//i,
  /wget\//i,
  /Go-http-client/i,
  /node-fetch/i,
  /axios/i,
  /httpie/i,
  /java\//i,
  /libwww-perl/i,
  /PHP\//i,
  /ruby/i,
  /okhttp/i,
  /Apache-HttpClient/i,
  /colly/i,
  /Scrapy/i,
  /HeadlessChrome(?!.*Googlebot)/i,
];

// ---------------------------------------------------------------------------
// Search engine bots (allowed — bypass rate limits)
// ---------------------------------------------------------------------------

const SEARCH_ENGINE_BOTS = [
  /Googlebot/i,
  /Bingbot/i,
  /Slurp/i,            // Yahoo
  /DuckDuckBot/i,
  /Baiduspider/i,
  /YandexBot/i,
  /Applebot/i,
  /facebookexternalhit/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Discordbot/i,
  /TelegramBot/i,
];

// ---------------------------------------------------------------------------
// Rate limiting — sliding window counters per IP
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number;
}

// Map<"ip:category", RateBucket>
const rateLimits = new Map<string, RateBucket>();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of rateLimits) {
    if (now > bucket.resetAt) {
      rateLimits.delete(key);
    }
  }
}

// Rate limit categories
type RateCategory = 'home' | 'api' | 'page' | 'sitemap';

const RATE_LIMITS: Record<RateCategory, { max: number; windowMs: number }> = {
  home: { max: 10, windowMs: 60_000 },      // 10 req/min
  api: { max: 20, windowMs: 60_000 },       // 20 req/min
  page: { max: 60, windowMs: 60_000 },      // 60 req/min
  sitemap: { max: 3, windowMs: 3_600_000 }, // 3 req/hour
};

function checkRateLimit(ip: string, category: RateCategory): { allowed: boolean; retryAfter: number } {
  const config = RATE_LIMITS[category];
  const key = `${ip}:${category}`;
  const now = Date.now();

  const bucket = rateLimits.get(key);

  if (!bucket || now > bucket.resetAt) {
    // New window
    rateLimits.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count++;

  if (bucket.count > config.max) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Honeypot blocklist — IPs that hit /trap/ URLs
// ---------------------------------------------------------------------------

const honeypotBlocklist = new Map<string, number>(); // ip → expiry timestamp
const HONEYPOT_BLOCK_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export function addToHoneypotBlocklist(ip: string) {
  honeypotBlocklist.set(ip, Date.now() + HONEYPOT_BLOCK_DURATION);
}

function isHoneypotBlocked(ip: string): boolean {
  const expiry = honeypotBlocklist.get(ip);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    honeypotBlocklist.delete(ip);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helper: get client IP
// ---------------------------------------------------------------------------

function getClientIp(request: Request): string {
  // Vercel sets x-forwarded-for
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  // Fallback
  return request.headers.get('x-real-ip') || '0.0.0.0';
}

// ---------------------------------------------------------------------------
// Helper: classify request path
// ---------------------------------------------------------------------------

function classifyPath(pathname: string): RateCategory | 'trap' | 'static' {
  if (pathname.startsWith('/trap/')) return 'trap';
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname.includes('sitemap')) return 'sitemap';
  if (pathname.startsWith('/_astro/') || pathname === '/favicon.svg' || pathname === '/favicon.ico' || pathname === '/robots.txt') return 'static';
  return 'page';
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const pathname = url.pathname;
  const category = classifyPath(pathname);

  // Skip rate limiting for static assets
  if (category === 'static') {
    return next();
  }

  // During Astro's build-time prerendering, the middleware runs but there is no
  // real HTTP client. We detect this via context.isPrerendered (Astro 5+).
  // In prerender context, `context.isPrerendered` is true.
  if ((context as any).isPrerendered) {
    return next();
  }

  const ip = getClientIp(request);
  const ua = request.headers.get('user-agent') || '';

  // --- Check honeypot blocklist ---
  if (isHoneypotBlocked(ip)) {
    return new Response('Forbidden', { status: 403 });
  }

  // --- Allow search engine bots (bypass all checks) ---
  if (SEARCH_ENGINE_BOTS.some(pattern => pattern.test(ua))) {
    return next();
  }

  // --- Block known bot User-Agents ---
  if (!ua || BLOCKED_UA_PATTERNS.some(pattern => pattern.test(ua))) {
    return new Response('Forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // --- Suspicious header check ---
  // Real browsers always send Accept-Language
  const acceptLang = request.headers.get('accept-language');
  const accept = request.headers.get('accept');

  // For HTML page requests, require browser-like headers
  if ((category === 'home' || category === 'page') && !acceptLang && !accept?.includes('text/html')) {
    return new Response('Forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // --- Rate limiting ---
  if (category !== 'trap') {
    cleanupStaleEntries();
    const rateCategory = category as RateCategory;
    const { allowed, retryAfter } = checkRateLimit(ip, rateCategory);
    if (!allowed) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: {
          'Content-Type': 'text/plain',
          'Retry-After': String(retryAfter),
        },
      });
    }
  }

  // --- Proceed to the actual request ---
  const response = await next();
  return response;
});
