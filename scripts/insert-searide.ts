const SUPABASE_URL = 'https://yfudrlytuoyyqtuqknry.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ssSsziZ_e4_gbXFPnngH3g__-DMZGpw';

// シーライドのカラー・重量データ
const colors = [
  { name: 'ブルピン', slug: 'bluepink', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/bluepink.png' },
  { name: 'アカキングロー', slug: 'akakinglow', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/akakinglow.png' },
  { name: 'チャートバックグロー', slug: 'chart-back-glow', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/chart-back-glow.png' },
  { name: 'ピンクグロー', slug: 'pink-glow', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/pink-glow.png' },
  { name: 'ゴールドグリーン', slug: 'gold-green', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/gold-green.png' },
  { name: 'ブルーサーディン', slug: 'blue-sardine', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/blue-sardine.png' },
  { name: 'レッドゴールド', slug: 'red-gold', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/red-gold.png' },
  { name: 'シルバーレインボー', slug: 'silver-rainbow', image: 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/silver-rainbow.png' },
];

const weights = [
  { g: 20, price: 665 },
  { g: 30, price: 715 },
  { g: 40, price: 770 },
  { g: 60, price: 820 },
];

async function insertLure(data: any) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/lures', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  
  return res.ok;
}

async function main() {
  let success = 0;
  let fail = 0;
  
  for (const color of colors) {
    for (const weight of weights) {
      const data = {
        name: 'シーライド',
        slug: 'sea-ride-' + color.slug + '-' + weight.g + 'g',
        manufacturer: 'BlueBlueFishing',
        manufacturer_slug: 'blueblue',
        type: 'メタルジグ',
        price: weight.price,
        description: 'シーライドは左右非対称のセンターバランス設計。フォールとリトリーブでアクションが変化し、多彩な誘いが可能。',
        images: [color.image],
        target_fish: ['青物', 'シーバス', 'タチウオ', 'マダイ'],
        weight: weight.g,
        color_name: color.name,
        release_year: 2022,
        action_type: 'フォール・スライド',
      };
      
      const ok = await insertLure(data);
      if (ok) {
        success++;
        console.log('OK:', color.name, weight.g + 'g');
      } else {
        fail++;
        console.log('FAIL:', color.name, weight.g + 'g');
      }
    }
  }
  
  console.log('\nTotal: ' + success + ' success, ' + fail + ' fail');
}

main().catch(console.error);
