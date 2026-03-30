import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

const pairs = [
  ['gamakatsu','80-609'],
  ['carpenter','jig-1505'],
  ['tacklehouse','tklm'],
  ['jackson','mijinko'],
  ['osp','iwaver60f'],
  ['dstyle','geelacanth'],
  ['flash-union','full-metal-sonic'],
  ['evergreen','junglewalker'],
];

for (const [maker, slug] of pairs) {
  // このページのdescription取得
  const {data: target} = await sb.from('lures').select('name,slug,description').eq('manufacturer_slug', maker).eq('slug', slug).limit(1);
  if (!target?.length || !target[0].description) {
    console.log(`${maker}/${slug}: description無し`);
    continue;
  }
  const desc200 = target[0].description.substring(0, 200).trim();
  // 同じメーカーで同じdescription（先頭200文字）を持つ他のslugを探す
  const {data: dupes} = await sb.from('lures').select('slug,name').eq('manufacturer_slug', maker).neq('slug', slug).ilike('description', `${desc200.substring(0, 50)}%`);
  const uniqueSlugs = [...new Set(dupes?.map(r => r.slug))].slice(0, 5);
  if (uniqueSlugs.length > 0) {
    console.log(`⚠️ ${maker}/${slug} → canonicalOverride対象。重複先: ${uniqueSlugs.join(', ')}`);
  } else {
    console.log(`❓ ${maker}/${slug} → 重複なし。Google側の判断で別canonical選択？`);
  }
}
