import 'dotenv/config';
import { fetchAllLures } from '../src/lib/fetch-all-lures';
import { groupLuresBySeries } from '../src/lib/group-lures';

async function main() {
  const lures = await fetchAllLures();
  const series = groupLuresBySeries(lures ?? []);
  const sf = series.find(s => s.slug === 'shimmy-flat');
  if (sf) {
    console.log('slug:', sf.slug);
    console.log('name:', sf.name);
    console.log('representative_image:', sf.representative_image);
    console.log('color_count:', sf.color_count);
    console.log('colors:', sf.colors.map(c => `${c.color_name}: ${c.images?.[0]?.slice(-50) || 'NONE'}`).join('\n  '));
  } else {
    console.log('shimmy-flat NOT FOUND in grouped series');
    // slugで部分一致検索
    const matches = series.filter(s => s.slug.includes('shimmy'));
    console.log('shimmy matches:', matches.map(s => s.slug));
  }
}
main().catch(console.error);
