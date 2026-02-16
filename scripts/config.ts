// scripts/config.ts
// Centralized configuration for the scraping pipeline
// All secrets are loaded from environment variables

import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// --- R2 (Cloudflare) ---
export const R2_ENDPOINT = requireEnv('R2_ENDPOINT');
export const R2_BUCKET = requireEnv('R2_BUCKET');
export const R2_PUBLIC_URL = requireEnv('R2_PUBLIC_URL');
export const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
export const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
export const R2_REGION = 'auto';

// --- Supabase ---
export const SUPABASE_URL = requireEnv('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

// --- Airtable ---
export const AIRTABLE_PAT = requireEnv('AIRTABLE_PAT');
export const AIRTABLE_BASE_ID = requireEnv('AIRTABLE_BASE_ID');
export const AIRTABLE_LURE_URL_TABLE_ID = requireEnv('AIRTABLE_LURE_URL_TABLE_ID');
export const AIRTABLE_MAKER_TABLE_ID = requireEnv('AIRTABLE_MAKER_TABLE_ID');
export const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// --- Vercel ---
export const VERCEL_DEPLOY_HOOK = requireEnv('VERCEL_DEPLOY_HOOK');

// --- Scraping ---
export const BLUEBLUE_BASE_URL = 'https://www.bluebluefishing.com';
export const PAGE_LOAD_DELAY_MS = 2000;

// --- Image Processing ---
export const IMAGE_WIDTH = 500;
export const IMAGE_FORMAT = 'webp' as const;
