import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// GSCで発見された旧フォーマットURLから、正しいリダイレクト先を見つける
async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  // 全ルアーのslug一覧を取得
  const slugMap = new Map<string, string>(); // key: manufacturer_slug/slug
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, manufacturer_slug, name')
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      if (r.slug && r.manufacturer_slug) {
        const key = `${r.manufacturer_slug}/${r.slug}`;
        if (!slugMap.has(key)) slugMap.set(key, r.name || '');
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  
  // メーカーslug一覧
  const makers = new Set<string>();
  for (const key of slugMap.keys()) {
    makers.add(key.split('/')[0]);
  }

  // 旧フォーマットURL（GSCで発見）
  const oldUrls = [
    // アンダースコアslug（hideup系）
    '/hideup/stagger_original_35/',
    '/hideup/Metallo_crank_30_FR/',
    '/hideup/HU-SCOONJIG/',
    '/hideup/coike_fullcast_soft/',
    '/hideup/coike_micro/',
    '/hideup/coike_shrimp_big/',
    '/hideup/risebacker_r_hi_sound/',
    '/hideup/stagger_wide_7/',
    '/hideup/coike_shad/',
    '/hideup/coike_shrimp/',
    '/hideup/hu-n-greedie_z_model_salt/',
    '/hideup/stagger_original_5/',
    '/hideup/stagger_original_6/',
    '/hideup/stagger_stick_5/',
    '/hideup/stagger_wide_hog_27/',
    '/hideup/HU-500/',
    '/hideup/HU-70_SDA_bass/',
    '/hideup/HU-150/',
    '/hideup/HU-200/',
    '/hideup/HU-300/',
    '/hideup/HU-30BT/',
    '/hideup/HU-350/',
    '/hideup/HU-400/',
    '/hideup/HU-70L/',
    '/hideup/HU-70_SDA_salt/',
    '/hideup/HU-CaluRuba50hook/',
    '/hideup/HU-Minnow111F/',
    '/hideup/HU-Minnow77SP_salt/',
    '/hideup/HUShad60SP/',
    '/hideup/coike_shrimp_extralarge/',
    '/hideup/coike_shrimp_mini/',
    '/hideup/coike_straight_140/',
    '/hideup/coike_thunder_M/',
    '/hideup/coike_trailer/',
    '/hideup/stagger_original_4/',
    '/hideup/stagger_original_67/',
    '/hideup/stagger_pintail/',
    '/hideup/stagger_wide_5/',
    '/hideup/stagger_wide_hog_22/',
    '/hideup/new_pylon84/',
    '/hideup/HU-Minnow111SP/',
    '/hideup/HU-Minnow111FS/',
    // engine系
    '/engine/swimmingmaster5_8/',
    '/engine/swimmingmaster1_4/',
    '/engine/swimmingmaster3_8/',
    // ecogear系
    '/ecogear/aji_shokunin_soft_sansun/',
    '/ecogear/jukusei_tairaba_aqua_curly_slim/',
    '/ecogear/ecogear_jukusei_aqua_katsu-aji_komushi/',
    '/ecogear/kasago_shokunin_rock_claw/',
    '/ecogear/mebaru_shokunin_minnow_ss/',
    '/ecogear/power_dart_minnow/',
    // pazdesign系
    '/pazdesign/kaisey_bladedangan/',
    // tacklehouse系
    '/tacklehouse/con_csm/',
    // jazz系
    '/jazz/new_sh_d_r/',
    // megabass系
    '/megabass/flapslap_lbo/',
    '/megabass/marine_gang_cookai90/',
    '/megabass/dog-x_diamante/',
    '/megabass/hazedong_shad_sw/',
    '/megabass/vision_oneten_lbo/',
    '/megabass/x-nanahan_plus2/',
    // deps系
    '/deps/huge-pencil_nabura/',
    // jackall系
    '/jackall/taimu_baitkeeper/',
    // berkley系
    '/berkley/Micro-Crawler-4i/',
    // shimano系
    '/shimano/a155f00000c5cqmqav_p/',
  ];
  
  // 正規化して対応するルアーを探す
  const results: { source: string; destination: string; found: boolean }[] = [];
  
  for (const url of oldUrls) {
    const parts = url.replace(/^\/|\/$/g, '').split('/');
    if (parts.length !== 2) continue;
    const [maker, oldSlug] = parts;
    
    // 正規化: 小文字化、アンダースコア→ハイフン
    const normalizedSlug = oldSlug.toLowerCase().replace(/_/g, '-');
    
    // 完全一致を探す
    const exactKey = `${maker}/${normalizedSlug}`;
    if (slugMap.has(exactKey)) {
      results.push({ source: url, destination: `/${exactKey}/`, found: true });
      continue;
    }
    
    // 部分一致を探す
    const makerSlugs = [...slugMap.keys()].filter(k => k.startsWith(maker + '/'));
    const partialMatch = makerSlugs.find(k => {
      const s = k.split('/')[1];
      return s.includes(normalizedSlug) || normalizedSlug.includes(s);
    });
    if (partialMatch) {
      results.push({ source: url, destination: `/${partialMatch}/`, found: true });
      continue;
    }
    
    // メーカーページへフォールバック
    if (makers.has(maker)) {
      results.push({ source: url, destination: `/${maker}/`, found: false });
    } else {
      results.push({ source: url, destination: '/', found: false });
    }
  }
  
  // 結果出力
  console.log('--- 完全/部分一致 ---');
  results.filter(r => r.found).forEach(r => {
    console.log(`  "${r.source}" → "${r.destination}"`);
  });
  
  console.log('\n--- メーカーページへフォールバック ---');
  results.filter(r => !r.found).forEach(r => {
    console.log(`  "${r.source}" → "${r.destination}"`);
  });
  
  // vercel.json用のJSON出力
  console.log('\n--- vercel.json用 redirects ---');
  for (const r of results) {
    console.log(`    { "source": "${r.source}", "destination": "${r.destination}", "permanent": true },`);
  }
}
main().catch(console.error);
