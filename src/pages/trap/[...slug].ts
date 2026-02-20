// src/pages/trap/[...slug].ts
// Honeypot trap — any request to /trap/* is from a scraper.
// Real browsers never see these links (hidden via CSS + aria-hidden).
// On access: block the IP via the middleware blocklist for 24 hours.

import type { APIRoute } from 'astro';
import { addToHoneypotBlocklist } from '../../middleware';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || '0.0.0.0';

  // Add IP to the blocklist (24h ban)
  addToHoneypotBlocklist(ip);

  console.warn(`[HONEYPOT] Blocked IP: ${ip}, UA: ${request.headers.get('user-agent')}, Path: ${new URL(request.url).pathname}`);

  // Return a plausible-looking 404 so scrapers don't know they've been caught
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain' },
  });
};

// Also handle POST, PUT etc.
export const ALL: APIRoute = async (context) => {
  return GET(context);
};
