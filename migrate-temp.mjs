import pg from 'pg';

// Pooler Session mode (port 5432 → 6543)
const client = new pg.Client({
  connectionString: 'postgresql://postgres.yfudrlytuoyyqtuqknry:EFGwxdw1JpcM1GoU@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'
});

await client.connect();
console.log('Connected!');

await client.query('TRUNCATE TABLE public.lures');
console.log('Truncated lures');

await client.query('ALTER TABLE public.lures ADD COLUMN IF NOT EXISTS slug TEXT');
await client.query('ALTER TABLE public.lures ADD COLUMN IF NOT EXISTS manufacturer_slug TEXT');
console.log('Added columns');

await client.query('CREATE INDEX IF NOT EXISTS idx_lures_slug ON public.lures(slug)');
await client.query('CREATE INDEX IF NOT EXISTS idx_lures_manufacturer_slug ON public.lures(manufacturer_slug)');
console.log('Created indexes');

await client.end();
console.log('Migration complete!');
