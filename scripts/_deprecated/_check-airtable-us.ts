// scripts/_check-airtable-us.ts
// 新10ブランドの未処理件数をAirtableメーカーリンク経由で確認
import 'dotenv/config';

const PAT = process.env.AIRTABLE_PAT!;
const BASE = process.env.AIRTABLE_BASE_ID!;
const URL_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID!;

// メーカーレコードID（_register-us-makers.ts で取得済み）
const MAKER_IDS: Record<string, string> = {
  '6th-sense': 'recscJKT7eGWswQxA',
  'berkley-us': 'recs3w48VUrlOONg2',
  'livetarget': 'recu1c9cTIx7xcZ0d',
  'lunkerhunt': 'rec207d21qdsSALMc',
  'missile-baits': 'recjRutHOqQQCJJy5',
  'spro': 'reclJw5F09gmovFLb',
  'googan-baits': 'rec31zWfCRhzHqZmg',
  'lunker-city': 'reckx3gW4jntc6nut',
  'riot-baits': 'recNxklLIhuVgb4H2',
  'xzone-lures': 'rec0lq0OBtUpc6D8k',
};

async function countByMaker(makerId: string): Promise<{ total: number; pending: number }> {
  let total = 0;
  let pending = 0;
  let offset: string | undefined;
  do {
    const filter = encodeURIComponent(`RECORD_ID()!=''`);
    // メーカーリンクフィールドでフィルタ
    const linkedFilter = encodeURIComponent(`FIND('${makerId}', ARRAYJOIN(メーカー))`);
    const url = `https://api.airtable.com/v0/${BASE}/${URL_TABLE}?filterByFormula=${linkedFilter}&fields%5B%5D=ステータス${offset ? '&offset=' + offset : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    const data = await res.json() as any;
    if (data.error) {
      console.error('API Error:', data.error);
      break;
    }
    for (const r of (data.records ?? [])) {
      total++;
      if (r.fields['ステータス'] === '未処理') pending++;
    }
    offset = data.offset;
  } while (offset);
  return { total, pending };
}

async function main() {
  let grandTotal = 0;
  let grandPending = 0;
  for (const [slug, makerId] of Object.entries(MAKER_IDS)) {
    const { total, pending } = await countByMaker(makerId);
    console.log(`${slug}: ${total} total, ${pending} 未処理`);
    grandTotal += total;
    grandPending += pending;
  }
  console.log(`\n合計: ${grandTotal} total, ${grandPending} 未処理`);
}
main().catch(console.error);
