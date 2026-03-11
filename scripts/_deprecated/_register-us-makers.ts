// scripts/_register-us-makers.ts
// Airtableのメーカーテーブルに10社のUSブランドを一括登録
import 'dotenv/config';

const PAT = process.env.AIRTABLE_PAT!;
const BASE = process.env.AIRTABLE_BASE_ID!;
const TABLE = process.env.AIRTABLE_MAKER_TABLE_ID!;

const US_MAKERS = [
  { name: '6th Sense', slug: '6th-sense' },
  { name: 'Berkley (US)', slug: 'berkley-us' },
  { name: 'LiveTarget', slug: 'livetarget' },
  { name: 'Lunkerhunt', slug: 'lunkerhunt' },
  { name: 'Missile Baits', slug: 'missile-baits' },
  { name: 'SPRO', slug: 'spro' },
  { name: 'Googan Baits', slug: 'googan-baits' },
  { name: 'Lunker City', slug: 'lunker-city' },
  { name: 'Riot Baits', slug: 'riot-baits' },
  { name: 'X Zone Lures', slug: 'xzone-lures' },
];

async function main() {
  // まず既存レコード1件取得してフィールド構造を確認
  const checkRes = await fetch(
    `https://api.airtable.com/v0/${BASE}/${TABLE}?maxRecords=2`,
    { headers: { Authorization: `Bearer ${PAT}` } },
  );
  const checkData = await checkRes.json() as any;
  console.log('既存レコードのフィールド構造:');
  console.log(JSON.stringify(Object.keys(checkData.records[0].fields), null, 2));
  console.log('サンプル:', JSON.stringify(checkData.records[0].fields, null, 2));

  // 既存slugを確認（重複防止）
  let allRecords: any[] = [];
  let offset: string | undefined;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?fields%5B%5D=Slug${offset ? '&offset=' + offset : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    const data = await res.json() as any;
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);

  const existingSlugs = new Set(allRecords.map((r: any) => r.fields.Slug));
  console.log(`\n既存メーカー数: ${existingSlugs.size}`);

  // 登録
  const toCreate = US_MAKERS.filter(m => !existingSlugs.has(m.slug));
  const alreadyExists = US_MAKERS.filter(m => existingSlugs.has(m.slug));

  if (alreadyExists.length > 0) {
    console.log(`\n既に登録済み: ${alreadyExists.map(m => m.slug).join(', ')}`);
  }

  if (toCreate.length === 0) {
    console.log('\n全メーカーが登録済み。何もしません。');
    return;
  }

  console.log(`\n登録対象: ${toCreate.map(m => m.slug).join(', ')}`);

  // Airtableは最大10件ずつバッチ作成
  for (let i = 0; i < toCreate.length; i += 10) {
    const batch = toCreate.slice(i, i + 10);
    const records = batch.map(m => ({
      fields: {
        'メーカー名': m.name,
        'Slug': m.slug,
      },
    }));

    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`❌ バッチ作成失敗:`, err);
      continue;
    }

    const result = await res.json() as any;
    for (const rec of result.records) {
      console.log(`✅ ${rec.fields['メーカー名']} (${rec.fields.Slug}) → ${rec.id}`);
    }
  }

  console.log('\n完了！');
}

main().catch(console.error);
