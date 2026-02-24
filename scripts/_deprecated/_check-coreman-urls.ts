// Check all COREMAN gap URLs to categorize: stub vs real page
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

var supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
var AIRTABLE_PAT = process.env.AIRTABLE_PAT as string;
var AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appy0PFXPaBfXnNDV';
var AIRTABLE_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID || 'tbl6ZIZkIjcj4uF3s';
var AIRTABLE_MAKER_TABLE = process.env.AIRTABLE_MAKER_TABLE_ID || 'tbluGJQ0tGtcaStYU';

async function fetchAll(tableId: string, filter?: string): Promise<any[]> {
  var all: any[] = []; var offset: string | undefined;
  do {
    var q = filter ? '?filterByFormula=' + encodeURIComponent(filter) : '?';
    if (offset) q += '&offset=' + encodeURIComponent(offset);
    var res = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + tableId + q, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT } });
    var data = await res.json() as any;
    if (data.records) all = all.concat(data.records);
    offset = data.offset;
    if (offset) await new Promise(function(r) { setTimeout(r, 200); });
  } while (offset);
  return all;
}

async function main() {
  // Build maker map
  var makers = await fetchAll(AIRTABLE_MAKER_TABLE);
  var makerSlugById: Record<string, string> = {};
  makers.forEach(function(m: any) { makerSlugById[m.id] = m.fields['Slug'] || ''; });

  // Get Supabase URLs
  var allRows: any[] = []; var from = 0;
  while (from < 100000) {
    var batch = await supabase.from('lures').select('source_url').eq('manufacturer_slug', 'coreman').range(from, from + 999);
    if (!batch.data || batch.data.length === 0) break;
    allRows = allRows.concat(batch.data);
    from += 1000;
  }
  var supaUrls = new Set(allRows.map(function(r) { return r.source_url; }));

  // Get Airtable records
  var records = await fetchAll(AIRTABLE_TABLE);
  var coremanRecs = records.filter(function(r: any) {
    var ids = r.fields['メーカー'] || [];
    return ids.length > 0 && makerSlugById[ids[0]] === 'coreman';
  });

  var missing = coremanRecs.filter(function(r: any) {
    return r.fields['ステータス'] === '登録完了' && r.fields['URL'] && !supaUrls.has(r.fields['URL']);
  });

  console.log('Total COREMAN gaps: ' + missing.length);
  var urls = missing.map(function(r: any) { return r.fields['URL']; });

  // Check each URL quickly
  var browser = await chromium.launch({ headless: true });
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    var page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(function() {});
    await page.waitForTimeout(2000);
    var info = await page.evaluate(function() {
      var bodyLen = (document.body.innerText || '').trim().length;
      var imgCount = document.querySelectorAll('img').length;
      var eConCount = document.querySelectorAll('.e-con').length;
      var hasColorImg = document.querySelectorAll('img[src*="/color-"]').length;
      var hasWpImg = document.querySelectorAll('img[src*="/wp-content/uploads/"]').length;
      var hasFigure = document.querySelectorAll('figure').length;
      var hasSpec = (document.body.innerText || '').indexOf('SPEC') >= 0;
      var hasColorLineup = (document.body.innerText || '').indexOf('COLOR') >= 0;
      return { bodyLen: bodyLen, imgCount: imgCount, eConCount: eConCount, hasColorImg: hasColorImg, hasWpImg: hasWpImg, hasFigure: hasFigure, hasSpec: hasSpec, hasColorLineup: hasColorLineup };
    });
    var status = info.bodyLen < 300 && info.imgCount <= 5 ? 'STUB' : 'REAL';
    console.log('[' + status + '] ' + url + ' | body=' + info.bodyLen + 'ch imgs=' + info.imgCount + ' e-con=' + info.eConCount + ' color-img=' + info.hasColorImg + ' wp-img=' + info.hasWpImg + ' fig=' + info.hasFigure + ' spec=' + info.hasSpec + ' color=' + info.hasColorLineup);
    await page.close();
  }
  await browser.close();
}
main();
