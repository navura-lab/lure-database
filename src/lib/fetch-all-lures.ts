import { supabase } from './supabase';

/**
 * Fetch all lures from Supabase with pagination.
 * Supabase default limit is 1000 rows, so we paginate to get everything.
 */
export async function fetchAllLures() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  console.log(`[fetchAllLures] Supabase URL: ${url ? url.substring(0, 30) + '...' : 'MISSING'}`);
  console.log(`[fetchAllLures] Supabase Key: ${key ? key.substring(0, 20) + '...' : 'MISSING'}`);

  let allLures: any[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('lures')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('[fetchAllLures] Error:', JSON.stringify(error));
      break;
    }

    console.log(`[fetchAllLures] Page from=${from}: ${data?.length ?? 0} rows`);

    if (data && data.length > 0) {
      allLures = allLures.concat(data);
      from += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`[fetchAllLures] Total: ${allLures.length} lures`);
  return allLures;
}
