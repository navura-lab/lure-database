// scripts/_debug-discover.ts
// discoverの返すURLと、Airtable既存URLの照合をデバッグ
import 'dotenv/config';
import { createShopifyDiscover } from './scrapers/shopify-generic.js';

const PAT = process.env.AIRTABLE_PAT!;
const BASE = process.env.AIRTABLE_BASE_ID!;
const URL_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID!;

async function main() {
  // 1. 6th-sense discover のURL取得
  const discover = createShopifyDiscover({
    domain: '6thsensefishing.com',
    slug: '6th-sense',
  });

  console.log('Discovering 6th Sense products...');
  const products = await discover(null as any); // fetchOnly なので page 不要
  console.log(`Found ${products.length} products`);
  console.log('Sample URLs:');
  products.slice(0, 5).forEach(p => console.log(`  ${p.url}`));

  // 2. Airtable既存URLをサンプル確認（6thsenseを含むか）
  console.log('\nChecking Airtable for 6thsense URLs...');
  const filter = encodeURIComponent(`FIND('6thsense', {URL})`);
  const url = `https://api.airtable.com/v0/${BASE}/${URL_TABLE}?filterByFormula=${filter}&fields%5B%5D=URL&fields%5B%5D=manufacturer_slug&maxRecords=5`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  const data = await res.json() as any;
  console.log(`Airtable records with "6thsense" in URL: ${data.records?.length ?? 0}`);
  data.records?.forEach((r: any) => console.log(`  ${r.fields.manufacturer_slug}: ${r.fields.URL}`));

  // 3. Airtable全URLをチェック - サンプルURLが含まれるか
  if (products.length > 0) {
    const sampleUrl = products[0].url.trim().replace(/\/$/, '');
    console.log(`\nChecking if sample URL exists in Airtable: ${sampleUrl}`);
    const filter2 = encodeURIComponent(`{URL}='${sampleUrl}'`);
    const url2 = `https://api.airtable.com/v0/${BASE}/${URL_TABLE}?filterByFormula=${filter2}&maxRecords=1`;
    const res2 = await fetch(url2, { headers: { Authorization: `Bearer ${PAT}` } });
    const data2 = await res2.json() as any;
    console.log(`Found: ${data2.records?.length ?? 0}`);
    if (data2.records?.length > 0) {
      console.log(`Record:`, JSON.stringify(data2.records[0].fields, null, 2));
    }
  }
}
main().catch(console.error);
