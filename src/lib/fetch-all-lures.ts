import { supabase } from './supabase';

/**
 * Fetch all lures from Supabase with pagination.
 * Supabase default limit is 1000 rows, so we paginate to get everything.
 */
export async function fetchAllLures() {
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
      console.error('Error fetching lures:', error);
      break;
    }

    if (data && data.length > 0) {
      allLures = allLures.concat(data);
      from += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return allLures;
}
