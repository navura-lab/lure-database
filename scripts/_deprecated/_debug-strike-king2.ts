import 'dotenv/config';

async function main() {
  const url = 'https://www.strikeking.com/en/shop/hard-baits/hc4';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });
  const html = await response.text();

  // ld+json の周辺を確認
  const idx = html.indexOf('application/ld+json');
  if (idx < 0) {
    console.log('ld+json NOT FOUND');
    return;
  }

  // script タグの開始位置を見つける
  const scriptStart = html.lastIndexOf('<script', idx);
  console.log('Script tag starts at:', scriptStart);
  console.log('Script opening:', html.substring(scriptStart, scriptStart + 100));

  // script タグの終了位置を見つける
  const scriptEnd = html.indexOf('</script>', idx);
  console.log('Script end at:', scriptEnd);

  // JSON部分を抽出
  const jsonStart = html.indexOf('>', scriptStart) + 1;
  const jsonStr = html.substring(jsonStart, scriptEnd).trim();
  console.log('\nJSON length:', jsonStr.length);
  console.log('JSON first 200:', jsonStr.substring(0, 200));
  console.log('JSON last 200:', jsonStr.substring(jsonStr.length - 200));

  // パースを試みる
  try {
    const data = JSON.parse(jsonStr);
    console.log('\n✅ JSON パース成功');
    console.log('@type:', data['@type']);
    console.log('name:', data.name);
    console.log('variants:', data.hasVariant?.length);
  } catch (err) {
    console.log('\n❌ JSON パース失敗:', (err as Error).message);
    // エラー位置の周辺を表示
    const posMatch = (err as Error).message.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      console.log('Error context:', jsonStr.substring(Math.max(0, pos - 50), pos + 50));
    }
  }

  // 元の正規表現でテスト
  const regex = /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi;
  const match = regex.exec(html);
  console.log('\n--- Regex match:', match ? 'FOUND' : 'NOT FOUND');
  if (match) {
    console.log('Match group 1 length:', match[1].length);
  }
}

main().catch(console.error);
