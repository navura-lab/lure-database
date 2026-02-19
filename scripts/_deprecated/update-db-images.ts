const SUPABASE_URL = 'https://yfudrlytuoyyqtuqknry.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ssSsziZ_e4_gbXFPnngH3g__-DMZGpw';

// R2画像URLマッピング
const r2Images: Record<string, string> = {
  'ブルピン': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/bluepink.png',
  'アカキングロー': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/akakinglow.png',
  'チャートバックグロー': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/chart-back-glow.png',
  'ピンクグロー': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/pink-glow.png',
  'ゴールドグリーン': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/gold-green.png',
  'ブルーサーディン': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/blue-sardine.png',
  'レッドゴールド': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/red-gold.png',
  'シルバーレインボー': 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/blueblue/sea-ride/silver-rainbow.png',
};

async function main() {
  // まずシーライドのデータを取得
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/lures?select=id,name,color_name,images&name=eq.シーライド',
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      }
    }
  );
  
  const data = await res.json();
  console.log('Found', data.length, 'SeaRide entries');
  
  for (const row of data) {
    const colorName = row.color_name;
    const r2Url = r2Images[colorName];
    
    if (r2Url) {
      const updateRes = await fetch(
        SUPABASE_URL + '/rest/v1/lures?id=eq.' + row.id,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ images: [r2Url] }),
        }
      );
      
      if (updateRes.ok) {
        console.log('Updated:', colorName);
      } else {
        console.log('Failed:', colorName, updateRes.status);
      }
    } else {
      console.log('No R2 image for:', colorName);
    }
  }
  
  console.log('Done!');
}

main().catch(console.error);
