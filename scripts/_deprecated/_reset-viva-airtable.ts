import 'dotenv/config';

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

async function airtableFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function main() {
  // 1. VIVAのmaker record IDを取得
  const makerData = await airtableFetch<any>(
    `${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=${encodeURIComponent("{slug}='viva'")}`
  );
  const makerId = makerData.records[0]?.id;
  console.log(`VIVA maker ID: ${makerId}`);

  // 2. VIVAの全レコードを取得（ステータスが「登録完了」or「エラー」のもの）
  let allRecords: any[] = [];
  let offset: string | undefined;
  do {
    const filter = encodeURIComponent(`AND({メーカー}='${makerId}',OR({ステータス}='登録完了',{ステータス}='エラー',{ステータス}='処理中'))`);
    let query = `${AIRTABLE_TABLE_ID}?filterByFormula=${filter}`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;

    const data = await airtableFetch<any>(query);
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset;
  } while (offset);

  console.log(`リセット対象: ${allRecords.length}件`);
  if (allRecords.length === 0) {
    // メーカーIDでフィルタできない場合、URLベースで再試行
    console.log('メーカーIDフィルタが効かない可能性。URL含むvivanet.co.jpでフィルタ...');
    offset = undefined;
    do {
      const filter = encodeURIComponent(`AND(FIND('vivanet.co.jp',{URL})>0,OR({ステータス}='登録完了',{ステータス}='エラー',{ステータス}='処理中'))`);
      let query = `${AIRTABLE_TABLE_ID}?filterByFormula=${filter}`;
      if (offset) query += `&offset=${encodeURIComponent(offset)}`;

      const data = await airtableFetch<any>(query);
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset;
    } while (offset);
    console.log(`URLフィルタ結果: ${allRecords.length}件`);
  }

  if (allRecords.length === 0) {
    console.log('リセット対象なし');
    return;
  }

  // 3. バッチ更新（10件ずつ）
  let updated = 0;
  for (let i = 0; i < allRecords.length; i += 10) {
    const batch = allRecords.slice(i, i + 10);
    const records = batch.map((r: any) => ({
      id: r.id,
      fields: { 'ステータス': '未処理', '備考': '' },
    }));

    await airtableFetch(`${AIRTABLE_TABLE_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });

    updated += batch.length;
    process.stdout.write(`\rリセット: ${updated}/${allRecords.length}件`);
  }

  console.log(`\n完了: ${updated}件を「未処理」にリセット`);
}

main();
