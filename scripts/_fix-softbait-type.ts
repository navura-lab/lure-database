import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // soft-bait URLでワーム以外のtypeを持つものを修正
  const fixes = [
    { slug: 'ronguemu', correctType: 'ワーム' },
    { slug: 'ishadclio', correctType: 'ワーム' },
    { slug: 'kvd-perfect-plastics-caffeine-shad-soft-jerkbait-5', correctType: 'ワーム' },
    // deadslowlerはスイムベイト系ワームなのでスイムベイトでも許容だが、ソフトベイトカテゴリなのでワームに
    { slug: 'deadslowler-full-contact', correctType: 'ワーム' },
  ];
  
  for (const fix of fixes) {
    const { data, error } = await sb.from('lures')
      .update({ type: fix.correctType })
      .eq('slug', fix.slug)
      .select('id');
    console.log(`${fix.slug}: ${data?.length || 0}件更新, error: ${error?.message || 'none'}`);
  }
}
main();
