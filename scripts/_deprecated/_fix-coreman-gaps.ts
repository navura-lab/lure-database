// Mark COREMAN stub pages as エラー, reset real pages to 未処理
var AIRTABLE_PAT = process.env.AIRTABLE_PAT as string;
var AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appy0PFXPaBfXnNDV';
var AIRTABLE_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID || 'tbl6ZIZkIjcj4uF3s';
var AIRTABLE_MAKER_TABLE = process.env.AIRTABLE_MAKER_TABLE_ID || 'tbluGJQ0tGtcaStYU';

// Stub pages (empty, no content)
var STUB_URLS = [
  'https://www.coreman.jp/product_lure/alkali-70%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/ip-10-ironplate-highlow/',
  'https://www.coreman.jp/product_lure/alkalishad-90%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/alkalishad-75%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/adh-01-alkali-dart-head/',
  'https://www.coreman.jp/product_lure/ph-02-powerhead%ef%bc%8bg/',
  'https://www.coreman.jp/product_lure/ph-5-powerhead-mini/',
  'https://www.coreman.jp/product_lure/bc-10-backchatter/',
  'https://www.coreman.jp/product_lure/ip-16-ironplate-highlow/',
  'https://www.coreman.jp/product_lure/alkali-60%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/alkalishad-55%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/alkali-83%e3%8e%9c/',
];

async function fetchAll(tableId: string): Promise<any[]> {
  var all: any[] = []; var offset: string | undefined;
  do {
    var q = offset ? '?offset=' + encodeURIComponent(offset) : '?';
    var res = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + tableId + q, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT } });
    var data = await res.json() as any;
    if (data.records) all = all.concat(data.records);
    offset = data.offset;
    if (offset) await new Promise(function(r) { setTimeout(r, 200); });
  } while (offset);
  return all;
}

async function patchBatch(ids: string[], fields: Record<string, any>): Promise<void> {
  for (var i = 0; i < ids.length; i += 10) {
    var batch = ids.slice(i, i + 10);
    var body = { records: batch.map(function(id) { return { id: id, fields: fields }; }) };
    await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + AIRTABLE_TABLE, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (i + 10 < ids.length) await new Promise(function(r) { setTimeout(r, 250); });
  }
}

async function main() {
  var makers = await fetchAll(AIRTABLE_MAKER_TABLE);
  var makerSlugById: Record<string, string> = {};
  makers.forEach(function(m: any) { makerSlugById[m.id] = m.fields['Slug'] || ''; });

  var records = await fetchAll(AIRTABLE_TABLE);
  var coremanRecs = records.filter(function(r: any) {
    var ids = r.fields['メーカー'] || [];
    return ids.length > 0 && makerSlugById[ids[0]] === 'coreman';
  });

  var stubSet = new Set(STUB_URLS);
  var stubIds: string[] = [];
  var realIds: string[] = [];

  coremanRecs.forEach(function(r: any) {
    var url = r.fields['URL'] || '';
    var status = r.fields['ステータス'] || '';
    if (status === '登録完了' && stubSet.has(url)) {
      stubIds.push(r.id);
      console.log('[STUB→エラー] ' + url);
    } else if (status === '登録完了') {
      // Check if it's in our gap list but NOT a stub
      // We'll reset ALL 登録完了 coreman records that have 0 supabase rows
      // For simplicity, just reset non-stub 登録完了 ones
    }
  });

  // Reset ALL non-stub coreman 登録完了 records to 未処理
  // (simpler approach: reset all to 未処理, pipeline will skip already-existing ones)
  var allToReset: string[] = [];
  coremanRecs.forEach(function(r: any) {
    var url = r.fields['URL'] || '';
    var status = r.fields['ステータス'] || '';
    if (status === '登録完了' && !stubSet.has(url)) {
      // Only reset if this URL was in our gap list
      // We don't have the gap list here, so we reset all non-stub 登録完了
      // Pipeline will skip ones that already have supabase data
    }
  });

  // Actually, let's be more targeted. Reset only REAL gap URLs
  var REAL_URLS = [
    'https://www.coreman.jp/product_lure/booster-system-123/',
    'https://www.coreman.jp/product_lure/ip-25-ironplate-highlow-sc/',
    'https://www.coreman.jp/product_lure/pb-20-powerblade/',
    'https://www.coreman.jp/product_lure/pb-13-powerblade%e2%91%a1/',
    'https://www.coreman.jp/product_lure/ij-22-ironjighead/',
    'https://www.coreman.jp/product_lure/alkalishad-110%e3%8e%9c/',
    'https://www.coreman.jp/product_lure/vj-36-vibration-jighead/',
    'https://www.coreman.jp/product_lure/test%e2%91%a0/',
    'https://www.coreman.jp/product_lure/rj-16-rollingjighead/',
    'https://www.coreman.jp/product_lure/ip-35-ironplate-highlow-sc/',
  ];
  var realSet = new Set(REAL_URLS);

  coremanRecs.forEach(function(r: any) {
    var url = r.fields['URL'] || '';
    var status = r.fields['ステータス'] || '';
    if (realSet.has(url)) {
      realIds.push(r.id);
      console.log('[REAL→未処理] ' + url);
    }
  });

  console.log('\nStub records to mark as エラー: ' + stubIds.length);
  console.log('Real records to reset to 未処理: ' + realIds.length);

  if (stubIds.length > 0) {
    await patchBatch(stubIds, { 'ステータス': 'エラー', '備考': 'サイト側空ページ（コンテンツなし）' });
    console.log('Marked ' + stubIds.length + ' stub records as エラー');
  }

  if (realIds.length > 0) {
    await patchBatch(realIds, { 'ステータス': '未処理', '備考': '' });
    console.log('Reset ' + realIds.length + ' real records to 未処理');
  }
}
main();
